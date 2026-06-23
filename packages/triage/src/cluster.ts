/**
 * 클러스터링 — 동일 서명의 실패를 하나로 묶는다 (원칙 B: 중복 분석/노이즈 단위화).
 *
 * 같은 원인을 N번 분류하지 않게 클러스터당 한 번만 Triage에 보낸다. 비용·일관성 둘 다 이득.
 */

import type { TestResult, ClusterRef } from "@qa/shared";
import { signatureOf } from "./signature.js";

/** 실패한 TestResult들을 서명 기준으로 클러스터링한다. */
export function clusterFailures(results: readonly TestResult[]): ClusterRef[] {
  const buckets = new Map<string, { caseIds: string[]; message: string; count: number }>();

  for (const r of results) {
    if (r.status === "passed" || r.status === "skipped") continue;
    const sig = signatureOf(r);
    const existing = buckets.get(sig);
    if (existing) {
      existing.caseIds.push(r.caseId);
      existing.count += 1;
    } else {
      buckets.set(sig, {
        caseIds: [r.caseId],
        message: r.error?.message ?? r.title,
        count: 1,
      });
    }
  }

  return [...buckets.entries()].map(([signature, b]) => ({
    signature,
    caseIds: b.caseIds,
    representativeMessage: b.message,
    occurrences: b.count,
  }));
}
