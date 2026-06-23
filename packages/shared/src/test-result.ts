/**
 * TestResult — 모든 러너(Playwright, pytest, custom)의 결과를 환원하는 단일 정규형.
 *
 * Triage / Signal Gate / Remediation 은 이 타입만 안다. 도구별 포맷은 어댑터가 흡수한다.
 * 모든 값은 불변(immutable)으로 다룬다 — 생성 후 변경하지 말고 새 객체를 만든다.
 */

export type TestStatus = "passed" | "failed" | "skipped" | "timed_out";

/**
 * 실패의 1차(러너 수준) 에러 종류. Triage가 산출하는 "근본원인 분류"와는 다르다.
 * 이것은 어댑터가 기계적으로 채우는 저수준 신호이고, FailureClass는 AI가 판정하는 고수준 결론이다.
 */
export type RawErrorType =
  | "assertion" // 단언 실패 (기대값 불일치)
  | "timeout" // 대기 초과
  | "element_not_found" // 셀렉터/로케이터 실패
  | "network" // 네트워크 오류 (reset, 5xx, ECONNREFUSED)
  | "exception" // 처리되지 않은 예외/스택트레이스
  | "setup" // 픽스처/전제조건 실패
  | "unknown";

export interface ArtifactRef {
  /** screenshot | video | trace | log | har | diff */
  readonly kind: string;
  /** 객체 스토리지 키 또는 로컬 경로 */
  readonly uri: string;
  readonly mime?: string;
}

export interface TestError {
  readonly type: RawErrorType;
  readonly message: string;
  readonly stack?: string;
  /** 어댑터가 알 수 있으면 채움: 실패가 발생한 소스 위치 */
  readonly location?: { readonly file: string; readonly line?: number };
}

export interface TestResult {
  /** 케이스의 안정적 식별자 (파일·제목 기반). 재실행 간 동일해야 클러스터링이 가능하다. */
  readonly caseId: string;
  readonly title: string;
  /** 어느 러너 어댑터가 만들었는지 (web-e2e, pipeline, ...) */
  readonly runnerId: string;
  readonly status: TestStatus;
  readonly durationMs: number;
  /** 이 결과를 얻기까지 어댑터 내부에서 일어난 재시도 횟수 (Retry Lane 재시도와 구분) */
  readonly attempts: number;
  readonly error?: TestError;
  readonly artifacts: readonly ArtifactRef[];
  /** 자유 형식 메타 (브라우저, 태그, 소요 환경 등) */
  readonly meta?: Readonly<Record<string, string>>;
}

/** 한 번의 러너 실행 전체 결과. */
export interface RunReport {
  readonly runnerId: string;
  readonly startedAt: string; // ISO8601
  readonly finishedAt: string;
  readonly results: readonly TestResult[];
}

export function summarize(report: RunReport): {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
} {
  const counts = { total: 0, passed: 0, failed: 0, skipped: 0 };
  for (const r of report.results) {
    counts.total += 1;
    if (r.status === "passed") counts.passed += 1;
    else if (r.status === "skipped") counts.skipped += 1;
    else counts.failed += 1; // failed | timed_out
  }
  return counts;
}
