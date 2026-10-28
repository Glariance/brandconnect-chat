/**
 * Local-development launcher for BrandConnect chat.
 * Starts API (8000), frontend (8080), Reverb (8081), and a queue worker together.
 *
 * Usage: npm run dev:all
 * Override PHP: set PHP_BINARY to an absolute php.exe path (not committed).
 *
 * Does not install packages, migrate, regenerate keys, or rewrite .env files.
 */
import { spawn, spawnSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = fs.realpathSync.native(path.resolve(__dirname, ".."));
const API_DIR = path.join(ROOT, "api");
const LOCK_PATH = path.join(ROOT, ".dev-all.lock");
const STOP_PATH = path.join(ROOT, ".dev-all.stop");
const LARAGON_PHP = "D:\\laragon\\bin\\php\\php-8.3.30\\php.exe";

const PORTS = {
  api: 8000,
  frontend: 8080,
  reverb: 8081,
};

const READY_TIMEOUT_MS = 60_000;
const READY_POLL_MS = 400;

/** @typedef {{ name: string, tag: string, child: import('node:child_process').ChildProcess, pid: number }} ManagedProc */

/** @type {ManagedProc[]} */
const children = [];
let shuttingDown = false;
let exitCode = 0;

function log(tag, message) {
  const lines = String(message).split(/\r?\n/);
  for (const line of lines) {
    if (line.length === 0) continue;
    process.stdout.write(`[${tag}] ${line}\n`);
  }
}

function fail(message) {
  const err = new Error(message);
  err.name = "LauncherError";
  throw err;
}

function isAlive(pid) {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function resolvePhp() {
  const override = process.env.PHP_BINARY?.trim();
  if (override) {
    if (!fs.existsSync(override)) {
      fail(`PHP_BINARY is set but not found: ${override}`);
    }
    return path.resolve(override);
  }

  const which = spawnSync(process.platform === "win32" ? "where" : "which", ["php"], {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  if (which.status === 0) {
    const first = which.stdout
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find(Boolean);
    if (first && fs.existsSync(first)) return first;
  }

  if (fs.existsSync(LARAGON_PHP)) return LARAGON_PHP;

  fail(
    "PHP not found. Add php to PATH, install Laragon PHP 8.3.30, or set PHP_BINARY to your php.exe.",
  );
}

function phpVersion(phpBin) {
  const r = spawnSync(phpBin, ["-v"], { encoding: "utf8", windowsHide: true });
  if (r.status !== 0) fail(`Could not run PHP at ${phpBin}`);
  return (r.stdout || "").split(/\r?\n/)[0] || "PHP";
}

/** @returns {{ pid: number|null, detail: string }} */
function portListener(port) {
  try {
    const out = execFileSync("netstat", ["-ano"], {
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    });
    const needle = `:${port}`;
    for (const line of out.split(/\r?\n/)) {
      if (!line.includes("LISTENING") || !line.includes(needle)) continue;
      // Match host:port in local address column (avoid matching remote :port).
      const m = line.match(/^\s*TCP\s+(\S+):(\d+)\s+\S+\s+LISTENING\s+(\d+)/i);
      if (!m) continue;
      if (Number(m[2]) !== port) continue;
      const pid = Number(m[3]);
      let image = "";
      try {
        const tl = execFileSync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], {
          encoding: "utf8",
          windowsHide: true,
        });
        const cols = tl.trim().split('","');
        image = (cols[0] || "").replace(/^"/, "");
      } catch {
        /* ignore */
      }
      return {
        pid: Number.isFinite(pid) ? pid : null,
        detail: image ? `${image} (PID ${pid})` : `PID ${pid}`,
      };
    }
  } catch (e) {
    return { pid: null, detail: `could not inspect port (${e instanceof Error ? e.message : e})` };
  }
  return { pid: null, detail: "unknown process" };
}

function assertPortFree(port, label) {
  const { pid, detail } = portListener(port);
  if (pid && isAlive(pid)) {
    fail(
      `Port ${port} (${label}) is already in use by ${detail}.\n` +
        `  Stop that process yourself, then re-run npm run dev:all.\n` +
        `  Examples (PowerShell):\n` +
        `    Get-NetTCPConnection -LocalPort ${port} | Select OwningProcess\n` +
        `    Stop-Process -Id <pid>   # only if you intend to stop it\n` +
        `  This launcher never kills unrelated processes automatically.`,
    );
  }
}

function readLock() {
  try {
    if (!fs.existsSync(LOCK_PATH)) return null;
    return JSON.parse(fs.readFileSync(LOCK_PATH, "utf8"));
  } catch {
    return null;
  }
}

function writeLock(payload) {
  fs.writeFileSync(LOCK_PATH, JSON.stringify(payload, null, 2), "utf8");
}

function clearLock() {
  try {
    if (fs.existsSync(LOCK_PATH)) fs.unlinkSync(LOCK_PATH);
  } catch {
    /* ignore */
  }
  try {
    if (fs.existsSync(STOP_PATH)) fs.unlinkSync(STOP_PATH);
  } catch {
    /* ignore */
  }
}

function persistLockChildren() {
  const existing = readLock() || { pid: process.pid, startedAt: new Date().toISOString(), root: ROOT };
  existing.children = children.map((c) => ({ name: c.name, pid: c.pid }));
  writeLock(existing);
}

function assertNoDuplicateLauncher() {
  const existing = readLock();
  if (!existing?.pid) return;
  if (existing.pid === process.pid) return;
  if (isAlive(existing.pid)) {
    fail(
      `Another npm run dev:all appears to be running (launcher PID ${existing.pid}).\n` +
        `  Stop it with Ctrl+C in that terminal, or remove stale lock ${path.basename(LOCK_PATH)} if the process is dead.`,
    );
  }
  clearLock();
}

function preflight(phpBin) {
  log("LAUNCHER", `Repo root: ${ROOT}`);
  log("LAUNCHER", `PHP: ${phpBin}`);
  log("LAUNCHER", phpVersion(phpBin));

  if (!fs.existsSync(path.join(ROOT, "node_modules", "vite"))) {
    fail("Frontend dependencies missing. Run npm install at the repository root (not done by this launcher).");
  }
  if (!fs.existsSync(path.join(API_DIR, "vendor", "autoload.php"))) {
    fail("API dependencies missing. Run composer install inside api/ (not done by this launcher).");
  }
  if (!fs.existsSync(path.join(API_DIR, "artisan"))) {
    fail("api/artisan not found.");
  }
  if (!fs.existsSync(path.join(ROOT, ".env"))) {
    fail("Root .env missing. Copy .env.example to .env and set VITE_* values (not done by this launcher).");
  }
  if (!fs.existsSync(path.join(API_DIR, ".env"))) {
    fail("api/.env missing. Copy api/.env.example to api/.env and configure the database/Reverb (not done by this launcher).");
  }

  assertPortFree(PORTS.api, "Laravel API");
  assertPortFree(PORTS.frontend, "Vite frontend");
  assertPortFree(PORTS.reverb, "Laravel Reverb");
}

function pipePrefixed(tag, stream) {
  let buf = "";
  stream.on("data", (chunk) => {
    buf += chunk.toString("utf8");
    const parts = buf.split(/\r?\n/);
    buf = parts.pop() ?? "";
    for (const part of parts) log(tag, part);
  });
  stream.on("end", () => {
    if (buf) log(tag, buf);
  });
}

/**
 * @param {string} name
 * @param {string} tag
 * @param {string} command
 * @param {string[]} args
 * @param {string} cwd
 * @param {{ env?: NodeJS.ProcessEnv, shell?: boolean }} [opts]
 */
function startProcess(name, tag, command, args, cwd, opts = {}) {
  log("LAUNCHER", `Starting ${name}…`);
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...(opts.env ?? {}) },
    stdio: ["ignore", "pipe", "pipe"],
    // npm.cmd on Windows requires a shell; PHP exe paths use shell:false so spaces stay safe.
    shell: Boolean(opts.shell),
    windowsHide: true,
  });

  if (child.pid == null) {
    fail(`Failed to spawn ${name}`);
  }

  pipePrefixed(tag, child.stdout);
  pipePrefixed(tag, child.stderr);

  const managed = { name, tag, child, pid: child.pid };
  children.push(managed);

  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    exitCode = code && code !== 0 ? code : 1;
    log(
      "LAUNCHER",
      `${name} exited unexpectedly (code=${code ?? "null"} signal=${signal ?? "null"}). Stopping remaining children.`,
    );
    void shutdown(exitCode);
  });

  log("LAUNCHER", `${name} started (PID ${child.pid}) — waiting for readiness…`);
  return managed;
}

