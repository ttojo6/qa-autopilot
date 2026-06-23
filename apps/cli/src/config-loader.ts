import { readFileSync } from "node:fs";
import { parse } from "yaml";
import type { QaConfig } from "@qa/shared";

/**
 * qa.config.yaml 로드 + 경계 검증(fail fast).
 * 외부 입력(설정 파일)은 신뢰하지 않는다 — 필수 필드를 명시적으로 확인한다.
 */
export function loadConfig(path: string): QaConfig {
  const raw = parse(readFileSync(path, "utf8")) as Partial<QaConfig>;

  if (!raw.project) throw new Error(`qa.config: "project" is required (${path})`);
  if (!Array.isArray(raw.runners) || raw.runners.length === 0) {
    throw new Error(`qa.config: at least one "runners[]" entry is required (${path})`);
  }
  for (const r of raw.runners) {
    if (!r.id || !r.adapter || !r.command) {
      throw new Error(`qa.config: runner needs id/adapter/command (${JSON.stringify(r)})`);
    }
  }
  if (!raw.retry || typeof raw.retry.maxRetries !== "number") {
    throw new Error(`qa.config: "retry.maxRetries" is required (${path})`);
  }
  if (!raw.triage || typeof raw.triage.confidenceThreshold !== "number") {
    throw new Error(`qa.config: "triage.confidenceThreshold" is required (${path})`);
  }
  if (!raw.remediation || !raw.governance) {
    throw new Error(`qa.config: "remediation" and "governance" sections are required (${path})`);
  }
  return raw as QaConfig;
}
