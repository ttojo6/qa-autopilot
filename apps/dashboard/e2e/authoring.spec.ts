import { test, expect } from "@playwright/test";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { TEST_PROPOSALS_FILE } from "./paths";

function resetProposals(items: unknown): void {
  mkdirSync(dirname(TEST_PROPOSALS_FILE), { recursive: true });
  writeFileSync(TEST_PROPOSALS_FILE, JSON.stringify(items), "utf8");
}

const pending = {
  id: "tp-e2e1",
  specId: "s1",
  title: "login shows error on invalid creds",
  targetRunner: "playwright-ts",
  filePath: "web/tests/login.spec.ts",
  diff: "--- /dev/null\n+++ b/web/tests/login.spec.ts\n@@ -0,0 +1,1 @@\n+test('x', () => {})\n",
  code: "test('x', () => {})",
  rationale: "covers invalid-credential error",
  verifyOutcome: "runs_passes",
  verifyEvidence: "ran and passed",
  status: "pending_review",
  decision: "pending",
  createdAt: "2026-06-24T00:00:00Z",
};

test("authoring queue lists proposals and links from home", async ({ page }) => {
  resetProposals([pending]);
  await page.goto("/");
  await page.getByRole("link", { name: /Authoring 리뷰 큐/ }).click();
  await expect(page.getByRole("heading", { name: "Authoring 리뷰 큐" })).toBeVisible();
  await expect(page.getByText("login shows error on invalid creds")).toBeVisible();
});

test("승인 Server Action: pending_review 초안을 승인하면 approved로 전이 (쓰기 경로)", async ({ page }) => {
  resetProposals([pending]);
  await page.goto("/authoring/tp-e2e1");
  await expect(page.getByRole("button", { name: /승인/ })).toBeVisible();

  await page.getByRole("button", { name: /승인/ }).click();
  await page.waitForLoadState("networkidle");

  // 승인 후: 리뷰 버튼 사라지고 approved 표시
  await expect(page.getByText(/이미 approved 됨/)).toBeVisible();
  await expect(page.getByRole("button", { name: /^승인/ })).toHaveCount(0);
});

test("rejected_error 초안은 리뷰 불가", async ({ page }) => {
  resetProposals([{ ...pending, id: "tp-e2e2", status: "rejected_error", verifyOutcome: "errors", verifyEvidence: "import error" }]);
  await page.goto("/authoring/tp-e2e2");
  await expect(page.getByText(/리뷰 대상이 아니다/)).toBeVisible();
  await expect(page.getByRole("button", { name: /^승인/ })).toHaveCount(0);
});
