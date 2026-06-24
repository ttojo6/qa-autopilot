import { defineConfig, devices } from "@playwright/test";
import { METRICS_FILE, PROPOSALS_FILE } from "./e2e/paths";

const PORT = 3990;

/**
 * 콘솔 자기 E2E — Server Action 쓰기 경로(승인/분류 이의/롤백)를 실제 브라우저로 검증한다.
 * webServer는 `next start`를 메모리 백엔드(파일 모드)로 띄우고, 테스트와 같은 메트릭 파일을 공유한다.
 * 서버 내부 상태(승인)는 워커 간 공유되므로 직렬(workers:1) 실행.
 */
export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  fullyParallel: false,
  reporter: process.env.CI ? "list" : [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: `node node_modules/next/dist/bin/next start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    env: {
      QA_METRICS_FILE: METRICS_FILE,
      QA_PROPOSALS_FILE: PROPOSALS_FILE,
    },
  },
});
