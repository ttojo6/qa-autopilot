/**
 * 제안 영속화 — DATABASE_URL 이 있으면 Postgres에 적재(콘솔과 공유), 없으면 JSON 핸드오프.
 *
 * 제안 id는 서명 해시로 안정화 → 재실행 시 같은 결함은 같은 제안으로 upsert(상태 연속성).
 */

import { upsertProposalDetail, createPool, type ProposalDetail } from "@qa/governance/pg";
import type { EnrichedProposal } from "./remediate.js";
import { writeProposals } from "./proposals-io.js";

/** 서명 → 안정적 짧은 id. */
function proposalId(signature: string): string {
  let h = 0;
  for (let i = 0; i < signature.length; i++) h = (Math.imul(31, h) + signature.charCodeAt(i)) | 0;
  return `prop-${(h >>> 0).toString(36)}`;
}

function toDetail(p: EnrichedProposal): ProposalDetail {
  return {
    id: proposalId(p.signature),
    signature: p.signature,
    scope: p.scope as ProposalDetail["scope"],
    author: "ai",
    requiredApprovals: p.gate.requiredApprovals,
    codeownersRequired: p.gate.codeownersRequired,
    regressionPassed: p.regressionProof.status === "passed",
    status: "proposed",
    summary: p.draft.summary,
    diff: p.draft.diff,
    proofStatus: p.regressionProof.status,
    proofEvidence: p.regressionProof.evidence,
    affectedFiles: p.draft.affectedFiles,
    failureClass: p.failureClass,
    createdAt: new Date().toISOString(),
  };
}

export interface PersistResult {
  readonly sink: "postgres" | "file";
  readonly location: string;
  readonly count: number;
}

export async function persistProposals(
  projectRoot: string,
  proposals: readonly EnrichedProposal[]
): Promise<PersistResult> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const pool = createPool(url);
    try {
      for (const p of proposals) {
        // scope=none은 애초에 제안으로 만들어지지 않음(app_source/test_only만 도달).
        await upsertProposalDetail(pool, toDetail(p));
      }
    } finally {
      await pool.end();
    }
    return { sink: "postgres", location: url.replace(/:[^:@/]+@/, ":****@"), count: proposals.length };
  }
  const file = writeProposals(projectRoot, proposals);
  return { sink: "file", location: file, count: proposals.length };
}
