-- 002: 거버넌스 권위 스키마.
-- 001의 placeholder 거버넌스 테이블(remediation_proposals/approvals/audit_log)을
-- @qa/governance 레코드와 1:1 대응하는 정식 테이블로 대체한다.
-- (001의 test_runs/test_results/failures/failure_clusters/triage_verdicts 는 유지.)

DROP TABLE IF EXISTS approvals CASCADE;
DROP TABLE IF EXISTS remediation_proposals CASCADE;
DROP TABLE IF EXISTS audit_log CASCADE;

-- 수정 제안. 게이트 관련 컬럼 + 콘솔 표시용 부가 컬럼을 한 행에 담는다.
CREATE TABLE proposals (
  id                  text PRIMARY KEY,
  signature           text NOT NULL,
  scope               text NOT NULL,        -- test_only | app_source
  author              text NOT NULL,        -- ai | system | <user>
  required_approvals  integer NOT NULL,
  codeowners_required boolean NOT NULL,
  regression_passed   boolean NOT NULL,
  status              text NOT NULL DEFAULT 'proposed',
  -- 콘솔 표시용(부가) — 게이트 판정에는 쓰이지 않음
  summary             text,
  diff                text,
  proof_status        text,                 -- passed | failed | not_run
  proof_evidence      text,
  affected_files      jsonb NOT NULL DEFAULT '[]',
  failure_class       text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- 승인 내역. 사람 식별자만 의미가 있으며 self-approve/봇 승인은 평가 단계에서 배제된다.
CREATE TABLE approvals (
  id           bigserial PRIMARY KEY,
  proposal_id  text NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  approver     text NOT NULL,
  decision     text NOT NULL,               -- approve | reject
  is_codeowner boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_approvals_proposal ON approvals(proposal_id);

-- 불변(append-only) 감사 로그.
CREATE TABLE audit_log (
  id         bigserial PRIMARY KEY,
  actor      text NOT NULL,
  action     text NOT NULL,
  target     text,
  detail     jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
