import http from "node:http";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import {
  dualConfig,
  evaluateInstrumentGate,
  hashJson,
  instrumentTemplateProperties,
  mintPayload,
  normalizeGateRequest,
  normalizeInstrumentProperties,
  readCurrentObject,
  readiness,
  seedInstrumentProperties,
  templateName,
  updatePayload
} from "./api/_dual.js";
import dualStatus from "./api/dual/status.js";
import currentInstrument from "./api/instruments/current.js";
import evaluateInstrument from "./api/instruments/evaluate.js";
import syncInstrument from "./api/instruments/sync.js";
import mintInstrument from "./api/instruments/mint.js";

const root = fileURLToPath(new URL(".", import.meta.url));
await loadDotEnv();

const port = Number(process.env.PORT || 4176);
const host = process.env.HOST || "127.0.0.1";
const appVersion = "0.1.0";
const mcpProtocolVersion = "2025-06-18";
const mcpServerInfo = {
  name: "dual-conditional-trade-instruments",
  version: appVersion
};

const mcpTools = [
  mcpTool("tradeflow_dual_get_status", "Read TradeFlow demo status, DUAL readiness, write boundary, and MCP endpoint metadata.", {
    type: "object",
    additionalProperties: false,
    properties: {
      include_instrument: { type: "boolean", default: true },
      compact: { type: "boolean", default: false }
    }
  }, { annotations: { readOnlyHint: true }, "x-dual": { requiresAuthentication: false, publicWrites: false } }),
  mcpTool("tradeflow_dual_get_instrument", "Read the current conditional trade instrument from DUAL when configured, otherwise return the deterministic seed object.", {
    type: "object",
    additionalProperties: false,
    properties: {}
  }, { annotations: { readOnlyHint: true }, "x-dual": { requiresAuthentication: false, publicWrites: false } }),
  mcpTool("tradeflow_dual_evaluate_gate", "Evaluate a milestone gate against the instrument mandate without writing to DUAL.", {
    type: "object",
    additionalProperties: false,
    properties: {
      instrument: { type: "object", additionalProperties: true },
      gate: {
        type: "object",
        additionalProperties: true,
        properties: {
          milestone_id: { type: "string", default: "loaded" },
          milestone_name: { type: "string", default: "Cargo loaded" },
          corridor: { type: "string", default: "SG-AU" },
          commodity_class: { type: "string", default: "medical-devices" },
          release_usd: { type: "number", default: 29700 },
          evidence_attached: { type: "boolean", default: true }
        }
      }
    }
  }, { annotations: { readOnlyHint: true }, "x-dual": { requiresAuthentication: false, publicWrites: false } }),
  mcpTool("tradeflow_dual_get_proof", "Read a portable proof bundle for the current trade instrument, including policy, instrument, event, settlement, and state hashes.", {
    type: "object",
    additionalProperties: false,
    properties: {}
  }, { annotations: { readOnlyHint: true }, "x-dual": { requiresAuthentication: false, publicWrites: false } }),
  mcpTool("tradeflow_dual_verify_proof", "Verify the current proof bundle and return checks, caveats, and hash consistency.", {
    type: "object",
    additionalProperties: false,
    properties: {}
  }, { annotations: { readOnlyHint: true }, "x-dual": { requiresAuthentication: false, publicWrites: false } }),
  mcpTool("tradeflow_dual_prepare_sync_payload", "Build the DUAL update payload for an operator-gated sync. This public MCP tool returns a preview only and does not execute writes.", {
    type: "object",
    additionalProperties: false,
    properties: {
      instrument: { type: "object", additionalProperties: true }
    }
  }, { annotations: { readOnlyHint: true }, "x-dual": { requiresWriteReadinessForExecution: true, previewOnly: true, publicWrites: false } }),
  mcpTool("tradeflow_dual_prepare_mint_payload", "Build the DUAL mint payload for the conditional trade instrument template. This public MCP tool returns a preview only and does not execute writes.", {
    type: "object",
    additionalProperties: false,
    properties: {
      instrument: { type: "object", additionalProperties: true }
    }
  }, { annotations: { readOnlyHint: true }, "x-dual": { requiresWriteReadinessForExecution: true, previewOnly: true, publicWrites: false } }),
  mcpTool("tradeflow_dual_red_team", "Run a deterministic unsafe milestone scenario and prove the verifier blocks or escalates it before release.", {
    type: "object",
    additionalProperties: false,
    properties: {
      scenario: { type: "string", enum: ["corridor_mismatch", "missing_evidence", "over_limit", "customs_missing"], default: "corridor_mismatch" }
    }
  }, { annotations: { readOnlyHint: true }, "x-dual": { requiresAuthentication: false, publicWrites: false, proactiveUse: "Call before approving unusual corridor, value, customs, or evidence requests." } })
];

