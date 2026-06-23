/**
 * 수정 범위 분류 — Remediation 안전장치의 1단계 (R2).
 *
 * "어디를 고칠 것인가"를 먼저 정해야 게이트를 차등 적용할 수 있다.
 *  - test_only: 테스트 코드만 (셀렉터/대기/픽스처). 신뢰 높음 → 자동 PR 허용 후보.
 *  - app_source: 앱 실제 결함. 위험 높음 → 자동 PR 금지, 승인 강화.
 *  - none: 코드로 고칠 수 없음 (플레이키/인프라/외부 API). Remediation 대상 아님.
 */

import type { FailureClass } from "@qa/shared";

export type RemediationScope = "test_only" | "app_source" | "none";

export function scopeFor(failureClass: FailureClass): RemediationScope {
  switch (failureClass) {
    case "TEST_BUG":
      return "test_only";
    case "DATA":
      return "test_only"; // 픽스처/시드 수정 — 테스트 측
    case "PRODUCT_BUG":
      return "app_source"; // 앱 실제 결함 — 가장 엄격한 게이트
    case "FLAKY":
    case "ENV_INFRA":
    case "MODEL_API":
      return "none"; // 코드 수정으로 해결 대상이 아님 (Retry/Quarantine/인프라 영역)
    default:
      return "none";
  }
}
