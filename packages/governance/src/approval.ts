/**
 * 승인 평가 — 거버넌스의 핵심 안전장치 (R7: 게이트 우회/self-approve 방지).
 *
 * "AI는 머지 권한 없음"은 이 레이어에서도 유효하다: 이 모듈은 *사람 승인이 충족됐는지*만
 * 계산한다. 실제 병합은 사람이 GitHub에서 한다 — merge 함수가 여기에도 없다.
 *
 * 차단 규칙:
 *  1) 제안 작성자(author)는 자기 제안을 승인할 수 없다 (self-approval 금지).
 *  2) "ai"/"system"은 승인자로 집계되지 않는다 (봇 자기승인 금지).
 *  3) reject가 하나라도 있으면 차단.
 *  4) 회귀 증빙이 통과하지 않았으면 차단.
 *  5) codeownersRequired면 승인자 중 최소 1명이 codeowner여야 한다.
 *  6) 고유 사람 승인자 수 ≥ requiredApprovals.
 */

import type { ProposalRecord, ApprovalRecord } from "./records.js";

const NON_HUMAN = new Set(["ai", "system"]);

export interface ApprovalEvaluation {
  /** 사람 승인이 충족되어 병합이 허용되는가. */
  readonly satisfied: boolean;
  readonly humanApprovers: readonly string[];
  readonly blockingReasons: readonly string[];
}

export function evaluateApprovals(
  proposal: ProposalRecord,
  approvals: readonly ApprovalRecord[]
): ApprovalEvaluation {
  const reasons: string[] = [];

  if (!proposal.regressionPassed) {
    reasons.push("regression proof not passed");
  }
  if (approvals.some((a) => a.decision === "reject")) {
    reasons.push("has at least one rejection");
  }

  const approvalsOnly = approvals.filter((a) => a.decision === "approve");

  // 유효 승인자: 사람 + 작성자가 아님 + 중복 제거.
  const valid = new Map<string, ApprovalRecord>();
  for (const a of approvalsOnly) {
    if (NON_HUMAN.has(a.approver.toLowerCase())) continue; // 봇 승인 무시
    if (a.approver === proposal.author) continue; // self-approval 무시
    if (!valid.has(a.approver)) valid.set(a.approver, a);
  }
  const humanApprovers = [...valid.keys()];

  if (humanApprovers.length < proposal.requiredApprovals) {
    reasons.push(
      `needs ${proposal.requiredApprovals} approval(s), have ${humanApprovers.length}`
    );
  }
  if (proposal.codeownersRequired && ![...valid.values()].some((a) => a.isCodeowner)) {
    reasons.push("CODEOWNERS approval required but none present");
  }

  return {
    satisfied: reasons.length === 0,
    humanApprovers,
    blockingReasons: reasons,
  };
}
