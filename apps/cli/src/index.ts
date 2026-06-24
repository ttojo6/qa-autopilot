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
          "",
        ].join("\n")
      );
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
