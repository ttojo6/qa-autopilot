/**
 * 제안/승인 저장소 포트 + 인메모리 구현.
 *
 * 인메모리 구현은 테스트·로컬용. 운영은 동일 포트를 Postgres 구현으로 교체
 * (migrations/001_init.sql 의 remediation_proposals / approvals 테이블).
 *
 * recordApproval은 evaluateApprovals를 통해 상태 전이를 결정하고, 모든 변경을 AuditLog에 남긴다.
 */

import type { ProposalRecord, ApprovalRecord } from "./records.js";
import type { AuditLog } from "./audit.js";
import { evaluateApprovals, type ApprovalEvaluation } from "./approval.js";

export interface ProposalStore {
  save(record: ProposalRecord): Promise<void>;
  get(id: string): Promise<ProposalRecord | undefined>;
  list(): Promise<readonly ProposalRecord[]>;
}

export interface ApprovalStore {
  add(record: ApprovalRecord): Promise<void>;
  forProposal(proposalId: string): Promise<readonly ApprovalRecord[]>;
}

export class InMemoryProposalStore implements ProposalStore {
  private readonly map = new Map<string, ProposalRecord>();
  async save(record: ProposalRecord): Promise<void> {
    this.map.set(record.id, record);
  }
  async get(id: string): Promise<ProposalRecord | undefined> {
    return this.map.get(id);
  }
  async list(): Promise<readonly ProposalRecord[]> {
    return [...this.map.values()];
  }
}

export class InMemoryApprovalStore implements ApprovalStore {
  private readonly byProposal = new Map<string, ApprovalRecord[]>();
  async add(record: ApprovalRecord): Promise<void> {
    const arr = this.byProposal.get(record.proposalId) ?? [];
    arr.push(record);
    this.byProposal.set(record.proposalId, arr);
  }
  async forProposal(proposalId: string): Promise<readonly ApprovalRecord[]> {
    return this.byProposal.get(proposalId) ?? [];
  }
}

/**
 * 승인을 기록하고 평가 결과에 따라 제안 상태를 전이시킨다. 모든 행위를 감사 로그에 남긴다.
 * 반환: 갱신된 평가 결과.
 */
export async function recordApproval(
  approval: ApprovalRecord,
  stores: { proposals: ProposalStore; approvals: ApprovalStore; audit: AuditLog }
): Promise<ApprovalEvaluation> {
  const proposal = await stores.proposals.get(approval.proposalId);
  if (!proposal) throw new Error(`unknown proposal: ${approval.proposalId}`);

  await stores.approvals.add(approval);
  await stores.audit.append({
    actor: approval.approver,
    action: "approval.recorded",
    target: approval.proposalId,
    detail: { decision: approval.decision, isCodeowner: approval.isCodeowner },
  });

  const all = await stores.approvals.forProposal(approval.proposalId);
  const evaluation = evaluateApprovals(proposal, all);

  const nextStatus = all.some((a) => a.decision === "reject")
    ? "rejected"
    : evaluation.satisfied
      ? "approved"
      : proposal.status;

  if (nextStatus !== proposal.status) {
    await stores.proposals.save({ ...proposal, status: nextStatus });
    await stores.audit.append({
      actor: "system",
      action: "proposal.status_changed",
      target: proposal.id,
      detail: { from: proposal.status, to: nextStatus },
    });
  }

  return evaluation;
}
