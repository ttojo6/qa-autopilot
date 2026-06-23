import { test } from "node:test";
import assert from "node:assert/strict";
import { scopeFor, gate, RemediationEngine } from "../dist/index.js";

const config = {
  testOnly: { autoPr: true, approval: 1 },
  appSource: { autoPr: false, approval: 2, codeownersRequired: true },
};

test("scopeFor maps classes to remediation scope", () => {
  assert.equal(scopeFor("TEST_BUG"), "test_only");
  assert.equal(scopeFor("DATA"), "test_only");
  assert.equal(scopeFor("PRODUCT_BUG"), "app_source");
  assert.equal(scopeFor("FLAKY"), "none");
  assert.equal(scopeFor("ENV_INFRA"), "none");
  assert.equal(scopeFor("MODEL_API"), "none");
});

test("gate blocks when regression proof is not passed", () => {
  const g = gate("test_only", { status: "not_run", evidence: "x" }, config);
  assert.ok(g.blockedReasons.length > 0);
  assert.equal(g.autoPrAllowed, false);
});

test("gate forces autoPr=false for app_source even when proof passes", () => {
  const g = gate("app_source", { status: "passed", evidence: "x" }, config);
  assert.equal(g.autoPrAllowed, false, "app_source must never auto-PR");
  assert.equal(g.requiredApprovals, 2);
  assert.equal(g.codeownersRequired, true);
  assert.equal(g.blockedReasons.length, 0);
});

test("gate allows autoPr for test_only when proof passes", () => {
  const g = gate("test_only", { status: "passed", evidence: "x" }, config);
  assert.equal(g.autoPrAllowed, true);
  assert.equal(g.requiredApprovals, 1);
});

const mkVerdict = (overrides) => ({
  signature: "sig1",
  failureClass: "PRODUCT_BUG",
  confidence: 0.9,
  lane: "signal",
  rationale: "expected X got Y",
  source: "test",
  ...overrides,
});

const okGenerator = {
  async generate() {
    return { diff: "--- a\n+++ b\n", summary: "fix", rationale: "r", affectedFiles: ["a.ts"], source: "fake" };
  },
};
const passVerifier = { async verify() { return { status: "passed", evidence: "reran 1 case: pass" }; } };
const failVerifier = { async verify() { return { status: "not_run", evidence: "no verifier" }; } };

test("engine rejects non-signal lanes (Remediation Lane entry guard)", async () => {
  const engine = new RemediationEngine({
    generator: okGenerator, verifier: passVerifier, caseIdsFor: () => ["c1"],
  });
  for (const lane of ["retry", "quarantine", "human"]) {
    const p = await engine.propose(mkVerdict({ lane }), config);
    assert.equal(p, null, `lane=${lane} must not enter remediation`);
  }
});

test("engine excludes scope=none classes", async () => {
  const engine = new RemediationEngine({
    generator: okGenerator, verifier: passVerifier, caseIdsFor: () => ["c1"],
  });
  const p = await engine.propose(mkVerdict({ failureClass: "FLAKY" }), config);
  assert.equal(p, null);
});

test("app_source proposal needs human PR even with passing proof (no auto-PR, no merge)", async () => {
  let prCalled = false;
  const engine = new RemediationEngine({
    generator: okGenerator,
    verifier: passVerifier,
    caseIdsFor: () => ["c1"],
    prPort: { async createPr() { prCalled = true; return { url: "http://pr/1" }; } },
  });
  const p = await engine.propose(mkVerdict({ failureClass: "PRODUCT_BUG" }), config);
  assert.equal(p.scope, "app_source");
  assert.equal(p.status, "needs_human_pr");
  assert.equal(prCalled, false, "app_source must not auto-open a PR");
});

test("test_only with passing proof opens a PR (but never merges)", async () => {
  const engine = new RemediationEngine({
    generator: okGenerator,
    verifier: passVerifier,
    caseIdsFor: () => ["c1"],
    prPort: { async createPr() { return { url: "http://pr/2" }; } },
  });
  const p = await engine.propose(mkVerdict({ failureClass: "TEST_BUG" }), config);
  assert.equal(p.scope, "test_only");
  assert.equal(p.status, "pr_opened");
  assert.equal(p.prUrl, "http://pr/2");
});

test("unverified fix is blocked (no proof, no PR)", async () => {
  const engine = new RemediationEngine({
    generator: okGenerator,
    verifier: failVerifier,
    caseIdsFor: () => ["c1"],
    prPort: { async createPr() { return { url: "http://pr/3" }; } },
  });
  const p = await engine.propose(mkVerdict({ failureClass: "TEST_BUG" }), config);
  assert.equal(p.status, "blocked");
  assert.ok(p.gate.blockedReasons.length > 0);
});
