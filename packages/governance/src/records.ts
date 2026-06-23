/**
 * 거버넌스 영속 레코드 타입. migrations/001_init.sql 의 테이블과 1:1 대응.
 */

export type ProposalScope = "test_only" | "app_source";
export type ProposalStatus = "proposed" | "approved" | "merged" | "rejected";

export interface ProposalRecord {
  readonly id: string;
  readonly signature: string;
  readonly scope: ProposalScope;
  /** 제안을 만든 주체. 자동 제안은 "ai" 또는 "system". self-approval 차단의 기준. */
  readonly author: string;
  readonly requiredApprovals: number;
  readonly codeownersRequired: boolean;
  readonly regressionPassed: boolean;
  readonly status: ProposalStatus;
  readonly createdAt: string;
}

export type Decision = "approve" | "reject";

export interface ApprovalRecord {
  readonly proposalId: string;
  /** 승인자 — 반드시 사람. "ai"/"system"은 승인자가 될 수 없다. */
  readonly approver: string;
  readonly decision: Decision;
  readonly isCodeowner: boolean;
  readonly createdAt: string;
}
