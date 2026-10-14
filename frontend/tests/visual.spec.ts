import { expect, test } from "@playwright/test";

// Um build, 27 UFs: RJ na raiz, as demais em /<uf>/. As telas rodam para uma amostra de UFs
// (a maior, a menor, o DF sem municípios); os casos de permalink usam ids reais de RJ e SP.
const screens = ["/", "/autores", "/votacoes", "/presenca", "/destinos", "/funcoes", "/favorecidos", "/metodologia", "/status"];
const SAMPLE = ["", "/sp", "/mg", "/df", "/am", "/ba", "/rr"];
const at = (prefix: string, screen: string) => `${prefix}${screen === "/" ? "/" : screen}`;

const CASES = [
  {
    prefix: "",
    autor: { id: "camara-160597", nome: "Romário" },
    municipio: { ibge: "3303302", nome: "Niterói", minPaths: 80 },
    favorecido: { slug: "11128809000110", nome: "Duque de Caxias" },
    bancada: "Bancada do Rio de Janeiro"
  },
  {
    prefix: "/sp",
    autor: { id: "camara-160565", nome: "Mara Gabrilli" },
    municipio: { ibge: "3509502", nome: "Campinas", minPaths: 600 },
    favorecido: { slug: "44892693000140", nome: "Carapicuiba" },
    bancada: "Bancada de São Paulo"
  }
];

test.describe("static pages", () => {
  for (const prefix of ["", "/sp", "/mg", "/df"]) {
    for (const screen of prefix === "/mg" ? ["/votacoes", "/presenca", "/autores"] : screens) {
      test(`${at(prefix, screen)} renders with visible content`, async ({ page }) => {
        const consoleErrors: string[] = [];
        page.on("console", (message) => {
          if (message.type() === "error") {
            consoleErrors.push(message.text());
          }
        });
        await page.goto(at(prefix, screen));
        await expect(page.locator("main")).toBeVisible();
        await expect(page.getByText("CARREGANDO", { exact: true })).toHaveCount(0);
        await expect(page.getByText(/DADOS INDISPONÍVEIS/)).toHaveCount(0);
        await expect(page.getByRole("heading", { name: /404|not found/i })).toHaveCount(0);
        const screenshot = await page.locator("main").screenshot();
        expect(screenshot.length).toBeGreaterThan(12_000);
        expect(consoleErrors).toEqual([]);
      });
    }
  }
});

test("screens fit the viewport without page scroll", async ({ page }) => {
  test.setTimeout(120_000);
  for (const prefix of SAMPLE) {
    for (const screen of screens) {
      await page.goto(at(prefix, screen));
      await page.waitForLoadState("networkidle");
      await expect(page.getByText("CARREGANDO", { exact: true })).toHaveCount(0);
      const [scrollHeight, viewport, scrollWidth, width] = await page.evaluate(() => [document.documentElement.scrollHeight, window.innerHeight, document.documentElement.scrollWidth, window.innerWidth]);
      expect(scrollHeight, `${at(prefix, screen)} deve caber na tela`).toBeLessThanOrEqual(viewport);
      expect(scrollWidth, `${at(prefix, screen)} não rola de lado`).toBeLessThanOrEqual(width);
    }
  }
});

for (const c of CASES) {
  test(`${c.prefix || "/"}: author permalink selects the author and loads their amendments`, async ({ page }) => {
    await page.goto(`${c.prefix}/autores?autor=${c.autor.id}`);
    await expect(page.getByRole("listbox", { name: "Autores" }).getByRole("option", { selected: true })).toContainText(c.autor.nome);
    await expect.poll(async () => page.locator("table.ruled tbody tr").count(), { timeout: 15_000 }).toBeGreaterThan(20);
  });

  test(`${c.prefix || "/"}: destinations map draws the municipalities`, async ({ page }) => {
    await page.goto(`${c.prefix}/destinos?m=${c.municipio.ibge}`);
    await expect.poll(async () => page.locator("svg[role=img] path").count(), { timeout: 15_000 }).toBeGreaterThan(c.municipio.minPaths);
    await expect(page.locator(".panel__head").filter({ hasText: c.municipio.nome }).first()).toBeVisible();
  });

  test(`${c.prefix || "/"}: favorecido payments load on demand and N toggles nominal`, async ({ page }) => {
    await page.goto(`${c.prefix}/favorecidos?f=${c.favorecido.slug}`);
    await expect(page.getByRole("listbox", { name: "Favorecidos" }).getByRole("option", { selected: true })).toContainText(new RegExp(c.favorecido.nome, "i"));
    await expect.poll(async () => page.locator("table.ruled tbody tr").count(), { timeout: 15_000 }).toBeGreaterThan(5);
    await expect(page.locator(".money").first()).toBeVisible();
    await page.keyboard.press("n");
    await expect(page.locator(".money")).toHaveCount(0);
  });

  test(`${c.prefix || "/"}: hotkeys switch screens inside the UF`, async ({ page }) => {
    await page.goto(`${c.prefix}/`);
    await page.waitForLoadState("networkidle");
    await page.keyboard.press("2");
    await expect(page).toHaveURL(new RegExp(`${c.prefix}/autores`));
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("listbox", { name: "Autores" }).getByRole("option", { selected: true })).not.toContainText(c.bancada);
  });
}

