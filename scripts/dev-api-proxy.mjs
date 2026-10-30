/**
 * Round-robin reverse proxy for local Laravel API workers.
 *
 * php artisan serve is single-threaded; concurrent browser requests (dashboard
 * polling + widget bootstrap) otherwise queue. This proxy fans out to several
 * artisan serve workers so presence/config/session can run in parallel.
 *
 * Env:
 *   API_PROXY_PORT   listen port (default 8000)
 *   API_PROXY_HOST   listen host (default 127.0.0.1)
 *   API_WORKERS      comma-separated host:port list
 */
import http from "node:http";

const listenHost = process.env.API_PROXY_HOST || "127.0.0.1";
const listenPort = Number(process.env.API_PROXY_PORT || 8000);
const workers = String(process.env.API_WORKERS || "127.0.0.1:8011,127.0.0.1:8012,127.0.0.1:8013")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((entry) => {
    const [host, portStr] = entry.split(":");
    const port = Number(portStr);
    if (!host || !Number.isFinite(port)) {
      throw new Error(`Invalid API_WORKERS entry: ${entry}`);
    }
    return { host, port };
  });

if (workers.length === 0) {
  throw new Error("API_WORKERS is empty");
}

let cursor = 0;
const hopHeader = "x-dev-api-worker";

const server = http.createServer((req, res) => {
  const worker = workers[cursor % workers.length];
  cursor += 1;

  const headers = { ...req.headers, host: `${worker.host}:${worker.port}` };
  delete headers["proxy-connection"];

  const upstream = http.request(
    {
      protocol: "http:",
      hostname: worker.host,
      port: worker.port,
      path: req.url,
      method: req.method,
      headers,
    },
    (up) => {
      const outHeaders = { ...up.headers, [hopHeader]: `${worker.host}:${worker.port}` };
      res.writeHead(up.statusCode || 502, outHeaders);
      up.pipe(res);
    },
  );

  upstream.on("error", (err) => {
    if (res.headersSent) {
      res.destroy(err);
      return;
    }
    res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    res.end(`Bad Gateway (${worker.host}:${worker.port}): ${err.message}`);
  });

  req.pipe(upstream);
});

server.listen(listenPort, listenHost, () => {
  process.stdout.write(
    `[API-PROXY] listening on http://${listenHost}:${listenPort} → ${workers
      .map((w) => `${w.host}:${w.port}`)
      .join(", ")}\n`,
  );
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref?.();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
