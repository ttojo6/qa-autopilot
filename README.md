# qa-autopilot

운영 자동화 중심의 QA 자동화 플랫폼. 테스트 *실행*을 넘어 **실패 분류(Triage) → 노이즈 격리 → 거버넌스 승인 → 자가 치유(수정 제안)**까지 자동화한다. 범용(어댑터 플러그인) 구조이며 어떤 레포에든 `qa.config.yaml` 하나로 붙는다.

> 첫 적용 케이스: [Actnote](../Actnote) (Next.js 웹 E2E + Python 파이프라인).

## 두 가지 설계 원칙 (코드로 강제)

1. **재시도(Retry)와 수정(Fix)의 분리** — 플레이키/인프라는 Retry Lane에서만 흡수하고 코드를 건드리지 않는다. "진짜 결함"으로 분류된 것만 Remediation Lane에 진입한다.
2. **실패 분석과 노이즈의 격리** — 모든 실패는 Signal Gate를 먼저 통과한다. 노이즈는 Quarantine으로 격리되어 릴리즈 게이트·수정 대상·핵심 지표에서 제외된다.

자세한 설계는 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), 리스크 레지스터는 [`docs/RISKS.md`](docs/RISKS.md) 참조.

---

## 빠른 시작

### 사전 요구사항

- **Node.js 24+** (type stripping·내장 테스트 러너 사용)
- **pnpm 9** — 이 환경엔 글로벌 shim이 없어 `corepack pnpm@9.12.0 <cmd>` 로 호출한다. 글로벌 설치가 가능하면 `corepack enable pnpm` 후 그냥 `pnpm <cmd>`.
- (선택) `git`, `gh` — Remediation의 회귀 증빙·PR 생성에 필요
- (선택) `ANTHROPIC_API_KEY` — Triage LLM escalation / Remediation 수정 제안 활성화

### 설치 · 빌드 · 테스트

```bash
corepack pnpm@9.12.0 install
corepack pnpm@9.12.0 -r run build
corepack pnpm@9.12.0 -r run test     # 단위 테스트 30케이스 (triage 9 · remediation 13 · governance 8)
```

> Turbo는 글로벌 pnpm 바이너리를 찾으므로 corepack 환경에선 위처럼 `pnpm -r run`을 쓴다. 글로벌 pnpm이 있으면 `pnpm build` / `pnpm build:turbo` 도 동작한다.

### 한 사이클 실행 (실행 → Triage → Remediation)

```bash
node apps/cli/dist/index.js run --config examples/actnote/qa.config.yaml [--auto-pr]
```

`signal`로 분류된 진짜 결함만 RemediationEngine에 들어가 수정 제안 → **git worktree 회귀 증빙** → 게이트를 거친다. 결과는 `artifacts/proposals.json`으로 내보내진다(콘솔 핸드오프).
- `ANTHROPIC_API_KEY` 없으면 Null 생성기(가짜 수정 안 만듦), 있으면 `claude-opus-4-8` 생성기.
- `--auto-pr` 없으면 PR을 열지 않는다(test_only도 사람 대기). app_source는 플래그와 무관하게 자동 PR **금지**.

### 승인 콘솔 (Phase 3 UI)

```bash
# CLI가 만든 실제 제안을 띄우려면 핸드오프 파일을 가리킨다 (없으면 시드 샘플로 동작)
QA_PROPOSALS_FILE=examples/actnote/artifacts/proposals.json \
  corepack pnpm@9.12.0 --filter @qa/dashboard dev    # http://localhost:3000
```

AI 수정 제안을 검토·승인한다. 승인 평가(self-approve/봇승인 차단·CODEOWNERS·정족수)가 UI에서 그대로 강제된다. **승인이 충족돼도 병합은 사람이 GitHub에서** — 콘솔에 merge 버튼은 없다.

> 전체 루프: `qa run` → Triage(signal) → RemediationEngine(opus 생성 + worktree 증빙 + 게이트) → 제안 영속화 → 콘솔 검토·승인 → 사람이 GitHub 병합.

### 영속화 (Postgres, 선택)

`DATABASE_URL`이 설정되면 CLI는 제안을 DB에 적재하고 콘솔은 **같은 DB**에서 읽는다(핸드오프 파일 불필요). 미설정 시 파일/시드로 동작.

```bash
docker compose up -d                                   # 로컬 Postgres (포트 5433)
export DATABASE_URL=postgres://qa:qa@localhost:5433/qa
corepack pnpm@9.12.0 --filter @qa/governance db:migrate # migrations/*.sql 순서 적용
# 이후 같은 DATABASE_URL 로 `qa run` 과 콘솔(dev) 을 띄우면 제안이 DB로 흐른다
```

스키마: `migrations/001`(runs/results/clusters/triage) + `migrations/002`(proposals/approvals/audit_log, 거버넌스 권위 테이블). pg 어댑터는 `Queryable` 포트 뒤에 있어 가짜 클라이언트로 SQL·매핑이 단위 테스트된다.

### CI / 릴리즈 게이트

