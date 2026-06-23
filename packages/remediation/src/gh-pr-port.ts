/**
 * GhPrPort — GitHub PR 생성 (gh CLI). 의도적으로 merge 메서드가 없다 (R2/R7).
 *
 * AI는 브랜치에 제안을 올리고 PR을 여는 데까지만. 승인·병합은 사람이 GitHub에서 별도로 한다.
 * 모든 git/gh 명령은 CommandRunner 포트 뒤에 두어 테스트 가능.
 */

import { writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { runCommand } from "@qa/shared";
import type { PrPort, RemediationScope } from "./types.js";

export interface CommandRunner {
  run(cmd: string, cwd: string): Promise<{ code: number | null; stdout: string; stderr: string }>;
}

class CliRunner implements CommandRunner {
  constructor(private readonly cwd: string) {}
  run(cmd: string): ReturnType<CommandRunner["run"]> {
    return runCommand(cmd, this.cwd, 120_000);
  }
}

export interface GhPrPortDeps {
  readonly repoRoot: string;
  readonly runner?: CommandRunner;
  /** 브랜치 접두사. 기본 "qa-autopilot/fix". */
  readonly branchPrefix?: string;
  readonly remote?: string; // 기본 origin
}

export class GhPrPort implements PrPort {
  private readonly runner: CommandRunner;
  constructor(private readonly deps: GhPrPortDeps) {
    this.runner = deps.runner ?? new CliRunner(deps.repoRoot);
  }

  async createPr(input: {
    title: string;
    body: string;
    diff: string;
    scope: RemediationScope;
  }): Promise<{ url: string }> {
    const branch = `${this.deps.branchPrefix ?? "qa-autopilot/fix"}-${Date.now()}`;
    const root = this.deps.repoRoot;

    await this.exec(`git checkout -b "${branch}"`);
    const patch = join(root, ".qa-autopilot-pr.patch");
    await writeFile(patch, input.diff, "utf8");
    try {
      await this.exec(`git apply "${patch}"`);
    } finally {
      await rm(patch, { force: true });
    }
    await this.exec(`git add -A`);
    await this.exec(`git commit -m "${shellEscape(input.title)}"`);
    await this.exec(`git push -u ${this.deps.remote ?? "origin"} "${branch}"`);

    const bodyFile = join(root, ".qa-autopilot-pr-body.md");
    await writeFile(bodyFile, input.body, "utf8");
    try {
      const res = await this.runner.run(
        `gh pr create --title "${shellEscape(input.title)}" --body-file "${bodyFile}" --head "${branch}"`,
        root
      );
      if (res.code !== 0) throw new Error(`gh pr create failed: ${res.stderr.slice(0, 300)}`);
      return { url: extractPrUrl(res.stdout) };
    } finally {
      await rm(bodyFile, { force: true });
    }
  }

  // merge 메서드는 존재하지 않는다 — AI에 병합 권한 없음.

  private async exec(cmd: string): Promise<void> {
    const res = await this.runner.run(cmd, this.deps.repoRoot);
    if (res.code !== 0) throw new Error(`command failed (${cmd}): ${res.stderr.slice(0, 300)}`);
  }
}

function shellEscape(s: string): string {
  return s.replace(/"/g, '\\"');
}

function extractPrUrl(stdout: string): string {
  const m = stdout.match(/https?:\/\/\S+/);
  return m ? m[0] : stdout.trim();
}
