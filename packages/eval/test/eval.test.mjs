import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreEval, runTriageEval, TRIAGE_DATASET, formatReport } from "../dist/index.js";
import { HeuristicClassifier } from "@qa/triage";

test("scoreEval computes accuracy, low-confidence, confusion", () => {
  const preds = [
    { id: "1", expected: "FLAKY", predicted: "FLAKY", confidence: 0.9 },
    { id: "2", expected: "PRODUCT_BUG", predicted: "TEST_BUG", confidence: 0.4 },
    { id: "3", expected: "DATA", predicted: "DATA", confidence: 0.5 },
  ];
  const r = scoreEval(preds, 0.75, "test");
  assert.equal(r.total, 3);
  assert.equal(r.correct, 2);
  assert.ok(Math.abs(r.accuracy - 2 / 3) < 1e-9);
  assert.equal(r.lowConfidence, 2); // conf 0.4 and 0.5
  assert.equal(r.confusion["PRODUCT_BUG"]["TEST_BUG"], 1);
});

test("heuristic classifier accuracy on labeled dataset (real measurement)", async () => {
  const report = await runTriageEval(new HeuristicClassifier(), TRIAGE_DATASET, {
    flakySignals: ["timeout", "econnreset", "503"],
    lowConfThreshold: 0.75,
    source: "heuristic",
  });
  // 측정된 결과를 고정 — 휴리스틱은 명확한 케이스(타임아웃/단언/픽스처)만 맞히고
  // 애매한 케이스(인프라/모델API/임포트)는 틀리며 대부분 저신뢰 → LLM escalation 정당화.
  assert.equal(report.total, 14);
  assert.equal(report.correct, 7, "heuristic gets 7/14");
  assert.ok(Math.abs(report.accuracy - 0.5) < 1e-9, "accuracy 50%");
  assert.equal(report.lowConfidence, 11, "79% low-confidence → escalation candidates");
  assert.ok(formatReport(report).includes("heuristic"));
});
