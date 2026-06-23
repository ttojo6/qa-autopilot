/**
 * 콘솔용 거버넌스 스토어 (서버 전용).
 *
 * 데모를 위해 인메모리 스토어를 시드한다. 운영에서는 동일 포트(ProposalStore/ApprovalStore/AuditLog)를
 * Postgres 구현(migrations/001_init.sql)으로 교체하면 콘솔 코드는 그대로 동작한다.
 *
 * Next dev의 HMR에도 상태가 유지되도록 globalThis에 싱글턴을 둔다.
 */

import {
  InMemoryProposalStore,
  InMemoryApprovalStore,
  InMemoryAuditLog,
  type ProposalRecord,
} from "@qa/governance";

/** 화면 표시용 부가 정보(diff·증빙 등)를 담은 뷰 모델. */
export interface ProposalView extends ProposalRecord {
  readonly summary: string;
  readonly diff: string;
  readonly proofStatus: "passed" | "failed" | "not_run";
  readonly proofEvidence: string;
  readonly affectedFiles: readonly string[];
  readonly failureClass: string;
}

export interface Stores {
  proposals: InMemoryProposalStore;
  approvals: InMemoryApprovalStore;
  audit: InMemoryAuditLog;
  views: Map<string, ProposalView>;
}

function seed(): Stores {
  const proposals = new InMemoryProposalStore();
  const approvals = new InMemoryApprovalStore();
  const audit = new InMemoryAuditLog();
  const views = new Map<string, ProposalView>();

  const samples: ProposalView[] = [
    {
      id: "p-1001",
      signature: "assertion|login.spec.ts|expected <num> received <num>",
      scope: "test_only",
      author: "ai",
      requiredApprovals: 1,
      codeownersRequired: false,
      regressionPassed: true,
      status: "proposed",
      createdAt: new Date(Date.now() - 3600_000).toISOString(),
      summary: "Update stale assertion in login spec",
      failureClass: "TEST_BUG",
      proofStatus: "passed",
      proofEvidence: "re-ran 1 affected case in worktree, all passed",
      affectedFiles: ["web/tests/login.spec.ts"],
      diff: `--- a/web/tests/login.spec.ts\n+++ b/web/tests/login.spec.ts\n@@\n-  expect(items).toHaveCount(3)\n+  expect(items).toHaveCount(4)\n`,
    },
    {
      id: "p-1002",
      signature: "assertion|cart.ts|total mismatch",
      scope: "app_source",
      author: "ai",
      requiredApprovals: 2,
      codeownersRequired: true,
      regressionPassed: true,
      status: "proposed",
      createdAt: new Date(Date.now() - 7200_000).toISOString(),
      summary: "Fix off-by-one in cart total calculation",
      failureClass: "PRODUCT_BUG",
      proofStatus: "passed",
      proofEvidence: "re-ran 3 affected cases in worktree, all passed",
      affectedFiles: ["web/src/lib/cart.ts"],
      diff: `--- a/web/src/lib/cart.ts\n+++ b/web/src/lib/cart.ts\n@@\n-  return items.slice(1).reduce(sum, 0)\n+  return items.reduce(sum, 0)\n`,
    },
    {
      id: "p-1003",
      signature: "exception|pipeline.py|KeyError speaker",
      scope: "app_source",
      author: "ai",
      requiredApprovals: 2,
      codeownersRequired: true,
      regressionPassed: false,
      status: "proposed",
      createdAt: new Date(Date.now() - 1800_000).toISOString(),
      summary: "Guard missing speaker key in pipeline",
      failureClass: "PRODUCT_BUG",
      proofStatus: "failed",
      proofEvidence: "re-ran 2 cases; 1 still failing: tests/test_pipeline.py::test_diarize",
      affectedFiles: ["src/pipeline.py"],
      diff: `--- a/src/pipeline.py\n+++ b/src/pipeline.py\n@@\n-  speaker = seg["speaker"]\n+  speaker = seg.get("speaker", "unknown")\n`,
    },
  ];

  for (const v of samples) {
    const { summary, diff, proofStatus, proofEvidence, affectedFiles, failureClass, ...record } = v;
    void summary; void diff; void proofStatus; void proofEvidence; void affectedFiles; void failureClass;
    proposals.save(record);
    views.set(v.id, v);
  }
  audit.append({ actor: "ai", action: "proposals.seeded", detail: { count: samples.length } });

  return { proposals, approvals, audit, views };
}

const g = globalThis as unknown as { __qaStores?: Stores };
export const stores: Stores = g.__qaStores ?? (g.__qaStores = seed());
