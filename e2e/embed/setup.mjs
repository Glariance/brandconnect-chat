/**
 * Provision dedicated embed-e2e owner/brand and write runtime env (no secrets logged).
 * Requires: API reachable, WIDGET_ALLOW_LOCALHOST_ORIGINS=true for localhost fixture ports.
 */
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const apiDir = path.join(root, "api");
const runtimeDir = path.join(root, "e2e", "embed", ".runtime");
fs.mkdirSync(runtimeDir, { recursive: true });

const EMAIL = process.env.EMBED_E2E_EMAIL || "embed-e2e@localhost.test";
const NAME = "Embed E2E Agent";
const ORG = "Embed E2E Organization";
const BRAND = "Embed E2E Brand";
const APPROVED_ORIGIN = process.env.APPROVED_ORIGIN || "http://localhost:8090";
const UNAPPROVED_ORIGIN = process.env.UNAPPROVED_ORIGIN || "http://localhost:8091";
const FRONTEND = (process.env.FRONTEND_ORIGIN || "http://localhost:8080").replace(/\/$/, "");
const API = (process.env.API_ORIGIN || "http://localhost:8000").replace(/\/$/, "");

function php(args) {
  const r = spawnSync("php", args, {
    cwd: apiDir,
    encoding: "utf8",
    windowsHide: true,
  });
  if (r.status !== 0) {
    throw new Error(`php ${args.join(" ")} failed: ${r.stderr || r.stdout}`);
  }
  return r.stdout;
}

function httpJson(method, url, { headers = {}, body, cookieJar } = {}) {
  const payload = body === undefined ? null : JSON.stringify(body);
  const hdrs = { Accept: "application/json", ...headers };
  if (payload !== null) {
    hdrs["Content-Type"] = "application/json";
    hdrs["Content-Length"] = String(Buffer.byteLength(payload));
  }
  if (cookieJar?.size) {
    hdrs.Cookie = [...cookieJar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request(
      { hostname: u.hostname, port: u.port || 80, path: `${u.pathname}${u.search}`, method, headers: hdrs },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          for (const raw of res.headers["set-cookie"] || []) {
            const [pair] = raw.split(";");
            const i = pair.indexOf("=");
            if (i > 0 && cookieJar) cookieJar.set(pair.slice(0, i), pair.slice(i + 1));
          }
          let json = null;
          try {
            json = data ? JSON.parse(data) : null;
          } catch {
            /* ignore */
          }
          resolve({ status: res.statusCode, headers: res.headers, json, text: data });
        });
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function xsrfFromJar(jar) {
  const raw = jar.get("XSRF-TOKEN");
  return raw ? decodeURIComponent(raw) : null;
}

function lastJsonLine(stdout) {
  const lines = String(stdout)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(lines[i]);
    } catch {
      /* continue */
    }
  }
  throw new Error(`No JSON in tinker output: ${stdout}`);
}

const password =
  process.env.EMBED_E2E_PASSWORD ||
  `EmbedE2E!${crypto.randomBytes(6).toString("base64url")}`;

console.log("[setup] Checking API…");
const up = await httpJson("GET", `${API}/up`);
if (up.status !== 200) throw new Error(`API not ready at ${API}/up (status ${up.status})`);

const allowLocal = php([
  "artisan",
  "tinker",
  "--execute=echo config('widget.allow_localhost_origins') ? '1' : '0';",
]).trim();
if (allowLocal !== "1") {
  throw new Error(
    "WIDGET_ALLOW_LOCALHOST_ORIGINS must be true in api/.env (restart npm run dev:all after setting).",
  );
}

console.log("[setup] Provisioning dedicated owner/brand (idempotent)…");
php([
  "artisan",
  "brandconnect:provision-owner",
  `--email=${EMAIL}`,
  `--name=${NAME}`,
  `--password=${password}`,
  `--organization=${ORG}`,
  `--brand=${BRAND}`,
  "-n",
]);

const brand = lastJsonLine(
  php([
    "artisan",
    "tinker",
    `--execute=$b=\\App\\Models\\Brand::query()->where('name', ${JSON.stringify(BRAND)})->first(); echo json_encode(['id'=>$b?->id,'public_id'=>$b?->public_id]);`,
  ]),
);
if (!brand?.public_id) throw new Error("Failed to resolve embed e2e brand");

console.log("[setup] Allowlisting approved fixture origin only…");
php([
  "artisan",
  "tinker",
  `--execute=$b=\\App\\Models\\Brand::query()->where('public_id', ${JSON.stringify(brand.public_id)})->firstOrFail(); $b->allowed_origins=\\App\\Support\\OriginAllowlist::normalizeList([${JSON.stringify(APPROVED_ORIGIN)}], true); $b->save(); echo json_encode($b->allowed_origins);`,
]);

const brandB = lastJsonLine(
  php([
    "artisan",
    "tinker",
    `--execute=$u=\\App\\Models\\User::where('email', ${JSON.stringify(EMAIL)})->firstOrFail(); $org=$u->memberships()->where('role','owner')->first()->organization; $b=$org->brands()->firstOrCreate(['name'=>'Embed E2E Brand B'], ['public_id'=>\\App\\Models\\Brand::generatePublicId(),'timezone'=>'UTC','color'=>'#7c3aed','greeting'=>'Hi','allowed_origins'=>['https://brand-b.example.com']]); $b->allowed_origins=\\App\\Support\\OriginAllowlist::normalizeList(['https://brand-b.example.com'], true); $b->save(); $b->agents()->syncWithoutDetaching([$u->id]); echo json_encode(['public_id'=>$b->public_id,'allowed_origins'=>$b->allowed_origins]);`,
  ]),
);
if (!brandB?.public_id) throw new Error("Failed to resolve embed e2e brand B");

const jar = new Map();
await httpJson("GET", `${API}/sanctum/csrf-cookie`, {
  cookieJar: jar,
  headers: { Origin: FRONTEND, Referer: `${FRONTEND}/` },
});
const login = await httpJson("POST", `${API}/api/v1/auth/login`, {
  cookieJar: jar,
  headers: {
    "X-XSRF-TOKEN": xsrfFromJar(jar) || "",
    Origin: FRONTEND,
    Referer: `${FRONTEND}/`,
  },
  body: { email: EMAIL, password },
});
if (login.status >= 400) {
  const msg = login.json?.message || login.text?.slice(0, 120) || "";
  throw new Error(`Login failed (${login.status}) ${msg}`);
}

const env = {
  email: EMAIL,
  password,
  brandId: brand.id,
  brandPublicId: brand.public_id,
  brandBPublicId: brandB.public_id,
  approvedOrigin: APPROVED_ORIGIN,
  unapprovedOrigin: UNAPPROVED_ORIGIN,
  frontendOrigin: FRONTEND,
  apiOrigin: API,
  widgetOrigin: FRONTEND,
};

fs.writeFileSync(path.join(runtimeDir, "env.json"), JSON.stringify(env, null, 2));
const { password: _omit, ...publicEnv } = env;
fs.writeFileSync(path.join(runtimeDir, "env.public.json"), JSON.stringify(publicEnv, null, 2));

console.log("[setup] Ready.");
console.log(`[setup] brand_public_id=${brand.public_id}`);
console.log(`[setup] approved_origin=${APPROVED_ORIGIN}`);
console.log(`[setup] unapproved_origin=${UNAPPROVED_ORIGIN}`);
console.log("[setup] Credentials written to e2e/embed/.runtime/env.json (gitignored).");
