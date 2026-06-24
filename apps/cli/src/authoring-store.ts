/**
 * Authoring 스토어 팩토리 — DATABASE_URL 있으면 Postgres(콘솔과 공유), 없으면 파일.
 * 파일 경로는 콘솔이 QA_TEST_PROPOSALS_FILE 로 가리킨다.
 */

import { resolve, join } from "node:path";
import { FileAuthoringStore, PgAuthoringStore, type AuthoringStore } from "@qa/authoring";
import { createPool } from "@qa/governance/pg";

export interface AuthoringStoreHandle {
  store: AuthoringStore;
  close: () => Promise<void>;
}

export function makeAuthoringStore(projectRoot: string): AuthoringStoreHandle {
  const url = process.env.DATABASE_URL;
  if (url) {
    const pool = createPool(url);
    return { store: new PgAuthoringStore(pool), close: () => pool.end() };
  }
  const file = join(resolve(projectRoot, "artifacts"), "test-proposals.json");
  return { store: new FileAuthoringStore(file), close: async () => undefined };
}
