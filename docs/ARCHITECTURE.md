# Architecture

## 한 줄 정의

테스트 **실행**을 넘어, 실패의 **분류 → 노이즈 격리 → 거버넌스 승인 → 자가 치유(수정 제안)**까지를 자동화하는 운영형 QA 플랫폼. 범용(어댑터 플러그인) 구조이며 Actnote를 첫 적용 케이스로 삼는다.

## 두 개의 불변 원칙 (코드 게이트)

### 원칙 A — 재시도(Retry)와 수정(Fix)의 분리
- Retry Lane(`packages/core/src/lanes/retry-lane.ts`)은 **코드를 절대 수정하지 않는다.** 횟수·백오프·대상 에러 타입만으로 일시 장애를 흡수한다.
- Remediation Lane은 Triage가 `is_real_defect && confidence ≥ θ`로 판정한 실패만 받는다.
- **강제 방식:** 두 레인은 별도 큐다. Retry는 수정 제안을 만들 권한 자체가 없다.

### 원칙 B — 실패 분석과 노이즈의 격리
- 모든 실패는 Signal Gate(`packages/core/src/lanes/signal-gate.ts`)를 먼저 통과한다.
- 노이즈(flaky/infra)는 Quarantine으로 격리되어 ① 릴리즈 게이트 지표 ② Remediation 대상 ③ 핵심 추세에서 제외된다.
- confidence가 임계값 미만이면 자동 처리 금지 → Human Triage Queue.

## 데이터 흐름

```
runners(adapters) ──► RunReport(정규형) ──► Signal Gate ──┬─► quarantine (노이즈)
                                                          ├─► retry lane (일시 장애)
                                                          ├─► human queue (저신뢰)
                                                          └─► signal ──► Triage(AI) ──► Governance ──► Remediation
```

## 정규형이 핵심

도구별 결과(Playwright JSON, pytest JSON, …)는 어댑터가 **`TestResult`**(`packages/shared/src/test-result.ts`) 하나로 환원한다. 코어·Triage·Remediation은 이 타입만 알기 때문에 새 러너 추가가 "어댑터 한 개 + 레지스트리 한 줄"로 끝난다.

- `RawErrorType` = 어댑터가 기계적으로 채우는 **저수준** 신호.
- `FailureClass` = Triage(AI)가 판정하는 **고수준** 근본원인 결론.
- 둘을 분리해 "기계 신호"와 "AI 판단"이 섞이지 않게 한다.

## 패키지 구성

| 패키지 | 책임 |
|---|---|
| `@qa/shared` | `TestResult` 정규형, `RunnerAdapter` 계약, `QaConfig` 스키마, `Lane`/`TriageVerdict`, spawn 유틸 |
| `@qa/core` | Orchestrator + Retry Lane + **Budget(R3)** + Signal Gate(2단계) + Quarantine(TTL 재평가) |
| `@qa/adapter-playwright-ts` | Playwright JSON → 정규형 (실 spawn/parse + `runCase`) |
| `@qa/adapter-pytest` | pytest JSON → 정규형 (실 spawn/parse + `runCase`) |
| `@qa/triage` | 클러스터링 + 휴리스틱/LLM(Claude) 분류 + confidence 라우팅 |
| `@qa/remediation` | 수정 범위 분류 + git worktree 회귀 증빙(`FixVerifier`) + 거버넌스 게이트 + gh PR 포트(merge 없음) |
| `@qa/governance` | append-only 감사(`AuditLog`) + 승인 평가(self-approve/codeowners/정족수) + 인메모리/Postgres 스토어(`@qa/governance/pg`, `Queryable` 포트) |
| `@qa/metrics` | 메타 지표 + STOP 트리거(R1/R2/R4) + 공유 스토어(File/Pg) |
| `@qa/authoring` | ① 테스트 생성(opus) + 중복제거 + worktree 검증 + 리뷰 큐 스토어(File/Pg) — 자동 추가 금지 |
| `@qa/cli` | `qa run` 진입점, 어댑터 레지스트리, 설정 로더, Triage 조합 |
| (예정) `apps/dashboard` | Next.js 승인 콘솔 (governance 백엔드 소비) |

### Remediation 안전 체인 (R2/R7)

```
verdict(signal) → scopeFor → LlmProposalGenerator(opus) → GitWorktreeVerifier(격리 적용→재실행)
   → gate(증빙 passed 필수 + app_source 자동PR 금지) → GhPrPort.createPr (merge 없음)
   → evaluateApprovals (self-approve/봇승인 차단, codeowners, 정족수) → 사람이 GitHub에서 병합
```
AI는 이 체인 어디에도 병합 권한이 없다 — `PrPort`·governance 어느 포트에도 merge 메서드가 존재하지 않는다.

### 모델 분리 (비용/정확도)

- **분류(Triage)**: `claude-haiku-4-5` — 저비용·고빈도. 휴리스틱이 애매할 때만 escalation.
- **수정 제안(Remediation)**: `claude-opus-4-8` + adaptive thinking — 정확도 우선. 구조화 출력(JSON Schema)으로 diff 강제.
- 둘 다 포트(interface) 뒤에 격리 → 키 없이 휴리스틱/Null 포트로 동작·테스트.

## 자가 치유 안전장치 (앱 소스 수정 허용 시)

1. **수정 범위 분류 먼저:** `test_only`(셀렉터/대기/픽스처) vs `app_source`(실제 결함).
2. **게이트 차등:** test_only는 자동 PR + 승인 1인. app_source는 자동 PR 금지 + 승인 2인 + CODEOWNERS.
3. **AI는 머지 권한 없음:** PR 생성 + 회귀 재실행 증빙 첨부까지만. 병합은 항상 사람.
4. **검증 없는 수정 불가:** 제안 diff로 회귀 재실행해 통과 증빙이 붙어야 게이트 통과.

## Phase 로드맵 (전 단계 완료)

- **Phase 0 ✅:** 골격 — 정규형·어댑터 계약·Signal Gate.
- **Phase 1 ✅:** 어댑터 실동작(spawn/parse·runCase) + Retry Lane + Budget(R3) + Quarantine TTL 재평가.
- **Phase 2 ✅:** AI Triage(휴리스틱/LLM 분류·클러스터링·confidence·Human Queue).
- **Phase 3 ✅:** Governance Console(승인 평가·audit·Next.js 대시보드·Postgres).
- **Phase 4 ✅:** Remediation(범위 분류·worktree 증빙·게이트·gh PR·롤백 자동 감지).
- **Phase 5 ✅:** Authoring(opus 생성·중복제거·검증·리뷰 큐).
- **운영화 ✅:** release-gate exit code + GitHub Actions(빌드/pg/E2E) + 메타 지표/STOP 트리거 + 자기 E2E.

> ⑤ 자동 수정을 의도적으로 맨 뒤(④ 거버넌스 후)에 켰다 — 분류·격리·거버넌스로 신뢰를 쌓기 전에 자동 수정을 켜면 노이즈를 코드로 증폭시킨다. 영속화·메타 지표 STOP 트리거가 신뢰의 근거를 제공한다.
