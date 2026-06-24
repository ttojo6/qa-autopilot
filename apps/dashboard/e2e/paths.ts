import { join } from "node:path";

/** E2E webServer와 테스트가 공유하는 경로. 둘 다 같은 메트릭 파일을 보게 한다. */
export const WORK_DIR = join(__dirname, ".work");
export const METRICS_FILE = join(WORK_DIR, "metrics.json");
export const PROPOSALS_FILE = join(__dirname, "fixtures", "proposals.json");
