/**
 * 실패 서명 정규화 — 클러스터링의 기반 (R5: caseId 불안정 → 추세 붕괴 방어).
 *
 * 같은 근본원인의 실패는 메시지에 가변 토큰(라인번호, 주소, UUID, 타임스탬프, 경로)이
 * 섞여 매번 달라 보인다. 이를 제거해 안정적 서명을 만들어야 동일 원인이 한 클러스터로 묶인다.
 *
 * 모든 함수는 순수(pure)하며 입력을 변경하지 않는다.
 */

import type { TestResult } from "@qa/shared";

const VOLATILE_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/0x[0-9a-fA-F]+/g, "<hex>"],
  [/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<uuid>"],
  [/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g, "<timestamp>"],
  [/(?:\/[\w.-]+)+\/?|[A-Za-z]:\\(?:[\w.-]+\\?)+/g, "<path>"],
  [/:\d+(?::\d+)?\b/g, ":<line>"], // file:line:col
  [/\b\d+(?:\.\d+)?ms\b/g, "<dur>"],
  [/\b\d{2,}\b/g, "<num>"], // 2자리 이상 숫자만 (단일 숫자 코드는 의미 보존)
  [/\s+/g, " "],
];

/** 단일 메시지를 정규화한다. */
export function normalizeMessage(message: string): string {
  let out = message.trim();
  for (const [pattern, replacement] of VOLATILE_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out.trim().slice(0, 500);
}

/**
 * TestResult → 안정적 서명. 에러 타입 + 정규화 메시지 + 위치 파일을 결합한다.
 * 위치는 파일까지만(라인 제외) — 라인 변경에 흔들리지 않게.
 */
export function signatureOf(result: TestResult): string {
  const type = result.error?.type ?? "unknown";
  const msg = normalizeMessage(result.error?.message ?? "");
  const file = result.error?.location?.file ?? "";
  return `${type}|${file}|${msg}`;
}
