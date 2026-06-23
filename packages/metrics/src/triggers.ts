/**
 * STOP 트리거 — 지표가 임계를 넘으면 자동화를 단계적으로 끈다 (RISKS.md의 STOP 트리거 코드화).
 *
 * 핵심 안전 철학: 과거 성과가 현재 자동화를 게이팅한다. override가 폭증하면 분류를 사람에게
 * 강등하고, 롤백이 잦으면 앱 소스 수정을 끈다. 소표본 오발(false alarm)은 minSamples로 막는다.
 */

import {
  quarantineRatio,
  overrideRate,
  rollbackRate,
  type MetricsSnapshot,
} from "./metrics.js";

export interface StopPolicy {
  /** R1 — override rate가 이 값을 넘으면 자동 라우팅 중단(전건 사람). 기본 0.25. */
  readonly overrideRateMax: number;
  /** R2 — rollback rate가 이 값을 넘으면 app_source 자동 수정 중단. 기본 0.15. */
  readonly rollbackRateMax: number;
  /** R4 — quarantine 비율이 이 값을 넘으면 flakySignals 재검토. 기본 0.4. */
  readonly quarantineRatioMax: number;
  /** 지표별 분모가 이 표본 수 미만이면 평가하지 않는다(소표본 오발 방지). 기본 20. */
  readonly minSamples: number;
}

export const DEFAULT_STOP_POLICY: StopPolicy = {
  overrideRateMax: 0.25,
  rollbackRateMax: 0.15,
  quarantineRatioMax: 0.4,
  minSamples: 20,
};

export type ControlKey = "forceHumanTriage" | "disableAppSourceRemediation" | "reviewFlakySignals";

export interface Trigger {
  readonly risk: string; // R1 | R2 | R4
  readonly metric: string;
  readonly value: number;
  readonly threshold: number;
  readonly samples: number;
  readonly control: ControlKey;
  readonly message: string;
}

/** 누적 스냅샷을 정책과 대조해 발동된 트리거들을 반환한다. */
export function evaluateTriggers(s: MetricsSnapshot, policy: StopPolicy = DEFAULT_STOP_POLICY): Trigger[] {
  const out: Trigger[] = [];

  // R1: override rate (분모 = 누적 분류 수)
  if (s.routing.total >= policy.minSamples) {
    const v = overrideRate(s);
    if (v > policy.overrideRateMax) {
      out.push({
        risk: "R1",
        metric: "overrideRate",
        value: v,
        threshold: policy.overrideRateMax,
        samples: s.routing.total,
        control: "forceHumanTriage",
        message: `override rate ${(v * 100).toFixed(1)}% > ${(policy.overrideRateMax * 100).toFixed(0)}% — 자동 라우팅 중단, 전건 사람 큐`,
      });
    }
  }

  // R2: rollback rate (분모 = 병합 수)
  if (s.feedback.merged >= policy.minSamples) {
    const v = rollbackRate(s);
    if (v > policy.rollbackRateMax) {
      out.push({
        risk: "R2",
        metric: "rollbackRate",
        value: v,
        threshold: policy.rollbackRateMax,
        samples: s.feedback.merged,
        control: "disableAppSourceRemediation",
        message: `rollback rate ${(v * 100).toFixed(1)}% > ${(policy.rollbackRateMax * 100).toFixed(0)}% — app_source 자동 수정 제안 중단`,
      });
    }
  }

  // R4: quarantine 비율 (분모 = 누적 분류 수)
  if (s.routing.total >= policy.minSamples) {
    const v = quarantineRatio(s.routing);
    if (v > policy.quarantineRatioMax) {
      out.push({
        risk: "R4",
        metric: "quarantineRatio",
        value: v,
        threshold: policy.quarantineRatioMax,
        samples: s.routing.total,
        control: "reviewFlakySignals",
        message: `quarantine 비율 ${(v * 100).toFixed(1)}% > ${(policy.quarantineRatioMax * 100).toFixed(0)}% — flakySignals 재검토 필요`,
      });
    }
  }

  return out;
}

/** 자동화 제어 상태 — 엔진이 매 사이클 시작 시 참조한다. */
export interface SafetyControls {
  readonly forceHumanTriage: boolean;
  readonly disableAppSourceRemediation: boolean;
  readonly reviewFlakySignals: boolean;
}

export const ALL_ENABLED: SafetyControls = {
  forceHumanTriage: false,
  disableAppSourceRemediation: false,
  reviewFlakySignals: false,
};

/** 발동된 트리거들 → 제어 상태(OR 합성). */
export function deriveControls(triggers: readonly Trigger[]): SafetyControls {
  return {
    forceHumanTriage: triggers.some((t) => t.control === "forceHumanTriage"),
    disableAppSourceRemediation: triggers.some((t) => t.control === "disableAppSourceRemediation"),
    reviewFlakySignals: triggers.some((t) => t.control === "reviewFlakySignals"),
  };
}
