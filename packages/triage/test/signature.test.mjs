import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeMessage, signatureOf, clusterFailures } from "../dist/index.js";

test("normalizeMessage strips volatile tokens", () => {
  const a = normalizeMessage("Timeout 30342ms at /home/run/abc.spec.ts:128:9 (id 0xDEADBEEF)");
  const b = normalizeMessage("Timeout 12ms at /var/lib/xyz.spec.ts:40:2 (id 0xCAFE)");
  assert.equal(a, b, "same root cause should normalize to identical strings");
});

test("signatureOf is stable across line-number changes", () => {
  const mk = (line) => ({
    caseId: "c1", title: "t", runnerId: "r", status: "failed", durationMs: 1, attempts: 1,
    error: { type: "assertion", message: "expected 5 received 6", location: { file: "a.ts", line } },
    artifacts: [],
  });
  assert.equal(signatureOf(mk(10)), signatureOf(mk(99)));
});

test("clusterFailures groups same-signature failures and ignores passes", () => {
  const base = (caseId, msg, status) => ({
    caseId, title: caseId, runnerId: "r", status, durationMs: 1, attempts: 1,
    error: status === "failed" ? { type: "timeout", message: msg } : undefined,
    artifacts: [],
  });
  const clusters = clusterFailures([
    base("a", "Timeout 100ms", "failed"),
    base("b", "Timeout 999ms", "failed"),
    base("c", "ok", "passed"),
  ]);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].occurrences, 2);
  assert.deepEqual([...clusters[0].caseIds].sort(), ["a", "b"]);
});
