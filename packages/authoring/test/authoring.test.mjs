import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeTitle,
  draftSignature,
  dedupDrafts,
  addFileDiff,
  AuthoringEngine,
} from "../dist/index.js";

const mkDraft = (title, over = {}) => ({
  specId: "s1", title, filePath: `tests/${title}.spec.ts`, code: "test('x', () => {})",
  diff: "", rationale: "r", source: "fake", ...over,
});

test("normalizeTitle collapses to lowercase alphanumerics", () => {
  assert.equal(normalizeTitle("Login: SHOWS error!!"), "login shows error");
});

test("draftSignature equal for semantically same titles", () => {
  const a = draftSignature({ title: "Login shows error", targetRunner: "playwright-ts" });
  const b = draftSignature({ title: "login SHOWS error", targetRunner: "playwright-ts" });
  assert.equal(a, b);
});

test("dedupDrafts removes batch + existing duplicates", () => {
  const drafts = [mkDraft("Login error"), mkDraft("login ERROR"), mkDraft("Logout works")];
  const existing = new Set([draftSignature({ title: "Logout works", targetRunner: "playwright-ts" })]);
  const { unique, duplicates } = dedupDrafts(drafts, "playwright-ts", existing);
  assert.deepEqual(unique.map((d) => d.title), ["Login error"]);
  assert.equal(duplicates.length, 2);
});

test("addFileDiff produces an add-file unified diff", () => {
  const d = addFileDiff("tests/a.spec.ts", "line1\nline2");
  assert.match(d, /\+\+\+ b\/tests\/a\.spec\.ts/);
  assert.match(d, /@@ -0,0 \+1,2 @@/);
  assert.match(d, /\+line1/);
});

const gen = (drafts) => ({ async generate() { return drafts; } });
const verifier = (outcome) => ({ async verify() { return { outcome, evidence: outcome }; } });

test("engine routes errors→rejected_error, ok→pending_review, dup→duplicate", async () => {
  const engine = new AuthoringEngine({
    generator: gen([mkDraft("Test A"), mkDraft("test a"), mkDraft("Test B")]), // A and 'test a' dup
    verifier: verifier("runs_passes"),
  });
  const props = await engine.author([{ id: "s1", description: "d", targetRunner: "playwright-ts" }]);
  const byTitle = Object.fromEntries(props.map((p) => [p.draft.title, p.status]));
  assert.equal(byTitle["Test A"], "pending_review");
  assert.equal(byTitle["test a"], "duplicate");
  assert.equal(byTitle["Test B"], "pending_review");
});

test("engine rejects drafts that do not even run (errors)", async () => {
  const engine = new AuthoringEngine({
    generator: gen([mkDraft("Broken test")]),
    verifier: verifier("errors"),
  });
  const props = await engine.author([{ id: "s1", description: "d", targetRunner: "pytest" }]);
  assert.equal(props[0].status, "rejected_error");
});

test("engine excludes against existing signatures (no regeneration)", async () => {
  const existing = new Set([draftSignature({ title: "Existing test", targetRunner: "pytest" })]);
  const engine = new AuthoringEngine({
    generator: gen([mkDraft("Existing test"), mkDraft("New test")]),
    verifier: verifier("runs_passes"),
    existingSignatures: () => existing,
  });
  const props = await engine.author([{ id: "s1", description: "d", targetRunner: "pytest" }]);
  const byTitle = Object.fromEntries(props.map((p) => [p.draft.title, p.status]));
  assert.equal(byTitle["Existing test"], "duplicate");
  assert.equal(byTitle["New test"], "pending_review");
});

test("engine never returns an 'added' status — all proposals await review", async () => {
  const engine = new AuthoringEngine({ generator: gen([mkDraft("X")]), verifier: verifier("runs_passes") });
  const props = await engine.author([{ id: "s1", description: "d", targetRunner: "pytest" }]);
  for (const p of props) {
    assert.ok(["pending_review", "duplicate", "rejected_error"].includes(p.status));
  }
});
