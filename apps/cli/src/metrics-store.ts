/**
 * 메트릭 스토어 팩토리 — DATABASE_URL 있으면 Postgres(콘솔과 공유), 없으면 파일.
 * 콘솔의 사람 피드백과 CLI의 라우팅 누적이 같은 누계를 보게 한다(STOP 트리거 무인 작동).
 */

import { resolve, join } from "node:path";
import { FileMetricsStore, PgMetricsStore, type MetricsStore } from "@qa/metrics";
import { createPool } from "@qa/governance/pg";

export interface MetricsHandle {
  store: MetricsStore;
  close: () => Promise<void>;
}

export function makeMetricsStore(projectRoot: string): MetricsHandle {
  const url = process.env.DATABASE_URL;
  if (url) {
    const pool = createPool(url);
    return { store: new PgMetricsStore(pool), close: () => pool.end() };
  }
  const file = join(resolve(projectRoot, "artifacts"), "metrics.json");
  return { store: new FileMetricsStore(file), close: async () => undefined };
}
