import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import type {
  RunnerAdapter,
  AdapterContext,
  RunnerConfig,
  RunReport,
  TestResult,
  RawErrorType,
} from "@qa/shared";
import { runCommand } from "@qa/shared";

/**
 * pytest 어댑터 (스텁).
 *
 * Phase 0: `pytest-json-report` 의 .report.json 을 정규형으로 환원하는 자리.
 * Actnote 파이프라인(STT→화자분리→LLM→Notion) 테스트가 이 어댑터로 들어온다.
 */

/** pytest longrepr/crash 메시지 → RawErrorType 매핑. */
export function classifyPytestError(message: string): RawErrorType {
  const m = message.toLowerCase();
  if (m.includes("assert")) return "assertion";
  if (m.includes("timeout") || m.includes("timed out")) return "timeout";
  if (m.includes("connection") || m.includes("httperror") || m.includes("503") || m.includes("502")) {
    return "network";
  }
  if (m.includes("fixture") || m.includes("setup")) return "setup";
  return "exception";
}

interface PytestJsonReport {
  readonly tests?: readonly {
    readonly nodeid: string;
    readonly outcome: string; // passed | failed | skipped | error
    readonly call?: { readonly duration?: number; readonly longrepr?: string; readonly crash?: { message?: string } };
  }[];
}

export function parsePytestJson(report: PytestJsonReport, runnerId: string): TestResult[] {
  const out: TestResult[] = [];
  for (const t of report.tests ?? []) {
    const status = t.outcome === "passed" ? "passed" : t.outcome === "skipped" ? "skipped" : "failed";
    const msg = t.call?.crash?.message ?? t.call?.longrepr;
    out.push({
      caseId: t.nodeid,
      title: t.nodeid.split("::").at(-1) ?? t.nodeid,
      runnerId,
      status,
      durationMs: Math.round((t.call?.duration ?? 0) * 1000),
      attempts: 1,
      error: msg
        ? { type: classifyPytestError(msg), message: msg, location: { file: t.nodeid.split("::")[0] ?? "" } }
        : undefined,
      artifacts: [],
    });
  }
  return out;
}

/** pytest-json-report 는 결과를 .report.json 파일로 쓴다. 그 파일을 읽어 정규화. */
async function readReport(cwd: string, runnerId: string, ctx: AdapterContext): Promise<TestResult[]> {
  const path = resolve(cwd, ".report.json");
  try {
    const raw = await readFile(path, "utf8");
    return parsePytestJson(JSON.parse(raw), runnerId);
  } catch (e) {
    ctx.logger(`[pytest] could not read ${path}: ${e instanceof Error ? e.message : e}`);
    return [];
  }
}

export function createAdapter(): RunnerAdapter {
  return {
    adapterId: "pytest",

    async run(config: RunnerConfig, ctx: AdapterContext): Promise<RunReport> {
      const cwd = resolve(ctx.projectRoot, config.workdir);
      ctx.logger(`[pytest] exec: ${config.command} in ${cwd}`);
      const startedAt = new Date().toISOString();
      await runCommand(config.command, cwd, config.timeoutMs ?? 1_800_000);
      const results = await readReport(cwd, config.id, ctx);
      return { runnerId: config.id, startedAt, finishedAt: new Date().toISOString(), results };
    },

    async runCase(config, caseId, ctx): Promise<TestResult | undefined> {
      // pytest는 nodeid(caseId)를 인자로 받아 단일 케이스 실행.
      const cwd = resolve(ctx.projectRoot, config.workdir);
      const escaped = caseId.replace(/"/g, '\\"');
      const cmd = `${config.command} "${escaped}"`;
      ctx.logger(`[pytest] rerun case: ${caseId}`);
      await runCommand(cmd, cwd, config.timeoutMs ?? 600_000);
      return (await readReport(cwd, config.id, ctx)).find((r) => r.caseId === caseId);
    },
  };
}
