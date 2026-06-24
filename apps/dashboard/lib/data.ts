/**
 * 콘솔 데이터 계층 (서버 전용). DATABASE_URL 유무로 백엔드를 분기한다:
 *   - 있으면: Postgres (@qa/governance/pg) — CLI와 같은 DB 공유.
 *   - 없으면: 인메모리(시드 또는 QA_PROPOSALS_FILE 핸드오프).
 * 페이지/액션은 이 모듈만 의존하므로 백엔드 교체가 화면 코드에 새지 않는다.
 */

import { evaluateApprovals, recordApproval, type ApprovalRecord } from "@qa/governance";
import {
  FileMetricsStore,
  PgMetricsStore,
  InMemoryMetricsStore,
  evaluateTriggers,
  deriveControls,
  summarizeMetrics,
  DEFAULT_STOP_POLICY,
  type MetricsStore,
  type MetricsView,
  type Trigger,
  type SafetyControls,
} from "@qa/metrics";
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

/**
 * 승인을 기록한다. 제안이 approved로 전이되면(정족수 충족) merged 피드백을 1회 자동 기록한다
 * — 사람이 별도 명령 없이 승인하면 곧 병합되므로 R2 분모(merged)가 자동 누적된다.
 */
export async function submitDecision(approval: ApprovalRecord): Promise<void> {
  const before = (await getView(approval.proposalId))?.status;
  if (usePg) {
    const pg = await getPg();
    await recordApproval(approval, {
      proposals: pg.proposals as never,
      approvals: pg.approvals as never,
      audit: pg.audit as never,
    });
  } else {
    await recordApproval(approval, memStores);
  }
  const after = (await getView(approval.proposalId))?.status;
  if (before !== "approved" && after === "approved") {
    await getMetricsStore().addFeedback({ merged: 1 });
  }
}

// ── 메타 지표 / STOP 트리거 (자동 피드백 루프) ──────────────────────────────

function getMetricsStore(): MetricsStore {
  const g = globalThis as unknown as { __qaMetrics?: MetricsStore };
  if (g.__qaMetrics) return g.__qaMetrics;
  if (usePg) {
    // pg 번들의 풀을 재사용하려면 비동기 getPg가 필요하므로, 여기서는 즉시 생성한 풀을 쓴다.
    // (단발성 UPDATE 1건이라 풀 1개로 충분.)
    g.__qaMetrics = new LazyPgMetricsStore();
  } else if (process.env.QA_METRICS_FILE) {
    g.__qaMetrics = new FileMetricsStore(process.env.QA_METRICS_FILE);
  } else {
    g.__qaMetrics = new InMemoryMetricsStore();
  }
  return g.__qaMetrics;
}

/** pg 번들(풀)을 지연 사용하는 래퍼 — getPg()의 풀을 공유. */
class LazyPgMetricsStore implements MetricsStore {
  private async inner(): Promise<PgMetricsStore> {
    const pg = await getPg();
    return new PgMetricsStore(pg.pool as never);
  }
  async load() {
    return (await this.inner()).load();
  }
  async addRouting(c: Parameters<MetricsStore["addRouting"]>[0]) {
    return (await this.inner()).addRouting(c);
  }
  async addFeedback(d: Parameters<MetricsStore["addFeedback"]>[0]) {
    return (await this.inner()).addFeedback(d);
  }
}

export interface SafetyInfo {
  metrics: MetricsView;
  triggers: Trigger[];
  controls: SafetyControls;
  samples: number;
}

export async function getSafety(): Promise<SafetyInfo> {
  const snap = await getMetricsStore().load();
  const triggers = evaluateTriggers(snap, DEFAULT_STOP_POLICY);
  return {
    metrics: summarizeMetrics(snap),
    triggers,
    controls: deriveControls(triggers),
    samples: snap.routing.total,
  };
}

/** R1 — 사람이 AI 분류에 이의(override)를 기록. */
export async function recordOverride(): Promise<void> {
  await getMetricsStore().addFeedback({ humanOverrides: 1 });
}

/** R2 — 병합 후 롤백을 보고. */
export async function recordRollback(): Promise<void> {
  await getMetricsStore().addFeedback({ rolledBack: 1 });
}

export const backend: "postgres" | "memory" = usePg ? "postgres" : "memory";