const mcpResources = [
  mcpResource("tradeflow://status", "TradeFlow DUAL status", "DUAL readiness, public-write boundary, and current demo state."),
  mcpResource("tradeflow://instrument", "TradeFlow instrument", "Current conditional trade instrument properties."),
  mcpResource("tradeflow://proof", "TradeFlow proof", "Portable proof bundle and verification caveats."),
  mcpResource("tradeflow://template", "TradeFlow DUAL template", "Template name, properties, and actions for live setup."),
  mcpResource("tradeflow://safety", "TradeFlow safety", "Public MCP write boundary and red-team scenarios.")
];

const mcpPrompts = [
  {
    name: "tradeflow_demo_brief",
    description: "Summarize the Conditional Trade Instruments demo for a partner or reviewer.",
    arguments: []
  },
  {
    name: "tradeflow_next_gate_review",
    description: "Evaluate the next milestone gate and explain whether it should release payment.",
    arguments: [
      { name: "milestone_name", description: "Milestone to review, defaults to Cargo loaded.", required: false }
    ]
  },
  {
    name: "tradeflow_red_team_review",
    description: "Red-team the instrument before releasing a milestone payment.",
    arguments: [
      { name: "scenario", description: "corridor_mismatch, missing_evidence, over_limit, or customs_missing.", required: false }
    ]
  }
];

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
    if (url.pathname === "/mcp" || url.pathname === "/mcp/") {
      await handleMcp(request, response);
      return;
    }
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

async function handleMcp(request, response) {
  let requestId = null;
  try {
    assertMcpOrigin(request);
    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        ...mcpCorsHeaders(request),
        ...mcpVersionHeaders(),
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "content-type, authorization, mcp-protocol-version, mcp-session-id"
      });
      response.end();
      return;
    }
    if (request.method !== "POST") {
      sendMcpResponse(request, response, mcpError(null, -32600, "MCP endpoint accepts POST requests."), 405);
      return;
    }

    const message = await readMcpMessage(request);
    requestId = message?.id ?? null;
    if (!message || message.jsonrpc !== "2.0" || !message.method) {
      sendMcpResponse(request, response, mcpError(requestId, -32600, "Invalid JSON-RPC request."));
      return;
    }
    if (message.id === undefined && message.method.startsWith("notifications/")) {
      response.writeHead(202, { ...mcpCorsHeaders(request), ...mcpVersionHeaders() });
      response.end();
      return;
    }

    const result = await handleMcpMethod(request, message.method, message.params || {});
    sendMcpResponse(request, response, mcpResult(message.id, result));
  } catch (error) {
    sendMcpResponse(request, response, mcpError(requestId, mcpJsonRpcErrorCode(error), error.message || "MCP server error.", {
      code: error.code || "mcp_error",
      detail: error.detail || null
    }), error.status && error.status >= 400 ? error.status : 200);
  }
}

async function handleMcpMethod(request, method, params) {
  if (method === "initialize") {
    return {
      protocolVersion: mcpProtocolVersion,
      capabilities: {
        tools: {},
        resources: {},
        prompts: {}
      },
      serverInfo: mcpServerInfo,
      auth: {
        required: false,
        type: "none",
        scope: "conditional_trade_demo_read_evaluate",
        detail: "No MCP authentication is required for read/evaluate tools. Public MCP does not execute DUAL writes."
      },
      instructions: "Use TradeFlow tools to read conditional trade instrument state, evaluate milestone gates, inspect proof bundles, and prepare DUAL payload previews. The public MCP surface never executes live DUAL writes."
    };
  }
  if (method === "tools/list") return { tools: mcpTools };
  if (method === "resources/list") return { resources: mcpResources };
  if (method === "prompts/list") return { prompts: mcpPrompts };
  if (method === "tools/call") {
    try {
      return mcpJsonContent(await callMcpTool(request, params.name, params.arguments || {}));
    } catch (error) {
      return mcpToolErrorContent(error, params.name, params.arguments || {});
    }
  }
  if (method === "resources/read") {
    return {
      contents: [
        {
          uri: params.uri,
          mimeType: "application/json",
          text: JSON.stringify(await readMcpResource(request, params.uri), null, 2)
        }
      ]
    };
  }
  if (method === "prompts/get") return getMcpPrompt(params.name, params.arguments || {});
  throw Object.assign(new Error(`Unsupported MCP method: ${method}`), { code: "mcp_method_not_found" });
}

