import { defineConfig, devices } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(root, ".runtime", "env.json");
const env = fs.existsSync(envPath) ? JSON.parse(fs.readFileSync(envPath, "utf8")) : {};

export default defineConfig({
  testDir: path.join(root, "tests"),
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["json", { outputFile: path.join(root, ".runtime", "playwright-report.json") }]],
  outputDir: path.join(root, ".runtime", "test-results"),
  use: {
    ...devices["Desktop Chrome"],
    channel: "msedge",
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    baseURL: env.frontendOrigin || "http://localhost:8080",
  },
  projects: [{ name: "embed-msedge", use: { channel: "msedge" } }],
});
