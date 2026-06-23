/**
 * Audit Log — 모든 자동/수동 거버넌스 행위의 불변(append-only) 기록 (R7).
 *
 * 핵심: 이 포트에는 update/delete가 없다. 한 번 기록된 행위는 수정·삭제되지 않는다
 * — 사후 추적과 게이트 우회 감지의 기반.
 */

export interface AuditEvent {
  /** system | ai | <user-id>. 누가 한 행위인지. */
  readonly actor: string;
  /** 예: "proposal.created", "approval.recorded", "verdict.routed". */
  readonly action: string;
  /** 대상 식별자 (서명, proposalId 등). */
  readonly target?: string;
  readonly detail?: Readonly<Record<string, unknown>>;
}

export interface AuditRecord extends AuditEvent {
  readonly id: number;
  readonly createdAt: string; // ISO8601
}

/** append와 조회만. 변경/삭제 메서드는 의도적으로 없다. */
export interface AuditLog {
  append(event: AuditEvent): Promise<AuditRecord>;
  list(filter?: { actor?: string; action?: string }): Promise<readonly AuditRecord[]>;
}

export class InMemoryAuditLog implements AuditLog {
  private readonly records: AuditRecord[] = [];
  private seq = 0;
  constructor(private readonly now: () => number = Date.now) {}

  async append(event: AuditEvent): Promise<AuditRecord> {
    const record: AuditRecord = { ...event, id: ++this.seq, createdAt: new Date(this.now()).toISOString() };
    this.records.push(record);
    return record;
  }

  async list(filter?: { actor?: string; action?: string }): Promise<readonly AuditRecord[]> {
    return this.records.filter(
      (r) =>
        (!filter?.actor || r.actor === filter.actor) &&
        (!filter?.action || r.action === filter.action)
    );
  }
}
