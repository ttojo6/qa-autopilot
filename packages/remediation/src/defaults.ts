/**
 * 안전 기본 포트 — 키·CI 없이도 엔진이 동작·테스트되도록.
 *
 * 기본값은 "아무것도 하지 않는다"가 아니라 "안전한 쪽으로 막는다"이다:
 *  - NullVerifier는 not_run을 반환 → 게이트가 자동 PR을 차단(검증 없는 수정 불가).
 */

import type {
  ProposalGenerator,
  ProposalRequest,
  ProposalDraft,
  FixVerifier,
  RegressionProof,
} from "./types.js";

/** 초안을 만들지 못하는 기본 생성기 (실제 운영에서는 LlmProposalGenerator로 교체). */
export class NullProposalGenerator implements ProposalGenerator {
  async generate(req: ProposalRequest): Promise<ProposalDraft> {
    return {
      diff: "",
      summary: `(no generator configured for ${req.signature})`,
      rationale: "No proposal generator wired; cannot produce a fix.",
      affectedFiles: [],
      source: "null-generator",
    };
  }
}

/** 회귀 검증을 수행하지 않는 기본 검증기 → not_run → 게이트가 자동 PR을 차단. */
export class NullFixVerifier implements FixVerifier {
  async verify(): Promise<RegressionProof> {
    return {
      status: "not_run",
      evidence: "No fix verifier wired; regression not verified. Auto-PR is blocked by policy.",
    };
  }
}
