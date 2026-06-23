import type { RunReport, TestResult, RetryPolicy } from "@qa/shared";

/**
 * 원칙 A — 재시도(Retry)와 수정(Fix)의 분리.
 *
 * Retry Lane 은 코드를 절대 건드리지 않는다. 결정론적 규칙(횟수·백오프·대상 에러)으로만
 * 플레이키/일시 장애를 흡수한다. 여기서 끝내 통과하면 Remediation 으로 넘어가지 않는다.
 *
 * 중요: Remediation Lane 진입 권한은 이 모듈이 아니라 SignalGate+Triage가 결정한다.
 * Retry는 "수정 후보를 만들지 않는다" — 큐 자체가 분리되어 있다.
 */

export interface RetryableUnit {
  readonly result: TestResult;
  /** 이 케이스만 다시 돌리는 실행기. 코어가 어댑터를 통해 주입한다. */
  rerun(): Promise<TestResult>;
}

export interface RetryOutcome {
  readonly caseId: string;
  readonly finalResult: TestResult;
  readonly retriesUsed: number;
  /** 재시도로 통과했는가 (= 플레이키 의심) */
  readonly recovered: boolean;
}

function isRetryable(result: TestResult, policy: RetryPolicy): boolean {
  if (result.status === "passed" || result.status === "skipped") return false;
  const type = result.error?.type ?? "unknown";
  return policy.retryableErrors.includes(type);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * 정책에 따라 단일 케이스를 재시도한다. 상한(maxRetries)·백오프로 비용 폭주를 막는다.
 */
export async function runRetryLane(
  unit: RetryableUnit,
  policy: RetryPolicy
): Promise<RetryOutcome> {
  let current = unit.result;
  let retries = 0;

  while (isRetryable(current, policy) && retries < policy.maxRetries) {
    await sleep(policy.backoffMs * (retries + 1));
    retries += 1;
    current = await unit.rerun();
  }

  const recovered = current.status === "passed" && retries > 0;
  return { caseId: unit.result.caseId, finalResult: current, retriesUsed: retries, recovered };
}

/** 리포트에서 재시도 대상 실패만 추린다. */
export function selectFailures(report: RunReport, policy: RetryPolicy): readonly TestResult[] {
  return report.results.filter((r) => isRetryable(r, policy));
}
