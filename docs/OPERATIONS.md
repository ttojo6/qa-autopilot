# 운영 가이드 (GitHub 연동)

레포의 CI·게이트·자동화를 실제 GitHub에서 운영하기 위한 절차. **아래 1·3·4는 당신의 GitHub
인증이 필요해 직접 실행해야 한다** (에이전트가 대신 게시하지 않는다).

## 1. 리모트 연결 + 첫 푸시

GitHub에 빈 레포(`qa-autopilot`, **private 권장**)를 만든 뒤:

```bash
# gh CLI가 있으면 (private)
gh repo create qa-autopilot --private --source=. --remote=origin --push

# 또는 수동: github.com에서 레포 생성 후
git remote add origin https://github.com/<you>/qa-autopilot.git
git push -u origin main
```

> 인증이 필요한 단계는 세션에서 `! gh auth login` 처럼 `!` 접두사로 실행하면 출력이 대화에 들어온다.

## 2. CI 시크릿 등록 (Settings → Secrets and variables → Actions)

| 시크릿 | 용도 | 없으면 |
|---|---|---|
| `DATABASE_URL` | 거버넌스·메트릭 공유 영속화 + `integration-postgres`/cron 스캔 | 파일 모드(휘발) — 공유 누계·라이브 pg 테스트 의미 없음 |
| `ANTHROPIC_API_KEY` | Triage LLM escalation · Remediation/Authoring 생성 | 휴리스틱/Null 폴백(안전) |

> CI의 `integration-postgres` 잡은 자체 Postgres 서비스를 띄우므로 시크릿 없이도 라이브 pg 테스트가 돈다. cron 스캔(`rollback-scan.yml`)은 누계를 공유 DB에 쓰려면 `DATABASE_URL`이 필요하다.

## 3. 릴리즈 게이트를 필수 체크로 (Branch protection)

`main`을 보호해 **CI 통과 없이는 머지 불가**로 만든다 — release-gate(`--fail-on-blocking`, exit 2)가 진짜 머지 차단으로 작동한다.

Settings → Branches → Add branch ruleset (또는 protection rule) for `main`:
- ✅ Require a pull request before merging
- ✅ Require status checks to pass → 다음을 필수로 지정:
  - `build-test` (release-gate 데모 포함)
  - `integration-postgres`
  - `e2e-dashboard`
- ✅ Require branches to be up to date before merging

이후 `qa run --fail-on-blocking`이 release-blocking 클러스터에서 exit 2 → `build-test` 실패 → PR 머지 차단.

## 4. 스케줄 작업

- **롤백 스캔** (`.github/workflows/rollback-scan.yml`): 매일 03:00 UTC `qa scan-rollbacks` 실행 → R2 rollback 무인 기록. `DATABASE_URL` 시크릿 필요(공유 누계). `workflow_dispatch`로 수동 실행도 가능.

## 5. 운영 파이프라인에서 `qa run`

대상 레포의 PR 파이프라인에 추가(이 레포가 아니라 *검사 대상* 프로젝트의 워크플로):

```yaml
- run: node <path>/apps/cli/dist/index.js run --config qa.config.yaml --fail-on-blocking
  env:
    DATABASE_URL: ${{ secrets.DATABASE_URL }}        # 제안·메트릭 공유
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

승인 콘솔(`apps/dashboard`)은 같은 `DATABASE_URL`로 띄우면 CLI가 적재한 제안을 검토·승인할 수 있다.

## 체크리스트

- [ ] 리모트 연결 + `git push -u origin main`
- [ ] `DATABASE_URL` / `ANTHROPIC_API_KEY` 시크릿 등록
- [ ] `main` branch protection — 3개 잡 필수 체크
- [ ] (cron) `DATABASE_URL` 확인 — 롤백 스캔 누계 공유
- [ ] 대상 프로젝트 PR 워크플로에 `qa run --fail-on-blocking` 추가
