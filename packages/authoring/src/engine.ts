/**
 * AuthoringEngine — ① 테스트 설계/생성의 오케스트레이터.
 *
 * 흐름: spec → 생성 → 중복 제거 → 검증 → 리뷰 큐(AuthoringProposal).
 *
 * 안전 불변:
 *  1) 어떤 초안도 레포에 자동 추가되지 않는다 — 엔진은 제안만 만든다(파일 쓰기 없음).
 *  2) 모든 초안은 pending_review로 끝난다 (errors/duplicate 제외).
 *  3) 중복(기존/배치 내)은 duplicate, 실행 불가(errors)는 rejected_error로 배제.
 */

import type {
  TestSpec,
  TestCaseGenerator,
  DraftVerifier,
  AuthoringProposal,
  TestCaseDraft,
} from "./types.js";
import { dedupDrafts, draftSignature } from "./dedup.js";
import { NullDraftVerifier } from "./verify.js";

export interface AuthoringEngineDeps {
  readonly generator: TestCaseGenerator;
  readonly verifier?: DraftVerifier;
  /** 러너별 기존 테스트 서명(재생성 방지). 없으면 빈 집합. */
  readonly existingSignatures?: (targetRunner: string) => ReadonlySet<string>;
  /** LLM 전송 전 PII/시크릿 마스킹. */
  readonly maskPII?: (text: string) => string;
}

export class AuthoringEngine {
  private readonly generator: TestCaseGenerator;
  private readonly verifier: DraftVerifier;
  private readonly existingSignatures: (runner: string) => ReadonlySet<string>;
  private readonly maskPII: (text: string) => string;

  constructor(deps: AuthoringEngineDeps) {
    this.generator = deps.generator;
    this.verifier = deps.verifier ?? new NullDraftVerifier();
    this.existingSignatures = deps.existingSignatures ?? (() => new Set());
    this.maskPII = deps.maskPII ?? ((t) => t);
  }

  /** 여러 스펙으로부터 테스트 제안을 만든다. 절대 레포에 쓰지 않는다. */
  async author(specs: readonly TestSpec[]): Promise<AuthoringProposal[]> {
    const out: AuthoringProposal[] = [];

    for (const spec of specs) {
      const masked: TestSpec = { ...spec, context: spec.context ? this.maskPII(spec.context) : undefined };
      const drafts = await this.generator.generate(masked);

      const { unique, duplicates } = dedupDrafts(
        drafts,
        spec.targetRunner,
        this.existingSignatures(spec.targetRunner)
      );

      for (const d of duplicates) {
        out.push(proposal(d, spec.targetRunner, { outcome: "not_run", evidence: "duplicate of existing/earlier test" }, "duplicate"));
      }

      for (const d of unique) {
        const verification = await this.verifier.verify(d);
        // 실행조차 안 되는(문법/임포트 실패) 초안은 리뷰 큐에서 배제.
        const status = verification.outcome === "errors" ? "rejected_error" : "pending_review";
        out.push(proposal(d, spec.targetRunner, verification, status));
      }
    }

    return out;
  }
}

function proposal(
  draft: TestCaseDraft,
  targetRunner: string,
  verification: AuthoringProposal["verification"],
  status: AuthoringProposal["status"]
): AuthoringProposal {
  return { draft, signature: draftSignature({ title: draft.title, targetRunner }), verification, status };
}
