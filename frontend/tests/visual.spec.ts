import { expect, test } from "@playwright/test";

const pages = ["/", "/autores", "/destinos", "/funcoes", "/favorecidos", "/metodologia", "/status"];

test.describe("static pages", () => {
  for (const path of pages) {
    test(`${path} renders with visible content`, async ({ page }) => {
      const consoleErrors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") {
          consoleErrors.push(message.text());
        }
      });
      await page.goto(path);
      await expect(page.locator("main")).toBeVisible();
      await expect(page.getByRole("heading", { name: /404|not found/i })).toHaveCount(0);
      const screenshot = await page.locator("main").screenshot();
      expect(screenshot.length).toBeGreaterThan(12_000);
      expect(consoleErrors).toEqual([]);
    });
  }
});

test("screens fit the viewport without page scroll", async ({ page }) => {
  for (const path of pages) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const [scrollHeight, viewport] = await page.evaluate(() => [document.documentElement.scrollHeight, window.innerHeight]);
    expect(scrollHeight, `${path} deve caber na tela`).toBeLessThanOrEqual(viewport);
  }
});

test("author permalink selects the author and loads their amendments", async ({ page }) => {
  await page.goto("/autores?autor=camara-160597");
  await expect(page.getByRole("listbox", { name: "Autores" }).getByRole("option", { selected: true })).toContainText("Romário");
  await expect.poll(async () => page.locator("table.ruled tbody tr").count(), { timeout: 15_000 }).toBeGreaterThan(20);
});

test("destinations map draws the municipalities", async ({ page }) => {
  await page.goto("/destinos?m=3303302");
  await expect.poll(async () => page.locator("svg[role=img] path").count(), { timeout: 15_000 }).toBeGreaterThan(80);
  await expect(page.getByRole("heading", { level: 2 }).or(page.locator(".panel__head")).filter({ hasText: "Niterói" }).first()).toBeVisible();
});

test("favorecido payments load on demand and N toggles nominal", async ({ page }) => {
  await page.goto("/favorecidos?f=11128809000110");
  await expect(page.getByRole("listbox", { name: "Favorecidos" }).getByRole("option", { selected: true })).toContainText("Duque de Caxias");
  await expect.poll(async () => page.locator("table.ruled tbody tr").count(), { timeout: 15_000 }).toBeGreaterThan(5);
  await expect(page.locator(".money").first()).toBeVisible();
  await page.keyboard.press("n");
  await expect(page.locator(".money")).toHaveCount(0);
});

test("hotkeys switch screens", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.keyboard.press("2");
  await expect(page).toHaveURL(/\/autores/);
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("listbox", { name: "Autores" }).getByRole("option", { selected: true })).not.toContainText("Bancada do Rio de Janeiro");
});
