/**
 * GitWorktreeVerifier — 제안 diff를 격리된 git worktree에 적용해 영향 케이스를 재실행하고
 * 회귀 증빙을 만든다 (R2: "검증 없는 수정은 게이트 통과 불가"를 실제 실행으로 뒷받침).
 *
 * 격리 이유: 작업 트리를 오염시키지 않고, 제안이 틀렸을 때도 안전하게 폐기한다.
 * git 기계 동작은 GitOps 포트 뒤에 두어 키/실제 git 없이도 테스트 가능.
 */

import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestResult } from "@qa/shared";
import { runCommand } from "@qa/shared";
import type { FixVerifier, ProposalDraft, ProposalRequest, RegressionProof } from "./types.js";

export interface GitOps {
  /** ref 시점의 worktree를 dir에 만든다. */
  addWorktree(dir: string, ref: string): Promise<void>;
  /** dir 안에 diff를 적용한다. 적용 실패 시 ok=false. */
  applyDiff(dir: string, diff: string): Promise<{ ok: boolean; error?: string }>;
  /** worktree를 제거한다 (정리). */
  removeWorktree(dir: string): Promise<void>;
}

/** git CLI 기반 기본 구현. */
export class CliGitOps implements GitOps {
  constructor(private readonly repoRoot: string) {}

  async addWorktree(dir: string, ref: string): Promise<void> {
    await runCommand(`git worktree add --detach "${dir}" ${ref}`, this.repoRoot, 60_000);
  }
  async applyDiff(dir: string, diff: string): Promise<{ ok: boolean; error?: string }> {
    // diff를 stdin으로 넘기기 위해 임시 파일 경유 (셸 따옴표 이슈 회피).
    const { writeFile, rm } = await import("node:fs/promises");
    const patch = join(dir, ".qa-autopilot.patch");
    await writeFile(patch, diff, "utf8");
    const res = await runCommand(`git apply "${patch}"`, dir, 60_000);
    await rm(patch, { force: true });
    return res.code === 0 ? { ok: true } : { ok: false, error: res.stderr.slice(0, 500) };
  }
  async removeWorktree(dir: string): Promise<void> {
    await runCommand(`git worktree remove --force "${dir}"`, this.repoRoot, 60_000);
  }
}

export interface GitWorktreeVerifierDeps {
  readonly repoRoot: string;
  readonly gitOps?: GitOps;
  /** worktree 디렉터리에서 주어진 케이스들을 재실행한다 (어댑터 배선은 호출자가 제공). */
  readonly runCases: (worktreeDir: string, caseIds: readonly string[]) => Promise<TestResult[]>;
  /** worktree를 만들 기준 ref. 기본 HEAD. */
  readonly baseRef?: string;
}

export class GitWorktreeVerifier implements FixVerifier {
  private readonly gitOps: GitOps;
  constructor(private readonly deps: GitWorktreeVerifierDeps) {
    this.gitOps = deps.gitOps ?? new CliGitOps(deps.repoRoot);
  }

  async verify(draft: ProposalDraft, req: ProposalRequest): Promise<RegressionProof> {
    if (!draft.diff.trim()) {
      return { status: "not_run", evidence: "empty diff — nothing to verify" };
    }
    const dir = join(tmpdir(), `qa-wt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    try {
      await this.gitOps.addWorktree(dir, this.deps.baseRef ?? "HEAD");
      const applied = await this.gitOps.applyDiff(dir, draft.diff);
      if (!applied.ok) {
        return { status: "failed", evidence: `diff did not apply: ${applied.error ?? "unknown"}` };
      }
      const results = await this.deps.runCases(dir, req.caseIds);
      return summarizeProof(results, req.caseIds);
    } catch (e) {
      return { status: "not_run", evidence: `verifier error: ${e instanceof Error ? e.message : e}` };
    } finally {
      await this.gitOps.removeWorktree(dir).catch(() => undefined);
    }
  }
}

function summarizeProof(results: readonly TestResult[], caseIds: readonly string[]): RegressionProof {
  const byId = new Map(results.map((r) => [r.caseId, r]));
  const ran = caseIds.filter((id) => byId.has(id));
  if (ran.length === 0) {
    return { status: "not_run", evidence: "no affected cases were re-run" };
  }
  const failed = ran.filter((id) => byId.get(id)?.status !== "passed");
  const verifiedAt = new Date().toISOString();
  if (failed.length === 0) {
    return { status: "passed", evidence: `re-ran ${ran.length} affected case(s), all passed`, verifiedAt };
  }
  return {
    status: "failed",
    evidence: `re-ran ${ran.length} case(s); ${failed.length} still failing: ${failed.join(", ")}`,
    verifiedAt,
  };
}
