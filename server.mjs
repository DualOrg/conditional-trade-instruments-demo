import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import dualStatus from "./api/dual/status.js";
import currentInstrument from "./api/instruments/current.js";
import evaluateInstrument from "./api/instruments/evaluate.js";
import syncInstrument from "./api/instruments/sync.js";
import mintInstrument from "./api/instruments/mint.js";

const root = fileURLToPath(new URL(".", import.meta.url));
await loadDotEnv();

const port = Number(process.env.PORT || 4176);
const host = process.env.HOST || "127.0.0.1";

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

const routes = new Map([
  ["GET /api/dual/status", dualStatus],
  ["GET /api/instruments/current", currentInstrument],
  ["POST /api/instruments/evaluate", evaluateInstrument],
  ["POST /api/instruments/sync", syncInstrument],
  ["POST /api/instruments/mint", mintInstrument]
]);

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || `${host}:${port}`}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
      return;
    }
    await serveStatic(url.pathname, response);
  } catch (error) {
    sendNodeJson(response, error.status || 500, {
      error: {
        message: error.message || "Unknown server error",
        code: error.code || error.name || "SERVER_ERROR",
        readiness: error.readiness || undefined
      }
    });
  }
});

server.listen(port, host, () => {
  console.log(`TradeFlow Control Desk running on http://${host}:${port}`);
});

async function handleApi(request, response, url) {
  const route = routes.get(`${request.method} ${url.pathname}`);
  if (!route) {
    sendNodeJson(response, 404, { error: { message: "Not found" } });
    return;
  }
  const body = request.method === "GET" ? undefined : await readJson(request);
  const wrappedRequest = {
    method: request.method,
    headers: request.headers,
    query: Object.fromEntries(url.searchParams.entries()),
    body
  };
  const wrappedResponse = {
    status(statusCode) {
      return {
        json(payload) {
          sendNodeJson(response, statusCode, payload);
        }
      };
    }
  };
  await route(wrappedRequest, wrappedResponse);
}

async function serveStatic(pathname, response) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const safePath = normalize(requested).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(root, safePath);
  if (!filePath.startsWith(root)) {
    sendNodeJson(response, 403, { error: { message: "Forbidden" } });
    return;
  }
  const content = await readFile(filePath);
  response.writeHead(200, {
    "Content-Type": mime[extname(filePath)] || "application/octet-stream",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(content);
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8") || "{}";
  return JSON.parse(raw);
}

function sendNodeJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(JSON.stringify(payload));
}

async function loadDotEnv() {
  try {
    const envText = await readFile(join(root, ".env"), "utf8");
    for (const line of envText.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const equals = trimmed.indexOf("=");
      if (equals === -1) continue;
      const key = trimmed.slice(0, equals).trim();
      const value = trimmed.slice(equals + 1).trim();
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // Local .env is optional.
  }
}
