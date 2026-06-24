/**
 * Authoring 도메인 타입 — ① 테스트 설계/생성.
 *
 * 가장 검증이 어려운 단계라 안전 불변을 강하게 둔다:
 *  1) AI는 테스트 초안을 *제안*만 한다. 어떤 포트도 테스트를 레포에 자동 추가하지 않는다.
 *  2) 모든 초안은 사람 리뷰(pending_review)를 거친다.
 *  3) 기존 테스트와 중복(duplicate)·실행 불가(rejected_error)는 리뷰 큐에서 배제.
 */

/** 무엇으로부터 테스트를 생성할지. */
export interface TestSpec {
  readonly id: string;
  readonly description: string; // 검증할 동작
  readonly targetRunner: string; // playwright-ts | pytest 등
  readonly context?: string; // 소스 스니펫/기능 문서 (PII 마스킹 후)
}

/** 생성된 테스트 초안. */
export interface TestCaseDraft {
  readonly specId: string;
  readonly title: string;
  readonly filePath: string; // 제안 경로
  readonly code: string;
  readonly diff: string; // 파일 추가 unified diff (게이트/PR 재사용)
  readonly rationale: string;
  readonly source: string; // claude:claude-opus-4-8 | null-generator
}

export type VerifyOutcome = "runs_passes" | "runs_fails" | "errors" | "not_run";

export interface DraftVerification {
  readonly outcome: VerifyOutcome;
  readonly evidence: string;
}

export type ReviewStatus = "pending_review" | "duplicate" | "rejected_error";

export interface AuthoringProposal {
  readonly draft: TestCaseDraft;
  readonly signature: string;
  readonly verification: DraftVerification;
  readonly status: ReviewStatus;
}

/** 테스트 초안 생성 포트 (LLM 또는 Null). */
export interface TestCaseGenerator {
  generate(spec: TestSpec): Promise<TestCaseDraft[]>;
}

/** 초안을 격리 실행해 실제로 동작/통과하는지 검증하는 포트. */
export interface DraftVerifier {
  verify(draft: TestCaseDraft): Promise<DraftVerification>;
}
