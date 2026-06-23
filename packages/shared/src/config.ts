/**
 * qa.config.yaml 의 타입 정의. 대상 레포 루트에 두는 매니페스트.
 * 코어는 도메인 지식을 모르고, 프로젝트별 차이는 전부 이 매니페스트로 주입된다.
 */

import type { RawErrorType } from "./test-result.js";

/** Triage가 산출하는 고수준 근본원인 분류 (Actnote error_classifier 6종에서 영감). */
export type FailureClass =
  | "PRODUCT_BUG" // 앱 실제 결함 → Remediation(app_source) 후보
  | "TEST_BUG" // 테스트 자체 오류 → Remediation(test_only) 후보
  | "FLAKY" // 비결정적 실패 → Retry Lane / Quarantine
  | "ENV_INFRA" // 환경·인프라 → Quarantine (코드 무관)
  | "DATA" // 테스트 데이터/픽스처 문제
  | "MODEL_API"; // 외부 모델/API 실패 (LLM, STT 등)

export interface RunnerConfig {
  readonly id: string;
  readonly adapter: string;
  readonly workdir: string;
  readonly command: string;
  readonly timeoutMs?: number;
}

export interface RetryPolicy {
  /** Retry Lane 최대 재시도 횟수. 무한 재시도 비용 폭주 방지의 핵심 상한. */
  readonly maxRetries: number;
  readonly backoffMs: number;
  /** 이 RawErrorType들만 재시도 대상. 나머지는 즉시 Signal Gate로 보낸다. */
  readonly retryableErrors: readonly RawErrorType[];
}

export interface TriageConfig {
  readonly classes: readonly FailureClass[];
  /** flaky로 추정할 저수준 신호 키워드. Phase 1 규칙 기반 격리에 사용. */
  readonly flakySignals: readonly string[];
  /** 이 값 미만의 confidence는 자동 처리 금지 → Human Triage Queue. */
  readonly confidenceThreshold: number;
}

export interface RemediationScopePolicy {
  readonly autoPr: boolean;
  /** 필요한 승인자 수. */
  readonly approval: number;
  readonly codeownersRequired?: boolean;
}

export interface RemediationConfig {
  readonly testOnly: RemediationScopePolicy;
  readonly appSource: RemediationScopePolicy;
}

export interface GovernanceConfig {
  /** 릴리즈 게이트 지표에서 제외할 분류 (노이즈 격리). */
  readonly releaseGateExclude: readonly FailureClass[];
}

/** 사이클당 비용·시간·재시도 상한 (R3: 재시도 비용 폭주 방어). */
export interface BudgetConfig {
  readonly maxCostUsd: number;
  readonly maxWallMs: number;
  readonly maxRetries: number;
  /** Retry Lane 재실행 1회당 추정 비용 (USD) — 예산 누계 산정용. */
  readonly costPerRerunUsd: number;
}

export interface QaConfig {
  readonly project: string;
  readonly runners: readonly RunnerConfig[];
  readonly retry: RetryPolicy;
  readonly triage: TriageConfig;
  readonly remediation: RemediationConfig;
  readonly governance: GovernanceConfig;
  readonly budget?: BudgetConfig;
}
