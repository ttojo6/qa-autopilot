/**
 * Classifier 포트 — 분류 구현(휴리스틱/LLM)을 갈아끼울 수 있는 경계.
 * TriageEngine은 이 인터페이스만 안다.
 */

import type { ClusterRef, FailureClass } from "@qa/shared";

export interface ClassificationInput {
  readonly cluster: ClusterRef;
  /** 어댑터가 채운 저수준 에러 타입 (assertion/timeout/...). */
  readonly rawErrorType: string;
  /** 매니페스트의 flaky 신호 키워드. 휴리스틱·프롬프트 양쪽에서 사용. */
  readonly flakySignals: readonly string[];
  /** 이 서명의 과거 발생 추세 (있으면 flaky 판정 신뢰도↑). */
  readonly history?: ClusterHistory;
}

export interface ClusterHistory {
  /** 최근 N회 실행 중 이 서명이 실패한 횟수. */
  readonly recentFailures: number;
  /** 최근 N회 실행 중 같은 케이스가 통과한 횟수 (높으면 flaky 의심). */
  readonly recentPasses: number;
}

export interface Classification {
  readonly failureClass: FailureClass;
  readonly confidence: number; // 0.0~1.0
  readonly rationale: string;
  readonly source: string; // "heuristic" | "claude:haiku-4-5" 등
}

export interface Classifier {
  classify(input: ClassificationInput): Promise<Classification>;
}
