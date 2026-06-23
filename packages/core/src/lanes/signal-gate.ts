import type {
  TestResult,
  TriageConfig,
  TriageVerdict,
  GovernanceConfig,
  Lane,
} from "@qa/shared";

/**
 * 원칙 B — 실패 분석과 노이즈의 격리.
 *
 * 2단계 구조:
 *  1) prefilter(): 명백한 노이즈를 규칙으로 싸게 거른다 (Triage 비용 절약).
 *     확신이 없으면 null → Triage(AI)로 넘긴다.
 *  2) applyVerdict(): Triage 판정(TriageVerdict)을 최종 GateDecision으로 환원하고,
 *     거버넌스 정책(releaseGateExclude)으로 릴리즈 차단 여부를 결정한다.
 *
 * "노이즈는 릴리즈를 차단하지 않는다"를 isReleaseBlocking에서 코드로 강제한다.
 */

export interface GateDecision {
  readonly signatureOrCase: string;
  readonly lane: Lane;
  readonly reason: string;
  /** 릴리즈 게이트를 막는 실패인지 (노이즈는 false). */
  readonly releaseBlocking: boolean;
}

/**
 * 1차 규칙 프리필터. 매우 보수적으로 — 확실한 노이즈만 격리하고 나머지는 Triage에 위임(null).
 * 보수적으로 두는 이유: 규칙이 진짜 결함을 노이즈로 오격리하면 R4(신호 매몰)가 발생.
 */
export function prefilter(result: TestResult, triage: TriageConfig): GateDecision | null {
  if (result.status === "passed" || result.status === "skipped") return null;

  const haystack = `${result.error?.type ?? ""} ${result.error?.message ?? ""}`.toLowerCase();
  const matched = triage.flakySignals.find((sig) => haystack.includes(sig.toLowerCase()));

  // 프리필터는 "확실한 노이즈"를 판단할 만큼 강한 증거가 없다(이력 미사용) → 격리하지 않고 위임.
  // 향후 강한 규칙(예: 알려진 인프라 에러 시그니처)이 생기면 여기서 quarantine을 반환한다.
  if (matched) return null; // Triage가 이력까지 보고 판단하도록.
  return null;
}

/** Triage 판정을 최종 게이트 결정으로 환원. 거버넌스 제외 정책을 여기서 적용한다. */
export function applyVerdict(verdict: TriageVerdict, governance: GovernanceConfig): GateDecision {
  const excluded = governance.releaseGateExclude.includes(verdict.failureClass);
  const blocking = isReleaseBlocking(verdict.lane) && !excluded;
  return {
    signatureOrCase: verdict.signature,
    lane: verdict.lane,
    reason: `${verdict.failureClass}@${verdict.confidence.toFixed(2)} (${verdict.source})`,
    releaseBlocking: blocking,
  };
}

/** 레인만으로 본 릴리즈 차단 여부 (거버넌스 제외 적용 전). */
export function isReleaseBlocking(lane: Lane): boolean {
  return lane === "signal" || lane === "human";
}
