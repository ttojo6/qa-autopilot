/**
 * Authoring 초안 검증기 (#2) — 생성된 테스트를 격리 worktree에 적용하고 실제 러너로 실행해
 * runs_passes / runs_fails / errors 를 판정한다 (remediation GitWorktreeVerifier 패턴 재사용).
 *
 * git/러너 동작은 주입 가능 → fake로 테스트 가능. 기본 runDraft는 어댑터로 실행한다.
 */

import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AdapterContext, RunnerAdapter, QaConfig } from "@qa/shared";
import { CliGitOps, type GitOps } from "@qa/remediation";
import {
  CallbackDraftVerifier,
  classifyDraftRun,
  type DraftVerifier,
  type DraftRunResult,
  type TestCaseDraft,
} from "@qa/authoring";

export interface DraftVerifierDeps {
  readonly repoRoot: string;
  readonly gitOps?: GitOps;
  /** worktree에서 초안을 실행해 raw 결과를 만든다. */
  readonly runDraft: (worktreeDir: string, draft: TestCaseDraft) => Promise<DraftRunResult>;
  readonly baseRef?: string;
}

/** 초안을 worktree에 적용→실행→분류하는 DraftVerifier를 만든다. */
export function makeDraftVerifier(deps: DraftVerifierDeps): DraftVerifier {
  const gitOps = deps.gitOps ?? new CliGitOps(deps.repoRoot);
  return new CallbackDraftVerifier(async (draft) => {
    if (!draft.diff.trim()) return classifyDraftRun({ ran: false, passed: false, collectError: "empty diff" });
    const dir = join(tmpdir(), `qa-author-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    try {
      await gitOps.addWorktree(dir, deps.baseRef ?? "HEAD");
      const applied = await gitOps.applyDiff(dir, draft.diff);
      if (!applied.ok) {
        return classifyDraftRun({ ran: false, passed: false, collectError: `diff did not apply: ${applied.error ?? "unknown"}` });
      }
      return classifyDraftRun(await deps.runDraft(dir, draft));
    } catch (e) {
      return classifyDraftRun({ ran: false, passed: false, collectError: e instanceof Error ? e.message : String(e) });
    } finally {
      await gitOps.removeWorktree(dir).catch(() => undefined);
    }
  });
}

/** 어댑터로 초안을 실행하는 기본 runDraft. 새 파일의 결과를 골라 ran/passed를 판정한다. */
export function adapterRunDraft(
  config: QaConfig,
  adapters: Record<string, RunnerAdapter>
): (worktreeDir: string, draft: TestCaseDraft) => Promise<DraftRunResult> {
  return async (worktreeDir, draft) => {
    const runner = config.runners.find((r) => r.adapter === draft.targetRunner);
    if (!runner) return { ran: false, passed: false, collectError: `no runner for ${draft.targetRunner}` };
    const adapter = adapters[runner.adapter];
    if (!adapter) return { ran: false, passed: false, collectError: `adapter ${runner.adapter} not registered` };

    const ctx: AdapterContext = {
      projectRoot: worktreeDir,
      artifactDir: join(worktreeDir, ".qa-art"),
      logger: () => undefined,
    };
    const report = await adapter.run(runner, ctx);
    // 새 파일에서 나온 결과만 추린다 (caseId/위치에 filePath 포함).
    const fileTag = draft.filePath.replace(/^.*[\\/]/, ""); // basename으로도 매칭
    const matched = report.results.filter(
      (r) =>
        r.caseId.includes(draft.filePath) ||
        r.caseId.includes(fileTag) ||
        (r.error?.location?.file ?? "").includes(fileTag)
    );
    if (matched.length === 0) {
      return { ran: false, passed: false, collectError: "draft test not collected (import/syntax?)" };
    }
    return { ran: true, passed: matched.every((r) => r.status === "passed") };
  };
}
