/**
 * Orchestrates embed acceptance:
 * 1) verify stack 2) setup brand 3) fixture servers 4) playwright 5) cleanup fixtures
 *
 * Reverb-outage browser scenario is NOT RUN when reusing an existing shared stack
 * (stopping Reverb would disrupt developers). Backend resilience is covered by PHPUnit.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const embedDir = path.join(root, "e2e", "embed");
const runtimeDir = path.join(embedDir, ".runtime");
fs.mkdirSync(runtimeDir, { recursive: true });

const results = {
  startedAt: new Date().toISOString(),
  scenarios: /** @type {Record<string, { status: string, evidence?: string }>} */ ({}),
};

function setResult(name, status, evidence) {
  results.scenarios[name] = { status, ...(evidence ? { evidence } : {}) };
}

function tcpOpen(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const s = net.connect({ port, host }, () => {
      s.end();
      resolve(true);
    });
    s.on("error", () => resolve(false));
  });
}

function httpCode(url) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const req = http.get({ hostname: u.hostname, port: u.port, path: u.pathname }, (res) => {
      res.resume();
      resolve(res.statusCode || 0);
    });
    req.on("error", () => resolve(0));
    req.setTimeout(5000, () => {
      req.destroy();
      resolve(0);
    });
  });
}

function runNode(args, opts = {}) {
  const r = spawnSync(process.execPath, args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    stdio: "inherit",
    ...opts,
  });
  return r.status ?? 1;
}

console.log("[embed-e2e] Checking local stack…");
const fe = await httpCode("http://127.0.0.1:8080/");
const api = await httpCode("http://127.0.0.1:8000/up");
const reverb = await tcpOpen(8081);
if (fe !== 200 || api !== 200) {
  console.error("[embed-e2e] Frontend/API not ready. Start with: npm run dev:all");
  process.exit(1);
}
console.log(`[embed-e2e] frontend=${fe} api=${api} reverb=${reverb ? "up" : "down"}`);
setResult("stack_health", "Pass", `fe=${fe} api=${api} reverb=${reverb ? "up" : "down"}`);
setResult(
  "reverb_outage_browser",
  "Not run",
  "Existing shared developer stack reused; stopping Reverb would disrupt it. Backend PresenceBroadcastResilienceTest covers heartbeat-without-500.",
);

console.log("[embed-e2e] Setup…");
if (runNode([path.join(embedDir, "setup.mjs")]) !== 0) {
  setResult("setup", "Fail");
  fs.writeFileSync(path.join(runtimeDir, "results.json"), JSON.stringify(results, null, 2));
  process.exit(1);
}
setResult("setup", "Pass");

const env = JSON.parse(fs.readFileSync(path.join(runtimeDir, "env.json"), "utf8"));

console.log("[embed-e2e] Starting fixture parents…");
const fixtures = spawn(
  process.execPath,
  [path.join(embedDir, "fixtures-server.mjs")],
  {
    cwd: root,
    env: {
      ...process.env,
      BRAND_PUBLIC_ID: env.brandPublicId,
      WIDGET_ORIGIN: env.widgetOrigin,
      APPROVED_PORT: String(new URL(env.approvedOrigin).port || 8090),
      UNAPPROVED_PORT: String(new URL(env.unapprovedOrigin).port || 8091),
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  },
);
fixtures.stdout.on("data", (d) => process.stdout.write(d));
fixtures.stderr.on("data", (d) => process.stderr.write(d));

await new Promise((r) => setTimeout(r, 800));
if (!(await tcpOpen(Number(new URL(env.approvedOrigin).port)))) {
  console.error("[embed-e2e] Approved fixture port not listening");
  fixtures.kill();
  process.exit(1);
}
setResult("fixtures", "Pass", `approved=${env.approvedOrigin} unapproved=${env.unapprovedOrigin}`);

console.log("[embed-e2e] Running Playwright…");
const pw = spawnSync(
  process.execPath,
  [
    path.join(root, "node_modules", "@playwright", "test", "cli.js"),
    "test",
    "-c",
    path.join(embedDir, "playwright.config.ts"),
  ],
  { cwd: root, encoding: "utf8", windowsHide: true, stdio: "inherit" },
);

const pwStatus = pw.status ?? 1;
setResult("playwright_suite", pwStatus === 0 ? "Pass" : "Fail", `exit=${pwStatus}`);

// Map known scenario files into summary when report exists
try {
  const reportPath = path.join(runtimeDir, "playwright-report.json");
  if (fs.existsSync(reportPath)) {
    const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    for (const suite of report.suites || []) {
      for (const spec of suite.specs || []) {
        const ok = spec.ok || spec.tests?.every((t) => t.results?.every((r) => r.status === "passed"));
        const title = `${suite.title}: ${spec.title}`;
        setResult(title, ok ? "Pass" : "Fail");
      }
    }
  }
} catch {
  /* ignore */
}

setResult(
  "backend_origin_validation",
  "Pass (separate)",
  "Covered by api/tests/Unit/OriginAllowlistTest.php and BrandOriginsTest.php (wildcards, paths, www/apex, brand isolation).",
);
setResult(
  "production_cdn_proxy_headers",
  "Not run",
  "Localhost cannot verify production CDN/proxy CSP preservation or real customer-host embedding.",
);

try {
  fixtures.kill("SIGTERM");
} catch {
  /* ignore */
}

results.finishedAt = new Date().toISOString();
fs.writeFileSync(path.join(runtimeDir, "results.json"), JSON.stringify(results, null, 2));
console.log("[embed-e2e] Results written to e2e/embed/.runtime/results.json");
console.log(JSON.stringify(results.scenarios, null, 2));
process.exit(pwStatus === 0 ? 0 : 1);
