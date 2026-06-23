/**
 * 메타 지표 누계 영속 — artifacts/metrics.json.
 *
 * 과거 성과가 현재 자동화를 게이팅한다(STOP 트리거). 누계가 쌓여야 임계가 의미를 갖는다.
 * (운영에서는 DB로 옮길 수 있으나, 지표는 작고 단일 파일로 충분.)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { EMPTY_SNAPSHOT, type MetricsSnapshot } from "@qa/metrics";

function metricsFile(projectRoot: string): string {
  return join(resolve(projectRoot, "artifacts"), "metrics.json");
}

export function loadMetrics(projectRoot: string): MetricsSnapshot {
  const f = metricsFile(projectRoot);
  if (!existsSync(f)) return EMPTY_SNAPSHOT;
  try {
    const parsed = JSON.parse(readFileSync(f, "utf8")) as MetricsSnapshot;
    return {
      routing: { ...EMPTY_SNAPSHOT.routing, ...parsed.routing },
      feedback: { ...EMPTY_SNAPSHOT.feedback, ...parsed.feedback },
    };
  } catch {
    return EMPTY_SNAPSHOT;
  }
}

export function saveMetrics(projectRoot: string, snap: MetricsSnapshot): string {
  const dir = resolve(projectRoot, "artifacts");
  mkdirSync(dir, { recursive: true });
  const f = metricsFile(projectRoot);
  writeFileSync(f, JSON.stringify(snap, null, 2), "utf8");
  return f;
}
