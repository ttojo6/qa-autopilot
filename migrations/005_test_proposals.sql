-- 005: Authoring 테스트 제안 리뷰 큐. 콘솔에서 사람이 승인/거절한다.
-- AI는 초안만 만들고, 승인돼도 테스트 추가는 사람이 한다(자동 추가 없음).

CREATE TABLE test_proposals (
  id             text PRIMARY KEY,
  spec_id        text NOT NULL,
  title          text NOT NULL,
  target_runner  text NOT NULL,
  file_path      text NOT NULL,
  diff           text NOT NULL,
  code           text NOT NULL,
  rationale      text,
  verify_outcome text NOT NULL,           -- runs_passes | runs_fails | errors | not_run
  verify_evidence text,
  status         text NOT NULL,           -- pending_review | duplicate | rejected_error
  decision       text NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  created_at     timestamptz NOT NULL DEFAULT now()
);
