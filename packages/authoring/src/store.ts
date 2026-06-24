/**
 * AuthoringStore — 테스트 제안 리뷰 큐의 영속 포트 (File/Pg/InMemory).
 * CLI(적재)와 콘솔(승인/거절)이 공유한다. AI는 초안만, 승인은 사람.
 */

import type { AuthoringProposal, ReviewStatus, VerifyOutcome } from "./types.js";
import { draftSignature } from "./dedup.js";

export type Decision = "pending" | "approved" | "rejected";

/** 콘솔 표시 + 리뷰 결정을 담은 영속 레코드. */
export interface StoredTestProposal {
  readonly id: string;
  readonly specId: string;
  readonly title: string;
  readonly targetRunner: string;
  readonly filePath: string;
  readonly diff: string;
  readonly code: string;
  readonly rationale: string;
  readonly verifyOutcome: VerifyOutcome;
  readonly verifyEvidence: string;
  readonly status: ReviewStatus;
  readonly decision: Decision;
  readonly createdAt: string;
}

/** 서명 → 안정적 id (재실행 시 같은 초안은 같은 id로 upsert). */
export function proposalId(targetRunner: string, title: string): string {
  const sig = draftSignature({ title, targetRunner });
  let h = 0;
  for (let i = 0; i < sig.length; i++) h = (Math.imul(31, h) + sig.charCodeAt(i)) | 0;
  return `tp-${(h >>> 0).toString(36)}`;
}

/** AuthoringProposal → 영속 레코드. */
export function toStored(p: AuthoringProposal, targetRunner: string): StoredTestProposal {
  return {
    id: proposalId(targetRunner, p.draft.title),
    specId: p.draft.specId,
    title: p.draft.title,
    targetRunner,
    filePath: p.draft.filePath,
    diff: p.draft.diff,
    code: p.draft.code,
    rationale: p.draft.rationale,
    verifyOutcome: p.verification.outcome,
    verifyEvidence: p.verification.evidence,
    status: p.status,
    decision: "pending",
    createdAt: new Date().toISOString(),
  };
}

export interface AuthoringStore {
  upsert(p: StoredTestProposal): Promise<void>;
  list(): Promise<StoredTestProposal[]>;
  get(id: string): Promise<StoredTestProposal | undefined>;
  setDecision(id: string, decision: Decision): Promise<void>;
}

export class InMemoryAuthoringStore implements AuthoringStore {
  private readonly map = new Map<string, StoredTestProposal>();
  async upsert(p: StoredTestProposal): Promise<void> {
    const prev = this.map.get(p.id);
    // 재적재 시 사람 결정(decision)은 보존.
    this.map.set(p.id, prev ? { ...p, decision: prev.decision } : p);
  }
  async list(): Promise<StoredTestProposal[]> {
    return [...this.map.values()];
  }
  async get(id: string): Promise<StoredTestProposal | undefined> {
    return this.map.get(id);
  }
  async setDecision(id: string, decision: Decision): Promise<void> {
    const p = this.map.get(id);
    if (p) this.map.set(id, { ...p, decision });
  }
}

export class FileAuthoringStore implements AuthoringStore {
  constructor(private readonly path: string) {}
  private async read(): Promise<StoredTestProposal[]> {
    const { readFile } = await import("node:fs/promises");
    try {
      return JSON.parse(await readFile(this.path, "utf8")) as StoredTestProposal[];
    } catch {
      return [];
    }
  }
  private async write(items: StoredTestProposal[]): Promise<void> {
    const { writeFile, mkdir } = await import("node:fs/promises");
    const { dirname } = await import("node:path");
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify(items, null, 2), "utf8");
  }
  async upsert(p: StoredTestProposal): Promise<void> {
    const items = await this.read();
    const i = items.findIndex((x) => x.id === p.id);
    if (i >= 0) items[i] = { ...p, decision: items[i]!.decision }; // 결정 보존
    else items.push(p);
    await this.write(items);
  }
  async list(): Promise<StoredTestProposal[]> {
    return this.read();
  }
  async get(id: string): Promise<StoredTestProposal | undefined> {
    return (await this.read()).find((x) => x.id === id);
  }
  async setDecision(id: string, decision: Decision): Promise<void> {
    const items = await this.read();
    const i = items.findIndex((x) => x.id === id);
    if (i >= 0) {
      items[i] = { ...items[i]!, decision };
      await this.write(items);
    }
  }
}

interface Queryable {
  query<R = Record<string, unknown>>(text: string, params?: readonly unknown[]): Promise<{ rows: R[] }>;
}

interface Row {
  id: string;
  spec_id: string;
  title: string;
  target_runner: string;
  file_path: string;
  diff: string;
  code: string;
  rationale: string | null;
  verify_outcome: string;
  verify_evidence: string | null;
  status: string;
  decision: string;
  created_at: Date | string;
}

function fromRow(r: Row): StoredTestProposal {
  return {
    id: r.id,
    specId: r.spec_id,
    title: r.title,
    targetRunner: r.target_runner,
    filePath: r.file_path,
    diff: r.diff,
    code: r.code,
    rationale: r.rationale ?? "",
    verifyOutcome: r.verify_outcome as VerifyOutcome,
    verifyEvidence: r.verify_evidence ?? "",
    status: r.status as ReviewStatus,
    decision: r.decision as Decision,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

export class PgAuthoringStore implements AuthoringStore {
  constructor(private readonly db: Queryable) {}
  async upsert(p: StoredTestProposal): Promise<void> {
    // 재적재 시 decision은 보존(insert 시 pending, conflict 시 미갱신).
    await this.db.query(
      `insert into test_proposals
         (id, spec_id, title, target_runner, file_path, diff, code, rationale, verify_outcome, verify_evidence, status)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       on conflict (id) do update set
         verify_outcome = excluded.verify_outcome, verify_evidence = excluded.verify_evidence, status = excluded.status`,
      [p.id, p.specId, p.title, p.targetRunner, p.filePath, p.diff, p.code, p.rationale, p.verifyOutcome, p.verifyEvidence, p.status]
    );
  }
  async list(): Promise<StoredTestProposal[]> {
    const { rows } = await this.db.query<Row>(`select * from test_proposals order by created_at desc`);
    return rows.map(fromRow);
  }
  async get(id: string): Promise<StoredTestProposal | undefined> {
    const { rows } = await this.db.query<Row>(`select * from test_proposals where id = $1`, [id]);
    return rows[0] ? fromRow(rows[0]) : undefined;
  }
  async setDecision(id: string, decision: Decision): Promise<void> {
    await this.db.query(`update test_proposals set decision = $2 where id = $1`, [id, decision]);
  }
}
