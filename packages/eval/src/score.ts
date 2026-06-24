/**
 * 채점 — 순수 함수. 정확도 + 혼동행렬 + 저신뢰 비율.
 */

import type { FailureClass } from "@qa/shared";

export interface Prediction {
  readonly id: string;
  readonly expected: FailureClass;
  readonly predicted: FailureClass;
  readonly confidence: number;
}

export interface EvalReport {
  readonly total: number;
  readonly correct: number;
  readonly accuracy: number;
  /** confidence < threshold 인 예측 수 (escalation/human 후보). */
  readonly lowConfidence: number;
  readonly lowConfidenceRate: number;
  /** confusion[expected][predicted] = count */
  readonly confusion: Record<string, Record<string, number>>;
  readonly source: string;
}

export function scoreEval(
  predictions: readonly Prediction[],
  lowConfThreshold: number,
  source: string
): EvalReport {
  const total = predictions.length;
  let correct = 0;
  let lowConfidence = 0;
  const confusion: Record<string, Record<string, number>> = {};

  for (const p of predictions) {
    if (p.predicted === p.expected) correct += 1;
    if (p.confidence < lowConfThreshold) lowConfidence += 1;
    (confusion[p.expected] ??= {})[p.predicted] = ((confusion[p.expected] ?? {})[p.predicted] ?? 0) + 1;
  }

  return {
    total,
    correct,
    accuracy: total > 0 ? correct / total : 0,
    lowConfidence,
    lowConfidenceRate: total > 0 ? lowConfidence / total : 0,
    confusion,
    source,
  };
}

/** 보고서를 사람이 읽을 텍스트로. */
export function formatReport(r: EvalReport): string {
  const lines = [
    `[${r.source}] accuracy ${(r.accuracy * 100).toFixed(1)}% (${r.correct}/${r.total})  low-confidence ${(r.lowConfidenceRate * 100).toFixed(0)}%`,
  ];
  for (const [expected, preds] of Object.entries(r.confusion)) {
    const wrong = Object.entries(preds).filter(([pred]) => pred !== expected);
    if (wrong.length > 0) {
      lines.push(`  ${expected} → ${wrong.map(([p, n]) => `${p}×${n}`).join(", ")} (오분류)`);
    }
  }
  return lines.join("\n");
}
