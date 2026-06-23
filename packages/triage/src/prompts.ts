/**
 * Triage LLM 프롬프트 + 구조화 출력 스키마. 버전 관리 대상(prompts/ 에서 추적).
 *
 * 설계 의도:
 *  - 6종 분류를 명확한 정의와 함께 제시 → 모델이 임의 해석 못하게.
 *  - confidence를 모델이 스스로 보수적으로 매기도록 명시(확신 없으면 낮게).
 *  - rationale 필수 → 사람이 검수·번복할 수 있는 근거 제공 (R1 방어).
 */

export const TRIAGE_SYSTEM_PROMPT = `You are a QA failure triage analyst. Classify a single cluster of related test failures into exactly one root-cause class. You are the first-pass analyst; a human reviews low-confidence calls, so it is far better to report low confidence than to guess high.

Classes:
- PRODUCT_BUG: a genuine defect in the application under test (wrong behavior, regression).
- TEST_BUG: the test itself is wrong (bad selector, stale assertion, race in the test, wrong fixture expectation).
- FLAKY: non-deterministic failure that would likely pass on retry (timing, transient network, animation).
- ENV_INFRA: environment/infrastructure (CI runner, missing service, container, DNS) — unrelated to app or test code.
- DATA: test data / fixture / seed problem (missing record, wrong seed state).
- MODEL_API: an external model or API dependency failed (LLM, STT, third-party 5xx).

Rules:
- Choose the single most likely class.
- Set confidence in [0,1]. Use < 0.6 when the evidence is ambiguous or you cannot distinguish PRODUCT_BUG from TEST_BUG. Do not inflate confidence.
- rationale: one or two sentences citing the concrete evidence you used.
- Never invent stack details not present in the input.`;

export interface TriageJsonOutput {
  failure_class: string;
  confidence: number;
  rationale: string;
}

/** Anthropic output_config.format 에 넣는 JSON Schema (구조화 출력 강제). */
export const TRIAGE_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    failure_class: {
      type: "string",
      enum: ["PRODUCT_BUG", "TEST_BUG", "FLAKY", "ENV_INFRA", "DATA", "MODEL_API"],
    },
    confidence: { type: "number" },
    rationale: { type: "string" },
  },
  required: ["failure_class", "confidence", "rationale"],
  additionalProperties: false,
} as const;

export function buildUserPrompt(input: {
  rawErrorType: string;
  representativeMessage: string;
  occurrences: number;
  flakySignals: readonly string[];
  recentPasses?: number;
  recentFailures?: number;
}): string {
  return [
    `Raw error type: ${input.rawErrorType}`,
    `Occurrences in this run: ${input.occurrences}`,
    `Known flaky signal keywords for this project: ${input.flakySignals.join(", ") || "(none)"}`,
    input.recentPasses !== undefined
      ? `History: ${input.recentPasses} recent pass(es), ${input.recentFailures ?? 0} recent failure(s) of this signature.`
      : "History: unavailable.",
    "",
    "Representative failure message:",
    "```",
    input.representativeMessage.slice(0, 4000),
    "```",
  ].join("\n");
}
