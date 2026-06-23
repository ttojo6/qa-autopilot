import type { RunReport, TestResult } from "./test-result.js";
import type { RunnerConfig } from "./config.js";

/**
 * RunnerAdapter — 러너별 플러그인이 구현하는 계약.
 * 범용성의 핵심: 코어는 이 인터페이스만 알고, 도구별 지식은 어댑터 안에 가둔다.
 *
 * 생명주기: discover() → run() → normalize() 는 어댑터 내부에서 합쳐져
 * 최종적으로 RunReport(정규형)만 코어에 반환한다.
 */
export interface RunnerAdapter {
  /** 매니페스트의 adapter 필드와 일치하는 식별자 (예: "playwright-ts", "pytest"). */
  readonly adapterId: string;

  /**
   * 설정대로 테스트를 실행하고 결과를 정규형으로 반환한다.
   * 어댑터는 절대 코드를 수정하지 않는다. 실행과 정규화만 담당한다.
   */
  run(config: RunnerConfig, ctx: AdapterContext): Promise<RunReport>;

  /**
   * 단일 케이스만 재실행한다 (Retry Lane용). 도구가 케이스 필터를 지원할 때만 구현.
   * 미구현(undefined) 시 해당 러너의 Retry Lane은 건너뛴다.
   */
  runCase?(config: RunnerConfig, caseId: string, ctx: AdapterContext): Promise<TestResult | undefined>;
}

export interface AdapterContext {
  /** 대상 레포 루트의 절대 경로. workdir은 이 기준으로 해석한다. */
  readonly projectRoot: string;
  /** 아티팩트(스크린샷/트레이스 등)를 저장할 디렉터리. */
  readonly artifactDir: string;
  readonly logger: (msg: string) => void;
}

export type AdapterFactory = () => RunnerAdapter;
