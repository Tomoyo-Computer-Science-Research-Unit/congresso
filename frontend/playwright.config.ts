import { defineConfig, devices } from "@playwright/test";

// Um build com as 27 UFs, servido na raiz (NEXT_PUBLIC_BASE_PATH vazio): RJ em "/", as demais em
// "/<uf>/". O deploy usa /congresso.
export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  expect: {
    timeout: 10_000
  },
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure"
  },
  webServer: {
    command: "NEXT_PUBLIC_BASE_PATH= npm run build && rm -rf out-test && cp -r out out-test && npx serve out-test -l 4173",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000
  },
  projects: [
    {
      name: "chromium-desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } }
    },
    {
      // Palco mínimo do site (1280×720): abaixo disso a página rola, o layout não cede.
      name: "chromium-min",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 720 } }
    }
  ]
});
