-- 004: 롤백 자동 감지의 중복 집계 방지 ledger.
-- 이미 R2 분자로 집계한 revert 커밋 sha를 기록한다(멱등 스캔).

CREATE TABLE scanned_reverts (
  sha        text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);
