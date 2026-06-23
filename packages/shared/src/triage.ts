/**
 * Triage 공용 타입. core(Signal Gate)와 @qa/triage가 모두 의존하므로 shared에 둔다
 * (core ↔ triage 순환 의존 방지).
 */

import type { FailureClass } from "./config.js";

/**
 * 실패가 흘러갈 레인. 원칙 A·B의 분기점.
 * - retry: 일시 장애 → Retry Lane (코드 무변경)
 * - quarantine: 노이즈 → 격리 (릴리즈 게이트·Remediation 제외)
 * - signal: 진짜 결함 → Remediation 후보
 * - human: 저신뢰 → 사람 Triage 큐 (자동 처리 금지)
 */
export type Lane = "retry" | "quarantine" | "signal" | "human";

/** 동일 근본원인으로 묶인 실패 클러스터의 참조. */
export interface ClusterRef {
  /** 정규화된 실패 서명 (clustering 키). */
  readonly signature: string;
  /** 이 클러스터에 속한 caseId 목록. */
  readonly caseIds: readonly string[];
  /** 대표 에러 메시지(원문). */
  readonly representativeMessage: string;
  readonly occurrences: number;
}

/**
 * Triage(AI 또는 규칙)가 내리는 1차 판정.
 * AI 판단(class/confidence/rationale)과 라우팅 결론(lane)을 한 객체에 담는다.
 */
export interface TriageVerdict {
  readonly signature: string;
  readonly failureClass: FailureClass;
  /** 0.0~1.0. confidenceThreshold 미만이면 lane은 강제로 "human". */
  readonly confidence: number;
  readonly lane: Lane;
  readonly rationale: string;
  /** 판정 출처: 어떤 모델/규칙이 만들었는지 (감사용). */
  readonly source: string;
}
