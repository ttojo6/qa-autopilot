/**
 * 분류 → 레인 라우팅. 원칙 A·B를 코드로 강제하는 결정 지점.
 *
 * 규칙(우선순위 순):
 *  1) confidence < threshold  → "human"  (자동 처리 금지 — R1 방어)
 *  2) FLAKY / ENV_INFRA       → "quarantine"  (노이즈 격리 — 원칙 B)
 *     단, 재시도 가능한 일시 장애로 판단되면 "retry"
 *  3) 그 외 (PRODUCT_BUG/TEST_BUG/DATA/MODEL_API) → "signal"  (Remediation 후보)
 */

import type { Lane, FailureClass, TriageVerdict } from "@qa/shared";
import type { Classification } from "./classifier.js";

const NOISE_CLASSES: ReadonlySet<FailureClass> = new Set(["FLAKY", "ENV_INFRA"]);

export interface RoutingContext {
  readonly confidenceThreshold: number;
  /** 이 분류가 재시도로 회복 가능한 일시 장애인가 (retry vs quarantine 구분). */
  readonly retryEligible: boolean;
}

export function routeClassification(
  signature: string,
  c: Classification,
  ctx: RoutingContext
): TriageVerdict {
  const lane = decideLane(c, ctx);
  return {
    signature,
    failureClass: c.failureClass,
    confidence: c.confidence,
    lane,
    rationale: c.rationale,
    source: c.source,
  };
}

function decideLane(c: Classification, ctx: RoutingContext): Lane {
  // 1) 저신뢰는 무조건 사람에게. 자동화의 가장 중요한 안전장치.
  if (c.confidence < ctx.confidenceThreshold) return "human";

  // 2) 노이즈 격리. 일시 장애면 Retry Lane으로, 아니면 Quarantine.
  if (NOISE_CLASSES.has(c.failureClass)) {
    return ctx.retryEligible ? "retry" : "quarantine";
  }

  // 3) 진짜 신호 → Remediation 후보 레인.
  return "signal";
}
