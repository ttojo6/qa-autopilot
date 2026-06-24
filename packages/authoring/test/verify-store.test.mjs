import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyDraftRun,
  proposalId,
  toStored,
  InMemoryAuthoringStore,
  PgAuthoringStore,
} from "../dist/index.js";

test("classifyDraftRun maps run results to outcomes", () => {
  assert.equal(classifyDraftRun({ ran: true, passed: true }).outcome, "runs_passes");
  assert.equal(classifyDraftRun({ ran: true, passed: false }).outcome, "runs_fails");
  assert.equal(classifyDraftRun({ ran: false, passed: false }).outcome, "errors");
  assert.equal(classifyDraftRun({ ran: true, passed: true, collectError: "import x" }).outcome, "errors");
});

test("proposalId stable for same runner+title", () => {
  assert.equal(proposalId("pytest", "Login error"), proposalId("pytest", "login ERROR"));
  assert.notEqual(proposalId("pytest", "A"), proposalId("playwright-ts", "A"));
});

const mkProposal = (title, status = "pending_review") => ({
  draft: { specId: "s1", targetRunner: "pytest", title, filePath: `t/${title}.py`, code: "c", diff: "d", rationale: "r", source: "fake" },
  signature: "sig",
  verification: { outcome: "runs_passes", evidence: "ok" },
  status,
});

test("InMemoryAuthoringStore upsert preserves human decision on re-upsert", async () => {
  const s = new InMemoryAuthoringStore();
  const stored = toStored(mkProposal("Test A"), "pytest");
  await s.upsert(stored);
  await s.setDecision(stored.id, "approved");
  // 재적재(검증 갱신)해도 decision 보존
  await s.upsert({ ...stored, verifyOutcome: "runs_fails" });
  const got = await s.get(stored.id);
  assert.equal(got.decision, "approved");
  assert.equal(got.verifyOutcome, "runs_fails");
});

function fakeDb(rows = []) {
  const calls = [];
  return { calls, query: async (t, p) => { calls.push({ t, p }); return { rows }; } };
}

test("PgAuthoringStore.upsert preserves decision on conflict (does not touch decision)", async () => {
  const db = fakeDb();
  await new PgAuthoringStore(db).upsert(toStored(mkProposal("X"), "pytest"));
  const { t } = db.calls[0];
  assert.match(t, /insert into test_proposals/i);
  assert.match(t, /on conflict \(id\) do update set/i);
  assert.doesNotMatch(t, /decision = excluded/i); // decision은 갱신 안 함
});

test("PgAuthoringStore.setDecision updates only decision", async () => {
  const db = fakeDb();
  await new PgAuthoringStore(db).setDecision("tp-1", "approved");
  assert.match(db.calls[0].t, /update test_proposals set decision = \$2 where id = \$1/i);
  assert.deepEqual(db.calls[0].p, ["tp-1", "approved"]);
});
