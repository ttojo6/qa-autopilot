/**
 * Postgres 구현 — ProposalStore/ApprovalStore/AuditLog 포트를 pg로 충족한다.
 * recordApproval은 이 구현을 그대로 받아 동작한다(포트 동일).
 *
 * 모든 쿼리는 파라미터 바인딩($1..)을 사용한다 (SQL 인젝션 방지).
 */

import type { ProposalStore, ApprovalStore } from "../store.js";
import type { AuditLog, AuditEvent, AuditRecord } from "../audit.js";
import type { ProposalRecord, ApprovalRecord } from "../records.js";
import type { Queryable } from "./queryable.js";

/** 콘솔 표시용 부가 컬럼까지 포함한 풍부한 제안 행. */
export interface ProposalDetail extends ProposalRecord {
  readonly summary: string;
  readonly diff: string;
  readonly proofStatus: "passed" | "failed" | "not_run";
  readonly proofEvidence: string;
  readonly affectedFiles: readonly string[];
  readonly failureClass: string;
}

interface ProposalRow {
  id: string;
  signature: string;
  scope: string;
  author: string;
  required_approvals: number;
  codeowners_required: boolean;
  regression_passed: boolean;
  status: string;
  summary: string | null;
  diff: string | null;
  proof_status: string | null;
  proof_evidence: string | null;
  affected_files: unknown;
  failure_class: string | null;
  created_at: Date | string;
}

function toRecord(r: ProposalRow): ProposalRecord {
  return {
    id: r.id,
    signature: r.signature,
    scope: r.scope as ProposalRecord["scope"],
    author: r.author,
    requiredApprovals: r.required_approvals,
    codeownersRequired: r.codeowners_required,
    regressionPassed: r.regression_passed,
    status: r.status as ProposalRecord["status"],
    createdAt: new Date(r.created_at).toISOString(),
  };
}

function toDetail(r: ProposalRow): ProposalDetail {
  const files = Array.isArray(r.affected_files) ? (r.affected_files as string[]) : [];
  return {
    ...toRecord(r),
    summary: r.summary ?? "",
    diff: r.diff ?? "",
    proofStatus: (r.proof_status as ProposalDetail["proofStatus"]) ?? "not_run",
    proofEvidence: r.proof_evidence ?? "",
    affectedFiles: files,
    failureClass: r.failure_class ?? "",
  };
}

export class PgProposalStore implements ProposalStore {
  constructor(private readonly db: Queryable) {}

  /** 상태 갱신용 UPSERT. 충돌 시 status만 갱신 → 부가 컬럼(diff 등)은 보존. */
  async save(r: ProposalRecord): Promise<void> {
    await this.db.query(
      `insert into proposals
         (id, signature, scope, author, required_approvals, codeowners_required, regression_passed, status)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (id) do update set status = excluded.status`,
      [r.id, r.signature, r.scope, r.author, r.requiredApprovals, r.codeownersRequired, r.regressionPassed, r.status]
    );
  }

  async get(id: string): Promise<ProposalRecord | undefined> {
    const { rows } = await this.db.query<ProposalRow>(`select * from proposals where id = $1`, [id]);
    return rows[0] ? toRecord(rows[0]) : undefined;
  }

  async list(): Promise<readonly ProposalRecord[]> {
    const { rows } = await this.db.query<ProposalRow>(`select * from proposals order by created_at desc`);
    return rows.map(toRecord);
  }
}

export class PgApprovalStore implements ApprovalStore {
  constructor(private readonly db: Queryable) {}

  async add(r: ApprovalRecord): Promise<void> {
    await this.db.query(
      `insert into approvals (proposal_id, approver, decision, is_codeowner, created_at)
       values ($1,$2,$3,$4,$5)`,
      [r.proposalId, r.approver, r.decision, r.isCodeowner, r.createdAt]
    );
  }

  async forProposal(proposalId: string): Promise<readonly ApprovalRecord[]> {
    const { rows } = await this.db.query<{
      proposal_id: string;
      approver: string;
      decision: string;
      is_codeowner: boolean;
      created_at: Date | string;
    }>(`select * from approvals where proposal_id = $1 order by created_at asc`, [proposalId]);
    return rows.map((a) => ({
      proposalId: a.proposal_id,
      approver: a.approver,
      decision: a.decision as ApprovalRecord["decision"],
      isCodeowner: a.is_codeowner,
      createdAt: new Date(a.created_at).toISOString(),
    }));
  }
}

export class PgAuditLog implements AuditLog {
  constructor(private readonly db: Queryable) {}

  async append(event: AuditEvent): Promise<AuditRecord> {
    const { rows } = await this.db.query<{ id: string; created_at: Date | string }>(
      `insert into audit_log (actor, action, target, detail)
       values ($1,$2,$3,$4) returning id, created_at`,
      [event.actor, event.action, event.target ?? null, event.detail ? JSON.stringify(event.detail) : null]
    );
    const row = rows[0]!;
    return { ...event, id: Number(row.id), createdAt: new Date(row.created_at).toISOString() };
  }

  async list(filter?: { actor?: string; action?: string }): Promise<readonly AuditRecord[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter?.actor) {
      params.push(filter.actor);
      where.push(`actor = $${params.length}`);
    }
    if (filter?.action) {
      params.push(filter.action);
      where.push(`action = $${params.length}`);
    }
    const clause = where.length ? `where ${where.join(" and ")}` : "";
    const { rows } = await this.db.query<{
      id: string;
      actor: string;
      action: string;
      target: string | null;
      detail: unknown;
      created_at: Date | string;
    }>(`select * from audit_log ${clause} order by id asc`, params);
    return rows.map((r) => ({
      id: Number(r.id),
      actor: r.actor,
      action: r.action,
      target: r.target ?? undefined,
      detail: (r.detail as Record<string, unknown>) ?? undefined,
      createdAt: new Date(r.created_at).toISOString(),
    }));
  }
}

/** 콘솔용 풍부한 제안을 통째로 upsert (CLI가 신규 제안을 적재할 때). */
export async function upsertProposalDetail(db: Queryable, d: ProposalDetail): Promise<void> {
  await db.query(
    `insert into proposals
       (id, signature, scope, author, required_approvals, codeowners_required, regression_passed, status,
        summary, diff, proof_status, proof_evidence, affected_files, failure_class)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     on conflict (id) do update set
       status = excluded.status, summary = excluded.summary, diff = excluded.diff,
       proof_status = excluded.proof_status, proof_evidence = excluded.proof_evidence,
       affected_files = excluded.affected_files, regression_passed = excluded.regression_passed`,
    [
      d.id, d.signature, d.scope, d.author, d.requiredApprovals, d.codeownersRequired, d.regressionPassed, d.status,
      d.summary, d.diff, d.proofStatus, d.proofEvidence, JSON.stringify(d.affectedFiles), d.failureClass,
    ]
  );
}

export async function listProposalDetails(db: Queryable): Promise<ProposalDetail[]> {
  const { rows } = await db.query<ProposalRow>(`select * from proposals order by created_at desc`);
  return rows.map(toDetail);
}

export async function getProposalDetail(db: Queryable, id: string): Promise<ProposalDetail | undefined> {
  const { rows } = await db.query<ProposalRow>(`select * from proposals where id = $1`, [id]);
  return rows[0] ? toDetail(rows[0]) : undefined;
}
