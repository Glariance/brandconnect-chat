/**
 * Local realtime delivery check. Prints timings/status only — never tokens/secrets.
 * Requires: API :8000, Reverb :8081, queue worker.
 */
import fs from "node:fs";
import http from "node:http";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import WebSocket from "ws";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function parseEnv(file) {
  const out = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i > 0) out[line.slice(0, i)] = line.slice(i + 1).replace(/^["']|["']$/g, "");
  }
  return out;
}

function request(method, urlStr, { headers = {}, body } = {}) {
  const u = new URL(urlStr);
  const payload = body === undefined ? null : JSON.stringify(body);
  const hdrs = { Accept: "application/json", ...headers };
  if (payload !== null) {
    hdrs["Content-Type"] = "application/json";
    hdrs["Content-Length"] = Buffer.byteLength(payload);
  }
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const req = http.request(
      { host: u.hostname, port: u.port, path: `${u.pathname}${u.search}`, method, headers: hdrs },
      (res) => {
        let data = "";
        res.on("data", (d) => (data += d));
        res.on("end", () => {
          let json = null;
          try {
            json = JSON.parse(data);
          } catch {
            /* ignore */
          }
          resolve({ status: res.statusCode, ms: Date.now() - t0, json, raw: data });
        });
      },
    );
    req.on("error", reject);
    if (payload !== null) req.write(payload);
    req.end();
  });
}

const apiEnv = parseEnv(path.join(root, "api", ".env"));
const key = apiEnv.REVERB_APP_KEY;
const php = spawnSync(
  "php",
  [
    "-r",
    'require "vendor/autoload.php"; $app=require "bootstrap/app.php"; $app->make(Illuminate\\Contracts\\Console\\Kernel::class)->bootstrap(); echo App\\Models\\Brand::query()->value("public_id");',
  ],
  { cwd: path.join(root, "api"), encoding: "utf8" },
);
const publicId = (php.stdout || "").trim();
if (!publicId) {
  console.error("NO_BRAND", (php.stderr || "").slice(0, 300));
  process.exit(1);
}

const tAll = Date.now();
const log = (label, extra = {}) => {
  console.log(label, JSON.stringify({ elapsed_ms: Date.now() - tAll, ...extra }));
};

const sess = await request(
  "POST",
  `http://127.0.0.1:8000/api/v1/widget/brands/${encodeURIComponent(publicId)}/sessions`,
  { body: {} },
);
const token = sess.json?.data?.token;
log("VISITOR_SESSION", { status: sess.status, ms: sess.ms, hasToken: Boolean(token) });
if (!token) process.exit(1);

const conv = await request("POST", "http://127.0.0.1:8000/api/v1/widget/conversations", {
  headers: { Authorization: `Bearer ${token}` },
  body: { page: "/ws-frame-test" },
});
const convId = conv.json?.data?.id;
log("VISITOR_CONV", { status: conv.status, ms: conv.ms, hasId: Boolean(convId) });
if (!convId) process.exit(1);

let gotEvent = false;
let subscribed = false;
const ws = new WebSocket(
  `ws://127.0.0.1:8081/app/${key}?protocol=7&client=js&version=8.4.0&flash=false`,
);

ws.on("message", async (buf) => {
  const msg = JSON.parse(String(buf));
  if (msg.event === "pusher:connection_established") {
    const socketId = JSON.parse(msg.data).socket_id;
    log("STAGE1_WS_CONNECTED", { socketId_len: String(socketId).length });
    const auth = await request("POST", "http://127.0.0.1:8000/api/v1/widget/broadcasting/auth", {
      headers: { Authorization: `Bearer ${token}` },
      body: { socket_id: socketId, channel_name: `private-conversations.${convId}` },
    });
    log("STAGE3_VISITOR_AUTH", { status: auth.status, hasAuth: Boolean(auth.json?.auth), ms: auth.ms });
    if (!auth.json?.auth) {
      ws.close();
      return;
    }
    ws.send(
      JSON.stringify({
        event: "pusher:subscribe",
        data: { channel: `private-conversations.${convId}`, auth: auth.json.auth },
      }),
    );
  }
  if (msg.event === "pusher_internal:subscription_succeeded") {
    subscribed = true;
    log("STAGE4_PRIVATE_SUBSCRIBED", { channel: msg.channel });
    const send = await request("POST", `http://127.0.0.1:8000/api/v1/widget/conversations/${convId}/messages`, {
      headers: { Authorization: `Bearer ${token}` },
      body: { client_message_id: crypto.randomUUID(), text: "ws frame verify" },
    });
    log("STAGE5_MESSAGE_STORED", { status: send.status, ms: send.ms });
  }
  if (typeof msg.event === "string" && msg.event.endsWith("message.created")) {
    gotEvent = true;
    log("STAGE6_WS_EVENT_RECEIVED", {
      event: msg.event,
      channel: msg.channel,
      data_len: String(msg.data || "").length,
    });
    ws.close();
  }
});

ws.on("error", (e) => log("WS_ERROR", { message: e.message }));

await new Promise((resolve) => {
  const timer = setTimeout(() => {
    log("TIMEOUT", { subscribed, gotEvent });
    try {
      ws.close();
    } catch {
      /* ignore */
    }
    resolve();
  }, 10000);
  ws.on("close", () => {
    clearTimeout(timer);
    resolve();
  });
});

process.exit(gotEvent ? 0 : 2);
