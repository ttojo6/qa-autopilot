import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PgProposalStore,
  PgApprovalStore,
  PgAuditLog,
  upsertProposalDetail,
  listProposalDetails,
} from "../dist/pg/index.js";
import { recordApproval } from "../dist/index.js";

/** SQL을 기록하고 큐에 넣어둔 결과를 순서대로 반환하는 가짜 Queryable. */
function fakeDb(responses = []) {
  const calls = [];
  let i = 0;
  return {
    calls,
    query: async (text, params) => {
      calls.push({ text, params });
      return responses[i++] ?? { rows: [] };
    },
  };
}

const propRow = (over = {}) => ({
  id: "p1", signature: "sig", scope: "app_source", author: "ai",
  required_approvals: 2, codeowners_required: true, regression_passed: true,
  status: "proposed", summary: "s", diff: "d", proof_status: "passed",
  proof_evidence: "ev", affected_files: ["a.ts"], failure_class: "PRODUCT_BUG",
  created_at: "2026-01-01T00:00:00Z", ...over,
});

test("PgProposalStore.save issues parameterized UPSERT touching only status on conflict", async () => {
  const db = fakeDb();
  const store = new PgProposalStore(db);
  await store.save({
    id: "p1", signature: "sig", scope: "app_source", author: "ai",
    requiredApprovals: 2, codeownersRequired: true, regressionPassed: true,
    status: "approved", createdAt: "2026-01-01T00:00:00Z",
  });
  const { text, params } = db.calls[0];
  assert.match(text, /insert into proposals/i);
  assert.match(text, /on conflict \(id\) do update set status = excluded\.status/i);
  assert.equal(params[0], "p1");
  assert.equal(params[7], "approved");
});

test("PgProposalStore.get maps row to ProposalRecord", async () => {
  const db = fakeDb([{ rows: [propRow()] }]);
  const rec = await new PgProposalStore(db).get("p1");
  assert.equal(rec.requiredApprovals, 2);
  assert.equal(rec.codeownersRequired, true);
  assert.equal(rec.scope, "app_source");
});

test("listProposalDetails maps rich columns incl. affected_files jsonb", async () => {
  const db = fakeDb([{ rows: [propRow(), propRow({ id: "p2", affected_files: [] })] }]);
  const details = await listProposalDetails(db);
  assert.equal(details.length, 2);
  assert.deepEqual(details[0].affectedFiles, ["a.ts"]);
  assert.equal(details[0].proofStatus, "passed");
  assert.equal(details[0].failureClass, "PRODUCT_BUG");
});

test("upsertProposalDetail writes all columns and preserves on conflict", async () => {
  const db = fakeDb();
  await upsertProposalDetail(db, {
    id: "p1", signature: "sig", scope: "test_only", author: "ai",
    requiredApprovals: 1, codeownersRequired: false, regressionPassed: true, status: "proposed",
    summary: "s", diff: "d", proofStatus: "passed", proofEvidence: "ev",
    affectedFiles: ["x.ts"], failureClass: "TEST_BUG", createdAt: "2026-01-01T00:00:00Z",
  });
  const { text, params } = db.calls[0];
  assert.match(text, /insert into proposals/i);
  assert.match(text, /affected_files = excluded\.affected_files/i);
  assert.equal(params[12], JSON.stringify(["x.ts"]));
});

test("recordApproval works over pg ports (get → add → re-evaluate → status update + audit)", async () => {
  // 1) proposals.get → app_source, needs 2 (returns row)
  // 2) approvals.add (insert)
  // 3) audit append (returning)
  // 4) approvals.forProposal → one human codeowner approval (still <2)
  const db = fakeDb([
    { rows: [propRow()] }, // proposals.get
    { rows: [] }, // approvals.add
    { rows: [{ id: "1", created_at: "2026-01-01T00:00:00Z" }] }, // audit append returning
    { rows: [{ proposal_id: "p1", approver: "alice", decision: "approve", is_codeowner: true, created_at: "2026-01-01T00:00:00Z" }] }, // forProposal
  ]);
  const stores = {
    proposals: new PgProposalStore(db),
    approvals: new PgApprovalStore(db),
    audit: new PgAuditLog(db),
  };
  const evaluation = await recordApproval(
    { proposalId: "p1", approver: "alice", decision: "approve", isCodeowner: true, createdAt: "2026-01-01T00:00:00Z" },
    stores
  );
  assert.equal(evaluation.satisfied, false, "1 of 2 required → not satisfied");
  // audit insert happened with parameterized actor
  assert.ok(db.calls.some((c) => /insert into audit_log/i.test(c.text)));
});
