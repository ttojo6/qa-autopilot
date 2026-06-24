#!/usr/bin/env node
import { resolve, dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { runCycle, unrecoveredFailures, applyVerdict, type OrchestratorDeps } from "@qa/core";
import { TriageEngine, HeuristicClassifier, LlmClassifier } from "@qa/triage";
import type { RunnerAdapter, AdapterContext, Lane } from "@qa/shared";
import { createAdapter as playwright } from "@qa/adapter-playwright-ts";
import { createAdapter as pytest } from "@qa/adapter-pytest";
import { loadConfig } from "./config-loader.js";
import { remediate } from "./remediate.js";
import { persistProposals } from "./persist.js";
import { makeMetricsStore } from "./metrics-store.js";
import { makeRevertLedger } from "./revert-ledger.js";
import { CliGitLogReader, detectRemediationRollbacks } from "@qa/remediation";
import {
  AuthoringEngine,
  NullTestCaseGenerator,
  LlmTestCaseGenerator,
  NullDraftVerifier,
  toStored,
} from "@qa/authoring";
import { makeAuthoringStore } from "./authoring-store.js";
import { makeDraftVerifier, adapterRunDraft } from "./draft-verifier.js";
import { readFileSync } from "node:fs";
import {
  evaluateTriggers,
  deriveControls,
  countLanes,
  summarizeMetrics,
  DEFAULT_STOP_POLICY,
} from "@qa/metrics";

/** 등록된 어댑터 레지스트리. 새 러너는 여기 한 줄로 추가된다(범용성). */
const ADAPTERS: Record<string, RunnerAdapter> = {
  "playwright-ts": playwright(),
  pytest: pytest(),
};

interface Args {
  command: string;
  config: string;
  autoPr: boolean;
  failOnBlocking: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  const command = argv[0] ?? "help";
  const ci = argv.indexOf("--config");
  const config = ci >= 0 ? (argv[ci + 1] ?? "") : "qa.config.yaml";
  return {
    command,
    config,
    autoPr: argv.includes("--auto-pr"),
    failOnBlocking: argv.includes("--fail-on-blocking"),
  };
}

const pct = (n: number): string => `${(n * 100).toFixed(0)}%`;

function flagStr(argv: readonly string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

function flagNum(argv: readonly string[], flag: string): number {
  const i = argv.indexOf(flag);
  if (i < 0) return 0;
  const next = argv[i + 1];
  const n = next && !next.startsWith("--") ? Number(next) : 1;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
}

/** 사람 피드백을 누계에 기록한다 — STOP 트리거(R1 override / R2 rollback)의 분자.
 *  콘솔 UI 행동으로도 동일 누계에 기록되지만, 스크립트/수동 보정용으로 남겨둔다. */
async function cmdFeedback(configPath: string, argv: readonly string[]): Promise<void> {
  const projectRoot = dirname(resolve(process.cwd(), configPath));
  const { store, close } = makeMetricsStore(projectRoot);
  try {
    await store.addFeedback({
      humanOverrides: flagNum(argv, "--override"),
      merged: flagNum(argv, "--merged"),
      rolledBack: flagNum(argv, "--rolled-back"),
    });
    const s = await store.load();
    console.log(
      `feedback recorded\n  overrides=${s.feedback.humanOverrides} merged=${s.feedback.merged} rolledBack=${s.feedback.rolledBack} (분류 누계 n=${s.routing.total})`
    );
  } finally {
    await close();
  }
}

/**
 * 롤백 자동 감지 — git 로그에서 remediation 커밋을 되돌린 revert를 찾아 R2 분자를 무인 기록한다.
 * ledger로 중복 집계를 막는다(멱등). 콘솔 "롤백 보고" 버튼의 자동화 대체.
 */
async function cmdScanRollbacks(configPath: string): Promise<void> {
  const projectRoot = dirname(resolve(process.cwd(), configPath));
  const commits = await new CliGitLogReader(projectRoot).log(1000);
  const rollbacks = detectRemediationRollbacks(commits);

  const ledgerH = makeRevertLedger(projectRoot);
  const metricsH = makeMetricsStore(projectRoot);
  try {
    const newly = await ledgerH.ledger.markSeen(rollbacks.map((r) => r.revertSha));
    if (newly.length > 0) await metricsH.store.addFeedback({ rolledBack: newly.length });
    const s = await metricsH.store.load();
    console.log(
      [
        `scan-rollbacks: ${commits.length} commits scanned`,
        `  remediation reverts found: ${rollbacks.length}  (new this scan: ${newly.length})`,
        ...rollbacks.slice(0, 10).map((r) => `    ✗ ${r.revertSha.slice(0, 8)} reverts "${r.revertedSubject}"`),
        `  rolledBack 누계: ${s.feedback.rolledBack} / merged: ${s.feedback.merged}`,
      ].join("\n")
    );
  } finally {
    await ledgerH.close();
    await metricsH.close();
  }
}

/**
 * ① Authoring — 스펙(JSON)으로부터 테스트 초안을 생성·중복제거·검증해 리뷰 큐로 내보낸다.
 * 절대 레포에 테스트를 자동 추가하지 않는다 — 사람 승인 대상 제안만 만든다.
 */
async function cmdAuthor(configPath: string, argv: readonly string[]): Promise<void> {
  const projectRoot = dirname(resolve(process.cwd(), configPath));
  const specPath = flagStr(argv, "--spec");
  if (!specPath) {
    console.error("qa author: --spec <specs.json> required");
    process.exitCode = 1;
    return;
  }
  const specs = JSON.parse(readFileSync(resolve(process.cwd(), specPath), "utf8")) as Array<{
    id: string;
    description: string;
    targetRunner: string;
    context?: string;
  }>;
  if (!Array.isArray(specs) || specs.some((s) => !s.id || !s.description || !s.targetRunner)) {
    console.error("qa author: spec file must be an array of {id, description, targetRunner}");
    process.exitCode = 1;
    return;
  }

  const generator = process.env.ANTHROPIC_API_KEY
    ? new LlmTestCaseGenerator()
    : new NullTestCaseGenerator();

  // --verify: 초안을 worktree에 적용해 실제 러너로 검증. 미지정 시 검증 생략(not_run).
  const verify = argv.includes("--verify");
  const verifier = verify
    ? makeDraftVerifier({ repoRoot: projectRoot, runDraft: adapterRunDraft(loadConfig(resolve(process.cwd(), configPath)), ADAPTERS) })
    : new NullDraftVerifier();

  const engine = new AuthoringEngine({ generator, verifier });
  const proposals = await engine.author(specs);

  // 리뷰 큐에 적재(콘솔과 공유). 재적재 시 사람 결정은 보존.
  const runnerOf = new Map(specs.map((s) => [s.id, s.targetRunner]));
  const sh = makeAuthoringStore(projectRoot);
  try {
    for (const p of proposals) {
      await sh.store.upsert(toStored(p, runnerOf.get(p.draft.specId) ?? "unknown"));
    }
  } finally {
    await sh.close();
  }

  const byStatus: Record<string, number> = {};
  for (const p of proposals) byStatus[p.status] = (byStatus[p.status] ?? 0) + 1;
  const line = Object.entries(byStatus).map(([k, v]) => `${k}:${v}`).join("  ") || "(none)";
  console.log(
    [
      `author: ${specs.length} spec(s) → ${proposals.length} draft(s)  [${line}]`,
      `  generator: ${process.env.ANTHROPIC_API_KEY ? "claude-opus-4-8" : "null (set ANTHROPIC_API_KEY)"}  verify: ${verify ? "worktree" : "off"}`,
      `  → 리뷰 큐 적재(${process.env.DATABASE_URL ? "postgres" : "artifacts/test-proposals.json"}). 콘솔 /authoring 에서 승인.`,
      `  모든 초안은 사람 리뷰 대상 — 레포에 자동 추가되지 않음.`,
    ].join("\n")
  );
}

async function cmdRun(configPath: string, autoPr: boolean, failOnBlocking: boolean): Promise<void> {
  const abs = resolve(process.cwd(), configPath);
  const config = loadConfig(abs);
  const projectRoot = dirname(abs);

  const deps: OrchestratorDeps = {
    resolveAdapter: (id) => ADAPTERS[id],
    makeContext: (runnerId): AdapterContext => {
      const artifactDir = resolve(projectRoot, "artifacts", runnerId);
      mkdirSync(artifactDir, { recursive: true });
      return { projectRoot, artifactDir, logger: (m) => console.log(m) };
    },
  };

  const result = await runCycle(config, deps);

  // STOP 트리거: 과거 누계 성과가 이번 사이클 자동화를 게이팅한다.
  const metrics = makeMetricsStore(projectRoot);
  const prior = await metrics.store.load();
  const triggers = evaluateTriggers(prior, DEFAULT_STOP_POLICY);
  const controls = deriveControls(triggers);

  // Triage: 미회복 실패만 분류·라우팅. forceHuman 발동 시 전건 사람 큐로 강등.
  const llm = process.env.ANTHROPIC_API_KEY ? new LlmClassifier() : undefined;
  const engine = new TriageEngine(
    { heuristic: new HeuristicClassifier(), llm },
    { forceHuman: controls.forceHumanTriage }
  );
  const failures = unrecoveredFailures(result);
  const verdicts = await engine.triage(failures, config.triage);

  const counts: Record<Lane, number> = { retry: 0, quarantine: 0, signal: 0, human: 0 };
  let blocking = 0;
  for (const v of verdicts) {
    counts[v.lane] += 1;
    const decision = applyVerdict(v, config.governance);
    if (decision.releaseBlocking) blocking += 1;
  }

  // ⑤ Remediation: signal 판정만 수정 제안으로. (키 없으면 Null 생성기로 안전하게 no-op)
  const proposals = await remediate({
    config,
    projectRoot,
    adapters: ADAPTERS,
    failures,
    verdicts,
    enablePr: autoPr,
    disableAppSource: controls.disableAppSourceRemediation,
  });

  // 누계 갱신: 이번 사이클 라우팅을 더한다(피드백은 콘솔 UI 행동/`qa feedback`로 누적).
  await metrics.store.addRouting(countLanes(verdicts));
  const cumulative = await metrics.store.load();
  await metrics.close();
  const mv = summarizeMetrics(cumulative);
  const persisted = await persistProposals(projectRoot, proposals);
  const byStatus: Record<string, number> = {};
  for (const p of proposals) byStatus[p.status] = (byStatus[p.status] ?? 0) + 1;
  const statusLine = Object.entries(byStatus).map(([k, v]) => `${k}:${v}`).join("  ") || "(none)";

  const b = result.budget;
  console.log(
    [
      ``,
      `=== ${result.project} ===`,
      `unrecovered failures: ${failures.length}  (clusters: ${verdicts.length})`,
      `  signal: ${counts.signal}  human(review): ${counts.human}  quarantine: ${counts.quarantine}  retry: ${counts.retry}`,
      `release-blocking clusters: ${blocking}`,
      `remediation proposals: ${proposals.length}  [${statusLine}]`,
      `  → ${persisted.sink}: ${persisted.location}${persisted.sink === "file" ? "  (콘솔: QA_PROPOSALS_FILE 로 지정)" : "  (콘솔: 동일 DATABASE_URL)"}`,
      `retries used: ${b.retries}  cost: $${b.costUsd.toFixed(2)}  elapsed: ${(b.elapsedMs / 1000).toFixed(1)}s${result.budgetExhausted ? "  [BUDGET EXHAUSTED]" : ""}`,
      `triage source: ${llm ? "heuristic + claude" : "heuristic only (set ANTHROPIC_API_KEY for LLM escalation)"}`,
      `remediation: ${process.env.ANTHROPIC_API_KEY ? "claude-opus-4-8 generator" : "null generator (set ANTHROPIC_API_KEY)"}${autoPr ? " · auto-PR ON" : " · auto-PR off"}`,
      `metrics(cum n=${cumulative.routing.total}): quarantine ${pct(mv.quarantineRatio)} human ${pct(mv.humanRatio)} override ${pct(mv.overrideRate)} rollback ${pct(mv.rollbackRate)}`,
      `safety: forceHuman=${controls.forceHumanTriage} disableAppSource=${controls.disableAppSourceRemediation} reviewFlaky=${controls.reviewFlakySignals}`,
      ...triggers.map((t) => `  ⚠ STOP ${t.risk}: ${t.message} (n=${t.samples})`),
    ].join("\n")
  );

  // 릴리즈 게이트: CI에서 머지를 막는 종료코드. 노이즈는 이미 제외돼 있으므로
  // 여기서 막히는 것은 진짜 결함(signal) 또는 저신뢰(human) 클러스터뿐이다.
  if (failOnBlocking && blocking > 0) {
    console.error(`\n✖ release gate: ${blocking} blocking cluster(s) — failing CI (exit 2)`);
    process.exitCode = 2;
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const { command, config, autoPr, failOnBlocking } = parseArgs(argv);
  switch (command) {
    case "run":
      await cmdRun(config, autoPr, failOnBlocking);
      break;
    case "feedback":
      await cmdFeedback(config, argv);
      break;
    case "scan-rollbacks":
      await cmdScanRollbacks(config);
      break;
    case "author":
      await cmdAuthor(config, argv);
      break;
    default:
      console.log(
        [
          "qa-autopilot",
          "",
          "Usage:",
          "  qa run --config <path> [--auto-pr] [--fail-on-blocking]",
          "    실행→Triage→Remediation 한 사이클. --fail-on-blocking 시 release-blocking 있으면 exit 2.",
          "  qa feedback --config <path> [--override N] [--merged N] [--rolled-back N]",
          "    사람 피드백을 누계에 기록 → STOP 트리거(R1 override / R2 rollback) 평가에 반영.",
          "  qa scan-rollbacks --config <path>",
          "    git 로그에서 remediation 커밋을 되돌린 revert를 찾아 R2 rollback을 무인 기록(멱등).",
          "  qa author --config <path> --spec <specs.json>",
          "    스펙으로부터 테스트 초안 생성·중복제거·검증 → 리뷰 큐(test-proposals.json). 자동 추가 안 함.",
          "",
        ].join("\n")
      );
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
