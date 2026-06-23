-- qa-autopilot 초기 스키마 (Phase 0).
-- 거버넌스·감사가 제품의 차별점이므로 스키마부터 그 모양으로 둔다.
-- 이력은 append-only 를 지향한다 (Actnote bi-temporal 감각 차용).

create table if not exists test_runs (
  id            uuid primary key default gen_random_uuid(),
  project       text not null,
  commit_sha    text,
  trigger       text,                       -- ci | manual | schedule
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  summary       jsonb
);

create table if not exists test_results (
  id            uuid primary key default gen_random_uuid(),
  run_id        uuid not null references test_runs(id) on delete cascade,
  runner_id     text not null,
  case_id       text not null,              -- 재실행 간 안정적 식별자
  title         text not null,
  status        text not null,              -- passed | failed | skipped | timed_out
  duration_ms   integer not null default 0,
  attempts      integer not null default 1,
  error_type    text,                       -- RawErrorType (저수준)
  error_message text,
  artifacts     jsonb not null default '[]'
);
create index if not exists idx_results_run on test_results(run_id);
create index if not exists idx_results_case on test_results(case_id);

-- 동일 근본원인 묶음 = 노이즈 제거/중복 분석 방지의 단위.
create table if not exists failure_clusters (
  id            uuid primary key default gen_random_uuid(),
  signature     text not null unique,       -- 정규화된 실패 서명
  rep_message   text,
  occurrences   integer not null default 0,
  first_seen    timestamptz not null default now(),
  last_seen     timestamptz not null default now()
);

create table if not exists failures (
  id            uuid primary key default gen_random_uuid(),
  result_id     uuid not null references test_results(id) on delete cascade,
  cluster_id    uuid references failure_clusters(id),
  signature     text not null
);

-- AI 1차 분석 결과. lane 으로 retry/quarantine/signal/human 을 분리 기록.
create table if not exists triage_verdicts (
  id            uuid primary key default gen_random_uuid(),
  cluster_id    uuid references failure_clusters(id),
  failure_class text not null,              -- PRODUCT_BUG | TEST_BUG | FLAKY | ...
  confidence    numeric(4,3) not null,
  lane          text not null,              -- retry | quarantine | signal | human
  rationale     text,
  model         text,
  created_at    timestamptz not null default now()
);

-- 자가 치유 제안. scope 로 test_only / app_source 분리 (게이트 차등의 근거).
create table if not exists remediation_proposals (
  id            uuid primary key default gen_random_uuid(),
  cluster_id    uuid references failure_clusters(id),
  scope         text not null,              -- test_only | app_source
  diff          text,
  pr_url        text,
  regression_proof jsonb,                   -- 수정 적용 후 회귀 재실행 증빙
  status        text not null default 'proposed', -- proposed | approved | merged | rejected
  created_at    timestamptz not null default now()
);

-- 사람 최종 확인. AI 는 머지 권한이 없다 — 승인은 항상 사람 식별자.
create table if not exists approvals (
  id            uuid primary key default gen_random_uuid(),
  proposal_id   uuid not null references remediation_proposals(id) on delete cascade,
  approver      text not null,
  decision      text not null,              -- approve | reject
  policy_rule   text,
  created_at    timestamptz not null default now()
);

-- 모든 자동 행위의 불변 감사 기록.
create table if not exists audit_log (
  id            bigserial primary key,
  actor         text not null,              -- system | ai | <user>
  action        text not null,
  target        text,
  detail        jsonb,
  created_at    timestamptz not null default now()
);
