/**
 * 제안 핸드오프 — CLI가 만든 제안을 콘솔이 읽을 수 있게 JSON으로 내보낸다.
 *
 * 공유 DB가 붙기 전까지의 다리(bridge). 콘솔은 QA_PROPOSALS_FILE 환경변수로 이 파일을 가리킨다.
 * (운영에서는 양쪽이 같은 Postgres를 보게 되면 이 파일은 불필요.)
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import type { EnrichedProposal } from "./remediate.js";

export function writeProposals(projectRoot: string, proposals: readonly EnrichedProposal[]): string {
  const dir = resolve(projectRoot, "artifacts");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "proposals.json");
  writeFileSync(file, JSON.stringify(proposals, null, 2), "utf8");
  return file;
}