function killTree(pid) {
  if (!pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    /* ignore */
  }
}

/** Windows: PIDs whose parent chain includes rootPid (plus rootPid). */
function windowsDescendantPids(rootPid) {
  const pids = new Set([rootPid]);
  try {
    const out = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress`,
      ],
      { encoding: "utf8", windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
    );
    const rows = JSON.parse(out);
    const list = Array.isArray(rows) ? rows : [rows];
    let grew = true;
    while (grew) {
      grew = false;
      for (const row of list) {
        if (pids.has(Number(row.ParentProcessId)) && !pids.has(Number(row.ProcessId))) {
          pids.add(Number(row.ProcessId));
          grew = true;
        }
      }
    }
  } catch {
    /* fall back to taskkill /T on the root only */
  }
  return [...pids];
}

async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  exitCode = code;
  log("LAUNCHER", "Shutting down children…");

  const targets = new Set();
  for (const proc of children) {
    targets.add(proc.pid);
    if (process.platform === "win32") {
      for (const d of windowsDescendantPids(proc.pid)) targets.add(d);
    }
  }
  // Include PIDs persisted in the lock (covers restarts of the stop path).
  const locked = readLock();
  for (const c of locked?.children ?? []) {
    if (c?.pid) targets.add(Number(c.pid));
  }

  for (const pid of targets) {
    if (pid === process.pid) continue;
    try {
      log("LAUNCHER", `Stopping PID ${pid}…`);
      killTree(pid);
    } catch {
      /* ignore */
    }
  }

  // Grace period so ports release; retry listeners that belong to our target set.
  await new Promise((r) => setTimeout(r, 800));
  for (const port of Object.values(PORTS)) {
    const { pid } = portListener(port);
    if (pid && (targets.has(pid) || [...targets].some((root) => windowsDescendantPids(root).includes(pid)))) {
      log("LAUNCHER", `Stopping lingering port ${port} owner PID ${pid}…`);
      killTree(pid);
    }
  }
  await new Promise((r) => setTimeout(r, 500));

  clearLock();
  log("LAUNCHER", "All launcher children signaled. Bye.");
  process.exit(exitCode);
}

function httpReady(url, acceptStatuses = [200, 204]) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 2000 }, (res) => {
      res.resume();
      resolve(acceptStatuses.includes(res.statusCode ?? 0));
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

function tcpReady(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port }, () => {
      socket.end();
      resolve(true);
    });
    socket.setTimeout(1500, () => {
      socket.destroy();
      resolve(false);
    });
    socket.on("error", () => resolve(false));
  });
}

async function waitUntil(label, check, timeoutMs = READY_TIMEOUT_MS) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (shuttingDown) return false;
    if (await check()) {
      log("LAUNCHER", `READY ${label}`);
      return true;
    }
    await new Promise((r) => setTimeout(r, READY_POLL_MS));
  }
  log("LAUNCHER", `NOT READY ${label} (timeout ${timeoutMs}ms)`);
  return false;
}

async function main() {
  assertNoDuplicateLauncher();
  const phpBin = resolvePhp();
  preflight(phpBin);

  writeLock({
    pid: process.pid,
    startedAt: new Date().toISOString(),
    root: ROOT,
  });

  const onSignal = (signal) => {
    log("LAUNCHER", `${signal} received — stopping launcher-owned processes.`);
    void shutdown(0);
  };
  process.on("SIGINT", () => onSignal("SIGINT"));
  process.on("SIGTERM", () => onSignal("SIGTERM"));
  // Windows console close / Ctrl+Break
  process.on("SIGHUP", () => onSignal("SIGHUP"));

  try {
    startProcess(
      "API",
      "API",
      phpBin,
      ["artisan", "serve", "--host=127.0.0.1", `--port=${PORTS.api}`],
      API_DIR,
    );

    // Run Vite via Node (same as npm run dev) so the PID tree is killable on Windows
    // without an intermediate npm.cmd shell that can orphan the server.
    const viteEntry = path.join(ROOT, "node_modules", "vite", "bin", "vite.js");
    if (!fs.existsSync(viteEntry)) {
      fail("vite.js not found under node_modules. Run npm install at the repository root.");
    }
    startProcess(
      "FRONTEND",
      "FRONTEND",
      process.execPath,
      [viteEntry, "dev", "--port", String(PORTS.frontend), "--strictPort"],
      ROOT,
    );

    startProcess(
      "REVERB",
      "REVERB",
      phpBin,
      ["artisan", "reverb:start", "--host=127.0.0.1", `--port=${PORTS.reverb}`],
      API_DIR,
    );

    startProcess(
      "QUEUE",
      "QUEUE",
      phpBin,
      ["artisan", "queue:work", "--sleep=1", "--tries=3", "--queue=default"],
      API_DIR,
    );

    persistLockChildren();

    // Poll for stop file (reliable on Windows when Ctrl+C cannot be sent cross-console).
    const stopPoll = setInterval(() => {
      if (shuttingDown) return;
      if (!fs.existsSync(STOP_PATH)) return;
      log("LAUNCHER", "Stop file detected (.dev-all.stop).");
      clearInterval(stopPoll);
      void shutdown(0);
    }, 700);
    stopPoll.unref?.();

    const apiOk = await waitUntil("API http://127.0.0.1:8000/up", () =>
      httpReady("http://127.0.0.1:8000/up"),
    );
    const feOk = await waitUntil("FRONTEND http://127.0.0.1:8080/", () =>
      httpReady("http://127.0.0.1:8080/", [200, 304]),
    );
    const rvOk = await waitUntil("REVERB tcp://127.0.0.1:8081", () =>
      tcpReady("127.0.0.1", PORTS.reverb),
    );

    const queueProc = children.find((c) => c.name === "QUEUE");
    const queueRunning = Boolean(queueProc && queueProc.child.exitCode == null);
    if (queueRunning) {
      log(
        "LAUNCHER",
        "QUEUE process is running (PID " +
          queueProc.pid +
          "). This does not verify message delivery — use node scripts/verify-reverb-delivery.mjs for that.",
      );
    } else {
      log("LAUNCHER", "QUEUE process is not running.");
    }

    if (!apiOk || !feOk || !rvOk || !queueRunning) {
      fail("One or more services failed readiness checks. Cleaning up.");
    }

    log("LAUNCHER", "");
    log("LAUNCHER", "=== Local stack ready (dev only) ===");
    log("LAUNCHER", "  Frontend:  http://127.0.0.1:8080/  (also http://localhost:8080/)");
    log("LAUNCHER", "  API:       http://127.0.0.1:8000/");
    log("LAUNCHER", "  Health:    http://127.0.0.1:8000/up");
    log("LAUNCHER", "  Reverb:    ws://127.0.0.1:8081  (TCP accepted)");
    log("LAUNCHER", "  Queue:     worker running (--sleep=1 --tries=3)");
    log("LAUNCHER", "Press Ctrl+C to stop all launcher-owned processes.");
    log("LAUNCHER", "Or from another terminal: npm run dev:all:stop");
    log("LAUNCHER", "");
  } catch (e) {
    log("LAUNCHER", `ERROR: ${e instanceof Error ? e.message : String(e)}`);
    await shutdown(1);
  }
}

/**
 * External stop helper: npm run dev:all:stop
 * Writes .dev-all.stop when a launcher is alive; otherwise taskkills lock children.
 */
function stopCommand() {
  const existing = readLock();
  if (existing?.pid && isAlive(existing.pid)) {
    fs.writeFileSync(STOP_PATH, `stop requested at ${new Date().toISOString()}\n`, "utf8");
    log("LAUNCHER", `Stop requested for launcher PID ${existing.pid}. Waiting for cleanup…`);
    const t0 = Date.now();
    while (Date.now() - t0 < 20_000) {
      if (!isAlive(existing.pid) && !fs.existsSync(LOCK_PATH)) {
        log("LAUNCHER", "Launcher stopped.");
        process.exit(0);
      }
      spawnSync("powershell.exe", ["-NoProfile", "-Command", "Start-Sleep -Seconds 1"], {
        stdio: "ignore",
        windowsHide: true,
      });
    }
    log("LAUNCHER", "Timed out waiting for graceful stop; forcing taskkill on lock children.");
  }

  const locked = readLock();
  const pids = new Set();
  if (locked?.pid) pids.add(Number(locked.pid));
  for (const c of locked?.children ?? []) {
    if (c?.pid) pids.add(Number(c.pid));
  }
  // Snapshot before expanding — mutating a Set while iterating it is unsafe.
  for (const pid of [...pids]) {
    if (process.platform === "win32") {
      for (const d of windowsDescendantPids(pid)) pids.add(d);
    }
  }
  for (const pid of pids) {
    if (pid === process.pid) continue;
    log("LAUNCHER", `Force-stopping PID ${pid}…`);
    killTree(pid);
  }
  clearLock();
  log("LAUNCHER", "Stop complete.");
  process.exit(0);
}

if (process.argv.includes("--stop")) {
  stopCommand();
} else {
  main().catch(async (e) => {
    log("LAUNCHER", `ERROR: ${e instanceof Error ? e.message : String(e)}`);
    await shutdown(1);
  });
}
