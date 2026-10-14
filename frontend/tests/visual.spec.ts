import { expect, test } from "@playwright/test";

const UF = (process.env.PW_UF || "RJ").toUpperCase() as "RJ" | "SP";
const pages = ["/", "/autores", "/destinos", "/funcoes", "/favorecidos", "/metodologia", "/status"];

// Casos reais de cada UF: um autor, um município e um favorecido do núcleo; em SP também um
// favorecido fora do núcleo (arquivo extra).
const FIXTURES = {
  RJ: {
    autor: { id: "camara-160597", nome: "Romário" },
    municipio: { ibge: "3303302", nome: "Niterói", minPaths: 80 },
    favorecido: { slug: "11128809000110", nome: "Duque de Caxias" },
    favorecidoExtra: null as null | { slug: string; nome: string },
    bancada: "Bancada do Rio de Janeiro"
  },
  SP: {
    autor: { id: "camara-160565", nome: "Mara Gabrilli" },
    municipio: { ibge: "3509502", nome: "Campinas", minPaths: 600 },
    favorecido: { slug: "44892693000140", nome: "Carapicuiba" },
    favorecidoExtra: { slug: "46179958000192", nome: "Candido Mota" } as null | { slug: string; nome: string },
    bancada: "Bancada de São Paulo"
  }
}[UF];

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
    const [scrollHeight, viewport, scrollWidth, width] = await page.evaluate(() => [document.documentElement.scrollHeight, window.innerHeight, document.documentElement.scrollWidth, window.innerWidth]);
    expect(scrollHeight, `${path} deve caber na tela`).toBeLessThanOrEqual(viewport);
    expect(scrollWidth, `${path} não rola de lado`).toBeLessThanOrEqual(width);
  }
});

test("author permalink selects the author and loads their amendments", async ({ page }) => {
  await page.goto(`/autores?autor=${FIXTURES.autor.id}`);
  await expect(page.getByRole("listbox", { name: "Autores" }).getByRole("option", { selected: true })).toContainText(FIXTURES.autor.nome);
  await expect.poll(async () => page.locator("table.ruled tbody tr").count(), { timeout: 15_000 }).toBeGreaterThan(20);
});

test("destinations map draws the municipalities", async ({ page }) => {
  await page.goto(`/destinos?m=${FIXTURES.municipio.ibge}`);
  await expect.poll(async () => page.locator("svg[role=img] path").count(), { timeout: 15_000 }).toBeGreaterThan(FIXTURES.municipio.minPaths);
  await expect(page.getByRole("heading", { level: 2 }).or(page.locator(".panel__head")).filter({ hasText: FIXTURES.municipio.nome }).first()).toBeVisible();
});

test("favorecido payments load on demand and N toggles nominal", async ({ page }) => {
  await page.goto(`/favorecidos?f=${FIXTURES.favorecido.slug}`);
  await expect(page.getByRole("listbox", { name: "Favorecidos" }).getByRole("option", { selected: true })).toContainText(new RegExp(FIXTURES.favorecido.nome, "i"));
  await expect.poll(async () => page.locator("table.ruled tbody tr").count(), { timeout: 15_000 }).toBeGreaterThan(5);
  await expect(page.locator(".money").first()).toBeVisible();
  await page.keyboard.press("n");
  await expect(page.locator(".money")).toHaveCount(0);
});

test("favorecido outside the core opens from the extra file", async ({ page }) => {
  test.skip(!FIXTURES.favorecidoExtra, "o núcleo do RJ leva todos os favorecidos com página");
  const extra = FIXTURES.favorecidoExtra!;
  await page.goto(`/favorecidos?f=${extra.slug}`);
  await expect(page.getByRole("listbox", { name: "Favorecidos" }).getByRole("option", { selected: true })).toContainText(new RegExp(extra.nome, "i"));
  await expect.poll(async () => page.locator("table.ruled tbody tr").count(), { timeout: 15_000 }).toBeGreaterThan(0);
  await expect(page).toHaveURL(new RegExp(`f=${extra.slug}`));
});

test("hotkeys switch screens", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.keyboard.press("2");
  await expect(page).toHaveURL(/\/autores/);
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("listbox", { name: "Autores" }).getByRole("option", { selected: true })).not.toContainText(FIXTURES.bancada);
});

test("header UF switch marks the active UF and links to the other one", async ({ page }) => {
  await page.goto("/autores");
  const uf = page.getByRole("navigation", { name: "UF" });
  await expect(uf.getByRole("link", { name: UF })).toHaveAttribute("aria-current", "page");
  const other = UF === "RJ" ? "SP" : "RJ";
  await expect(uf.getByRole("link", { name: other })).not.toHaveAttribute("aria-current", "page");
  // Servido na raiz nos testes: RJ em "/", SP em "/sp/" (no ar: /emendas/ e /emendas/sp/).
  await expect(uf.getByRole("link", { name: other })).toHaveAttribute("href", other === "SP" ? "/sp/autores/" : "/autores/");
  // A UF fica à direita, colada ao botão de tema.
  const [ufBox, themeBox] = await Promise.all([uf.boundingBox(), page.getByRole("button", { name: /tema/i }).boundingBox()]);
  expect(ufBox!.x + ufBox!.width).toBeLessThanOrEqual(themeBox!.x);
  expect(themeBox!.x - (ufBox!.x + ufBox!.width)).toBeLessThan(24);
});