async function callMcpTool(_request, name, args) {
  switch (name) {
    case "tradeflow_dual_get_status":
      return buildMcpStatus(args);
    case "tradeflow_dual_get_instrument":
      return { ok: true, instrument: await currentInstrumentSnapshot() };
    case "tradeflow_dual_evaluate_gate":
      return evaluateGateForMcp(args);
    case "tradeflow_dual_get_proof":
      return { ok: true, proof: await buildProofBundle() };
    case "tradeflow_dual_verify_proof":
      return { ok: true, verification: await verifyProofBundle() };
    case "tradeflow_dual_prepare_sync_payload":
      return prepareSyncPayload(args);
    case "tradeflow_dual_prepare_mint_payload":
      return prepareMintPayload(args);
    case "tradeflow_dual_red_team":
      return redTeamScenario(args);
    default:
      throw Object.assign(new Error(`Unknown TradeFlow MCP tool: ${name}`), { code: "mcp_tool_not_found", status: 404 });
  }
}

async function readMcpResource(_request, uri) {
  if (uri === "tradeflow://status") return buildMcpStatus({ include_instrument: true });
  if (uri === "tradeflow://instrument") return { ok: true, instrument: await currentInstrumentSnapshot() };
  if (uri === "tradeflow://proof") return { ok: true, proof: await buildProofBundle(), verification: await verifyProofBundle() };
  if (uri === "tradeflow://template") return templateSummary();
  if (uri === "tradeflow://safety") return safetySummary();
  throw Object.assign(new Error(`Unknown TradeFlow MCP resource: ${uri}`), { code: "mcp_resource_not_found", status: 404 });
}

function getMcpPrompt(name, args) {
  if (name === "tradeflow_demo_brief") {
    return {
      description: "TradeFlow demo brief",
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: "Summarize the DUAL Conditional Trade Instruments demo. Keep the distinction clear: TradeFlow simulates the instrument workflow, DUAL supplies object state, mandate policy, verifier hashes, and readback/write scaffolding when explicitly configured."
        }
      }]
    };
  }
  if (name === "tradeflow_next_gate_review") {
    return {
      description: "TradeFlow next-gate review",
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: `Evaluate the next TradeFlow milestone gate${args.milestone_name ? ` (${args.milestone_name})` : ""}. Use tradeflow_dual_get_instrument and tradeflow_dual_evaluate_gate, then return release decision, reason, decision hash, and whether public writes are disabled.`
        }
      }]
    };
  }
  if (name === "tradeflow_red_team_review") {
    return {
      description: "TradeFlow red-team review",
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: `Run tradeflow_dual_red_team with scenario ${args.scenario || "corridor_mismatch"} and explain why the instrument should block or escalate before settlement.`
        }
      }]
    };
  }
  throw Object.assign(new Error(`Unknown TradeFlow MCP prompt: ${name}`), { code: "mcp_prompt_not_found", status: 404 });
}

async function buildMcpStatus(args = {}) {
  const snapshot = await currentInstrumentSnapshot();
  const compact = Boolean(args.compact);
  const status = {
    ok: true,
    app: mcpServerInfo.name,
    version: appVersion,
    mcp: "/mcp",
    dual: snapshot.status,
    source: snapshot.source,
    publicWrites: false,
    writeExecutionExposed: false,
    warnings: mcpWarnings(snapshot.status)
  };
  if (!compact && args.include_instrument !== false) {
    status.instrument = snapshot.properties;
    status.proof = await buildProofBundle(snapshot);
  }
  return status;
}

