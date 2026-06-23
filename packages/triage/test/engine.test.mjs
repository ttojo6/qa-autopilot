import { test } from "node:test";
import assert from "node:assert/strict";
import { TriageEngine, routeClassification } from "../dist/index.js";

const config = {
  classes: ["PRODUCT_BUG", "TEST_BUG", "FLAKY", "ENV_INFRA", "DATA", "MODEL_API"],
  flakySignals: ["timeout", "econnreset"],
  confidenceThreshold: 0.75,
};

const fail = (caseId, type, msg) => ({
  caseId, title: caseId, runnerId: "r", status: "failed", durationMs: 1, attempts: 1,
  error: { type, message: msg }, artifacts: [],
});

test("low confidence always routes to human (R1 guard)", () => {
  const c = { failureClass: "PRODUCT_BUG", confidence: 0.4, rationale: "x", source: "test" };
  const v = routeClassification("sig", c, { confidenceThreshold: 0.75, retryEligible: false });
  assert.equal(v.lane, "human");
});

test("confident FLAKY with retry-eligible type goes to retry lane", () => {
  const c = { failureClass: "FLAKY", confidence: 0.9, rationale: "x", source: "test" };
  const v = routeClassification("sig", c, { confidenceThreshold: 0.75, retryEligible: true });
  assert.equal(v.lane, "retry");
});

test("confident FLAKY without retry eligibility is quarantined", () => {
  const c = { failureClass: "FLAKY", confidence: 0.9, rationale: "x", source: "test" };
  const v = routeClassification("sig", c, { confidenceThreshold: 0.75, retryEligible: false });
  assert.equal(v.lane, "quarantine");
});

test("confident real defect routes to signal", () => {
  const c = { failureClass: "PRODUCT_BUG", confidence: 0.9, rationale: "x", source: "test" };
  const v = routeClassification("sig", c, { confidenceThreshold: 0.75, retryEligible: false });
  assert.equal(v.lane, "signal");
});

test("engine escalates to LLM when heuristic is uncertain", async () => {
  let llmCalled = false;
  const llm = {
    async classify() {
      llmCalled = true;
      return { failureClass: "PRODUCT_BUG", confidence: 0.92, rationale: "llm", source: "fake-llm" };
    },
  };
  const engine = new TriageEngine({ llm }, { escalateBelow: 0.7 });
  const verdicts = await engine.triage([fail("a", "assertion", "expected 1 got 2")], config);
  assert.ok(llmCalled, "LLM should be called for uncertain heuristic result");
  assert.equal(verdicts[0].lane, "signal");
  assert.equal(verdicts[0].source, "fake-llm");
});

test("engine skips LLM when heuristic is confident", async () => {
  let llmCalled = false;
  const llm = {
    async classify() {
      llmCalled = true;
      return { failureClass: "PRODUCT_BUG", confidence: 0.9, rationale: "llm", source: "fake-llm" };
    },
  };
  const engine = new TriageEngine(
    { llm, historyFor: () => ({ recentPasses: 3, recentFailures: 1 }) },
    { escalateBelow: 0.7 }
  );
  const verdicts = await engine.triage([fail("a", "timeout", "Timeout 30000ms exceeded")], config);
  assert.ok(!llmCalled, "LLM should NOT be called when heuristic is confident");
  assert.equal(verdicts[0].failureClass, "FLAKY");
  assert.equal(verdicts[0].lane, "retry");
});
