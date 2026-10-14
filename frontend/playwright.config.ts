import { defineConfig, devices } from "@playwright/test";

// Uma UF por rodada: `npm run test:visual` roda RJ e depois SP (PW_UF=SP). Cada UF tem build e
// porta próprios, na raiz (NEXT_PUBLIC_BASE_PATH vazio); o deploy usa /emendas e /emendas/sp.
const uf = (process.env.PW_UF || "RJ").toUpperCase();
const port = uf === "SP" ? 4174 : 4173;
const outDir = `out-test-${uf.toLowerCase()}`;

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  expect: {
    timeout: 10_000
  },
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure"
  },
  webServer: {
    command: `NEXT_PUBLIC_UF=${uf} NEXT_PUBLIC_BASE_PATH= npm run build && rm -rf ${outDir} && cp -r out ${outDir} && npx serve ${outDir} -l ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000
  },
  projects: [
    {
      name: `${uf.toLowerCase()}-desktop`,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } }
    },
    {
      // Palco mínimo do site (1280×720): abaixo disso a página rola, o layout não cede.
      name: `${uf.toLowerCase()}-min`,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 720 } }
    }
  ]
});
