import pg from "pg";
import type { Queryable } from "./queryable.js";

export interface PgPool extends Queryable {
  end(): Promise<void>;
}

/** 실제 Postgres 풀을 Queryable로 감싼다. connectionString은 DATABASE_URL. */
export function createPool(connectionString: string): PgPool {
  const pool = new pg.Pool({ connectionString });
  return {
    query: <R = Record<string, unknown>>(text: string, params?: readonly unknown[]) =>
      pool.query(text, params ? [...params] : undefined) as unknown as Promise<{ rows: R[] }>,
    end: () => pool.end(),
  };
}
