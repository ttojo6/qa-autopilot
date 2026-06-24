/**
 * 초안 검증 — 생성된 테스트가 실제로 실행/통과하는지 격리 환경에서 확인한다.
 *
 * 안전 기본값(NullDraftVerifier)은 "검증 안 함"(not_run)을 반환한다 — 엔진은 not_run을
 * 거부하지 않지만, 운영에서는 실제 검증기를 붙여 errors(문법/임포트 실패) 초안을 걸러야 한다.
 */

import type { DraftVerifier, TestCaseDraft, DraftVerification } from "./types.js";

/** 초안을 격리 실행한 raw 결과. 호출자(러너 배선)가 채운다. */
export interface DraftRunResult {
  /** 러너가 이 테스트를 수집·실행했는가 (import/문법 OK). */
  readonly ran: boolean;
  /** 실행됐다면 통과했는가. */
  readonly passed: boolean;
  /** 수집/문법 실패 메시지 (있으면 errors). */
  readonly collectError?: string;
}

/**
 * raw 실행 결과 → VerifyOutcome.
 *  - 수집 실패/미실행 → errors (리뷰 큐에서 배제)
 *  - 실행+통과 → runs_passes
 *  - 실행+실패 → runs_fails (진짜 버그이거나 잘못된 단언 — 사람 판단)
 */
export function classifyDraftRun(r: DraftRunResult): DraftVerification {
  if (r.collectError || !r.ran) {
    return { outcome: "errors", evidence: r.collectError ?? "draft was not collected/executed" };
  }
  return r.passed
    ? { outcome: "runs_passes", evidence: "draft ran and passed against current code" }
    : { outcome: "runs_fails", evidence: "draft ran but failed — possible real bug or wrong assertion" };
}

export class NullDraftVerifier implements DraftVerifier {
  async verify(): Promise<DraftVerification> {
    return { outcome: "not_run", evidence: "no verifier wired; draft not executed" };
  }
}

/**
 * 콜백 기반 검증기 — 초안을 격리 실행하는 방법(worktree에 쓰고 러너 실행)을 호출자가 주입한다.
 * 반환 outcome을 그대로 증빙으로 사용.
 */
export class CallbackDraftVerifier implements DraftVerifier {
  constructor(private readonly run: (draft: TestCaseDraft) => Promise<DraftVerification>) {}
  verify(draft: TestCaseDraft): Promise<DraftVerification> {
    return this.run(draft);
  }
}
