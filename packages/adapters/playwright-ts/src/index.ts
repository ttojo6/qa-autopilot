import { resolve } from "node:path";
import type {
  RunnerAdapter,
  AdapterContext,
  RunnerConfig,
  RunReport,
  TestResult,
  RawErrorType,
} from "@qa/shared";
import { runCommand, extractJson } from "@qa/shared";

/**
 * Playwright 어댑터 (스텁).
 *
 * Phase 0: `--reporter=json` 출력을 파싱해 TestResult 정규형으로 환원하는 자리.
 * 실제 spawn/parse 는 Phase 1 에서 구현한다. 지금은 계약과 매핑 규칙만 고정한다.
 */

/** Playwright 에러 메시지 → 저수준 RawErrorType 매핑 규칙. */
export function classifyPlaywrightError(message: string): RawErrorType {
  const m = message.toLowerCase();
  if (m.includes("timeout") || m.includes("exceeded")) return "timeout";
  if (m.includes("locator") || m.includes("not found") || m.includes("no element")) {
    return "element_not_found";
  }
  if (m.includes("net::") || m.includes("econnrefused") || m.includes("socket")) return "network";
  if (m.includes("expect(") || m.includes("to equal") || m.includes("received")) return "assertion";
  return "exception";
}

interface PlaywrightJsonSuite {
  readonly specs?: readonly {
    readonly title: string;
    readonly file: string;
    readonly tests?: readonly {
      readonly results?: readonly {
        readonly status: string;
        readonly duration: number;
        readonly error?: { readonly message?: string; readonly stack?: string };
        readonly retry: number;
      }[];
    }[];
  }[];
  readonly suites?: readonly PlaywrightJsonSuite[];
}

/** Playwright JSON 리포트를 정규형 TestResult[]로 변환 (재귀 suite 평탄화). */
export function parsePlaywrightJson(json: PlaywrightJsonSuite, runnerId: string): TestResult[] {
  const out: TestResult[] = [];
  const walk = (suite: PlaywrightJsonSuite): void => {
    for (const spec of suite.specs ?? []) {
      const last = spec.tests?.[0]?.results?.at(-1);
      const status = last?.status === "passed" ? "passed" : last?.status === "skipped" ? "skipped" : "failed";
      const errMsg = last?.error?.message;
      out.push({
        caseId: `${spec.file}::${spec.title}`,
        title: spec.title,
        runnerId,
        status,
        durationMs: last?.duration ?? 0,
        attempts: (last?.retry ?? 0) + 1,
        error: errMsg
          ? { type: classifyPlaywrightError(errMsg), message: errMsg, stack: last?.error?.stack, location: { file: spec.file } }
          : undefined,
        artifacts: [],
      });
    }
    for (const child of suite.suites ?? []) walk(child);
  };
  walk(json);
  return out;
}

export function createAdapter(): RunnerAdapter {
  return {
    adapterId: "playwright-ts",

    async run(config: RunnerConfig, ctx: AdapterContext): Promise<RunReport> {
      const cwd = resolve(ctx.projectRoot, config.workdir);
      ctx.logger(`[playwright-ts] exec: ${config.command} in ${cwd}`);
      const startedAt = new Date().toISOString();
      const res = await runCommand(config.command, cwd, config.timeoutMs ?? 600_000);
      const results = parseOutput(res.stdout, config.id, ctx);
      return { runnerId: config.id, startedAt, finishedAt: new Date().toISOString(), results };
    },

    async runCase(config, caseId, ctx): Promise<TestResult | undefined> {
      // caseId = "<file>::<title>". Playwright는 -g <title>로 제목 필터링.
      const title = caseId.split("::").slice(1).join("::") || caseId;
      const cwd = resolve(ctx.projectRoot, config.workdir);
      const escaped = title.replace(/"/g, '\\"');
      const cmd = `${config.command} -g "${escaped}"`;
      ctx.logger(`[playwright-ts] rerun case: ${title}`);
      const res = await runCommand(cmd, cwd, config.timeoutMs ?? 300_000);
      return parseOutput(res.stdout, config.id, ctx).find((r) => r.caseId === caseId);
    },
  };
}

function parseOutput(stdout: string, runnerId: string, ctx: AdapterContext): TestResult[] {
  const json = extractJson(stdout);
  if (!json) {
    ctx.logger(`[playwright-ts] no JSON report parsed from stdout`);
    return [];
  }
  try {
    return parsePlaywrightJson(JSON.parse(json), runnerId);
  } catch (e) {
    ctx.logger(`[playwright-ts] JSON parse failed: ${e instanceof Error ? e.message : e}`);
    return [];
  }
}
