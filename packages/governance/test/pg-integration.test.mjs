import { test } from "node:test";
import assert from "node:assert/strict";
import { recordApproval } from "../dist/index.js";

const url = process.env.DATABASE_URL;
// 로컬(DB 없음)에서는 skip, CI(postgres 서비스)에서는 실제 왕복 실행.
const opts = url ? {} : { skip: "DATABASE_URL not set — live pg integration skipped" };

test("pg round-trip: upsert → ai self-approve ignored → 2 humans → approved + audit", opts, async () => {
  const pg = await import("../dist/pg/index.js");
  const db = pg.createPool(url);
  const now = () => new Date().toISOString();
  try {
    await db.query("truncate proposals, approvals, audit_log restart identity cascade");

    await pg.upsertProposalDetail(db, {
      id: "it-1", signature: "sig", scope: "app_source", author: "ai",
      requiredApprovals: 2, codeownersRequired: true, regressionPassed: true, status: "proposed",
      summary: "s", diff: "d", proofStatus: "passed", proofEvidence: "ev",
      affectedFiles: ["a.ts"], failureClass: "PRODUCT_BUG", createdAt: now(),
    });

    const details = await pg.listProposalDetails(db);
    assert.equal(details.length, 1);
    assert.deepEqual(details[0].affectedFiles, ["a.ts"]);
    assert.equal(details[0].proofStatus, "passed");

    const stores = {
      proposals: new pg.PgProposalStore(db),
      approvals: new pg.PgApprovalStore(db),
      audit: new pg.PgAuditLog(db),
    };

    // 봇(ai) 자기 승인 → 집계 안 됨
    let ev = await recordApproval(
      { proposalId: "it-1", approver: "ai", decision: "approve", isCodeowner: true, createdAt: now() },
      stores
    );
    assert.equal(ev.satisfied, false);

    // 사람 1 (codeowner) → 아직 2명 필요
    ev = await recordApproval(
      { proposalId: "it-1", approver: "alice", decision: "approve", isCodeowner: true, createdAt: now() },
      stores
    );
    assert.equal(ev.satisfied, false);

    // 사람 2 → 정족수 충족 + codeowner 충족
    ev = await recordApproval(
      { proposalId: "it-1", approver: "bob", decision: "approve", isCodeowner: false, createdAt: now() },
      stores
    );
    assert.equal(ev.satisfied, true);

    const after = await pg.getProposalDetail(db, "it-1");
    assert.equal(after.status, "approved");

    const audit = await stores.audit.list({ action: "proposal.status_changed" });
    assert.ok(audit.length >= 1, "status change audited");
  } finally {
    await db.end();
  }
});
