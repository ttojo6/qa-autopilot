/**
 * MetricsStore — 누계 영속의 포트. CLI(라우팅)와 콘솔(사람 피드백)이 같은 누계를 공유해야
 * STOP 트리거가 무인으로 작동한다.
 *
 * 구현 3종:
 *  - InMemoryMetricsStore: 테스트/폴백
 *  - FileMetricsStore: artifacts/metrics.json (단일 프로세스/로컬)
 *  - PgMetricsStore: 단일 행 metrics 테이블 (CLI·콘솔 공유)
 */

import {
  EMPTY_SNAPSHOT,
  type MetricsSnapshot,
  type RoutingCounts,
  type FeedbackCounts,
} from "./metrics.js";

export interface MetricsStore {
  load(): Promise<MetricsSnapshot>;
  /** 이번 사이클의 라우팅 카운트를 누계에 더한다. */
  addRouting(counts: RoutingCounts): Promise<void>;
  /** 사람 피드백 델타를 누계에 더한다. */
  addFeedback(delta: Partial<FeedbackCounts>): Promise<void>;
}

export class InMemoryMetricsStore implements MetricsStore {
  private snap: MetricsSnapshot;
  constructor(initial: MetricsSnapshot = EMPTY_SNAPSHOT) {
    this.snap = initial;
  }
  async load(): Promise<MetricsSnapshot> {
    return this.snap;
  }
  async addRouting(c: RoutingCounts): Promise<void> {
    const r = this.snap.routing;
    this.snap = {
      ...this.snap,
      routing: {
        total: r.total + c.total,
        signal: r.signal + c.signal,
        human: r.human + c.human,
        quarantine: r.quarantine + c.quarantine,
        retry: r.retry + c.retry,
      },
    };
  }
  async addFeedback(d: Partial<FeedbackCounts>): Promise<void> {
    const f = this.snap.feedback;
    this.snap = {
      ...this.snap,
      feedback: {
        humanOverrides: f.humanOverrides + (d.humanOverrides ?? 0),
        merged: f.merged + (d.merged ?? 0),
        rolledBack: f.rolledBack + (d.rolledBack ?? 0),
      },
    };
  }
}

/** 파일 기반 — read-modify-write (단일 프로세스 가정). */
export class FileMetricsStore implements MetricsStore {
  constructor(private readonly path: string) {}

  async load(): Promise<MetricsSnapshot> {
    const { readFile } = await import("node:fs/promises");
    try {
      const parsed = JSON.parse(await readFile(this.path, "utf8")) as MetricsSnapshot;
      return {
        routing: { ...EMPTY_SNAPSHOT.routing, ...parsed.routing },
        feedback: { ...EMPTY_SNAPSHOT.feedback, ...parsed.feedback },
      };
    } catch {
      return EMPTY_SNAPSHOT;
    }
  }

  private async write(snap: MetricsSnapshot): Promise<void> {
    const { writeFile, mkdir } = await import("node:fs/promises");
    const { dirname } = await import("node:path");
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify(snap, null, 2), "utf8");
  }

  async addRouting(c: RoutingCounts): Promise<void> {
    const s = await this.load();
    const r = s.routing;
    await this.write({
      ...s,
      routing: {
        total: r.total + c.total,
        signal: r.signal + c.signal,
        human: r.human + c.human,
        quarantine: r.quarantine + c.quarantine,
        retry: r.retry + c.retry,
      },
    });
  }

  async addFeedback(d: Partial<FeedbackCounts>): Promise<void> {
    const s = await this.load();
    const f = s.feedback;
    await this.write({
      ...s,
      feedback: {
        humanOverrides: f.humanOverrides + (d.humanOverrides ?? 0),
        merged: f.merged + (d.merged ?? 0),
        rolledBack: f.rolledBack + (d.rolledBack ?? 0),
      },
    });
  }
}

/** Queryable 최소 형태 (governance pg.Pool과 구조적으로 호환 — 패키지 의존 없이). */
interface Queryable {
  query<R = Record<string, unknown>>(text: string, params?: readonly unknown[]): Promise<{ rows: R[] }>;
}

interface MetricsRow {
  total: string | number;
  signal: string | number;
  human: string | number;
  quarantine: string | number;
  retry: string | number;
  human_overrides: string | number;
  merged: string | number;
  rolled_back: string | number;
}

/** Postgres 단일 행(metrics) 기반. 원자적 UPDATE 증분으로 동시 갱신 안전. */
export class PgMetricsStore implements MetricsStore {
  constructor(private readonly db: Queryable) {}

  async load(): Promise<MetricsSnapshot> {
    const { rows } = await this.db.query<MetricsRow>(`select * from metrics where id = 1`);
    const r = rows[0];
    if (!r) return EMPTY_SNAPSHOT;
    const n = (v: string | number) => Number(v);
    return {
      routing: { total: n(r.total), signal: n(r.signal), human: n(r.human), quarantine: n(r.quarantine), retry: n(r.retry) },
      feedback: { humanOverrides: n(r.human_overrides), merged: n(r.merged), rolledBack: n(r.rolled_back) },
    };
  }

  async addRouting(c: RoutingCounts): Promise<void> {
    await this.db.query(
      `update metrics set total=total+$1, signal=signal+$2, human=human+$3, quarantine=quarantine+$4, retry=retry+$5 where id=1`,
      [c.total, c.signal, c.human, c.quarantine, c.retry]
    );
  }

  async addFeedback(d: Partial<FeedbackCounts>): Promise<void> {
    await this.db.query(
      `update metrics set human_overrides=human_overrides+$1, merged=merged+$2, rolled_back=rolled_back+$3 where id=1`,
      [d.humanOverrides ?? 0, d.merged ?? 0, d.rolledBack ?? 0]
    );
  }
}
