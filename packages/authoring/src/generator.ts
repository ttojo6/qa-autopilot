/**
 * 테스트 초안 생성기. 코드 생성은 최고 추론 모델(claude-opus-4-8).
 * 생성하는 것은 *초안*뿐 — 레포에 쓰지 않는다(엔진/사람만이 적용 결정).
 */

import Anthropic from "@anthropic-ai/sdk";
import type { TestCaseGenerator, TestSpec, TestCaseDraft } from "./types.js";

/** 파일 추가 unified diff를 합성한다. */
export function addFileDiff(path: string, code: string): string {
  const lines = code.replace(/\n$/, "").split("\n");
  const header = `--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${lines.length} @@\n`;
  return header + lines.map((l) => `+${l}`).join("\n") + "\n";
}

/** 생성기가 없을 때의 안전 기본값 — 아무 초안도 만들지 않는다. */
export class NullTestCaseGenerator implements TestCaseGenerator {
  async generate(): Promise<TestCaseDraft[]> {
    return [];
  }
}

const SYSTEM_PROMPT = `You write a small number of high-quality, runnable test cases from a behavior spec. You only draft tests — a human reviews and approves every one before it enters the suite.

Rules:
- Generate 1-3 focused tests that directly exercise the described behavior. Do not pad.
- Each test must be self-contained and runnable by the target runner (e.g. Playwright, pytest).
- Prefer asserting observable behavior over implementation details.
- Give each test a clear, specific title (used for de-duplication).
- Do not invent application APIs you cannot infer from the spec/context; if unsure, write the test against the described behavior and note assumptions in rationale.`;

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    tests: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          file_path: { type: "string" },
          code: { type: "string" },
          rationale: { type: "string" },
        },
        required: ["title", "file_path", "code", "rationale"],
        additionalProperties: false,
      },
    },
  },
  required: ["tests"],
  additionalProperties: false,
} as const;

interface GenJson {
  tests: Array<{ title: string; file_path: string; code: string; rationale: string }>;
}

export interface LlmGeneratorOptions {
  readonly model?: string;
  readonly client?: Anthropic;
  readonly maxTokens?: number;
}

export class LlmTestCaseGenerator implements TestCaseGenerator {
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly maxTokens: number;

  constructor(opts: LlmGeneratorOptions = {}) {
    this.client = opts.client ?? new Anthropic();
    this.model = opts.model ?? "claude-opus-4-8";
    this.maxTokens = opts.maxTokens ?? 4096;
  }

  async generate(spec: TestSpec): Promise<TestCaseDraft[]> {
    const user = [
      `Target runner: ${spec.targetRunner}`,
      `Behavior to test: ${spec.description}`,
      spec.context ? `Context:\n\`\`\`\n${spec.context.slice(0, 6000)}\n\`\`\`` : "Context: (none)",
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
    return parsed.tests.map((t) => ({
      specId: spec.id,
      targetRunner: spec.targetRunner,
      title: t.title,
      filePath: t.file_path,
      code: t.code,
      diff: addFileDiff(t.file_path, t.code),
      rationale: t.rationale,
      source: `claude:${this.model}`,
    }));
  }
}

interface TextBlock {
  type: string;
  text?: string;
}
function extractText(res: unknown): string {
  const blocks = (res as { content: TextBlock[] }).content ?? [];
  const block = blocks.find((b) => b.type === "text" && typeof b.text === "string");
  if (!block?.text) throw new Error("LLM authoring: no text block in response");
  return block.text;
}
