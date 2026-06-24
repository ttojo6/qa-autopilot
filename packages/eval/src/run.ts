/**
 * Triage eval 러너 — Classifier(휴리스틱/LLM)를 라벨 데이터셋에 돌려 채점한다.
 */

import type { Classifier } from "@qa/triage";
import type { LabeledFailure } from "./dataset.js";
import { scoreEval, type Prediction, type EvalReport } from "./score.js";

export interface TriageEvalOptions {
  readonly flakySignals: readonly string[];
  readonly lowConfThreshold: number;
  readonly source: string;
}

export async function runTriageEval(
  classifier: Classifier,
  dataset: readonly LabeledFailure[],
  opts: TriageEvalOptions
): Promise<EvalReport> {
  const predictions: Prediction[] = [];

  for (const item of dataset) {
    const classification = await classifier.classify({
      cluster: {
        signature: item.id,
        caseIds: [item.id],
        representativeMessage: item.message,
        occurrences: 1,
      },
      rawErrorType: item.errorType,
      flakySignals: opts.flakySignals,
      history: item.history,
    });
    predictions.push({
      id: item.id,
      expected: item.expectedClass,
      predicted: classification.failureClass,
      confidence: classification.confidence,
    });
  }

  return scoreEval(predictions, opts.lowConfThreshold, opts.source);
}
