import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isRemediationSubject,
  revertedShaOf,
  detectRemediationRollbacks,
  parseGitLog,
} from "../dist/index.js";

const FIELD = String.fromCharCode(0x1f);
const RECORD = String.fromCharCode(0x1e);

test("isRemediationSubject matches fix(scope): convention only", () => {
  assert.equal(isRemediationSubject("fix(test_only): update selector"), true);
  assert.equal(isRemediationSubject("fix(app_source): guard null"), true);
  assert.equal(isRemediationSubject("feat: add thing"), false);
  assert.equal(isRemediationSubject("fix: generic"), false);
});

test("revertedShaOf parses the git revert marker", () => {
  assert.equal(
    revertedShaOf({ sha: "z", subject: "Revert ...", body: "This reverts commit abc1234def." }),
    "abc1234def"
  );
  assert.equal(revertedShaOf({ sha: "z", subject: "x", body: "no marker" }), undefined);
});

test("detectRemediationRollbacks links reverts to remediation commits only", () => {
  const commits = [
    { sha: "rev1", subject: "Revert fix", body: "This reverts commit aaa1111." },
    { sha: "rev2", subject: "Revert feat", body: "This reverts commit bbb2222." },
    { sha: "aaa1111", subject: "fix(app_source): guard null", body: "" },
    { sha: "bbb2222", subject: "feat: unrelated", body: "" },
  ];
  const out = detectRemediationRollbacks(commits);
  assert.equal(out.length, 1);
  assert.equal(out[0].revertSha, "rev1");
  assert.equal(out[0].revertedSha, "aaa1111");
});

test("detectRemediationRollbacks handles abbreviated reverted sha", () => {
  const commits = [
    { sha: "rev1", subject: "Revert", body: "This reverts commit aaa1111." },
    { sha: "aaa1111999900", subject: "fix(test_only): x", body: "" },
  ];
  assert.equal(detectRemediationRollbacks(commits).length, 1);
});

test("parseGitLog splits records and fields", () => {
  const stdout =
    `sha1${FIELD}fix(test_only): a${FIELD}body line${RECORD}` +
    `sha2${FIELD}feat: b${FIELD}${RECORD}`;
  const commits = parseGitLog(stdout);
  assert.equal(commits.length, 2);
  assert.equal(commits[0].sha, "sha1");
  assert.equal(commits[0].subject, "fix(test_only): a");
  assert.equal(commits[1].subject, "feat: b");
});
