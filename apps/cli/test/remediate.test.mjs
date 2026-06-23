import { test } from "node:test";
import assert from "node:assert/strict";
import { remediate } from "../dist/remediate.js";
import { signatureOf } from "@qa/triage";

const fail = (caseId, runnerId, type, msg) => ({
  caseId, title: caseId, runnerId, status: "failed", durationMs: 1, attempts: 1,
  error: { type, message: msg }, artifacts: [],
});

const config = {
  project: "t",
  runners: [{ id: "e2e", adapter: "playwright-ts", workdir: ".", command: "x" }],
  retry: { maxRetries: 0, backoffMs: 0, retryableErrors: [] },
  triage: { classes: [], flakySignals: [], confidenceThreshold: 0.75 },
  remediation: {
    testOnly: { autoPr: true, approval: 1 },
    appSource: { autoPr: false, approval: 2, codeownersRequired: true },
  },
  governance: { releaseGateExclude: [] },
};

const okGen = { async generate() { return { diff: "--- a\n+++ b\n", summary: "fix", rationale: "r", affectedFiles: ["a.ts"], source: "fake" }; } };
const passVerifier = { async verify() { return { status: "passed", evidence: "ok" }; } };

test("only signal verdicts become proposals; failureClass attached", async () => {
  const f1 = fail("c1", "e2e", "assertion", "expected 1 got 2");
  const verdicts = [
    { signature: signatureOf(f1), failureClass: "PRODUCT_BUG", confidence: 0.9, lane: "signal", rationale: "r", source: "t" },
    { signature: "other", failureClass: "FLAKY", confidence: 0.9, lane: "quarantine", rationale: "r", source: "t" },
  ];
  const out = await remediate({
    config, projectRoot: ".", adapters: {}, failures: [f1], verdicts, enablePr: false,
    overrides: { generator: okGen, verifier: passVerifier },
  });
  assert.equal(out.length, 1, "only the signal verdict yields a proposal");
  assert.equal(out[0].scope, "app_source");
  assert.equal(out[0].failureClass, "PRODUCT_BUG");
  assert.equal(out[0].status, "needs_human_pr", "app_source without prPort never auto-opens");
});

test("disableAppSource skips app_source verdicts (R2 STOP)", async () => {
  const f1 = fail("c1", "e2e", "assertion", "expected 1 got 2");
  const verdicts = [
    { signature: signatureOf(f1), failureClass: "PRODUCT_BUG", confidence: 0.9, lane: "signal", rationale: "r", source: "t" },
  ];
  const out = await remediate({
    config, projectRoot: ".", adapters: {}, failures: [f1], verdicts, enablePr: false,
    disableAppSource: true,
    overrides: { generator: okGen, verifier: passVerifier },
  });
  assert.equal(out.length, 0, "app_source proposal suppressed when disableAppSource is on");
});

test("scope=none verdicts produce nothing", async () => {
  const out = await remediate({
    config, projectRoot: ".", adapters: {}, failures: [], verdicts: [
      { signature: "s", failureClass: "FLAKY", confidence: 0.9, lane: "signal", rationale: "r", source: "t" },
    ], enablePr: false,
    overrides: { generator: okGen, verifier: passVerifier },
  });
  assert.equal(out.length, 0);
});

test("caseIdsFor maps signature to affected cases", async () => {
  const f1 = fail("c1", "e2e", "timeout", "Timeout 30000ms");
  const f2 = fail("c2", "e2e", "timeout", "Timeout 31000ms");
  const sig = signatureOf(f1);
  let seenCaseIds = null;
  const capturingGen = { async generate(req) { seenCaseIds = req.caseIds; return okGen.generate(); } };
  const verdicts = [{ signature: sig, failureClass: "TEST_BUG", confidence: 0.9, lane: "signal", rationale: "r", source: "t" }];
  await remediate({
    config, projectRoot: ".", adapters: {}, failures: [f1, f2], verdicts, enablePr: false,
    overrides: { generator: capturingGen, verifier: passVerifier },
  });
  assert.deepEqual([...seenCaseIds].sort(), ["c1", "c2"], "both same-signature cases attached");
});
