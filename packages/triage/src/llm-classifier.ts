/**
 * Claude 기반 분류기. 휴리스틱이 애매할 때만 호출되는 escalation 경로.
 *
 * 모델 선택: 기본 claude-haiku-4-5 (저비용·고빈도 분류). 어려운 케이스만 opus로 올리고 싶으면
 * 생성 시 model을 바꾼다. 구조화 출력(output_config.format)으로 JSON 스키마를 강제한다.
 *
 * 비용/PII 주의(R8): representativeMessage는 호출 전에 마스킹되어 있어야 한다(엔진 책임).
 */

import Anthropic from "@anthropic-ai/sdk";
import type { Classifier, ClassificationInput, Classification } from "./classifier.js";
import {
  TRIAGE_SYSTEM_PROMPT,
  TRIAGE_OUTPUT_SCHEMA,
  buildUserPrompt,
  type TriageJsonOutput,
} from "./prompts.js";

export interface LlmClassifierOptions {
  /** 분류 모델. 기본 저비용 Haiku. 정밀이 필요하면 "claude-opus-4-8". */
  readonly model?: string;
  readonly client?: Anthropic;
  readonly maxTokens?: number;
}

export class LlmClassifier implements Classifier {
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly maxTokens: number;

  constructor(opts: LlmClassifierOptions = {}) {
    this.client = opts.client ?? new Anthropic(); // ANTHROPIC_API_KEY from env
    this.model = opts.model ?? "claude-haiku-4-5";
    this.maxTokens = opts.maxTokens ?? 512;
  }

  async classify(input: ClassificationInput): Promise<Classification> {
    const user = buildUserPrompt({
      rawErrorType: input.rawErrorType,
      representativeMessage: input.cluster.representativeMessage,
      occurrences: input.cluster.occurrences,
      flakySignals: input.flakySignals,
      recentPasses: input.history?.recentPasses,
      recentFailures: input.history?.recentFailures,
    });

    // output_config 는 최신 API 파라미터라 SDK 타입에 없을 수 있어 호출 경계에서만 캐스팅.
    const params = {
      model: this.model,
      max_tokens: this.maxTokens,
      system: TRIAGE_SYSTEM_PROMPT,
      messages: [{ role: "user", content: user }],
      output_config: { format: { type: "json_schema", schema: TRIAGE_OUTPUT_SCHEMA } },
    };

    const res = await this.client.messages.create(params as never);
    const text = extractText(res);
    const parsed = JSON.parse(text) as TriageJsonOutput;

    return {
      failureClass: parsed.failure_class as Classification["failureClass"],
      confidence: clamp01(parsed.confidence),
      rationale: parsed.rationale,
      source: `claude:${this.model}`,
    };
  }
}

interface TextBlock {
  type: string;
  text?: string;
}
interface MessageLike {
  content: TextBlock[];
}

function extractText(res: unknown): string {
  const msg = res as MessageLike;
  const block = msg.content?.find((b) => b.type === "text" && typeof b.text === "string");
  if (!block?.text) throw new Error("LLM triage: no text block in response");
  return block.text;
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