`--fail-on-blocking`을 주면 release-blocking 클러스터가 있을 때 **exit 2**로 끝나 CI가 머지를 막는다(노이즈는 이미 제외됐으므로 여기서 막히는 건 진짜 결함 또는 저신뢰뿐).

```bash
node apps/cli/dist/index.js run --config <path> --fail-on-blocking   # blocking>0 이면 exit 2
```

`.github/workflows/ci.yml` 2개 잡:
- **build-test** — 설치·빌드·전체 단위 테스트(pg 통합은 `DATABASE_URL` 없어 자동 skip) + ci-smoke 게이트 데모(exit 0).
- **integration-postgres** — Postgres 서비스 + `db:migrate` + **라이브 pg 왕복 테스트**(upsert→봇승인 무시→정족수 충족→approved+감사). 로컬에선 skip, CI에서만 실행.
- **e2e-dashboard** — Chromium 설치 + **콘솔 자기 E2E**(Playwright). Server Action 쓰기 경로(승인/분류 이의/롤백)를 실제 브라우저로 검증 — 제품이 스스로를 QA(dogfooding).

```bash
corepack pnpm@9.12.0 --filter @qa/dashboard run e2e:install   # Chromium (1회)
corepack pnpm@9.12.0 -r run build
corepack pnpm@9.12.0 --filter @qa/dashboard run e2e
```

### 메타 지표 / STOP 트리거 (자동화 자가 제어)

자동화 자체의 건강도를 누계로 추적해(`artifacts/metrics.json`), 임계 초과 시 자동화를 단계적으로 끈다 — **과거 성과가 현재 사이클을 게이팅**한다. (RISKS.md의 STOP 트리거를 코드화: `@qa/metrics`)

| 위험 | 지표 | 임계 | 발동 시 제어 |
|---|---|---|---|
| R1 | override rate (사람이 AI 분류 뒤집은 비율) | > 25% | `forceHumanTriage` — 전건 사람 큐로 강등 |
| R2 | rollback rate (병합 후 롤백 비율) | > 15% | `disableAppSourceRemediation` — 앱 소스 자동 수정 중단 |
| R4 | quarantine 비율 | > 40% | `reviewFlakySignals` — flakySignals 재검토 |

`minSamples`(기본 20)로 소표본 오발을 막는다. **누계는 CLI와 콘솔이 공유**한다 — `DATABASE_URL` 있으면 `metrics` 테이블, 없으면 파일(`QA_METRICS_FILE`).

**피드백은 콘솔 UI 행동으로 자동 기록**된다(별도 명령 불필요):
- 제안 상세의 **분류 이의(override)** 버튼 → R1 분자 +1
- **롤백 보고(rollback)** 버튼 → R2 분자 +1
- 승인이 정족수를 충족해 `approved`로 전이되면 **merged 자동 +1**(R2 분모)

**롤백은 git 스캔으로도 무인 감지**된다 — `qa scan-rollbacks`가 `fix(test_only|app_source):` 커밋을 되돌린 revert를 찾아 R2 분자를 멱등 기록한다(ledger로 중복 방지). CI/cron에 걸면 사람 없이 R2가 작동한다.

```bash
qa scan-rollbacks --config <path>            # git revert → R2 rollback 무인 기록 (멱등)
```

스크립트/수동 보정용 CLI 폴백:

```bash
qa feedback --config <path> [--override N] [--merged N] [--rolled-back N]
```

`qa run` 출력의 `safety:`/`⚠ STOP` 줄과 콘솔 상단 **Safety 배너**로 발동 상태를 확인한다. 콘솔 버튼의 **Server Action 쓰기 경로는 Playwright 자기 E2E로 검증**된다(분류 이의→R1, 롤백 보고→R2, 승인 self-approve 차단).

---

## 내 프로젝트에 적용하기

대상 레포 루트에 `qa.config.yaml`을 만든다. 코어는 도메인 지식을 모르고, 프로젝트별 차이는 전부 이 매니페스트로 주입된다.

```yaml
project: my-app

runners:
  - id: web-e2e
    adapter: playwright-ts          # 등록된 어댑터 id
    workdir: web                    # project 루트 기준 상대 경로
    command: "npx playwright test --reporter=json"
  - id: api
    adapter: pytest
    workdir: .
    command: "uv run pytest --json-report --json-report-file=.report.json"

retry:                              # 원칙 A — 코드 무변경, 일시 장애만 흡수
  maxRetries: 2
  backoffMs: 3000
  retryableErrors: [timeout, network]

budget:                             # R3 — 사이클당 상한, 초과 시 즉시 중단
  maxCostUsd: 5.0
  maxWallMs: 1800000
  maxRetries: 50
  costPerRerunUsd: 0.05

triage:                             # 원칙 B — 노이즈 격리 + 분류
  classes: [PRODUCT_BUG, TEST_BUG, FLAKY, ENV_INFRA, DATA, MODEL_API]
  flakySignals: ["timeout", "ECONNRESET", "503"]
  confidenceThreshold: 0.75         # 미만이면 자동 처리 금지 → 사람 큐

remediation:                        # ⑤ 자가 치유 — 범위별 게이트 차등
  testOnly:   { autoPr: true,  approval: 1 }
  appSource:  { autoPr: false, approval: 2, codeownersRequired: true }

governance:                         # ④ 노이즈는 릴리즈 게이트에서 제외
  releaseGateExclude: [FLAKY, ENV_INFRA]
```