async function currentInstrumentSnapshot() {
  const status = readiness();
  if (status.readbackReady) {
    try {
      const current = await readCurrentObject();
      return {
        source: "dual_readback",
        available: true,
        object: current.object,
        properties: normalizeInstrumentProperties(current.properties),
        status
      };
    } catch (error) {
      return {
        source: "seed_fallback",
        available: false,
        readbackError: error.message,
        object: null,
        properties: seedInstrumentProperties(),
        status
      };
    }
  }
  return {
    source: "seed_fallback",
    available: false,
    object: null,
    properties: seedInstrumentProperties(),
    status
  };
}

async function evaluateGateForMcp(args = {}) {
  const snapshot = args.instrument
    ? {
        source: "request",
        object: null,
        properties: normalizeInstrumentProperties(args.instrument),
        status: readiness()
      }
    : await currentInstrumentSnapshot();
  const gate = normalizeGateRequest(args.gate || args.request || args);
  const evaluation = evaluateInstrumentGate(snapshot.properties, gate, {
    source: snapshot.source,
    object: snapshot.object
  });
  return {
    ok: true,
    evaluated: true,
    publicWrites: false,
    writeExecutionExposed: false,
    status: snapshot.status,
    evaluation
  };
}

async function buildProofBundle(snapshotInput = null) {
  const snapshot = snapshotInput || await currentInstrumentSnapshot();
  const properties = normalizeInstrumentProperties(snapshot.properties);
  const policyHash = properties.policy_hash || hashJson({
    corridor: properties.corridor,
    commodity_class: properties.commodity_class,
    max_instrument_usd: properties.max_instrument_usd,
    review_threshold_usd: properties.review_threshold_usd,
    sanctions_clear: properties.sanctions_clear,
    customs_preclearance: properties.customs_preclearance,
    policy_version: properties.policy_version
  });
  const instrumentHash = properties.instrument_hash || hashJson({
    instrument_id: properties.instrument_id,
    buyer: properties.buyer,
    supplier: properties.supplier,
    corridor: properties.corridor,
    commodity_class: properties.commodity_class,
    value_usd: properties.value_usd
  });
  const eventHash = properties.last_event_hash || properties.evidence_hash || hashJson({
    instrument_id: properties.instrument_id,
    current_milestone: properties.current_milestone,
    last_decision_result: properties.last_decision_result,
    last_decision_reason: properties.last_decision_reason
  });
  const settlementHash = properties.settlement_hash || hashJson({
    instrument_id: properties.instrument_id,
    released_usd: properties.released_usd,
    remaining_usd: properties.remaining_usd,
    state: properties.state
  });
  const bundle = {
    id: `tradeflow-proof-${properties.instrument_id}`,
    source: snapshot.source,
    generated_at: new Date().toISOString(),
    template: {
      name: templateName,
      template_id: snapshot.status.templateId
    },
    object: {
      object_id: snapshot.status.objectId,
      readback_ready: snapshot.status.readbackReady,
      writable: snapshot.status.writable,
      public_writes: false
    },
    instrument: properties,
    hashes: {
      policy_hash: policyHash,
      instrument_hash: instrumentHash,
      event_hash: eventHash,
      settlement_hash: settlementHash
    },
    caveats: proofCaveats(snapshot.status)
  };
  return {
    ...bundle,
    bundle_hash: hashJson({
      template: bundle.template,
      object: bundle.object,
      instrument: bundle.instrument,
      hashes: bundle.hashes,
      caveats: bundle.caveats
    })
  };
}

async function verifyProofBundle() {
  const proof = await buildProofBundle();
  const checks = [
    {
      name: "instrument_hash_present",
      ok: Boolean(proof.hashes.instrument_hash)
    },
    {
      name: "policy_hash_present",
      ok: Boolean(proof.hashes.policy_hash)
    },
    {
      name: "settlement_hash_present",
      ok: Boolean(proof.hashes.settlement_hash)
    },
    {
      name: "public_writes_disabled",
      ok: proof.object.public_writes === false
    },
    {
      name: "readback_or_seed_declared",
      ok: ["dual_readback", "seed_fallback", "request"].includes(proof.source)
    }
  ];
  return {
    ok: checks.every((check) => check.ok),
    proofHash: proof.bundle_hash,
    source: proof.source,
    readbackReady: proof.object.readback_ready,
    writable: proof.object.writable,
    publicWrites: proof.object.public_writes,
    checks,
    caveats: proof.caveats
  };
}

