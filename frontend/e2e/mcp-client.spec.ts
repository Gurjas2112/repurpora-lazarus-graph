/**
 * Agent as MCP client: opt in to an admin-approved external MCP server from the chat Tools menu, then run research.
 *   E2E_USER_EMAIL=... E2E_USER_PASSWORD=... npx playwright test e2e/mcp-client.spec.ts
 */
import { test, expect, Page } from "@playwright/test";
import path from "node:path";

const OUT = path.resolve(process.cwd(), "../app_screenshots_screen_recording");
let step = 33;
async function shot(page: Page, name: string, fullPage = false) {
  step += 1;
  await page.screenshot({ path: path.join(OUT, `${String(step).padStart(2, "0")}_${name}.png`), fullPage });
}

test("research run using an external MCP server", async ({ page }) => {
  await page.goto("/login?next=/chat");
  await page.getByLabel("Work email").fill(process.env.E2E_USER_EMAIL!);
  await page.getByLabel("Password").fill(process.env.E2E_USER_PASSWORD!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/chat/, { timeout: 60_000 });
  await page.evaluate(() => window.localStorage.removeItem("repurpora:mcp_servers"));

  await page.getByTestId("mcp-tools-picker").click();
  await expect(page.getByTestId("mcp-tools-panel")).toBeVisible();
  await expect(page.getByTestId("mcp-server-1")).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(800);
  await shot(page, "chat_tools_menu_approved_mcp_servers");
  await page.getByTestId("mcp-server-1").click();
  await page.waitForTimeout(600);
  await shot(page, "chat_tools_mcp_server_enabled");
  await page.keyboard.press("Escape");
  await page.mouse.click(10, 400);

  const box = page.getByPlaceholder(/Ask about a molecule/);
  await box.click();
  await box.pressSequentially("Assess colchicine repurposing for cardiovascular prevention in India", { delay: 15 });
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText(/External MCP tools/)).toBeVisible({ timeout: 120_000 });
  await page.waitForTimeout(1000);
  await shot(page, "chat_plan_includes_external_mcp_agent");
  await expect(page.getByText(/Quality gates/)).toBeVisible({ timeout: 10 * 60_000 });
  await page.getByRole("heading", { name: /External Tool Findings/i }).first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  await shot(page, "chat_brief_external_mcp_findings_cited");
  await page.getByText("External MCP tool calls").first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  await shot(page, "chat_mcp_tool_calls_and_external_evidence");
});
