/**
 * Triage 라벨 데이터셋 — 분류 품질 측정의 ground truth.
 *
 * 사람이 라벨한 (실패 → 기대 분류) 쌍. 휴리스틱/LLM 분류기를 같은 셋에 돌려 정확도를 잰다.
 * 명확한 케이스(타임아웃→FLAKY)와 애매한 케이스(ModuleNotFound)를 섞어, 휴리스틱의 한계와
 * LLM escalation의 필요를 숫자로 드러낸다.
 */

import type { RawErrorType, FailureClass } from "@qa/shared";

export interface LabeledFailure {
  readonly id: string;
  readonly errorType: RawErrorType;
  readonly message: string;
  readonly expectedClass: FailureClass;
  /** 선택: 과거 이력 (flaky 판단 신뢰도). */
  readonly history?: { readonly recentPasses: number; readonly recentFailures: number };
}

export const TRIAGE_DATASET: readonly LabeledFailure[] = [
  // 명확한 FLAKY (타임아웃 + 통과 이력)
  { id: "f1", errorType: "timeout", message: "Test timeout of 30000ms exceeded", expectedClass: "FLAKY", history: { recentPasses: 4, recentFailures: 1 } },
  { id: "f2", errorType: "timeout", message: "locator.click: Timeout 5000ms exceeded waiting for element", expectedClass: "FLAKY", history: { recentPasses: 2, recentFailures: 1 } },
  // 일시 네트워크 → FLAKY
  { id: "n1", errorType: "network", message: "read ECONNRESET", expectedClass: "FLAKY", history: { recentPasses: 3, recentFailures: 1 } },
  // 인프라 (서비스 다운) → ENV_INFRA  (휴리스틱은 network→FLAKY로 오분류 가능)
  { id: "e1", errorType: "network", message: "connect ECONNREFUSED 127.0.0.1:5432 postgres", expectedClass: "ENV_INFRA" },
  { id: "e2", errorType: "exception", message: "container failed to start: no space left on device", expectedClass: "ENV_INFRA" },
  // 단언 실패 → PRODUCT_BUG (휴리스틱 0.45)
  { id: "a1", errorType: "assertion", message: "expected 200 received 500", expectedClass: "PRODUCT_BUG" },
  { id: "a2", errorType: "assertion", message: "expected cart total 40 but received 30", expectedClass: "PRODUCT_BUG" },
  // 테스트 버그 (셀렉터 변경) → TEST_BUG  (휴리스틱은 element_not_found→FLAKY/낮은신뢰)
  { id: "t1", errorType: "element_not_found", message: "locator '#old-login-btn' not found; selector likely renamed", expectedClass: "TEST_BUG" },
  // 픽스처/데이터 → DATA
  { id: "d1", errorType: "setup", message: "fixture 'seed_user' not found", expectedClass: "DATA" },
  { id: "d2", errorType: "setup", message: "no rows in seed table 'accounts'", expectedClass: "DATA" },
  // 외부 모델/API → MODEL_API (휴리스틱이 잡기 어려움)
  { id: "m1", errorType: "network", message: "OpenAI API 503 Service Unavailable", expectedClass: "MODEL_API" },
  { id: "m2", errorType: "exception", message: "anthropic.RateLimitError: 429 rate limit", expectedClass: "MODEL_API" },
  // 임포트/문법 → TEST_BUG (휴리스틱 default PRODUCT_BUG 0.2로 오분류)
  { id: "i1", errorType: "exception", message: "ModuleNotFoundError: No module named 'helpers'", expectedClass: "TEST_BUG" },
  { id: "i2", errorType: "exception", message: "SyntaxError: unexpected token in spec file", expectedClass: "TEST_BUG" },
];
