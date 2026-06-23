import type { FailureClass } from "@qa/shared";

/**
 * Quarantine — 격리된 노이즈의 보관소 (원칙 B).
 *
 * 핵심 안전장치(R1): 영구 격리 금지. 모든 격리 항목에 TTL을 두고, 만료되면 재평가 대상으로 표시한다.
 * "한 번 flaky로 격리되면 영원히 무시"되어 진짜 결함이 묻히는 사고를 막는다.
 */

export interface QuarantineEntry {
  readonly signature: string;
  readonly failureClass: FailureClass;
  /** 격리 시각 (epoch ms). */
  readonly quarantinedAt: number;
  /** 격리 이후 이 서명이 다시 관측된 횟수. */
  readonly seenCount: number;
  /** 마지막 관측 시각 (epoch ms). */
  readonly lastSeenAt: number;
}

export interface QuarantinePolicy {
  /** 이 시간이 지나면 재평가 대상. */
  readonly ttlMs: number;
  /** 이 횟수 이상 재관측되면 TTL과 무관하게 즉시 재평가 (노이즈 가정이 의심스러움). */
  readonly reevaluateAfterSeen: number;
}

export const DEFAULT_QUARANTINE_POLICY: QuarantinePolicy = {
  ttlMs: 7 * 24 * 60 * 60 * 1000, // 7일
  reevaluateAfterSeen: 20,
};

/** 새 격리 항목을 만든다 (불변). */
export function quarantine(
  signature: string,
  failureClass: FailureClass,
  now: number
): QuarantineEntry {
  return { signature, failureClass, quarantinedAt: now, seenCount: 1, lastSeenAt: now };
}

/** 격리된 서명이 다시 관측됐을 때 카운트를 올린 새 항목을 반환 (불변). */
export function recordSighting(entry: QuarantineEntry, now: number): QuarantineEntry {
  return { ...entry, seenCount: entry.seenCount + 1, lastSeenAt: now };
}

/**
 * 이 항목을 재평가해야 하는가? (TTL 만료 OR 재관측 과다)
 * 재평가 대상은 Quarantine에서 꺼내 다시 Triage 큐로 보낸다 — 영구 격리 방지.
 */
export function needsReevaluation(
  entry: QuarantineEntry,
  policy: QuarantinePolicy,
  now: number
): boolean {
  if (now - entry.quarantinedAt >= policy.ttlMs) return true;
  if (entry.seenCount >= policy.reevaluateAfterSeen) return true;
  return false;
}