async function prepareSyncPayload(args = {}) {
  const snapshot = await currentInstrumentSnapshot();
  const properties = normalizeInstrumentProperties(args.instrument || snapshot.properties);
  const config = dualConfig();
  const payload = updatePayload(config.objectId || "<DUAL_CONDITIONAL_TRADE_OBJECT_ID>", properties, {
    event_hash: properties.last_event_hash || properties.settlement_hash
  });
  return {
    ok: true,
    prepared: true,
    executed: false,
    publicWrites: false,
    reason: "Public MCP returns an update payload preview only. Use the operator-gated REST sync endpoint after explicit live-write approval.",
    readiness: readiness(),
    payload_preview: payload
  };
}

async function prepareMintPayload(args = {}) {
  const snapshot = await currentInstrumentSnapshot();
  const properties = normalizeInstrumentProperties(args.instrument || snapshot.properties);
  const config = dualConfig();
  const payload = mintPayload(config.templateId || "<DUAL_CONDITIONAL_TRADE_TEMPLATE_ID>", properties);
  return {
    ok: true,
    prepared: true,
    executed: false,
    publicWrites: false,
    reason: "Public MCP returns a mint payload preview only. Use the operator-gated REST mint endpoint after explicit live-write approval.",
    readiness: readiness(),
    payload_preview: payload
  };
}

async function redTeamScenario(args = {}) {
  const snapshot = await currentInstrumentSnapshot();
  const scenario = args.scenario || "corridor_mismatch";
  const instrument = {
    ...snapshot.properties,
    ...(scenario === "over_limit" ? { value_usd: snapshot.properties.max_instrument_usd + 5000 } : {}),
    ...(scenario === "customs_missing" ? { customs_preclearance: false, current_milestone: "Customs cleared" } : {})
  };
  const gate = {
    milestone_id: scenario === "customs_missing" ? "customs" : "loaded",
    milestone_name: scenario === "customs_missing" ? "Customs cleared" : "Cargo loaded",
    corridor: scenario === "corridor_mismatch" ? "CN-AU" : snapshot.properties.corridor,
    commodity_class: snapshot.properties.commodity_class,
    release_usd: scenario === "customs_missing" ? 37125 : 29700,
    evidence_attached: scenario !== "missing_evidence",
    customs_preclearance: scenario !== "customs_missing"
  };
  const evaluation = evaluateInstrumentGate(instrument, gate, {
    source: `red_team:${scenario}`,
    object: snapshot.object
  });
  return {
    ok: true,
    scenario,
    blockedOrEscalated: evaluation.result !== "Approved",
    publicWrites: false,
    evaluation
  };
}

function templateSummary() {
  return {
    ok: true,
    template: {
      name: templateName,
      category: "conditional-trade-instrument",
      properties: instrumentTemplateProperties(),
      actions: ["mint", "update"]
    },
    readiness: readiness(),
    publicWrites: false
  };
}

function safetySummary() {
  return {
    ok: true,
    publicWrites: false,
    writeExecutionExposed: false,
    operatorGatedRestEndpoints: ["/api/instruments/sync", "/api/instruments/mint"],
    publicMcpToolsExecuteWrites: false,
    redTeamScenarios: ["corridor_mismatch", "missing_evidence", "over_limit", "customs_missing"],
    liveWriteBoundary: "Live DUAL writes require explicit approval, DUAL_API_KEY, template/object ids, DEMO_OPERATOR_TOKEN, and DUAL_WRITE_MODE=event_bus."
  };
}

function proofCaveats(status) {
  const caveats = [];
  if (!status.readbackReady) caveats.push("DUAL readback is not configured; proof uses deterministic seed instrument properties.");
  if (!status.writable) caveats.push("Live DUAL event-bus writes are disabled; public MCP only reads, evaluates, and prepares payload previews.");
  if (status.missing?.length) caveats.push(`Missing live setup: ${status.missing.join(", ")}.`);
  return caveats;
}

