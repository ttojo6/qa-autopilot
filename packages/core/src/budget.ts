/**
 * Budget — 사이클당 비용·시간 상한 (R3: 재시도 비용 폭주 방어).
 *
 * Actnote 교훈: Modal retries=3 이 STT·화자분리·LLM 을 처음부터 재과금. 재시도는
 * "통과할 때까지" 돌면 비용이 폭주한다. Retry Lane·Orchestrator는 매 작업 전 Budget.check()로
 * 한도를 확인하고, 초과 시 즉시 중단(BudgetExceeded)하고 미실행분을 SKIPPED로 보고한다.
 *
 * 불변 패턴: record()는 새 누계를 가진 객체를 반환하지 않고 내부 누계를 갱신하지만,
 * 외부에는 읽기 전용 스냅샷(snapshot())만 노출한다.
 */

export class BudgetExceeded extends Error {
  constructor(
    readonly kind: "cost" | "time" | "retries",
    readonly used: number,
    readonly limit: number
  ) {
    super(`Budget exceeded: ${kind} used=${used} limit=${limit}`);
    this.name = "BudgetExceeded";
  }
}

export interface BudgetLimits {
  /** 사이클 전체 비용 상한 (USD). */
  readonly maxCostUsd: number;
  /** 사이클 전체 벽시계 시간 상한 (ms). */
  readonly maxWallMs: number;
  /** 사이클 전체 재시도 횟수 상한. */
  readonly maxRetries: number;
}

export interface BudgetSnapshot {
  readonly costUsd: number;
  readonly elapsedMs: number;
  readonly retries: number;
  readonly limits: BudgetLimits;
}

export class Budget {
  private costUsd = 0;
  private retries = 0;
  private readonly startedAt: number;

  constructor(
    private readonly limits: BudgetLimits,
    now: () => number = Date.now
  ) {
    this.now = now;
    this.startedAt = now();
  }
  private readonly now: () => number;

  /** 작업 실행 전 호출. 한도 초과면 BudgetExceeded throw. */
  check(): void {
    if (this.costUsd >= this.limits.maxCostUsd) {
      throw new BudgetExceeded("cost", this.costUsd, this.limits.maxCostUsd);
    }
    const elapsed = this.now() - this.startedAt;
    if (elapsed >= this.limits.maxWallMs) {
      throw new BudgetExceeded("time", elapsed, this.limits.maxWallMs);
    }
    if (this.retries >= this.limits.maxRetries) {
      throw new BudgetExceeded("retries", this.retries, this.limits.maxRetries);
    }
  }

  /** 한도 초과 여부를 throw 없이 확인 (루프 가드용). */
  hasHeadroom(): boolean {
    try {
      this.check();
      return true;
    } catch {
      return false;
    }
  }

  recordCost(usd: number): void {
    this.costUsd += Math.max(0, usd);
  }

  recordRetry(): void {
    this.retries += 1;
  }

  snapshot(): BudgetSnapshot {
    return {
      costUsd: this.costUsd,
      elapsedMs: this.now() - this.startedAt,
      retries: this.retries,
      limits: this.limits,
    };
  }
}
