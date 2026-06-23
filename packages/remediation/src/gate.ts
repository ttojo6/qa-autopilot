/**
 * 거버넌스 게이트 — 수정 범위별 차등 정책 + "검증 없는 수정 불가" 강제 (R2).
 *
 * 규칙:
 *  - app_source는 autoPr를 항상 false로 강제 (매니페스트가 true여도 무시). 앱 코드 자동 수정 금지.
 *  - 회귀 증빙(status)이 "passed"가 아니면 무조건 차단.
 *  - codeowners/승인자 수는 매니페스트(RemediationConfig)에서 가져온다.
 */

import type { RemediationConfig } from "@qa/shared";
import type { RemediationScope } from "./scope.js";
import type { RegressionProof, GateResult } from "./types.js";

export function gate(
  scope: RemediationScope,
  proof: RegressionProof,
  config: RemediationConfig
): GateResult {
  const blocked: string[] = [];

  if (scope === "none") {
    return {
      scope,
      autoPrAllowed: false,
      requiredApprovals: 0,
      codeownersRequired: false,
      blockedReasons: ["scope=none: not remediable by a code change"],
    };
  }

  const policy = scope === "app_source" ? config.appSource : config.testOnly;

  // 검증 없는 수정은 통과 불가.
  if (proof.status !== "passed") {
    blocked.push(`regression proof not passed (status=${proof.status})`);
  }

  // app_source는 자동 PR을 정책과 무관하게 금지.
  const autoPrAllowed = scope === "app_source" ? false : policy.autoPr;

  return {
    scope,
    autoPrAllowed: autoPrAllowed && blocked.length === 0,
    requiredApprovals: policy.approval,
    codeownersRequired: policy.codeownersRequired ?? false,
    blockedReasons: blocked,
  };
}
