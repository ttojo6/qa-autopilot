import { test } from "node:test";
import assert from "node:assert/strict";
import {
  countLanes,
  addRouting,
  quarantineRatio,
  overrideRate,
  rollbackRate,
  evaluateTriggers,
  deriveControls,
  DEFAULT_STOP_POLICY,
  EMPTY_ROUTING,
} from "../dist/index.js";

test("countLanes tallies lanes", () => {
  const c = countLanes([{ lane: "signal" }, { lane: "human" }, { lane: "quarantine" }, { lane: "quarantine" }]);
  assert.equal(c.total, 4);
  assert.equal(c.quarantine, 2);
  assert.equal(c.signal, 1);
});

test("addRouting is additive and immutable", () => {
  const a = countLanes([{ lane: "signal" }]);
  const b = countLanes([{ lane: "human" }]);
  const sum = addRouting(a, b);
  assert.equal(sum.total, 2);
  assert.equal(a.total, 1, "inputs unchanged");
});

test("ratios handle zero denominator", () => {
  assert.equal(quarantineRatio(EMPTY_ROUTING), 0);
  assert.equal(rollbackRate({ routing: EMPTY_ROUTING, feedback: { humanOverrides: 0, merged: 0, rolledBack: 0 } }), 0);
});

test("minSamples guards small-sample false alarms", () => {
  // 5 total, 4 quarantine = 80% — over threshold, but below minSamples(20) → no trigger
  const snap = {
    routing: { total: 5, signal: 0, human: 1, quarantine: 4, retry: 0 },
    feedback: { humanOverrides: 0, merged: 0, rolledBack: 0 },
  };
  assert.equal(evaluateTriggers(snap).length, 0);
});

test("R4 quarantine trigger fires with enough samples", () => {
  const snap = {
    routing: { total: 50, signal: 5, human: 5, quarantine: 30, retry: 10 }, // 60%
    feedback: { humanOverrides: 0, merged: 0, rolledBack: 0 },
  };
  const triggers = evaluateTriggers(snap);
  const r4 = triggers.find((t) => t.risk === "R4");
  assert.ok(r4);
  assert.equal(r4.control, "reviewFlakySignals");
  assert.equal(deriveControls(triggers).reviewFlakySignals, true);
});

test("R1 override trigger forces human triage", () => {
  const snap = {
    routing: { total: 100, signal: 40, human: 10, quarantine: 30, retry: 20 },
    feedback: { humanOverrides: 30, merged: 0, rolledBack: 0 }, // 30% > 25%
  };
  const triggers = evaluateTriggers(snap);
  assert.ok(triggers.some((t) => t.risk === "R1" && t.control === "forceHumanTriage"));
  assert.equal(deriveControls(triggers).forceHumanTriage, true);
});

test("R2 rollback trigger disables app_source remediation (needs merged>=minSamples)", () => {
  const tooFew = {
    routing: { total: 100, signal: 40, human: 0, quarantine: 0, retry: 60 },
    feedback: { humanOverrides: 0, merged: 5, rolledBack: 4 }, // 80% but merged<20
  };
  assert.equal(evaluateTriggers(tooFew).some((t) => t.risk === "R2"), false);

  const enough = {
    routing: { total: 100, signal: 40, human: 0, quarantine: 0, retry: 60 },
    feedback: { humanOverrides: 0, merged: 40, rolledBack: 10 }, // 25% > 15%
  };
  const triggers = evaluateTriggers(enough);
  assert.ok(triggers.some((t) => t.risk === "R2" && t.control === "disableAppSourceRemediation"));
  assert.equal(deriveControls(triggers).disableAppSourceRemediation, true);
});

test("healthy metrics produce no triggers", () => {
  const snap = {
    routing: { total: 100, signal: 50, human: 10, quarantine: 20, retry: 20 }, // 20% quarantine
    feedback: { humanOverrides: 5, merged: 30, rolledBack: 1 }, // 5% override, 3% rollback
  };
  assert.deepEqual(deriveControls(evaluateTriggers(snap)), {
    forceHumanTriage: false,
    disableAppSourceRemediation: false,
    reviewFlakySignals: false,
  });
});
