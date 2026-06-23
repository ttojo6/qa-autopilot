/**
 * 콘솔용 거버넌스 스토어 (서버 전용).
 *
 * 데이터 출처(우선순위):
 *  1) QA_PROPOSALS_FILE 환경변수가 가리키는 CLI 핸드오프 JSON (artifacts/proposals.json)
 *  2) 없으면 인메모리 시드 샘플
 * 운영에서는 동일 포트(ProposalStore/ApprovalStore/AuditLog)를 Postgres 구현으로 교체.
 */

import { existsSync, readFileSync } from "node:fs";
import {
  InMemoryProposalStore,
  InMemoryApprovalStore,
  InMemoryAuditLog,
  type ProposalRecord,
} from "@qa/governance";

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

/** ProposalView[] 로부터 스토어 3종을 구성한다 (시드·로더 공용). */
function makeStores(views: ProposalView[]): Stores {
  const proposals = new InMemoryProposalStore();
  const approvals = new InMemoryApprovalStore();
  const audit = new InMemoryAuditLog();
  const map = new Map<string, ProposalView>();

  for (const v of views) {
    const { summary, diff, proofStatus, proofEvidence, affectedFiles, failureClass, ...record } = v;
    void summary; void diff; void proofStatus; void proofEvidence; void affectedFiles; void failureClass;
    proposals.save(record);
    map.set(v.id, v);
  }
  audit.append({ actor: "system", action: "proposals.loaded", detail: { count: views.length } });
  return { proposals, approvals, audit, views: map };
}

/** CLI 핸드오프 JSON(EnrichedProposal[])을 ProposalView[]로 변환. */
function loadViewsFromFile(file: string): ProposalView[] | null {
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as Array<{
      signature: string;
      scope: "test_only" | "app_source";
      failureClass: string;
      draft: { diff: string; summary: string; affectedFiles: string[] };
      regressionProof: { status: "passed" | "failed" | "not_run"; evidence: string };
      gate: { requiredApprovals: number; codeownersRequired: boolean };
    }>;
    return raw.map((p, i) => ({
      id: `prop-${i + 1}`,
      signature: p.signature,
      scope: p.scope,
      author: "ai",
      requiredApprovals: p.gate.requiredApprovals,
      codeownersRequired: p.gate.codeownersRequired,
      regressionPassed: p.regressionProof.status === "passed",
      status: "proposed",
      createdAt: new Date().toISOString(),
      summary: p.draft.summary,
      diff: p.draft.diff,
      proofStatus: p.regressionProof.status,
      proofEvidence: p.regressionProof.evidence,
      affectedFiles: p.draft.affectedFiles,
      failureClass: p.failureClass,
    }));
  } catch {
    return null;
  }
}

function sampleViews(): ProposalView[] {
  return [
    {
      id: "prop-1",
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
      id: "prop-2",
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
      id: "prop-3",
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
}

function initialViews(): ProposalView[] {
  const file = process.env.QA_PROPOSALS_FILE;
  if (file && existsSync(file)) {
    const loaded = loadViewsFromFile(file);
    if (loaded && loaded.length > 0) return loaded;
  }
  return sampleViews();
}

const g = globalThis as unknown as { __qaStores?: Stores };
export const stores: Stores = g.__qaStores ?? (g.__qaStores = makeStores(initialViews()));
