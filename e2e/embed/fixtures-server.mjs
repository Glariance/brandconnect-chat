/**
 * Serves two lightweight parent fixture sites for embed acceptance tests.
 * Usage: node e2e/embed/fixtures-server.mjs
 * Env: APPROVED_PORT, UNAPPROVED_PORT, WIDGET_ORIGIN, BRAND_PUBLIC_ID
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const template = fs.readFileSync(path.join(__dirname, "fixtures", "site.html"), "utf8");

const approvedPort = Number(process.env.APPROVED_PORT || 8090);
const unapprovedPort = Number(process.env.UNAPPROVED_PORT || 8091);
const widgetOrigin = (process.env.WIDGET_ORIGIN || "http://localhost:8080").replace(/\/$/, "");
const brandPublicId = process.env.BRAND_PUBLIC_ID || "";

if (!brandPublicId) {
  console.error("[fixtures] BRAND_PUBLIC_ID is required");
  process.exit(1);
}

function render(label) {
  return template
    .replaceAll("__LABEL__", label)
    .replaceAll("__WIDGET_ORIGIN__", widgetOrigin)
    .replaceAll("__BRAND_PUBLIC_ID__", brandPublicId);
}

function listen(port, label) {
  const html = render(label);
  const server = http.createServer((req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(html);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const origin = `http://localhost:${port}`;
      console.log(`[fixtures] ${label} → ${origin}`);
      resolve({ server, origin, port, label });
    });
  });
}

const approved = await listen(approvedPort, "approved");
const unapproved = await listen(unapprovedPort, "unapproved");

const statePath = path.join(__dirname, ".runtime", "fixtures.json");
fs.mkdirSync(path.dirname(statePath), { recursive: true });
fs.writeFileSync(
  statePath,
  JSON.stringify(
    {
      approvedOrigin: approved.origin,
      unapprovedOrigin: unapproved.origin,
      widgetOrigin,
      brandPublicId,
      pid: process.pid,
    },
    null,
    2,
  ),
);

function shutdown() {
  approved.server.close();
  unapproved.server.close();
  try {
    fs.unlinkSync(statePath);
  } catch {
    /* ignore */
  }
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
