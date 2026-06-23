/**
 * 휴리스틱 분류기 — 규칙 기반. 키 없이도 동작하며 모든 환경에서 테스트 가능.
 *
 * 역할:
 *  1) 명백한 노이즈(flaky 신호 + 통과 이력)는 싸게 FLAKY로 분류.
 *  2) 애매하면 낮은 confidence를 반환 → TriageEngine이 LLM 또는 사람에게 위임.
 *
 * "애매하면 낮은 confidence" 원칙이 R1(오버트러스트) 방어의 1차 방어선이다.
 */

import type { Classifier, ClassificationInput, Classification } from "./classifier.js";

const FLAKY_RAW_TYPES = new Set(["timeout", "network", "element_not_found"]);

export class HeuristicClassifier implements Classifier {
  async classify(input: ClassificationInput): Promise<Classification> {
    const { cluster, rawErrorType, flakySignals, history } = input;
    const haystack = `${rawErrorType} ${cluster.representativeMessage}`.toLowerCase();
    const matchedSignal = flakySignals.find((s) => haystack.includes(s.toLowerCase()));

    // 이력상 같은 케이스가 통과한 적 있고 + flaky 신호 → 강한 FLAKY 증거.
    const passedBefore = (history?.recentPasses ?? 0) > 0;

    if (matchedSignal && passedBefore) {
      return {
        failureClass: "FLAKY",
        confidence: 0.85,
        rationale: `flaky signal "${matchedSignal}" + ${history?.recentPasses} recent pass(es)`,
        source: "heuristic",
      };
    }

    if (matchedSignal || FLAKY_RAW_TYPES.has(rawErrorType)) {
      // 신호는 있으나 이력 근거 부족 → 노이즈일 수 있으나 단정 못함. 낮은 confidence.
      return {
        failureClass: "FLAKY",
        confidence: 0.5,
        rationale: matchedSignal
          ? `flaky signal "${matchedSignal}" without pass history`
          : `retryable raw type "${rawErrorType}"`,
        source: "heuristic",
      };
    }

    if (rawErrorType === "assertion") {
      // 단언 실패는 보통 진짜 결함이지만, 제품/테스트 중 어느 쪽인지는 휴리스틱으로 단정 불가.
      return {
        failureClass: "PRODUCT_BUG",
        confidence: 0.45,
        rationale: "assertion failure — likely a real defect, but product-vs-test is uncertain",
        source: "heuristic",
      };
    }

    if (rawErrorType === "setup") {
      return {
        failureClass: "DATA",
        confidence: 0.5,
        rationale: "fixture/setup failure",
        source: "heuristic",
      };
    }

    // 분류 근거 없음 → 매우 낮은 confidence로 떠넘긴다.
    return {
      failureClass: "PRODUCT_BUG",
      confidence: 0.2,
      rationale: "no decisive heuristic signal",
      source: "heuristic",
    };
  }
}
