-- 003: 메타 지표 누계 (단일 행). STOP 트리거 평가의 공유 소스.
-- CLI(라우팅 누적)와 콘솔(사람 피드백)이 같은 행을 갱신한다.

CREATE TABLE metrics (
  id              smallint PRIMARY KEY DEFAULT 1,
  total           bigint NOT NULL DEFAULT 0,
  signal          bigint NOT NULL DEFAULT 0,
  human           bigint NOT NULL DEFAULT 0,
  quarantine      bigint NOT NULL DEFAULT 0,
  retry           bigint NOT NULL DEFAULT 0,
  human_overrides bigint NOT NULL DEFAULT 0,  -- R1 분자
  merged          bigint NOT NULL DEFAULT 0,  -- R2 분모
  rolled_back     bigint NOT NULL DEFAULT 0,  -- R2 분자
  CONSTRAINT metrics_singleton CHECK (id = 1)
);

INSERT INTO metrics (id) VALUES (1) ON CONFLICT DO NOTHING;
