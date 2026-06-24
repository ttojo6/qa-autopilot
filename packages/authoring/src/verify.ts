/**
 * 초안 검증 — 생성된 테스트가 실제로 실행/통과하는지 격리 환경에서 확인한다.
 *
 * 안전 기본값(NullDraftVerifier)은 "검증 안 함"(not_run)을 반환한다 — 엔진은 not_run을
 * 거부하지 않지만, 운영에서는 실제 검증기를 붙여 errors(문법/임포트 실패) 초안을 걸러야 한다.
 */

import type { DraftVerifier, TestCaseDraft, DraftVerification } from "./types.js";

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
