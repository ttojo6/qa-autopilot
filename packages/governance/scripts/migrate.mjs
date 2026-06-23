#!/usr/bin/env node
/**
 * 마이그레이션 러너 — migrations/*.sql 를 순서대로 1회씩 적용한다.
 * 적용 이력은 _migrations 테이블에 기록(멱등 보장).
 *
 *   DATABASE_URL=postgres://... node packages/governance/scripts/migrate.mjs
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, "../../../migrations");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query(
    `create table if not exists _migrations (name text primary key, applied_at timestamptz not null default now())`
  );
  const { rows } = await client.query(`select name from _migrations`);
  const applied = new Set(rows.map((r) => r.name));

  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    if (applied.has(file)) {
      console.log(`skip  ${file} (already applied)`);
      continue;
    }
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    await client.query("begin");
    try {
      await client.query(sql);
      await client.query(`insert into _migrations (name) values ($1)`, [file]);
      await client.query("commit");
      console.log(`apply ${file}`);
    } catch (e) {
      await client.query("rollback");
      console.error(`fail  ${file}: ${e.message}`);
      process.exit(1);
    }
  }
  console.log("migrations up to date");
} finally {
  await client.end();
}
