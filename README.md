# qa-autopilot

[![CI](https://github.com/ttojo6/qa-autopilot/actions/workflows/ci.yml/badge.svg)](https://github.com/ttojo6/qa-autopilot/actions/workflows/ci.yml)

**운영 자동화 중심의 QA 자동화 플랫폼.** 테스트 *실행*을 넘어 — 실패 **분류(Triage) → 노이즈 격리 → 거버넌스 승인 → 자가 치유(수정 제안) → 테스트 생성**까지 자동화한다. 범용(어댑터 플러그인) 구조라 어떤 레포에든 `qa.config.yaml` 하나로 붙는다.

> "TC를 보고, 실행하고, 실패를 찾고, 고치는" 수작업 QA를 파이프라인으로 만든다 — 단, **사람의 판단을 게이트로 유지**하면서.

---

## 핵심 아이디어

대부분의 "테스트 자동화"는 **실행**까지만 한다. 이 도구는 그 뒤의 **운영**을 자동화한다: 실패를 분류하고, 노이즈를 격리하고, 진짜 결함만 수정 제안을 만들고, 사람이 승인하면 PR을 연다. 그리고 자동화 자체의 건강도를 추적해 신뢰가 떨어지면 스스로 자동화를 끈다.

두 가지 원칙을 **슬로건이 아니라 코드 게이트**로 박았다:

1. **재시도(Retry)와 수정(Fix)의 분리** — 플레이키/인프라는 Retry Lane에서만 흡수하고 코드를 건드리지 않는다. "진짜 결함"으로 분류된 것만 Remediation Lane에 진입한다.
2. **실패 분석과 노이즈의 격리** — 모든 실패는 Signal Gate를 먼저 통과한다. 노이즈는 Quarantine으로 격리되어 릴리즈 게이트·수정 대상·핵심 지표에서 제외된다.

그리고 일관된 안전 불변: **AI는 어디서도 머지·병합·테스트 추가 권한이 없다.** 모든 변경의 최종 결정은 사람이 한다.

---

## 무엇을 하는가 (성숙도 5단계)

| 단계 | 컴포넌트 | 한 일 |
|---|---|---|
| ① 테스트 설계/생성 | `authoring` | 스펙 → 초안 생성(LLM) · 중복제거 · 격리 실행 검증 · 사람 리뷰 큐 |
| ② 통합 실행 | `core` + `adapters/*` | 러너 실행(spawn/parse) · 단일 케이스 재실행 · 비용 예산 상한 |
| ③ 1차 실패 분석 | `triage` | 서명 클러스터링 · 휴리스틱/LLM 분류 · confidence 라우팅 |
| ④ 사람 최종 확인 | `governance` + `dashboard` | 승인 평가(self-approve/CODEOWNERS/정족수) · 감사 로그 · 콘솔 |
| ⑤ 자가 치유 | `remediation` | 범위 분류 · worktree 회귀 증빙 · 게이트 · PR · 롤백 자동 감지 |

위에 더해, 자동화의 건강도를 추적하는 **메타 지표 + STOP 트리거**(`metrics`)가 과거 성과로 현재 자동화를 게이팅한다.

> 모든 LLM 경로는 포트(interface) 뒤에 격리되어 **API 키 없이도 휴리스틱/Null 폴백으로 동작·테스트**된다.

---

## 빠른 시작

### 사전 요구사항
- **Node.js 24+**, **pnpm 9** (`corepack enable pnpm`)
- (선택) `git`/`gh` — 자가 치유의 worktree 증빙·PR 생성
- (선택) `ANTHROPIC_API_KEY` — Triage LLM escalation · Remediation/Authoring 생성 (없으면 휴리스틱/Null)

### 설치 · 빌드 · 테스트
```bash
pnpm install
pnpm -r run build
pnpm -r run test       # 단위 75 + (DB 있을 때) 라이브 pg 통합
```

### 한 사이클 실행 (실행 → Triage → Remediation)
```bash
node apps/cli/dist/index.js run --config examples/demo/qa.config.yaml [--auto-pr] [--fail-on-blocking]
```
`signal`로 분류된 진짜 결함만 RemediationEngine에 들어가 수정 제안 → **git worktree 회귀 증빙** → 게이트를 거친다. `--fail-on-blocking`은 release-blocking이 있으면 **exit 2**로 CI 머지를 막는다.

### 승인 콘솔
```bash
pnpm --filter @qa/dashboard dev    # http://localhost:3000
```
AI 수정 제안과 생성된 테스트 초안을 **사람이 검토·승인**한다. 승인이 충족돼도 **병합/추가는 사람이 GitHub에서** — 콘솔에 merge 버튼은 없다.

---

## 내 프로젝트에 적용하기

대상 레포 루트에 `qa.config.yaml`을 만든다 ([`examples/demo`](examples/demo/qa.config.yaml) 참고):

```yaml
project: my-app
runners:
  - { id: web-e2e, adapter: playwright-ts, workdir: web, command: "npx playwright test --reporter=json" }
  - { id: api,     adapter: pytest,        workdir: .,   command: "uv run pytest --json-report --json-report-file=.report.json" }
retry:    { maxRetries: 2, backoffMs: 3000, retryableErrors: [timeout, network] }
budget:   { maxCostUsd: 5, maxWallMs: 1800000, maxRetries: 50, costPerRerunUsd: 0.05 }
triage:   { classes: [PRODUCT_BUG, TEST_BUG, FLAKY, ENV_INFRA, DATA, MODEL_API], flakySignals: ["timeout","503"], confidenceThreshold: 0.75 }
remediation:
  testOnly:  { autoPr: true,  approval: 1 }
  appSource: { autoPr: false, approval: 2, codeownersRequired: true }
governance: { releaseGateExclude: [FLAKY, ENV_INFRA] }
```

새 러너(Cypress, go test 등)는 **어댑터 한 개 + CLI 레지스트리 한 줄**로 추가된다 — `RunnerAdapter` 계약(`run` + 선택 `runCase`)을 구현해 결과를 `TestResult` 정규형으로 환원하면 끝. 코어는 도구별 지식을 모른다.

---

## 출력 읽는 법

```
=== my-app ===
unrecovered failures: 4  (clusters: 2)
  signal: 1  human(review): 1  quarantine: 0  retry: 0
release-blocking clusters: 1
remediation proposals: 1  [needs_human_pr:1]
metrics(cum n=120): quarantine 18%  human 9%  override 4%  rollback 2%
safety: forceHuman=false disableAppSource=false reviewFlaky=false
```
- **signal** 진짜 결함(수정 후보) · **human** 저신뢰(사람 검토) · **quarantine** 노이즈(격리) · **retry** 일시 장애
- `safety:`/`⚠ STOP` 줄은 메타 지표 STOP 트리거 발동 상태

---

## 주요 명령

```bash
qa run --config <p> [--auto-pr] [--fail-on-blocking]   # 실행→Triage→Remediation (CI 게이트)
qa author --config <p> --spec <specs.json> [--verify]  # 테스트 초안 생성→검증→리뷰 큐
qa scan-rollbacks --config <p>                          # git revert 스캔 → R2 rollback 무인 기록
qa feedback --config <p> [--override N] [--merged N] [--rolled-back N]   # 수동 피드백(폴백)
qa eval --config <p>                                    # 분류 품질 측정(라벨 데이터셋, 휴리스틱 + 키 있으면 LLM)
```

> `qa eval`은 라벨된 실패 데이터셋에 분류기를 돌려 정확도·혼동행렬을 낸다. 휴리스틱 단독은 명확한 케이스만 맞히고(약 50%, 저신뢰 ~79%) 애매한 클래스(인프라/모델API/테스트버그)에서 틀려 — **LLM escalation과 "저신뢰→사람" 설계를 숫자로 정당화**한다. `ANTHROPIC_API_KEY` 가 있으면 LLM 분류기도 같은 셋으로 평가해 정확도 Δ를 보여준다.

---

## 안전장치 (메타 지표 + STOP 트리거)

자동화 자체의 건강도를 누계로 추적해, 임계 초과 시 자동화를 단계적으로 끈다 — **과거 성과가 현재 사이클을 게이팅**한다.

| 위험 | 지표 | 임계 | 발동 시 |
|---|---|---|---|
| R1 | override rate (사람이 AI 분류를 뒤집은 비율) | > 25% | 전건 사람 큐로 강등 |
| R2 | rollback rate (병합 후 롤백) | > 15% | 앱 소스 자동 수정 중단 |
| R4 | quarantine 비율 | > 40% | flakySignals 재검토 경고 |

피드백은 **콘솔 UI 행동으로 자동 기록**된다(분류 이의·롤백 보고·승인→merged) + `qa scan-rollbacks`(git revert). 자세한 리스크·완화·STOP 트리거는 [`docs/RISKS.md`](docs/RISKS.md).

---

## CI / 운영

`.github/workflows/ci.yml` — push/PR마다 **build-test**(전체 빌드·테스트 + release-gate 데모) · **integration-postgres**(Postgres 서비스 + 라이브 pg 왕복) · **e2e-dashboard**(Playwright 자기 E2E). `--fail-on-blocking`을 branch protection의 필수 체크로 걸면 release-gate가 실제 머지 차단으로 작동한다.

GitHub 연동·시크릿·branch protection·cron 설정은 [`docs/OPERATIONS.md`](docs/OPERATIONS.md).

### Postgres 영속화 (선택)
`DATABASE_URL`이 있으면 CLI와 콘솔이 **같은 DB**를 공유한다(제안·승인·감사·메트릭). 없으면 파일/시드로 동작.
```bash
docker compose up -d
export DATABASE_URL=postgres://qa:qa@localhost:5433/qa
pnpm --filter @qa/governance db:migrate
```

---

## 폴더 구조

```
qa-autopilot/
├── packages/
│   ├── shared/       # TestResult 정규형 · RunnerAdapter 계약 · QaConfig
│   ├── core/         # Orchestrator + Retry Lane + Budget + Signal Gate + Quarantine
│   ├── triage/       # 클러스터링 + 휴리스틱/LLM 분류 + confidence 라우팅
│   ├── remediation/  # 범위 분류 + worktree 증빙 + 게이트 + PR + 롤백 감지
│   ├── governance/   # 감사 + 승인 평가 + 인메모리/Postgres 스토어
│   ├── metrics/      # 메타 지표 + STOP 트리거
│   ├── authoring/    # 테스트 생성 + 중복제거 + 검증 + 리뷰 큐
│   ├── eval/         # 분류 품질 측정 (라벨 데이터셋 + 채점기)
│   └── adapters/{playwright-ts,pytest}/
├── apps/{cli,dashboard}/
├── examples/{demo,ci-smoke}/
├── migrations/       # Postgres 스키마 (001~005)
└── docs/             # ARCHITECTURE.md · RISKS.md · OPERATIONS.md
```

---

## 안전 불변 (요약)

- 저신뢰 분류(confidence < 임계)는 **무조건 사람**에게.
- 노이즈는 릴리즈 게이트·수정·핵심 지표에서 **제외**.
- 검증(회귀 증빙 `passed`) 없는 수정은 **게이트 통과 불가**.
- 앱 소스 수정은 자동 PR **금지** + 승인 2인 + CODEOWNERS.
- **AI는 머지·병합·테스트 추가 권한이 없다** — Remediation PR·Authoring 테스트·승인 전부 사람이 최종.

---

## 기술 메모

- TypeScript(strict) 모노레포(pnpm + turbo), Node 24, Next.js 16 콘솔, Postgres(선택).
- LLM은 [Claude](https://www.anthropic.com/) (Anthropic API)를 포트 뒤에서 사용 — 분류는 저비용 모델, 수정/생성은 고성능 모델. 키 없으면 폴백.

## 라이선스

[MIT](LICENSE).
