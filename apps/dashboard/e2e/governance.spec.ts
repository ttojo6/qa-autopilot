import { test, expect } from "@playwright/test";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { METRICS_FILE } from "./paths";

function resetMetrics(snapshot: unknown): void {
  mkdirSync(dirname(METRICS_FILE), { recursive: true });
  writeFileSync(METRICS_FILE, JSON.stringify(snapshot), "utf8");
}

const HEALTHY = {
  routing: { total: 100, signal: 50, human: 10, quarantine: 20, retry: 20 },
  feedback: { humanOverrides: 5, merged: 30, rolledBack: 1 },
};

test("home renders console + safety banner", async ({ page }) => {
  resetMetrics(HEALTHY);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Governance Console" })).toBeVisible();
  await expect(page.getByText("all automation enabled")).toBeVisible();
});

test("분류 이의 버튼이 override를 기록해 R1 STOP을 발동한다 (Server Action 쓰기 경로)", async ({ page }) => {
  // override 25% — 한 번 더 이의하면 26% > 25% → R1 트립
  resetMetrics({
    routing: { total: 100, signal: 50, human: 10, quarantine: 20, retry: 20 },
    feedback: { humanOverrides: 25, merged: 0, rolledBack: 0 },
  });
  await page.goto("/");
  await expect(page.getByText("all automation enabled")).toBeVisible(); // 아직 미발동

  await page.goto("/proposals/prop-1");
  await page.getByRole("button", { name: /분류 이의/ }).click();
  await page.waitForLoadState("networkidle");

  await page.goto("/");
  await expect(page.getByText("자동 라우팅 중단")).toBeVisible(); // R1 메시지
  await expect(page.getByText("all automation enabled")).toHaveCount(0);
});

test("롤백 보고 버튼이 rollback을 기록해 R2 STOP을 발동한다", async ({ page }) => {
  // merged 20, rolledBack 3 = 15% (임계 아님). 한 번 더 → 4/20 = 20% > 15% → R2 트립
  resetMetrics({
    routing: { total: 100, signal: 50, human: 10, quarantine: 20, retry: 20 },
    feedback: { humanOverrides: 0, merged: 20, rolledBack: 3 },
  });
  await page.goto("/proposals/prop-2");
  await page.getByRole("button", { name: /롤백 보고/ }).click();
  await page.waitForLoadState("networkidle");

  await page.goto("/");
  await expect(page.getByText("app_source 자동 수정 제안 중단")).toBeVisible(); // R2 메시지
});

test("승인 Server Action: 봇/작성자 self-approve는 집계 안 됨, 사람 2인이면 충족", async ({ page }) => {
  resetMetrics(HEALTHY);
  await page.goto("/proposals/prop-2"); // app_source: 2인 + codeowner 필요
  await expect(page.getByText("미충족")).toBeVisible();

  // 사람 1 (codeowner)
  await page.getByPlaceholder(/승인자 이름/).fill("alice");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "승인" }).click();
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("alice", { exact: false })).toBeVisible();
  await expect(page.getByText("미충족")).toBeVisible(); // 1/2

  // 봇(ai) — 집계 안 됨: 충족되면 안 된다
  await page.getByPlaceholder(/승인자 이름/).fill("ai");
  await page.getByRole("button", { name: "승인" }).click();
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("미충족")).toBeVisible(); // 여전히 1/2 (ai 무시)

  // 사람 2 → 충족
  await page.getByPlaceholder(/승인자 이름/).fill("bob");
  await page.getByRole("button", { name: "승인" }).click();
  await page.waitForLoadState("networkidle");
  await expect(page.getByText(/승인 충족/)).toBeVisible();
});
