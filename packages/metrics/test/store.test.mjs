import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryMetricsStore, PgMetricsStore } from "../dist/index.js";

test("InMemoryMetricsStore accumulates routing and feedback", async () => {
  const s = new InMemoryMetricsStore();
  await s.addRouting({ total: 10, signal: 4, human: 2, quarantine: 3, retry: 1 });
  await s.addRouting({ total: 5, signal: 1, human: 1, quarantine: 2, retry: 1 });
  await s.addFeedback({ humanOverrides: 2 });
  await s.addFeedback({ merged: 3, rolledBack: 1 });
  const snap = await s.load();
  assert.equal(snap.routing.total, 15);
  assert.equal(snap.routing.quarantine, 5);
  assert.equal(snap.feedback.humanOverrides, 2);
  assert.equal(snap.feedback.merged, 3);
  assert.equal(snap.feedback.rolledBack, 1);
});

function fakeDb(rows = []) {
  const calls = [];
  return {
    calls,
    query: async (text, params) => {
      calls.push({ text, params });
      return { rows };
    },
  };
}

test("PgMetricsStore.addFeedback issues incremental UPDATE", async () => {
  const db = fakeDb();
  await new PgMetricsStore(db).addFeedback({ humanOverrides: 1 });
  const { text, params } = db.calls[0];
  assert.match(text, /update metrics set human_overrides=human_overrides\+\$1/i);
  assert.deepEqual(params, [1, 0, 0]);
});

test("PgMetricsStore.load maps bigint strings to numbers", async () => {
  const db = fakeDb([{ total: "100", signal: "40", human: "5", quarantine: "50", retry: "5", human_overrides: "30", merged: "0", rolled_back: "0" }]);
  const snap = await new PgMetricsStore(db).load();
  assert.equal(snap.routing.total, 100);
  assert.equal(snap.feedback.humanOverrides, 30);
  assert.equal(typeof snap.routing.total, "number");
});
