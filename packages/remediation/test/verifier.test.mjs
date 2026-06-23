import { test } from "node:test";
import assert from "node:assert/strict";
import { GitWorktreeVerifier } from "../dist/index.js";

const draft = (diff) => ({ diff, summary: "s", rationale: "r", affectedFiles: ["a.ts"], source: "fake" });
const req = { signature: "sig", failureClass: "TEST_BUG", scope: "test_only", clusterMessage: "m", caseIds: ["c1", "c2"] };

const fakeGit = (applyOk = true) => {
  const calls = [];
  return {
    calls,
    addWorktree: async (dir, ref) => { calls.push(["add", dir, ref]); },
    applyDiff: async (dir) => { calls.push(["apply", dir]); return { ok: applyOk, error: applyOk ? undefined : "conflict" }; },
    removeWorktree: async (dir) => { calls.push(["remove", dir]); },
  };
};

const pass = (caseId) => ({ caseId, title: caseId, runnerId: "r", status: "passed", durationMs: 1, attempts: 1, artifacts: [] });
const fail = (caseId) => ({ caseId, title: caseId, runnerId: "r", status: "failed", durationMs: 1, attempts: 1, artifacts: [] });

test("empty diff is not_run", async () => {
  const v = new GitWorktreeVerifier({ repoRoot: ".", gitOps: fakeGit(), runCases: async () => [] });
  const proof = await v.verify(draft("   "), req);
  assert.equal(proof.status, "not_run");
});

test("passing reruns produce passed proof and clean up worktree", async () => {
  const git = fakeGit(true);
  const v = new GitWorktreeVerifier({
    repoRoot: ".",
    gitOps: git,
    runCases: async (_dir, ids) => ids.map(pass),
  });
  const proof = await v.verify(draft("--- a\n+++ b\n"), req);
  assert.equal(proof.status, "passed");
  assert.ok(proof.verifiedAt);
  assert.ok(git.calls.some((c) => c[0] === "remove"), "worktree must be removed");
});

test("still-failing reruns produce failed proof", async () => {
  const v = new GitWorktreeVerifier({
    repoRoot: ".",
    gitOps: fakeGit(true),
    runCases: async (_dir, ids) => ids.map((id) => (id === "c1" ? pass(id) : fail(id))),
  });
  const proof = await v.verify(draft("--- a\n+++ b\n"), req);
  assert.equal(proof.status, "failed");
  assert.ok(proof.evidence.includes("c2"));
});

test("diff that does not apply is failed", async () => {
  const v = new GitWorktreeVerifier({ repoRoot: ".", gitOps: fakeGit(false), runCases: async () => [] });
  const proof = await v.verify(draft("--- a\n+++ b\n"), req);
  assert.equal(proof.status, "failed");
  assert.ok(proof.evidence.includes("did not apply"));
});