// Votações e presença: as mesmas telas em RJ, SP, MG e DF; votações comuns, votos filtrados pela UF.
for (const prefix of ["", "/sp", "/mg", "/df"]) {
  test(`${prefix || "/"}: votações list the votes of the UF's bancada`, async ({ page }) => {
    await page.goto(`${prefix}/votacoes`);
    const list = page.getByRole("listbox", { name: "Votações" });
    await expect.poll(async () => list.getByRole("option").count(), { timeout: 15_000 }).toBeGreaterThan(50);
    await expect(list.getByRole("option", { selected: true })).toBeVisible();
    await expect.poll(async () => page.locator(".votegrid li").count(), { timeout: 15_000 }).toBeGreaterThan(0);
    await expect.poll(async () => page.locator("table.ruled tbody tr").count(), { timeout: 15_000 }).toBeGreaterThan(3);
    await page.getByRole("combobox", { name: "Casa" }).selectOption("senado");
    await expect(list.getByRole("option").first()).toContainText("Sen.");
    await list.getByRole("option").first().click();
    await expect(page).toHaveURL(/v=s%3A/);
    // senadores da UF: três por vez, mais suplentes; a coluna de quem não votou pode ficar vazia
    await expect.poll(async () => page.locator(".votegrid li").count(), { timeout: 15_000 }).toBeGreaterThan(1);
  });

  test(`${prefix || "/"}: presença shows a month grid per parlamentar`, async ({ page }) => {
    await page.goto(`${prefix}/presenca`);
    const rows = page.locator("table.ruled tbody tr");
    await expect.poll(async () => rows.count(), { timeout: 15_000 }).toBeGreaterThan(5);
    await expect(page.locator("table.ruled thead th").filter({ hasText: /^jan$/ })).toHaveCount(1);
    await page.getByRole("combobox", { name: "Ano" }).selectOption("all");
    await expect(page.locator("table.ruled thead th").filter({ hasText: /^2015$/ })).toHaveCount(1);
    await page.getByRole("combobox", { name: "Casa" }).selectOption("senado");
    await expect.poll(async () => rows.count()).toBeGreaterThan(2);
    const first = (await rows.first().locator("td").first().innerText()).trim();
    await page.getByRole("searchbox", { name: "Buscar parlamentar" }).fill(first.split(" ")[0]);
    await expect.poll(async () => rows.count()).toBeGreaterThan(0);
    await expect(rows.first()).toContainText(first.split(" ")[0]);
  });
}

for (const c of [
  { prefix: "", id: "camara-160597", nome: "Romário", bancada: "bancada-rj" },
  { prefix: "/sp", id: "camara-160565", nome: "Mara Gabrilli", bancada: "bancada-sp" }
]) {
  test(`${c.prefix || "/"}: the author panel shows votes and absences; the bancada has none`, async ({ page }) => {
    await page.goto(`${c.prefix}/autores?autor=${c.id}`);
    await expect(page.getByRole("listbox", { name: "Autores" }).getByRole("option", { selected: true })).toContainText(c.nome);
    await expect(page.locator(".stat").filter({ hasText: "Participação" })).toContainText("%");
    await page.getByRole("button", { name: "Votos", exact: true }).click();
    await expect.poll(async () => page.locator("table.ruled tbody tr").count(), { timeout: 15_000 }).toBeGreaterThan(100);
    await expect(page.locator("table.ruled tbody tr").first()).toContainText(/Câm\.|Sen\./);
    await page.getByRole("combobox", { name: "Filtro de votos" }).selectOption("maioria");
    await expect.poll(async () => page.locator("table.ruled tbody tr").count()).toBeGreaterThan(0);
    await page.keyboard.press("v");
    await expect(page.locator(".monthgrid")).toBeVisible();
    await page.goto(`${c.prefix}/autores?autor=${c.bancada}`);
    await expect(page.getByRole("button", { name: "Votos", exact: true })).toBeDisabled();
    await expect(page.locator(".stat").filter({ hasText: "Participação" })).toContainText("–");
  });
}

test("favorecido outside the core opens from the extra file", async ({ page }) => {
  await page.goto("/sp/favorecidos?f=46179958000192");
  await expect(page.getByRole("listbox", { name: "Favorecidos" }).getByRole("option", { selected: true })).toContainText(/Candido Mota/i);
  await expect.poll(async () => page.locator("table.ruled tbody tr").count(), { timeout: 15_000 }).toBeGreaterThan(0);
  await expect(page).toHaveURL(/f=46179958000192/);
});

test("UF select sits left of the theme button, keeps the screen, and U steps to the next UF", async ({ page }) => {
  await page.goto("/funcoes");
  const select = page.getByRole("combobox", { name: "UF" });
  await expect(select).toHaveValue("RJ");
  await expect(select.locator("option")).toHaveCount(27);
  const [ufBox, themeBox] = await Promise.all([select.boundingBox(), page.getByRole("button", { name: /tema/i }).boundingBox()]);
  expect(ufBox!.x + ufBox!.width).toBeLessThanOrEqual(themeBox!.x);
  expect(themeBox!.x - (ufBox!.x + ufBox!.width)).toBeLessThan(24);
  await select.selectOption("MG");
  await expect(page).toHaveURL(/\/mg\/funcoes\/?$/);
  await expect(page.getByText("Bancada de Minas Gerais").first()).toBeVisible();
  await page.keyboard.press("u");
  await expect(page).toHaveURL(/\/pa\/funcoes\/?$/);
  await expect(page.getByRole("combobox", { name: "UF" })).toHaveValue("PA");
  await expect(page).toHaveURL(/\/pa\/funcoes\/\?f=/);
  await page.waitForLoadState("networkidle");
  await page.keyboard.press("1");
  await expect(page).toHaveURL(/\/pa\/?$/);
});
