"use server";

import { revalidatePath } from "next/cache";
import type { ApprovalRecord } from "@qa/governance";
import { submitDecision, recordOverride, recordRollback } from "../lib/data";

/**
 * 승인/거절 Server Action. submitDecision → recordApproval가 self-approve/봇승인 차단·정족수·
 * CODEOWNERS를 평가하고 상태 전이 + 감사 로그를 처리한다(백엔드는 메모리/Postgres 자동 분기).
 * AI는 이 경로로 승인할 수 없다(사람 식별자 필수, 봇 이름은 집계 제외).
 */
export async function decide(formData: FormData): Promise<void> {
  const proposalId = String(formData.get("proposalId") ?? "");
  const approver = String(formData.get("approver") ?? "").trim();
  const decision = String(formData.get("decision") ?? "") as ApprovalRecord["decision"];
  const isCodeowner = formData.get("isCodeowner") === "on";

  if (!proposalId || !approver || (decision !== "approve" && decision !== "reject")) return;

  await submitDecision({ proposalId, approver, decision, isCodeowner, createdAt: new Date().toISOString() });

  revalidatePath(`/proposals/${proposalId}`);
  revalidatePath("/");
}

/** R1 — AI 분류에 이의(override). 메타 지표에 자동 기록 → STOP 트리거 평가에 반영. */
export async function disputeClassification(formData: FormData): Promise<void> {
  const proposalId = String(formData.get("proposalId") ?? "");
  if (!proposalId) return;
  await recordOverride();
  revalidatePath(`/proposals/${proposalId}`);
  revalidatePath("/");
}

/** R2 — 병합 후 롤백 보고. 메타 지표(rolled_back)에 자동 기록. */
export async function reportRollback(formData: FormData): Promise<void> {
  const proposalId = String(formData.get("proposalId") ?? "");
  if (!proposalId) return;
  await recordRollback();
  revalidatePath(`/proposals/${proposalId}`);
  revalidatePath("/");
}
