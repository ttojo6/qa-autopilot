/**
 * 콘솔 데이터 계층 (서버 전용). DATABASE_URL 유무로 백엔드를 분기한다:
 *   - 있으면: Postgres (@qa/governance/pg) — CLI와 같은 DB 공유.
 *   - 없으면: 인메모리(시드 또는 QA_PROPOSALS_FILE 핸드오프).
 * 페이지/액션은 이 모듈만 의존하므로 백엔드 교체가 화면 코드에 새지 않는다.
 */

import { evaluateApprovals, recordApproval, type ApprovalRecord } from "@qa/governance";
import { stores as memStores, type ProposalView } from "./store";

const usePg = Boolean(process.env.DATABASE_URL);

interface PgBundle {
  pool: { query: (t: string, p?: readonly unknown[]) => Promise<{ rows: unknown[] }>; end: () => Promise<void> };
  proposals: { get(id: string): Promise<unknown>; save(r: unknown): Promise<void>; list(): Promise<unknown[]> };
  approvals: { add(r: unknown): Promise<void>; forProposal(id: string): Promise<ApprovalRecord[]> };
  audit: { append(e: unknown): Promise<unknown> };
  listProposalDetails: (db: unknown) => Promise<ProposalView[]>;
  getProposalDetail: (db: unknown, id: string) => Promise<ProposalView | undefined>;
}

async function getPg(): Promise<PgBundle> {
  const g = globalThis as unknown as { __qaPg?: PgBundle };
  if (g.__qaPg) return g.__qaPg;
  const mod = await import("@qa/governance/pg");
  const pool = mod.createPool(process.env.DATABASE_URL as string);
  g.__qaPg = {
    pool: pool as PgBundle["pool"],
    proposals: new mod.PgProposalStore(pool) as unknown as PgBundle["proposals"],
    approvals: new mod.PgApprovalStore(pool) as unknown as PgBundle["approvals"],
    audit: new mod.PgAuditLog(pool) as unknown as PgBundle["audit"],
    listProposalDetails: mod.listProposalDetails as unknown as PgBundle["listProposalDetails"],
    getProposalDetail: mod.getProposalDetail as unknown as PgBundle["getProposalDetail"],
  };
  return g.__qaPg;
}

export async function listViews(): Promise<ProposalView[]> {
  if (usePg) {
    const pg = await getPg();
    return pg.listProposalDetails(pg.pool);
  }
  return [...memStores.views.values()];
}

export async function getView(id: string): Promise<ProposalView | undefined> {
  if (usePg) {
    const pg = await getPg();
    return pg.getProposalDetail(pg.pool, id);
  }
  return memStores.views.get(id);
}

export async function getApprovals(id: string): Promise<readonly ApprovalRecord[]> {
  if (usePg) {
    const pg = await getPg();
    return pg.approvals.forProposal(id);
  }
  return memStores.approvals.forProposal(id);
}

/** 한 제안의 승인 평가 결과 (게이트 충족 여부 + 차단 사유). */
export async function getEvaluation(view: ProposalView, id: string) {
  const approvals = await getApprovals(id);
  return { approvals, evaluation: evaluateApprovals(view, approvals) };
}

export async function submitDecision(approval: ApprovalRecord): Promise<void> {
  if (usePg) {
    const pg = await getPg();
    await recordApproval(approval, {
      proposals: pg.proposals as never,
      approvals: pg.approvals as never,
      audit: pg.audit as never,
    });
    return;
  }
  await recordApproval(approval, memStores);
}

export const backend: "postgres" | "memory" = usePg ? "postgres" : "memory";
