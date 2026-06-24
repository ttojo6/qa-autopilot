import { test } from "node:test";
import assert from "node:assert/strict";
import { makeDraftVerifier, adapterRunDraft } from "../dist/draft-verifier.js";

const draft = (over = {}) => ({
  specId: "s1", targetRunner: "pytest", title: "T", filePath: "tests/t_new.py",
  code: "def test_x(): assert True", diff: "--- a\n+++ b\n", rationale: "r", source: "fake", ...over,
});

const fakeGit = (applyOk = true) => {
  const calls = [];
  return {
    calls,
    addWorktree: async (d) => calls.push(["add", d]),
    applyDiff: async () => ({ ok: applyOk, error: applyOk ? undefined : "conflict" }),
    removeWorktree: async (d) => calls.push(["remove", d]),
  };
};

test("verifier: runDraft passed → runs_passes, cleans worktree", async () => {
  const git = fakeGit(true);
  const v = makeDraftVerifier({ repoRoot: ".", gitOps: git, runDraft: async () => ({ ran: true, passed: true }) });
  const res = await v.verify(draft());
  assert.equal(res.outcome, "runs_passes");
  assert.ok(git.calls.some((c) => c[0] === "remove"));
});

test("verifier: runDraft failed → runs_fails", async () => {
  const v = makeDraftVerifier({ repoRoot: ".", gitOps: fakeGit(true), runDraft: async () => ({ ran: true, passed: false }) });
  assert.equal((await v.verify(draft())).outcome, "runs_fails");
});

test("verifier: diff does not apply → errors", async () => {
  const v = makeDraftVerifier({ repoRoot: ".", gitOps: fakeGit(false), runDraft: async () => ({ ran: true, passed: true }) });
  assert.equal((await v.verify(draft())).outcome, "errors");
});

test("verifier: empty diff → errors (not collected)", async () => {
  const v = makeDraftVerifier({ repoRoot: ".", gitOps: fakeGit(true), runDraft: async () => ({ ran: true, passed: true }) });
  assert.equal((await v.verify(draft({ diff: "   " }))).outcome, "errors");
});

test("adapterRunDraft: new-file result drives ran/passed", async () => {
  const config = { runners: [{ id: "api", adapter: "pytest", workdir: ".", command: "x" }] };
  const fakeAdapter = {
    adapterId: "pytest",
    async run() {
      return {
        runnerId: "api", startedAt: "", finishedAt: "",
        results: [
          { caseId: "tests/t_new.py::test_x", title: "test_x", runnerId: "api", status: "passed", durationMs: 1, attempts: 1, artifacts: [] },
          { caseId: "tests/other.py::test_y", title: "test_y", runnerId: "api", status: "failed", durationMs: 1, attempts: 1, artifacts: [] },
        ],
      };
    },
  };
  const run = adapterRunDraft(config, { pytest: fakeAdapter });
  const r = await run("/wt", draft());
  assert.equal(r.ran, true);
  assert.equal(r.passed, true, "only the new file's result counts; other.py failure ignored");
});

test("adapterRunDraft: no matching result → collectError (not collected)", async () => {
  const config = { runners: [{ id: "api", adapter: "pytest", workdir: ".", command: "x" }] };
  const fakeAdapter = { adapterId: "pytest", async run() { return { runnerId: "api", startedAt: "", finishedAt: "", results: [] }; } };
  const r = await adapterRunDraft(config, { pytest: fakeAdapter })("/wt", draft());
  assert.equal(r.ran, false);
  assert.ok(r.collectError);
});
