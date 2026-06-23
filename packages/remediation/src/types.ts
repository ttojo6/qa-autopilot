/**
 * Remediation 도메인 타입 + 포트.
 *
 * 핵심 안전 불변(R2): 어떤 포트에도 merge 메서드가 없다. AI는 PR을 만들고 증빙을 붙이는 데까지만
 * 할 수 있고, 병합은 항상 사람이 별도 채널(GitHub 승인)에서 한다 — 권한이 구조적으로 분리돼 있다.
 */

import type { RemediationScope } from "./scope.js";
export type { RemediationScope } from "./scope.js";

export interface ProposalRequest {
  readonly signature: string;
  readonly failureClass: string;
  readonly scope: RemediationScope;
  /** 마스킹된 대표 실패 메시지 (R8: PII 제거 후). */
  readonly clusterMessage: string;
  readonly caseIds: readonly string[];
}

/** 분류기/LLM이 만든 수정 초안. */
export interface ProposalDraft {
  /** unified diff 텍스트. */
  readonly diff: string;
  readonly summary: string;
  readonly rationale: string;
  /** diff가 건드리는 파일 목록 (영향 범위 표기 — 검수 보조). */
  readonly affectedFiles: readonly string[];
  readonly source: string; // "claude:opus-4-8" 등
}

/** 수정 초안을 만드는 포트. LLM 또는 규칙 기반. */
export interface ProposalGenerator {
  generate(req: ProposalRequest): Promise<ProposalDraft>;
}

export type RegressionStatus = "passed" | "failed" | "not_run";

/**
 * 회귀 증빙 — 제안된 diff를 적용해 영향 케이스를 재실행한 결과.
 * "검증 없는 수정은 게이트 통과 불가" 원칙의 증거물.
 */
export interface RegressionProof {
  readonly status: RegressionStatus;
  /** 재실행한 케이스와 결과 요약. */
  readonly evidence: string;
  readonly verifiedAt?: string; // ISO8601
}

/** 제안 diff를 격리 환경(worktree 등)에 적용해 재실행하고 증빙을 만드는 포트. */
export interface FixVerifier {
  verify(draft: ProposalDraft, req: ProposalRequest): Promise<RegressionProof>;
}

/** PR 생성 포트 — merge 없음(의도적). 생성과 코멘트만. */
export interface PrPort {
  createPr(input: {
    title: string;
    body: string;
    diff: string;
    scope: RemediationScope;
  }): Promise<{ url: string }>;
}

export interface GateResult {
  readonly scope: RemediationScope;
  /** 자동 PR 허용 여부 (app_source는 항상 false). */
  readonly autoPrAllowed: boolean;
  readonly requiredApprovals: number;
  readonly codeownersRequired: boolean;
  /** 게이트를 통과하지 못한 이유들 (비어 있으면 통과). */
  readonly blockedReasons: readonly string[];
}

export type ProposalStatus = "blocked" | "needs_human_pr" | "ready_for_auto_pr" | "pr_opened";

export interface RemediationProposal {
  readonly signature: string;
  readonly scope: RemediationScope;
  readonly draft: ProposalDraft;
  readonly regressionProof: RegressionProof;
  readonly gate: GateResult;
  readonly status: ProposalStatus;
  readonly prUrl?: string;
}
