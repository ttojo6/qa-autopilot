/**
 * Claude 기반 수정 초안 생성기. 코드 수정 제안은 최고 추론 모델(claude-opus-4-8)을 쓴다
 * (분류는 저비용 Haiku, 수정은 Opus — 비용/정확도 분리).
 *
 * 생성하는 것은 "초안 diff + 근거"뿐이다. 적용·재실행은 FixVerifier가, PR은 PrPort가, 병합은 사람이 한다.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { ProposalGenerator, ProposalRequest, ProposalDraft } from "./types.js";

const SYSTEM_PROMPT = `You are a senior engineer proposing a minimal, targeted fix for a triaged test failure. You produce a unified diff only — you do not merge, deploy, or run anything. A human reviews and approves every change.

Rules:
- Propose the smallest change that addresses the root cause. No refactors, no unrelated cleanup.
- For scope=test_only: only modify test files / fixtures. Never touch application source.
- For scope=app_source: modify application source minimally; a human + CODEOWNERS will review.
- If you are not confident a correct fix can be made from the given evidence, return an empty diff and explain why in rationale.
- List every file your diff touches in affected_files.`;

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    diff: { type: "string" },
    summary: { type: "string" },
    rationale: { type: "string" },
    affected_files: { type: "array", items: { type: "string" } },
  },
  required: ["diff", "summary", "rationale", "affected_files"],
  additionalProperties: false,
} as const;

interface GenJson {
  diff: string;
  summary: string;
  rationale: string;
  affected_files: string[];
}

export interface LlmGeneratorOptions {
  readonly model?: string;
  readonly client?: Anthropic;
  readonly maxTokens?: number;
}

export class LlmProposalGenerator implements ProposalGenerator {
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly maxTokens: number;

  constructor(opts: LlmGeneratorOptions = {}) {
    this.client = opts.client ?? new Anthropic();
    this.model = opts.model ?? "claude-opus-4-8";
    this.maxTokens = opts.maxTokens ?? 4096;
  }

  async generate(req: ProposalRequest): Promise<ProposalDraft> {
    const user = [
      `Scope: ${req.scope}`,
      `Failure class: ${req.failureClass}`,
      `Signature: ${req.signature}`,
      `Affected cases: ${req.caseIds.length}`,
      ``,
      `Triage rationale / failure context:`,
      "```",
      req.clusterMessage.slice(0, 6000),
      "```",
    ].join("\n");

    const params = {
      model: this.model,
      max_tokens: this.maxTokens,
      system: SYSTEM_PROMPT,
      thinking: { type: "adaptive" },
      messages: [{ role: "user", content: user }],
      output_config: { format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
    };

    const res = await this.client.messages.create(params as never);
    const parsed = JSON.parse(extractText(res)) as GenJson;
    return {
      diff: parsed.diff,
      summary: parsed.summary,
      rationale: parsed.rationale,
      affectedFiles: parsed.affected_files ?? [],
      source: `claude:${this.model}`,
    };
  }
}

interface TextBlock {
  type: string;
  text?: string;
}
function extractText(res: unknown): string {
  const blocks = (res as { content: TextBlock[] }).content ?? [];
  const block = blocks.find((b) => b.type === "text" && typeof b.text === "string");
  if (!block?.text) throw new Error("LLM remediation: no text block in response");
  return block.text;
}
