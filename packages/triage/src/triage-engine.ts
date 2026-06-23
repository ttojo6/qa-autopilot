/**
 * TriageEngine — ③ 1차 실패 분석의 오케스트레이터.
 *
 * 흐름: 실패 → 클러스터링 → (휴리스틱 1차) → 애매하면 LLM escalation → 라우팅(레인 결정).
 *
 * 설계 원칙:
 *  - 휴리스틱이 충분히 확신하면 LLM을 부르지 않는다 (비용 절감 + 결정론).
 *  - escalation 후에도 confidence가 임계 미만이면 lane="human" (R1: 오버트러스트 방어).
 *  - representativeMessage는 LLM에 보내기 전 maskPII로 정화한다 (R8).
 */

import type { TestResult, TriageVerdict, TriageConfig, RawErrorType } from "@qa/shared";
import { clusterFailures } from "./cluster.js";
import { signatureOf } from "./signature.js";
import { routeClassification } from "./routing.js";
import { HeuristicClassifier } from "./heuristic-classifier.js";
import type { Classifier, ClusterHistory, ClassificationInput } from "./classifier.js";

const RETRYABLE_RAW: ReadonlySet<string> = new Set(["timeout", "network"]);

export interface TriageEngineDeps {
  /** 1차 분류기. 기본 HeuristicClassifier. */
  readonly heuristic?: Classifier;
  /** escalation용 LLM 분류기. 없으면 escalation 생략(휴리스틱 결과만 사용). */
  readonly llm?: Classifier;
  /** 서명별 과거 이력 제공 (flaky 판단 신뢰도↑). 없으면 이력 미사용. */
  readonly historyFor?: (signature: string) => ClusterHistory | undefined;
  /** LLM 전송 전 PII/시크릿 마스킹. 기본 항등(주의: 운영에서는 반드시 구현). */
  readonly maskPII?: (text: string) => string;
}

export interface TriageEngineOptions {
  /**
   * 휴리스틱 confidence가 이 값 미만이면 LLM으로 escalation.
   * (충분히 확신하는 휴리스틱 결과는 그대로 채택해 비용 절감.)
   */
  readonly escalateBelow?: number;
}

export class TriageEngine {
  private readonly heuristic: Classifier;
  private readonly llm?: Classifier;
  private readonly historyFor: (sig: string) => ClusterHistory | undefined;
  private readonly maskPII: (text: string) => string;
  private readonly escalateBelow: number;

  constructor(deps: TriageEngineDeps = {}, opts: TriageEngineOptions = {}) {
    this.heuristic = deps.heuristic ?? new HeuristicClassifier();
    this.llm = deps.llm;
    this.historyFor = deps.historyFor ?? (() => undefined);
    this.maskPII = deps.maskPII ?? ((t) => t);
    this.escalateBelow = opts.escalateBelow ?? 0.7;
  }

  /** 한 번의 실행 결과를 분류·라우팅한다. */
  async triage(results: readonly TestResult[], config: TriageConfig): Promise<TriageVerdict[]> {
    const clusters = clusterFailures(results);
    const rawTypeBySig = indexRawType(results);
    const verdicts: TriageVerdict[] = [];

    for (const cluster of clusters) {
      const rawErrorType = rawTypeBySig.get(cluster.signature) ?? "unknown";
      const input: ClassificationInput = {
        cluster: { ...cluster, representativeMessage: this.maskPII(cluster.representativeMessage) },
        rawErrorType,
        flakySignals: config.flakySignals,
        history: this.historyFor(cluster.signature),
      };

      let classification = await this.heuristic.classify(input);

      // 휴리스틱이 애매하고 LLM이 있으면 escalation.
      if (classification.confidence < this.escalateBelow && this.llm) {
        try {
          classification = await this.llm.classify(input);
        } catch {
          // LLM 실패는 치명적이지 않다 — 휴리스틱 결과를 유지하되 사람에게 갈 만큼 낮은 신뢰.
          classification = { ...classification, rationale: `${classification.rationale} (llm escalation failed)` };
        }
      }

      verdicts.push(
        routeClassification(cluster.signature, classification, {
          confidenceThreshold: config.confidenceThreshold,
          retryEligible: RETRYABLE_RAW.has(rawErrorType),
        })
      );
    }

    return verdicts;
  }
}

/** 서명 → 대표 rawErrorType 매핑 (클러스터당 첫 실패의 타입). cluster.ts와 같은 서명 키 사용. */
function indexRawType(results: readonly TestResult[]): Map<string, RawErrorType> {
  const map = new Map<string, RawErrorType>();
  for (const r of results) {
    if (r.status === "passed" || r.status === "skipped") continue;
    const key = signatureOf(r);
    if (!map.has(key)) map.set(key, r.error?.type ?? "unknown");
  }
  return map;
}
