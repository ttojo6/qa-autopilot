import type {
  QaConfig,
  RunReport,
  RunnerAdapter,
  AdapterContext,
  TestResult,
  BudgetConfig,
} from "@qa/shared";
import { summarize } from "@qa/shared";
import { runRetryLane, selectFailures, type RetryOutcome } from "./lanes/retry-lane.js";
import { Budget, BudgetExceeded } from "./budget.js";

/**
 * Orchestrator — 한 사이클의 실행과 Retry Lane을 조율한다 (원칙 A).
 *
 * 책임 범위(의도적으로 좁게):
 *  - 러너 실행 → 정규형 수집
 *  - Retry Lane: 일시 장애만, 예산(Budget) 한도 내에서 재시도 (R3 방어)
 *  - 비용/시간/재시도 누계 보고
 *
 * Triage(AI 분류)·Signal Gate 라우팅은 이 모듈이 하지 않는다 — 상위(@qa/triage + applyVerdict)가
 * 조합한다. Orchestrator는 "코드를 수정하지 않는" 레인까지만 책임진다(원칙 A의 경계).
 */

const DEFAULT_BUDGET: BudgetConfig = {
  maxCostUsd: 5,
  maxWallMs: 30 * 60 * 1000,
  maxRetries: 50,
  costPerRerunUsd: 0.05,
};

export interface CycleResult {
  readonly project: string;
  readonly reports: readonly RunReport[];
  readonly retryOutcomes: readonly RetryOutcome[];
  readonly budget: ReturnType<Budget["snapshot"]>;
  /** 예산 초과로 중단됐는지. */
  readonly budgetExhausted: boolean;
}

export interface OrchestratorDeps {
  readonly resolveAdapter: (adapterId: string) => RunnerAdapter | undefined;
  readonly makeContext: (runnerId: string) => AdapterContext;
  readonly now?: () => number;
}

export async function runCycle(config: QaConfig, deps: OrchestratorDeps): Promise<CycleResult> {
  const budgetCfg = config.budget ?? DEFAULT_BUDGET;
  const budget = new Budget(budgetCfg, deps.now);
  const reports: RunReport[] = [];
  const retryOutcomes: RetryOutcome[] = [];
  let budgetExhausted = false;

  for (const runner of config.runners) {
    const adapter = deps.resolveAdapter(runner.adapter);
    if (!adapter) {
      throw new Error(`No adapter registered for "${runner.adapter}" (runner ${runner.id})`);
    }
    const ctx = deps.makeContext(runner.id);
    ctx.logger(`[${runner.id}] running via ${runner.adapter}…`);
    const report = await adapter.run(runner, ctx);
    reports.push(report);

    const s = summarize(report);
    ctx.logger(`[${runner.id}] total=${s.total} pass=${s.passed} fail=${s.failed} skip=${s.skipped}`);

    // Retry Lane — 일시 장애만, 예산 한도 내에서.
    if (budgetExhausted) continue;
    if (!adapter.runCase) {
      ctx.logger(`[${runner.id}] adapter has no runCase(); skipping Retry Lane`);
      continue;
    }
    const retryable = selectFailures(report, config.retry);
    for (const failure of retryable) {
      if (!budget.hasHeadroom()) {
        budgetExhausted = true;
        ctx.logger(`[${runner.id}] budget exhausted — remaining retries skipped`);
        break;
      }
      try {
        const outcome = await runRetryLane(
          {
            result: failure,
            rerun: async () => {
              budget.check(); // 한도 초과면 throw → 재시도 중단
              budget.recordRetry();
              budget.recordCost(budgetCfg.costPerRerunUsd);
              const r = await adapter.runCase!(runner, failure.caseId, ctx);
              return r ?? failure; // 결과 미확인 시 원래 실패 유지(회복 아님)
            },
          },
          config.retry
        );
        retryOutcomes.push(outcome);
        if (outcome.recovered) ctx.logger(`[${runner.id}] recovered on retry: ${failure.caseId}`);
      } catch (e) {
        if (e instanceof BudgetExceeded) {
          budgetExhausted = true;
          ctx.logger(`[${runner.id}] ${e.message} — Retry Lane stopped`);
          break;
        }
        throw e;
      }
    }
  }

  return {
    project: config.project,
    reports,
    retryOutcomes,
    budget: budget.snapshot(),
    budgetExhausted,
  };
}

/** 실행 후 남은(회복 안 된) 실패만 추린다 — 다음 단계(Triage)의 입력. */
export function unrecoveredFailures(result: CycleResult): TestResult[] {
  const recovered = new Set(
    result.retryOutcomes.filter((o) => o.recovered).map((o) => o.caseId)
  );
  const out: TestResult[] = [];
  for (const report of result.reports) {
    for (const r of report.results) {
      if (r.status === "passed" || r.status === "skipped") continue;
      if (recovered.has(r.caseId)) continue;
      out.push(r);
    }
  }
  return out;
}
