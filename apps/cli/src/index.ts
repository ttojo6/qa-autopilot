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
import { writeProposals } from "./proposals-io.js";

/** 등록된 어댑터 레지스트리. 새 러너는 여기 한 줄로 추가된다(범용성). */
const ADAPTERS: Record<string, RunnerAdapter> = {
  "playwright-ts": playwright(),
  pytest: pytest(),
};

function parseArgs(argv: readonly string[]): { command: string; config: string; autoPr: boolean } {
  const command = argv[0] ?? "help";
  const ci = argv.indexOf("--config");
  const config = ci >= 0 ? (argv[ci + 1] ?? "") : "qa.config.yaml";
  return { command, config, autoPr: argv.includes("--auto-pr") };
}

async function cmdRun(configPath: string, autoPr: boolean): Promise<void> {
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

  // Triage: 미회복 실패만 분류·라우팅. ANTHROPIC_API_KEY 있으면 LLM escalation 활성화.
  const llm = process.env.ANTHROPIC_API_KEY ? new LlmClassifier() : undefined;
  const engine = new TriageEngine({ heuristic: new HeuristicClassifier(), llm });
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
  });
  const propFile = writeProposals(projectRoot, proposals);
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
      `  → ${propFile}  (콘솔: QA_PROPOSALS_FILE 로 지정)`,
      `retries used: ${b.retries}  cost: $${b.costUsd.toFixed(2)}  elapsed: ${(b.elapsedMs / 1000).toFixed(1)}s${result.budgetExhausted ? "  [BUDGET EXHAUSTED]" : ""}`,
      `triage source: ${llm ? "heuristic + claude" : "heuristic only (set ANTHROPIC_API_KEY for LLM escalation)"}`,
      `remediation: ${process.env.ANTHROPIC_API_KEY ? "claude-opus-4-8 generator" : "null generator (set ANTHROPIC_API_KEY)"}${autoPr ? " · auto-PR ON" : " · auto-PR off"}`,
    ].join("\n")
  );
}

async function main(): Promise<void> {
  const { command, config, autoPr } = parseArgs(process.argv.slice(2));
  switch (command) {
    case "run":
      await cmdRun(config, autoPr);
      break;
    default:
      console.log(
        "qa-autopilot\n\nUsage:\n  qa run --config <path> [--auto-pr]   실행→Triage→Remediation 한 사이클\n"
      );
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
