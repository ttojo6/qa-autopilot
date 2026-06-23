import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateApprovals,
  InMemoryAuditLog,
  InMemoryProposalStore,
  InMemoryApprovalStore,
  recordApproval,
} from "../dist/index.js";

const proposal = (over = {}) => ({
  id: "p1",
  signature: "sig",
  scope: "app_source",
  author: "ai",
  requiredApprovals: 2,
  codeownersRequired: true,
  regressionPassed: true,
  status: "proposed",
  createdAt: "2026-01-01T00:00:00Z",
  ...over,
});

const approval = (approver, over = {}) => ({
  proposalId: "p1",
  approver,
  decision: "approve",
  isCodeowner: false,
  createdAt: "2026-01-01T00:00:00Z",
  ...over,
});

test("blocks when regression proof not passed", () => {
  const e = evaluateApprovals(proposal({ regressionPassed: false }), [
    approval("alice", { isCodeowner: true }),
    approval("bob"),
  ]);
  assert.equal(e.satisfied, false);
  assert.ok(e.blockingReasons.some((r) => r.includes("regression")));
});

test("self-approval by author does not count", () => {
  const e = evaluateApprovals(proposal({ author: "alice", requiredApprovals: 1, codeownersRequired: false }), [
    approval("alice", { isCodeowner: true }),
  ]);
  assert.equal(e.satisfied, false, "author approving own proposal must not satisfy");
  assert.deepEqual(e.humanApprovers, []);
});

test("ai/system approvals are ignored", () => {
  const e = evaluateApprovals(proposal({ requiredApprovals: 1, codeownersRequired: false }), [
    approval("ai"),
    approval("system"),
  ]);
  assert.equal(e.satisfied, false);
});

test("a single rejection blocks", () => {
  const e = evaluateApprovals(proposal({ requiredApprovals: 1, codeownersRequired: false }), [
    approval("alice"),
    approval("bob", { decision: "reject" }),
  ]);
  assert.equal(e.satisfied, false);
  assert.ok(e.blockingReasons.some((r) => r.includes("rejection")));
});

test("app_source needs 2 approvals incl a codeowner", () => {
  const notEnough = evaluateApprovals(proposal(), [approval("alice", { isCodeowner: true })]);
  assert.equal(notEnough.satisfied, false);

  const noCodeowner = evaluateApprovals(proposal(), [approval("alice"), approval("bob")]);
  assert.equal(noCodeowner.satisfied, false);
  assert.ok(noCodeowner.blockingReasons.some((r) => r.includes("CODEOWNERS")));

  const ok = evaluateApprovals(proposal(), [approval("alice", { isCodeowner: true }), approval("bob")]);
  assert.equal(ok.satisfied, true);
  assert.deepEqual([...ok.humanApprovers].sort(), ["alice", "bob"]);
});

test("duplicate approver counts once", () => {
  const e = evaluateApprovals(proposal({ requiredApprovals: 2, codeownersRequired: false }), [
    approval("alice"),
    approval("alice"),
  ]);
  assert.equal(e.satisfied, false);
});

test("recordApproval transitions status and writes append-only audit", async () => {
  const proposals = new InMemoryProposalStore();
  const approvals = new InMemoryApprovalStore();
  const audit = new InMemoryAuditLog();
  await proposals.save(proposal({ requiredApprovals: 1, codeownersRequired: false }));

  const e1 = await recordApproval(approval("alice"), { proposals, approvals, audit });
  assert.equal(e1.satisfied, true);
  assert.equal((await proposals.get("p1")).status, "approved");

  const log = await audit.list();
  assert.ok(log.some((r) => r.action === "approval.recorded"));
  assert.ok(log.some((r) => r.action === "proposal.status_changed"));
  // append-only: AuditLog has no update/delete
  assert.equal(typeof audit.update, "undefined");
  assert.equal(typeof audit.delete, "undefined");
});

test("rejection transitions proposal to rejected", async () => {
  const proposals = new InMemoryProposalStore();
  const approvals = new InMemoryApprovalStore();
  const audit = new InMemoryAuditLog();
  await proposals.save(proposal({ requiredApprovals: 1, codeownersRequired: false }));
  await recordApproval(approval("bob", { decision: "reject" }), { proposals, approvals, audit });
  assert.equal((await proposals.get("p1")).status, "rejected");
});
