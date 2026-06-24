/**
 * 롤백 자동 감지 (R2 무인화) — remediation 커밋을 되돌린 git revert 커밋을 찾는다.
 *
 * remediation PR 제목은 `fix(test_only): ...` / `fix(app_source): ...` 규약(engine.ts).
 * `git revert` 는 본문에 "This reverts commit <sha>." 를 남기므로 이를 파싱해 연결한다.
 *
 * 순수 로직은 git 없이 테스트 가능. 실제 로그 읽기는 GitLogReader 포트 뒤에 둔다.
 */

import { runCommand } from "@qa/shared";

export interface Commit {
  readonly sha: string;
  readonly subject: string;
  readonly body: string;
}

const REMEDIATION_SUBJECT = /^fix\((test_only|app_source)\):/;
const REVERTS_MARKER = /This reverts commit ([0-9a-f]{7,40})/i;

const FIELD = String.fromCharCode(0x1f); // 필드 구분자
const RECORD = String.fromCharCode(0x1e); // 레코드 구분자

/** 이 커밋이 remediation이 만든 커밋인가 (제목 규약). */
export function isRemediationSubject(subject: string): boolean {
  return REMEDIATION_SUBJECT.test(subject.trim());
}

/** revert 커밋이면 되돌린 대상 sha를 반환. */
export function revertedShaOf(commit: Commit): string | undefined {
  const m = commit.body.match(REVERTS_MARKER);
  return m ? m[1] : undefined;
}

export interface Rollback {
  readonly revertSha: string;
  readonly revertedSha: string;
  readonly revertedSubject: string;
}

/**
 * 로그 윈도우에서 "remediation 커밋을 되돌린 revert"만 골라낸다.
 * 되돌린 대상 커밋이 같은 윈도우 안에 있어야 제목으로 remediation 여부를 판정할 수 있다.
 */
export function detectRemediationRollbacks(commits: readonly Commit[]): Rollback[] {
  const bySha = new Map<string, Commit>();
  for (const c of commits) bySha.set(c.sha, c);

  const findByPrefix = (sha: string): Commit | undefined => {
    if (bySha.has(sha)) return bySha.get(sha);
    for (const c of commits) if (c.sha.startsWith(sha)) return c; // 약식 sha 대응
    return undefined;
  };

  const out: Rollback[] = [];
  for (const c of commits) {
    const reverted = revertedShaOf(c);
    if (!reverted) continue;
    const target = findByPrefix(reverted);
    if (target && isRemediationSubject(target.subject)) {
      out.push({ revertSha: c.sha, revertedSha: target.sha, revertedSubject: target.subject });
    }
  }
  return out;
}

export interface GitLogReader {
  log(maxCount: number): Promise<Commit[]>;
}

/** git CLI 기반 로그 리더. git의 %x1f/%x1e 포맷 토큰으로 제어문자를 출력시킨다. */
export class CliGitLogReader implements GitLogReader {
  constructor(private readonly repoRoot: string) {}

  async log(maxCount: number): Promise<Commit[]> {
    // %x1f/%x1e 는 git이 해당 바이트를 출력 — 셸 인자로는 안전한 printable 토큰.
    const res = await runCommand(
      `git log --max-count=${maxCount} --format=%H%x1f%s%x1f%b%x1e`,
      this.repoRoot,
      60_000
    );
    return parseGitLog(res.stdout);
  }
}

/** git log 출력(0x1e 레코드 / 0x1f 필드)을 파싱. 테스트에서 직접 사용. */
export function parseGitLog(stdout: string): Commit[] {
  return stdout
    .split(RECORD)
    .map((r) => r.trim())
    .filter((r) => r.length > 0)
    .map((r) => {
      const [sha = "", subject = "", body = ""] = r.split(FIELD);
      return { sha: sha.trim(), subject: subject.trim(), body: body.trim() };
    })
    .filter((c) => c.sha.length > 0);
}
