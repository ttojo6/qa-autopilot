/**
 * RevertLedger — 이미 R2 분자로 집계한 revert sha를 기록해 중복 집계를 막는다(멱등 스캔).
 * DATABASE_URL 있으면 scanned_reverts 테이블, 없으면 파일.
 */

import { resolve, join } from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createPool } from "@qa/governance/pg";

export interface RevertLedger {
  /** 주어진 sha들 중 처음 보는 것만 기록하고, 새로 추가된 sha 목록을 반환한다. */
  markSeen(shas: readonly string[]): Promise<string[]>;
}

interface Queryable {
  query<R = Record<string, unknown>>(text: string, params?: readonly unknown[]): Promise<{ rows: R[] }>;
}

class PgRevertLedger implements RevertLedger {
  constructor(private readonly db: Queryable) {}
  async markSeen(shas: readonly string[]): Promise<string[]> {
    if (shas.length === 0) return [];
    const { rows } = await this.db.query<{ sha: string }>(
      `insert into scanned_reverts (sha)
       select unnest($1::text[]) on conflict (sha) do nothing returning sha`,
      [[...shas]]
    );
    return rows.map((r) => r.sha);
  }
}

class FileRevertLedger implements RevertLedger {
  constructor(private readonly path: string) {}
  async markSeen(shas: readonly string[]): Promise<string[]> {
    const seen = await this.load();
    const added = shas.filter((s) => !seen.has(s));
    if (added.length === 0) return [];
    for (const s of added) seen.add(s);
    await mkdir(resolve(this.path, ".."), { recursive: true });
    await writeFile(this.path, JSON.stringify({ seen: [...seen] }, null, 2), "utf8");
    return added;
  }
  private async load(): Promise<Set<string>> {
    if (!existsSync(this.path)) return new Set();
    try {
      const parsed = JSON.parse(await readFile(this.path, "utf8")) as { seen?: string[] };
      return new Set(parsed.seen ?? []);
    } catch {
      return new Set();
    }
  }
}

export interface LedgerHandle {
  ledger: RevertLedger;
  close: () => Promise<void>;
}

export function makeRevertLedger(projectRoot: string): LedgerHandle {
  const url = process.env.DATABASE_URL;
  if (url) {
    const pool = createPool(url);
    return { ledger: new PgRevertLedger(pool), close: () => pool.end() };
  }
  const file = join(resolve(projectRoot, "artifacts"), "revert-ledger.json");
  return { ledger: new FileRevertLedger(file), close: async () => undefined };
}
