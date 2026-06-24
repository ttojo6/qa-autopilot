/**
 * 중복 제거 — 기존 테스트나 같은 배치 내 중복을 재생성하지 않게 한다 (Authoring 핵심 품질장치).
 *
 * 의미적으로 같은 테스트(제목 표현만 다른)를 걸러내기 위해 제목을 정규화한 서명을 쓴다.
 */

import type { TestCaseDraft } from "./types.js";

/** 제목 정규화: 소문자 + 영숫자만 + 공백 1칸. */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, " ")
    .trim();
}

/** 초안 서명 = 대상 러너 + 정규화 제목. 동일 서명은 중복으로 본다. */
export function draftSignature(draft: Pick<TestCaseDraft, "title"> & { targetRunner: string }): string {
  return `${draft.targetRunner}|${normalizeTitle(draft.title)}`;
}

export interface DedupResult {
  readonly unique: readonly TestCaseDraft[];
  readonly duplicates: readonly TestCaseDraft[];
}

/**
 * 기존 서명 집합과 배치 내 중복을 모두 제거한다.
 * existingSignatures: 이미 존재하는 테스트의 서명(있으면 재생성 방지).
 */
export function dedupDrafts(
  drafts: readonly TestCaseDraft[],
  targetRunner: string,
  existingSignatures: ReadonlySet<string> = new Set()
): DedupResult {
  const seen = new Set(existingSignatures);
  const unique: TestCaseDraft[] = [];
  const duplicates: TestCaseDraft[] = [];

  for (const d of drafts) {
    const sig = draftSignature({ title: d.title, targetRunner });
    if (seen.has(sig)) {
      duplicates.push(d);
    } else {
      seen.add(sig);
      unique.push(d);
    }
  }
  return { unique, duplicates };
}
