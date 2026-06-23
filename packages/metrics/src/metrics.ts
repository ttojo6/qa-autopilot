/**
 * 메타 지표 — 자동화 자체의 건강도를 측정한다 (RISKS.md의 검증 지표를 코드화).
 *
 * 순수 함수만. 데이터 적재·임계 판정은 다른 모듈이 담당한다.
 */

import type { Lane, TriageVerdict } from "@qa/shared";

/** 레인별 누계. aiClassified ≈ total(모든 판정은 AI/규칙 분류). */
export interface RoutingCounts {
  readonly total: number;
  readonly signal: number;
  readonly human: number;
  readonly quarantine: number;
  readonly retry: number;
}

export const EMPTY_ROUTING: RoutingCounts = { total: 0, signal: 0, human: 0, quarantine: 0, retry: 0 };

/** 사람 피드백 누계 — STOP 트리거의 분자. */
export interface FeedbackCounts {
  /** 사람이 AI 분류를 뒤집은 횟수 (R1 override). */
  readonly humanOverrides: number;
  /** 병합된 remediation PR 수 (R2 rollback의 분모). */
  readonly merged: number;
  /** 병합 후 롤백된 수 (R2). */
  readonly rolledBack: number;
}

export const EMPTY_FEEDBACK: FeedbackCounts = { humanOverrides: 0, merged: 0, rolledBack: 0 };

export interface MetricsSnapshot {
  readonly routing: RoutingCounts;
  readonly feedback: FeedbackCounts;
}

export const EMPTY_SNAPSHOT: MetricsSnapshot = { routing: EMPTY_ROUTING, feedback: EMPTY_FEEDBACK };

/** 한 사이클의 판정 목록 → 레인 카운트. */
export function countLanes(verdicts: readonly Pick<TriageVerdict, "lane">[]): RoutingCounts {
  const c = { total: 0, signal: 0, human: 0, quarantine: 0, retry: 0 };
  for (const v of verdicts) {
    c.total += 1;
    c[v.lane] += 1;
  }
  return c;
}

/** 두 RoutingCounts를 합산 (누계 갱신, 불변). */
export function addRouting(a: RoutingCounts, b: RoutingCounts): RoutingCounts {
  return {
    total: a.total + b.total,
    signal: a.signal + b.signal,
    human: a.human + b.human,
    quarantine: a.quarantine + b.quarantine,
    retry: a.retry + b.retry,
  };
}

const ratio = (num: number, den: number): number => (den > 0 ? num / den : 0);

/** R4 — 격리 비율. 너무 높으면 flakySignals 과광범위(신호 매몰) 의심. */
export function quarantineRatio(r: RoutingCounts): number {
  return ratio(r.quarantine, r.total);
}

/** 사람 큐로 가는 비율 — Triage 포화/저신뢰의 선행 지표(정보용). */
export function humanRatio(r: RoutingCounts): number {
  return ratio(r.human, r.total);
}

/** R1 — 사람이 AI 분류를 뒤집은 비율. 높으면 분류 신뢰 불가. */
export function overrideRate(s: MetricsSnapshot): number {
  return ratio(s.feedback.humanOverrides, s.routing.total);
}

/** R2 — 병합 후 롤백 비율. 높으면 잘못된 수정이 확산 중. */
export function rollbackRate(s: MetricsSnapshot): number {
  return ratio(s.feedback.rolledBack, s.feedback.merged);
}

/** 한 줄 요약 지표(콘솔/CLI 표시용). */
export interface MetricsView {
  readonly quarantineRatio: number;
  readonly humanRatio: number;
  readonly overrideRate: number;
  readonly rollbackRate: number;
}

export function summarizeMetrics(s: MetricsSnapshot): MetricsView {
  return {
    quarantineRatio: quarantineRatio(s.routing),
    humanRatio: humanRatio(s.routing),
    overrideRate: overrideRate(s),
    rollbackRate: rollbackRate(s),
  };
}