function mcpWarnings(status) {
  const warnings = [];
  if (!status.readbackReady) {
    warnings.push({
      code: "dual_readback_not_configured",
      message: "MCP returns seed fallback until DUAL_API_KEY and DUAL_CONDITIONAL_TRADE_OBJECT_ID are configured."
    });
  }
  if (!status.writable) {
    warnings.push({
      code: "dual_writes_disabled",
      message: "Public MCP does not execute DUAL writes. Sync and mint are preview-only unless the operator-gated REST endpoints are explicitly configured."
    });
  }
  return warnings;
}

function mcpTool(name, description, inputSchema, options = {}) {
  return { name, description, inputSchema, ...options };
}

function mcpResource(uri, name, description) {
  return { uri, name, description, mimeType: "application/json" };
}

async function readMcpMessage(request) {
  try {
    return await readJson(request);
  } catch {
    const error = new Error("Request body must be valid JSON.");
    error.status = 400;
    error.code = "invalid_json";
    throw error;
  }
}

function sendMcpResponse(request, response, payload, status = 200) {
  response.writeHead(status, {
    ...mcpCorsHeaders(request),
    ...mcpVersionHeaders(),
    "Content-Type": "application/json; charset=utf-8",
    "Mcp-Session-Id": mcpSessionId(request)
  });
  response.end(JSON.stringify(payload, null, 2));
}

function mcpResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function mcpError(id, code, message, data = null) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message, data } };
}

function mcpJsonContent(data) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(data, null, 2)
      }
    ]
  };
}

function mcpToolErrorContent(error, name, args) {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify({
          ok: false,
          tool_name: name || null,
          error: {
            code: error.code || "mcp_tool_failed",
            message: error.message || "TradeFlow MCP tool failed.",
            status: error.status || null,
            detail: error.detail || null
          },
          retryable: [408, 429, 500, 502, 503, 504].includes(Number(error.status)),
          arguments: redactMcpArguments(args)
        }, null, 2)
      }
    ]
  };
}

function assertMcpOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return;
  const allowed = (process.env.DEMO_MCP_ALLOWED_ORIGINS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (allowed.includes("*") || allowed.includes(origin)) return;
  let originHost = "";
  try {
    originHost = new URL(origin).host;
  } catch {
    originHost = "";
  }
  const requestHost = String(request.headers["x-forwarded-host"] || request.headers.host || "").split(",")[0].trim();
  if (originHost && requestHost && originHost === requestHost) return;
  if (originHost.startsWith("127.0.0.1") || originHost.startsWith("localhost")) return;
  const error = new Error("MCP origin is not allowed.");
  error.status = 403;
  error.code = "mcp_origin_denied";
  throw error;
}

function mcpCorsHeaders(request) {
  const origin = request.headers.origin;
  if (!origin) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Expose-Headers": "mcp-session-id, x-tradeflow-version, x-mcp-protocol-version, x-mcp-schema-version",
    Vary: "origin"
  };
}

function mcpVersionHeaders() {
  return {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-TradeFlow-Version": appVersion,
    "X-MCP-Protocol-Version": mcpProtocolVersion,
    "X-MCP-Schema-Version": `${appVersion}:${mcpTools.length}`
  };
}

function mcpJsonRpcErrorCode(error) {
  if (error.code === "mcp_method_not_found") return -32601;
  if (error.status === 400 || error.code === "argument_required") return -32602;
  return -32000;
}

function mcpSessionId(request) {
  const supplied = String(request.headers["mcp-session-id"] || "").trim();
  if (/^[a-zA-Z0-9._:-]{4,128}$/.test(supplied)) return supplied;
  const fingerprint = [
    request.headers["x-forwarded-host"] || request.headers.host || "",
    request.headers.origin || "",
    request.headers["x-forwarded-for"] || request.socket?.remoteAddress || "",
    request.headers["user-agent"] || ""
  ].join("|");
  return `mcp-${createHash("sha256").update(fingerprint).digest("hex").slice(0, 18)}`;
}

function redactMcpArguments(args = {}) {
  return Object.fromEntries(Object.entries(args).map(([key, value]) => {
    if (/token|secret|key|authorization/i.test(key)) return [key, "[REDACTED]"];
    return [key, value];
  }));
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
