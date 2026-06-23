/**
 * Remediation 실배선 — Triage의 signal 판정을 RemediationEngine에 연결한다.
 *
 * 안전 기본값:
 *  - ANTHROPIC_API_KEY 없으면 NullProposalGenerator (가짜 수정 안 만듦).
 *  - --auto-pr 없으면 prPort 미주입 → test_only도 자동 PR 안 열림(사람 대기).
 *  - 회귀 검증은 GitWorktreeVerifier가 실제 어댑터로 worktree에서 재실행(증빙 없으면 게이트 차단).
 */

import { join } from "node:path";
import {
  RemediationEngine,
  NullProposalGenerator,
  LlmProposalGenerator,
  GitWorktreeVerifier,
  GhPrPort,
  type ProposalGenerator,
  type FixVerifier,
  type PrPort,
  type RemediationProposal,
} from "@qa/remediation";
import { signatureOf } from "@qa/triage";
import type {
  TestResult,
  TriageVerdict,
  QaConfig,
  RunnerAdapter,
  AdapterContext,
} from "@qa/shared";

/** 콘솔/핸드오프용으로 failureClass를 덧붙인 제안. */
export interface EnrichedProposal extends RemediationProposal {
  readonly failureClass: string;
}

export interface RemediateDeps {
  readonly config: QaConfig;
  readonly projectRoot: string;
  readonly adapters: Record<string, RunnerAdapter>;
  readonly failures: readonly TestResult[];
  readonly verdicts: readonly TriageVerdict[];
  readonly enablePr: boolean;
  /** 테스트용 포트 오버라이드. */
  readonly overrides?: { generator?: ProposalGenerator; verifier?: FixVerifier; prPort?: PrPort };
}

export async function remediate(deps: RemediateDeps): Promise<EnrichedProposal[]> {
  const { sigToCases, caseToRunner } = buildIndexes(deps.failures);

  const generator =
    deps.overrides?.generator ??
    (process.env.ANTHROPIC_API_KEY ? new LlmProposalGenerator() : new NullProposalGenerator());

  const verifier =
    deps.overrides?.verifier ??
    new GitWorktreeVerifier({
      repoRoot: deps.projectRoot,
      runCases: (wtDir, caseIds) => rerunInWorktree(wtDir, caseIds, deps, caseToRunner),
    });

  const prPort =
    deps.overrides?.prPort ?? (deps.enablePr ? new GhPrPort({ repoRoot: deps.projectRoot }) : undefined);

  const engine = new RemediationEngine({
    generator,
    verifier,
    prPort,
    caseIdsFor: (sig) => sigToCases.get(sig) ?? [],
  });

  const out: EnrichedProposal[] = [];
  for (const v of deps.verdicts) {
    if (v.lane !== "signal") continue; // 원칙 A: signal만 Remediation 진입
    const proposal = await engine.propose(v, deps.config.remediation);
    if (proposal) out.push({ ...proposal, failureClass: v.failureClass });
  }
  return out;
}

function buildIndexes(failures: readonly TestResult[]): {
  sigToCases: Map<string, string[]>;
  caseToRunner: Map<string, string>;
} {
  const sigToCases = new Map<string, string[]>();
  const caseToRunner = new Map<string, string>();
  for (const f of failures) {
    const sig = signatureOf(f);
    const arr = sigToCases.get(sig);
    if (arr) arr.push(f.caseId);
    else sigToCases.set(sig, [f.caseId]);
    caseToRunner.set(f.caseId, f.runnerId);
  }
  return { sigToCases, caseToRunner };
}

/** worktree 디렉터리에서 영향 케이스를 해당 어댑터로 재실행. */
async function rerunInWorktree(
  wtDir: string,
  caseIds: readonly string[],
  deps: RemediateDeps,
  caseToRunner: Map<string, string>
): Promise<TestResult[]> {
  const out: TestResult[] = [];
  for (const caseId of caseIds) {
    const runnerId = caseToRunner.get(caseId);
    const runner = deps.config.runners.find((r) => r.id === runnerId);
    if (!runner) continue;
    const adapter = deps.adapters[runner.adapter];
    if (!adapter?.runCase) continue;
    const ctx: AdapterContext = {
      projectRoot: wtDir, // 워크트리 기준으로 실행 → 작업 트리 오염 없음
      artifactDir: join(wtDir, ".qa-artifacts"),
      logger: () => undefined,
    };
    const r = await adapter.runCase(runner, caseId, ctx);
    if (r) out.push(r);
  }
  return out;
}