새 러너(예: Cypress, go test)는 **어댑터 한 개 + CLI 레지스트리 한 줄**로 추가된다 — `RunnerAdapter` 계약(`run` + 선택 `runCase`)을 구현해 결과를 `TestResult` 정규형으로 환원하면 끝.

---

## 출력 읽는 법

```
=== my-app ===
unrecovered failures: 4  (clusters: 2)        # 재시도로 회복 안 된 실패 / 묶인 클러스터 수
  signal: 1  human(review): 1  quarantine: 0  retry: 0
release-blocking clusters: 1                  # 릴리즈를 막아야 하는 클러스터 (노이즈 제외 후)
retries used: 3  cost: $0.15  elapsed: 41.2s  # 예산 사용량
triage source: heuristic + claude
```

- **signal** = 진짜 결함 → Remediation 후보 · **human** = 저신뢰, 사람 검토 필요 · **quarantine** = 노이즈(격리) · **retry** = 일시 장애(회복 시도됨)
- `ANTHROPIC_API_KEY`가 없으면 `triage source: heuristic only` 로 동작(LLM escalation 비활성, 안전).

---

## 폴더 구조

```
qa-autopilot/
├── packages/
│   ├── shared/         # TestResult 정규형, RunnerAdapter 계약, QaConfig, Lane/TriageVerdict, spawn 유틸
│   ├── core/           # Orchestrator + Retry Lane + Budget(R3) + Signal Gate + Quarantine
│   ├── triage/         # 클러스터링 + 휴리스틱/LLM(Claude) 분류 + confidence 라우팅
│   ├── remediation/    # 범위 분류 + git worktree 회귀 증빙 + 게이트 + gh PR 포트(merge 없음)
│   ├── governance/     # append-only 감사 + 승인 평가 + 인메모리/Postgres 스토어(@qa/governance/pg)
│   ├── metrics/        # 메타 지표 + STOP 트리거(R1/R2/R4) — 과거 성과가 현재 자동화를 게이팅
│   ├── authoring/      # ① AI 테스트 케이스 생성 — 생성·중복제거·검증·리뷰 큐(자동 추가 금지)
│   └── adapters/
│       ├── playwright-ts/   # Playwright JSON → 정규형
│       └── pytest/          # pytest JSON → 정규형
├── apps/
│   ├── cli/            # `qa run` 진입점, 어댑터 레지스트리, 설정 로더
│   └── dashboard/      # Next.js 16 승인 콘솔 (governance 백엔드 소비)
├── examples/actnote/   # 첫 적용 매니페스트
├── migrations/         # Postgres 초기 스키마 (거버넌스·감사 중심)
└── docs/               # ARCHITECTURE.md, RISKS.md
```

## 성숙도 5단계 → 컴포넌트

| 단계 | 컴포넌트 | 상태 |
|---|---|---|
| ① 테스트 설계/생성 | `authoring` + `cli` | ✅ 생성(opus)·중복제거·검증·리뷰 큐 (자동 추가 금지) |
| ② 통합 실행 | `core` + `adapters/*` | ✅ 실 spawn/parse + runCase + Budget |
| ③ 1차 실패 분석 | `triage` | ✅ 휴리스틱/LLM 분류 + confidence 라우팅 |
| ④ 사람 최종 확인 | `governance` + `apps/dashboard` | ✅ 감사 + 승인 평가 + Next.js 콘솔 + Postgres 영속화 |
| ⑤ 자가 치유 | `remediation` + `cli` | ✅ signal→생성·worktree 증빙·게이트·PR→콘솔 핸드오프 |

**성숙도 5단계 전부 코드화 완료.** RISKS.md의 R1–R4 STOP 트리거도 자동화됨.

### 테스트 생성 (Phase 5 Authoring)

```bash
qa author --config <path> --spec <specs.json>   # 스펙 → 초안 → test-proposals.json
```

스펙(JSON 배열, `{id, description, targetRunner, context?}`)으로부터 `claude-opus-4-8`가 테스트 초안을 생성한다. 기존 테스트와 **중복 제거**, **격리 실행 검증**(실행 불가는 배제), 모든 초안은 **사람 리뷰 대상**으로 큐에 들어간다 — **레포에 자동 추가되지 않는다**.

## 안전 불변 (요약)

- 저신뢰 분류(confidence < 임계)는 **무조건 사람**에게.
- 노이즈는 릴리즈 게이트·Remediation·핵심 지표에서 **제외**.
- 검증(회귀 증빙 `passed`) 없는 수정은 **게이트 통과 불가**.
- 앱 소스 수정은 자동 PR **금지** + 승인 2인 + CODEOWNERS.
- **AI는 머지 권한 없음** — `PrPort`·governance 어느 포트에도 merge 메서드가 없다.

자세한 위협·완화·STOP 트리거는 [`docs/RISKS.md`](docs/RISKS.md).
