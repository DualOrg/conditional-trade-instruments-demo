import http from "node:http";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import {
  deriveProofHashes,
  dualConfig,
  evaluateInstrumentGate,
  hashJson,
  instrumentTemplateProperties,
  mintPayload,
  normalizeEvidenceRefs,
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

const viewInputSchema = {
  type: "string",
  enum: ["compact", "full"],
  default: "compact",
  description: "compact returns decision-critical fields without repeated policy/instrument blocks; full returns the complete diagnostic envelope."
};

const evidenceRefInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    type: { type: "string", description: "Evidence class, for example bill_of_lading, gps_fix, customs_clearance, inspection_photo, signed_attestation." },
    id: { type: "string", description: "Document id, CID, attestation id, or source-local evidence id." },
    hash: { type: "string", description: "Content hash or signed attestation hash. If omitted, the demo derives one from the reference fields." },
    issuer: { type: "string", description: "Issuer or oracle that produced the evidence reference." },
    uri: { type: "string", description: "Optional evidence URI such as ipfs://, ar://, https://, or demo://." }
  }
};

const instrumentInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    instrument_id: { type: "string" },
    buyer: { type: "string" },
    supplier: { type: "string" },
    buyer_agent: { type: "string" },
    corridor: { type: "string" },
    commodity_class: { type: "string" },
    payment_rail: { type: "string" },
    state: { type: "string" },
    value_usd: { type: "number" },
    max_instrument_usd: { type: "number" },
    review_threshold_usd: { type: "number" },
    sanctions_clear: { type: "boolean" },
    customs_preclearance: { type: "boolean" },
    current_milestone: { type: "string", description: "Next milestone awaiting verification, not the last verified milestone." },
    verified_milestones: { type: "number", description: "Count of milestone gates already verified before the current gate." },
    released_usd: { type: "number" },
    remaining_usd: { type: "number" },
    blocked_actions: { type: "number" },
    halt_reason: { type: "string" },
    policy_version: { type: "number" },
    policy_hash: { type: "string" },
    instrument_hash: { type: "string" },
    evidence_hash: { type: "string" },
    evidence_refs: { type: "array", items: evidenceRefInputSchema },
    last_event_hash: { type: "string" },
    settlement_hash: { type: "string" },
    last_decision_result: { type: "string" },
    last_decision_reason: { type: "string" },
    updated_at: { type: "string" }
  }
};

const gateInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    milestone_id: { type: "string", default: "loaded" },
    milestone_name: { type: "string", default: "Cargo loaded" },
    corridor: { type: "string", default: "SG-AU" },
    commodity_class: { type: "string", default: "medical-devices" },
    release_usd: { type: "number", default: 29700 },
    evidence_attached: { type: "boolean", default: true },
    evidence_type: { type: "string", default: "BOL + GPS fix" },
    evidence_refs: { type: "array", items: evidenceRefInputSchema },
    customs_preclearance: { type: "boolean", default: true }
  }
};

const mcpTools = [
  mcpTool("tradeflow_dual_get_status", "Read TradeFlow demo status, DUAL readiness, write boundary, and MCP endpoint metadata.", {
    type: "object",
    additionalProperties: false,
    properties: {
      include_instrument: { type: "boolean", default: false },
      compact: { type: "boolean", default: false },
      view: viewInputSchema
    }
  }, { annotations: { readOnlyHint: true }, "x-dual": { requiresAuthentication: false, publicWrites: false } }),
  mcpTool("tradeflow_dual_get_instrument", "Read the current conditional trade instrument from DUAL when configured, otherwise return the deterministic seed object.", {
    type: "object",
    additionalProperties: false,
    properties: {
      view: { ...viewInputSchema, default: "full" }
    }
  }, { annotations: { readOnlyHint: true }, "x-dual": { requiresAuthentication: false, publicWrites: false } }),
  mcpTool("tradeflow_dual_get_policy", "Read the discoverable mandate policy: supported corridors, commodity classes, payment rails, ceilings, evidence contract, result convention, and operator-gate boundary.", {
    type: "object",
    additionalProperties: false,
    properties: {}
  }, { annotations: { readOnlyHint: true }, "x-dual": { requiresAuthentication: false, publicWrites: false } }),
  mcpTool("tradeflow_dual_get_policy_history", "Read the immutable policy version registry used to verify older proofs against the policy version they were issued under.", {
    type: "object",
    additionalProperties: false,
    properties: {}
  }, { annotations: { readOnlyHint: true }, "x-dual": { requiresAuthentication: false, publicWrites: false } }),
  mcpTool("tradeflow_dual_evaluate_gate", "Evaluate a milestone gate against the instrument mandate without writing to DUAL. Tool ok=true means the MCP call succeeded; inspect evaluation.result for Approved, Approved with review, Needs evidence, or Blocked.", {
    type: "object",
    additionalProperties: false,
    properties: {
      instrument: instrumentInputSchema,
      gate: gateInputSchema,
      view: viewInputSchema
    }
  }, { annotations: { readOnlyHint: true }, "x-dual": { requiresAuthentication: false, publicWrites: false } }),
  mcpTool("tradeflow_dual_get_proof", "Read a portable proof bundle for the current trade instrument, including policy, instrument, event, settlement, and state hashes.", {
    type: "object",
    additionalProperties: false,
    properties: {
      view: { ...viewInputSchema, default: "full" }
    }
  }, { annotations: { readOnlyHint: true }, "x-dual": { requiresAuthentication: false, publicWrites: false } }),
  mcpTool("tradeflow_dual_verify_proof", "Verify the current proof bundle and return checks, caveats, and hash consistency.", {
    type: "object",
    additionalProperties: false,
    properties: {
      view: viewInputSchema
    }
  }, { annotations: { readOnlyHint: true }, "x-dual": { requiresAuthentication: false, publicWrites: false } }),
  mcpTool("tradeflow_dual_prepare_sync_payload", "Build the DUAL update payload for an operator-gated sync. This public MCP tool returns a preview only and does not execute writes.", {
    type: "object",
    additionalProperties: false,
    properties: {
      instrument: instrumentInputSchema,
      view: viewInputSchema
    }
  }, { annotations: { readOnlyHint: true }, "x-dual": { requiresWriteReadinessForExecution: true, previewOnly: true, publicWrites: false } }),
  mcpTool("tradeflow_dual_prepare_mint_payload", "Build the DUAL mint payload for the conditional trade instrument template. This public MCP tool returns a preview only and does not execute writes.", {
    type: "object",
    additionalProperties: false,
    properties: {
      instrument: instrumentInputSchema,
      view: viewInputSchema
    }
  }, { annotations: { readOnlyHint: true }, "x-dual": { requiresWriteReadinessForExecution: true, previewOnly: true, publicWrites: false } }),
  mcpTool("tradeflow_dual_get_mint_status", "Read the mint/readback status for the conditional trade instrument. This never lists private wallets or executes mint writes.", {
    type: "object",
    additionalProperties: false,
    properties: {}
  }, { annotations: { readOnlyHint: true }, "x-dual": { requiresAuthentication: false, publicWrites: false } }),
  mcpTool("tradeflow_dual_simulate_lifecycle", "Simulate a milestone lifecycle inside one MCP response. The public MCP remains stateless; this helper threads state locally and does not persist to DUAL.", {
    type: "object",
    additionalProperties: false,
    properties: {
      instrument: instrumentInputSchema,
      gates: { type: "array", items: gateInputSchema },
      halt_on_block: { type: "boolean", default: true },
      steps_view: {
        type: "string",
        enum: ["summary", "evaluation", "full"],
        default: "summary",
        description: "summary returns one compact row per step; evaluation returns the previous step envelope; full returns summary steps plus full_steps diagnostics."
      },
      view: viewInputSchema
    }
  }, { annotations: { readOnlyHint: true }, "x-dual": { requiresAuthentication: false, publicWrites: false, persisted: false } }),
  mcpTool("tradeflow_dual_evaluate_adversarial_gate", "Evaluate an arbitrary adversarial gate and compare the verifier result to an expected result.", {
    type: "object",
    additionalProperties: false,
    required: ["expect", "gate"],
    properties: {
      instrument: instrumentInputSchema,
      gate: gateInputSchema,
      expect: { type: "string", enum: ["Approved", "Approved with review", "Needs evidence", "Blocked", "blocked_or_escalated"], description: "blocked_or_escalated matches any non-Approved result: Blocked, Needs evidence, or Approved with review." },
      view: viewInputSchema
    }
  }, { annotations: { readOnlyHint: true }, "x-dual": { requiresAuthentication: false, publicWrites: false } }),
  mcpTool("tradeflow_dual_red_team", "Run a deterministic unsafe milestone scenario and prove the verifier blocks or escalates it before release. Tool ok=true means the MCP call succeeded; blockedOrEscalated=true means the verifier did its job.", {
    type: "object",
    additionalProperties: false,
    properties: {
      scenario: { type: "string", enum: ["corridor_mismatch", "missing_evidence", "over_limit", "customs_missing"], default: "corridor_mismatch" },
      view: viewInputSchema
    }
  }, { annotations: { readOnlyHint: true }, "x-dual": { requiresAuthentication: false, publicWrites: false, proactiveUse: "Call before approving unusual corridor, value, customs, or evidence requests." } })
];

const mcpResources = [
  mcpResource("tradeflow://status", "TradeFlow DUAL status", "DUAL readiness, public-write boundary, and current demo state."),
  mcpResource("tradeflow://instrument", "TradeFlow instrument", "Current conditional trade instrument properties."),
  mcpResource("tradeflow://policy", "TradeFlow policy", "Supported corridors, commodity classes, mandate ceilings, evidence contract, and operator-gate boundary."),
  mcpResource("tradeflow://policy-history", "TradeFlow policy history", "Immutable policy version registry for old proof verification."),
  mcpResource("tradeflow://proof", "TradeFlow proof", "Portable proof bundle and verification caveats."),
  mcpResource("tradeflow://mint-status", "TradeFlow mint status", "Mint/readback readiness and current object handle, without executing writes."),
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
      instructions: "Use TradeFlow tools to read conditional trade instrument state, discover policy inputs, evaluate milestone gates, inspect proof bundles, simulate lifecycle state, and prepare DUAL payload previews. The public MCP surface never executes live DUAL writes."
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
      validateTopLevelArgs(args, ["include_instrument", "compact", "view"], name);
      return buildMcpStatus(args);
    case "tradeflow_dual_get_instrument":
      validateTopLevelArgs(args, ["view"], name);
      return { ok: true, instrument: instrumentEnvelope(await currentInstrumentSnapshot(), { view: viewMode(args, "full") }) };
    case "tradeflow_dual_get_policy":
      validateTopLevelArgs(args, [], name);
      return { ok: true, policy: policyMetadata(), publicWrites: false };
    case "tradeflow_dual_get_policy_history":
      validateTopLevelArgs(args, [], name);
      return { ok: true, policy_history: policyHistory(), publicWrites: false };
    case "tradeflow_dual_evaluate_gate":
      validateTopLevelArgs(args, ["instrument", "gate", "view"], name);
      return evaluateGateForMcp(args);
    case "tradeflow_dual_get_proof":
      validateTopLevelArgs(args, ["view"], name);
      return { ok: true, proof: await buildProofBundle(null, { view: viewMode(args, "full") }) };
    case "tradeflow_dual_verify_proof":
      validateTopLevelArgs(args, ["view"], name);
      return { ok: true, verification: await verifyProofBundle({ view: viewMode(args) }) };
    case "tradeflow_dual_prepare_sync_payload":
      validateTopLevelArgs(args, ["instrument", "view"], name);
      return prepareSyncPayload(args);
    case "tradeflow_dual_prepare_mint_payload":
      validateTopLevelArgs(args, ["instrument", "view"], name);
      return prepareMintPayload(args);
    case "tradeflow_dual_get_mint_status":
      validateTopLevelArgs(args, [], name);
      return getMintStatus();
    case "tradeflow_dual_simulate_lifecycle":
      validateTopLevelArgs(args, ["instrument", "gates", "halt_on_block", "steps_view", "view"], name);
      return simulateLifecycle(args);
    case "tradeflow_dual_evaluate_adversarial_gate":
      validateTopLevelArgs(args, ["instrument", "gate", "expect", "view"], name);
      return evaluateAdversarialGate(args);
    case "tradeflow_dual_red_team":
      validateTopLevelArgs(args, ["scenario", "view"], name);
      return redTeamScenario(args);
    default:
      throw Object.assign(new Error(`Unknown TradeFlow MCP tool: ${name}`), { code: "mcp_tool_not_found", status: 404 });
  }
}

async function readMcpResource(_request, uri) {
  if (uri === "tradeflow://status") return buildMcpStatus({ include_instrument: true });
  if (uri === "tradeflow://instrument") return { ok: true, instrument: instrumentEnvelope(await currentInstrumentSnapshot()) };
  if (uri === "tradeflow://policy") return { ok: true, policy: policyMetadata(), publicWrites: false };
  if (uri === "tradeflow://policy-history") return { ok: true, policy_history: policyHistory(), publicWrites: false };
  if (uri === "tradeflow://proof") return { ok: true, proof: await buildProofBundle(), verification: await verifyProofBundle() };
  if (uri === "tradeflow://mint-status") return getMintStatus();
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
  const view = viewMode(args, "compact");
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
  if (view === "full" && args.include_instrument !== false) {
    status.instrument = instrumentEnvelope(snapshot, { view: "full" });
    status.proof = await buildProofBundle(snapshot, { view: "full" });
  } else if (args.include_instrument === true) {
    status.instrument = instrumentEnvelope(snapshot, { view: "compact" });
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

function instrumentEnvelope(snapshot, options = {}) {
  const properties = normalizeInstrumentProperties(snapshot.properties);
  const view = viewMode(options, "full");
  const hashes = deriveProofHashes(properties, {
    gate: options.eventGate || null,
    evidence_refs: options.evidenceRefs !== undefined ? options.evidenceRefs : properties.evidence_refs
  });
  const declared = declaredHashes(properties);
  const envelope = {
    source: snapshot.source,
    available: Boolean(snapshot.available),
    object: objectEnvelope(snapshot),
    properties,
    evidence: {
      count: properties.evidence_refs.length,
      refs: properties.evidence_refs,
      hash: properties.evidence_hash || hashes.evidence_hash
    },
    hashes: {
      declared,
      derived: hashes,
      verification: hashVerification(declared, hashes)
    },
    caveats: proofCaveats(snapshot.status)
  };
  if (view === "compact") {
    return {
      ...envelope,
      policy_uri: "tradeflow://policy",
      semantics_uri: "tradeflow://policy"
    };
  }
  return {
    ...envelope,
    semantics: {
      current_milestone: "Next milestone awaiting verification, not the last verified milestone.",
      verified_milestones: "Count of completed milestone gates before the current gate.",
      stateless_public_mcp: "Read/evaluate tools do not persist lifecycle state. Use tradeflow_dual_simulate_lifecycle to thread a sequence in one response."
    },
    policy: policyMetadata()
  };
}

function objectEnvelope(snapshot) {
  return {
    object_id: snapshot.status.objectId || snapshot.object?.id || null,
    template_id: snapshot.status.templateId || snapshot.object?.templateId || null,
    state_hash: snapshot.object?.stateHash || null,
    integrity_hash: snapshot.object?.integrityHash || null,
    readback_ready: snapshot.status.readbackReady,
    writable: snapshot.status.writable,
    public_writes: false
  };
}

async function snapshotFromArgs(args = {}) {
  if (args.instrument === undefined) return currentInstrumentSnapshot();
  validatePlainObject(args.instrument, "instrument");
  validateAllowedFields(args.instrument, new Set(Object.keys(instrumentTemplateProperties())), "invalid_instrument_fields", "instrument");
  validateEvidenceRefList(args.instrument.evidence_refs, "instrument.evidence_refs");
  const properties = normalizeInstrumentProperties(args.instrument);
  return {
    source: "request",
    available: true,
    object: null,
    properties,
    status: readiness()
  };
}

function gateFromArgs(args = {}) {
  const rawGate = args.gate || args.request || pickAllowedFields(args, gateFieldNames());
  validatePlainObject(rawGate, "gate");
  validateAllowedFields(rawGate, new Set(gateFieldNames()), "invalid_gate_fields", "gate");
  validateEvidenceRefList(rawGate.evidence_refs, "gate.evidence_refs");
  return normalizeGateRequest(rawGate);
}

function gatesFromArgs(args = {}) {
  if (!args.gates) return defaultLifecycleGates();
  if (!Array.isArray(args.gates)) {
    throw Object.assign(new Error("gates must be an array of milestone gate objects."), {
      status: 400,
      code: "invalid_gates"
    });
  }
  return args.gates.map((gate) => {
    validatePlainObject(gate, "gate");
    validateAllowedFields(gate, new Set(gateFieldNames()), "invalid_gate_fields", "gate");
    validateEvidenceRefList(gate.evidence_refs, "gate.evidence_refs");
    return normalizeGateRequest(gate);
  });
}

function gateFieldNames() {
  return [
    "milestone_id",
    "milestone_name",
    "corridor",
    "commodity_class",
    "release_usd",
    "evidence_attached",
    "evidence_type",
    "evidence_refs",
    "customs_preclearance"
  ];
}

function pickAllowedFields(input, allowed) {
  return Object.fromEntries(Object.entries(input || {}).filter(([key]) => allowed.includes(key)));
}

function validatePlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw Object.assign(new Error(`${label} must be an object.`), {
      status: 400,
      code: `invalid_${label}`
    });
  }
}

function validateAllowedFields(value, allowed, code, label) {
  const unknown = Object.keys(value || {}).filter((key) => !allowed.has(key));
  if (!unknown.length) return;
  throw Object.assign(new Error(`${label} includes unsupported field(s): ${unknown.join(", ")}.`), {
    status: 400,
    code,
    detail: {
      unknown,
      allowed: Array.from(allowed)
    }
  });
}

function validateTopLevelArgs(args = {}, allowedKeys = [], label = "tool") {
  validatePlainObject(args, "arguments");
  validateAllowedFields(args, new Set(allowedKeys), "invalid_arguments", label);
}

function validateEvidenceRefList(refs, label) {
  if (refs === undefined) return;
  if (!Array.isArray(refs)) {
    throw Object.assign(new Error(`${label} must be an array.`), {
      status: 400,
      code: "invalid_evidence_refs"
    });
  }
  const allowed = new Set(["type", "id", "hash", "issuer", "uri"]);
  refs.forEach((ref, index) => {
    validatePlainObject(ref, `${label}[${index}]`);
    validateAllowedFields(ref, allowed, "invalid_evidence_ref_fields", `${label}[${index}]`);
  });
}

function viewMode(args = {}, fallback = "compact") {
  if (args.compact === true) return "compact";
  const view = args.view || fallback;
  if (view === "compact" || view === "full") return view;
  throw Object.assign(new Error(`view must be "compact" or "full", got "${view}".`), {
    status: 400,
    code: "invalid_view"
  });
}

function stepsViewMode(args = {}, view = "compact") {
  const mode = args.steps_view || (view === "compact" ? "summary" : "evaluation");
  if (["summary", "evaluation", "full"].includes(mode)) return mode;
  throw Object.assign(new Error(`steps_view must be "summary", "evaluation", or "full", got "${mode}".`), {
    status: 400,
    code: "invalid_steps_view"
  });
}

function declaredHashes(properties) {
  return {
    policy_hash: properties.policy_hash || "",
    instrument_hash: properties.instrument_hash || "",
    evidence_hash: properties.evidence_hash || "",
    last_event_hash: properties.last_event_hash || "",
    settlement_hash: properties.settlement_hash || ""
  };
}

function hashVerification(declared, derived) {
  return {
    policy_hash: hashCheck(declared.policy_hash, derived.policy_hash, "policy_hash"),
    instrument_hash: hashCheck(declared.instrument_hash, derived.instrument_hash, "instrument_hash"),
    evidence_hash: hashCheck(declared.evidence_hash, derived.evidence_hash, "evidence_hash"),
    last_event_hash: hashCheck(declared.last_event_hash, derived.event_hash, "event_hash"),
    settlement_hash: hashCheck(declared.settlement_hash, derived.settlement_hash, "settlement_hash")
  };
}

function hashCheck(declared, derived, derivedName) {
  const declaredValue = declared || "";
  return {
    declared: declaredValue || null,
    derived,
    derivedName,
    verifies: declaredValue ? declaredValue === derived : null,
    note: declaredValue
      ? declaredValue === derived
        ? "Declared hash matches the value re-derived for this response context."
        : "Declared hash does not match the value re-derived for this response context."
      : "No declared hash was supplied; verifier used the re-derived value."
  };
}

function compactEvaluation(evaluation) {
  return {
    allowed: evaluation.allowed,
    result: evaluation.result,
    code: evaluation.code,
    reason: evaluation.reason,
    source: evaluation.source,
    gate: evaluation.gate,
    proof: {
      policy_hash: evaluation.proof.policy_hash,
      instrument_hash: evaluation.proof.instrument_hash,
      evidence_hash: evaluation.proof.evidence_hash,
      event_hash: evaluation.proof.event_hash,
      settlement_hash: evaluation.proof.settlement_hash,
      decision_hash: evaluation.proof.decision_hash,
      decision_content_hash: evaluation.proof.decision_content_hash,
      decision_envelope_hash: evaluation.proof.decision_envelope_hash,
      decision_hash_semantics: evaluation.proof.decision_hash_semantics,
      evidence_refs: evaluation.proof.evidence_refs,
      evidence_anchor: evaluation.proof.evidence_anchor,
      evaluated_at: evaluation.proof.evaluated_at
    }
  };
}

function compactProof(proof) {
  return {
    id: proof.id,
    source: proof.source,
    generated_at: proof.generated_at,
    object: proof.object,
    instrument_id: proof.instrument.properties.instrument_id,
    state: proof.instrument.properties.state,
    current_milestone: proof.instrument.properties.current_milestone,
    hashes: proof.hashes,
    hash_verification: proof.instrument.hashes.verification,
    bundle_hash: proof.bundle_hash,
    caveats: proof.caveats,
    full_resource: "tradeflow://proof"
  };
}

function lifecycleStepSummary(step) {
  return {
    step: step.step,
    milestone_id: step.gate.milestone_id,
    milestone_name: step.gate.milestone_name,
    result: step.evaluation.result,
    code: step.evaluation.code,
    released_usd: step.state.released_usd,
    remaining_usd: step.state.remaining_usd,
    halted: step.halted_after_step,
    halt_reason: step.state.halt_reason || null,
    decision_content_hash: step.evaluation.proof.decision_content_hash
  };
}

function mergeEvidenceRefs(existing = [], incoming = []) {
  const merged = normalizeEvidenceRefs([...existing, ...incoming], []);
  const seen = new Set();
  return merged.filter((item) => {
    const key = `${item.type}:${item.id}:${item.hash}:${item.uri}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function defaultLifecycleGates() {
  return [
    {
      milestone_id: "loaded",
      milestone_name: "Cargo loaded",
      corridor: "SG-AU",
      commodity_class: "medical-devices",
      release_usd: 29700,
      evidence_attached: true,
      evidence_type: "BOL + GPS fix",
      evidence_refs: [
        { type: "bill_of_lading", id: "BOL-8842", issuer: "Lion City Precision", uri: "demo://evidence/bol-8842" },
        { type: "gps_fix", id: "GPS-SIN-SYD-20260527", issuer: "TradeFlow route oracle", uri: "demo://evidence/gps-sin-syd-20260527" }
      ]
    },
    {
      milestone_id: "customs",
      milestone_name: "Customs cleared",
      corridor: "SG-AU",
      commodity_class: "medical-devices",
      release_usd: 37125,
      evidence_attached: true,
      evidence_type: "AU ICS clearance",
      evidence_refs: [
        { type: "customs_clearance", id: "AU-ICS-7721", issuer: "Australian border broker", uri: "demo://evidence/au-ics-7721" }
      ]
    },
    {
      milestone_id: "inspection",
      milestone_name: "Inspection complete",
      corridor: "SG-AU",
      commodity_class: "medical-devices",
      release_usd: 37125,
      evidence_attached: true,
      evidence_type: "Inspection photo set",
      evidence_refs: [
        { type: "inspection_photo_set", id: "INSPECT-SYD-4109", issuer: "Warehouse QA agent", uri: "demo://evidence/inspect-syd-4109" }
      ]
    },
    {
      milestone_id: "delivered",
      milestone_name: "Buyer acceptance",
      corridor: "SG-AU",
      commodity_class: "medical-devices",
      release_usd: 44550,
      evidence_attached: true,
      evidence_type: "Acceptance certificate",
      evidence_refs: [
        { type: "acceptance_certificate", id: "ACCEPT-AUSMED-001", issuer: "AUS MedTech Pty Ltd", uri: "demo://evidence/accept-ausmed-001" }
      ]
    }
  ];
}

async function evaluateGateForMcp(args = {}) {
  const snapshot = await snapshotFromArgs(args);
  const gate = gateFromArgs(args);
  const view = viewMode(args);
  const evaluation = evaluateInstrumentGate(snapshot.properties, gate, {
    source: snapshot.source,
    object: snapshot.object
  });
  const response = {
    ok: true,
    evaluated: true,
    publicWrites: false,
    writeExecutionExposed: false,
    resultConvention: "ok=true means the MCP call succeeded. Use evaluation.result and evaluation.allowed for the release decision.",
    status: snapshot.status,
    evaluation: view === "full" ? evaluation : compactEvaluation(evaluation)
  };
  if (view === "full") {
    response.instrument = instrumentEnvelope(snapshot, { view: "full" });
    response.policy = policyMetadata();
  } else {
    response.policy_uri = "tradeflow://policy";
  }
  return response;
}

async function buildProofBundle(snapshotInput = null, options = {}) {
  const snapshot = snapshotInput || await currentInstrumentSnapshot();
  const properties = normalizeInstrumentProperties(snapshot.properties);
  const hashes = deriveProofHashes(properties);
  const declared = declaredHashes(properties);
  const view = viewMode(options, "full");
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
    instrument: instrumentEnvelope(snapshot, { view }),
    hashes,
    declared_hashes: declared,
    derived_hashes: hashes,
    caveats: proofCaveats(snapshot.status)
  };
  const proof = {
    ...bundle,
    bundle_hash: hashJson({
      template: bundle.template,
      object: bundle.object,
      instrument: bundle.instrument,
      hashes: bundle.hashes,
      declared_hashes: bundle.declared_hashes,
      caveats: bundle.caveats
    })
  };
  return view === "compact" ? compactProof(proof) : proof;
}

async function verifyProofBundle(options = {}) {
  const view = viewMode(options);
  const proof = await buildProofBundle(null, { view: "full" });
  const properties = proof.instrument.properties;
  const rederived = deriveProofHashes(properties);
  const declared = declaredHashes(properties);
  const declaredEntries = Object.entries(declared).filter(([, value]) => Boolean(value));
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
      name: "event_hash_present",
      ok: Boolean(proof.hashes.event_hash)
    },
    {
      name: "evidence_hash_present",
      ok: Boolean(proof.hashes.evidence_hash)
    },
    {
      name: "policy_hash_rederived",
      ok: proof.hashes.policy_hash === rederived.policy_hash
    },
    {
      name: "instrument_hash_rederived",
      ok: proof.hashes.instrument_hash === rederived.instrument_hash
    },
    {
      name: "evidence_hash_rederived",
      ok: proof.hashes.evidence_hash === rederived.evidence_hash
    },
    {
      name: "event_hash_rederived",
      ok: proof.hashes.event_hash === rederived.event_hash
    },
    {
      name: "settlement_hash_rederived",
      ok: proof.hashes.settlement_hash === rederived.settlement_hash
    },
    {
      name: "declared_hashes_match_rederived",
      ok: declaredEntries.every(([key, value]) => {
        const proofKey = key === "last_event_hash" ? "event_hash" : key;
        return value === rederived[proofKey];
      })
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
    hashes: proof.hashes,
    declaredHashes: view === "full" ? declared : undefined,
    rederivedHashes: view === "full" ? rederived : undefined,
    hashVerification: hashVerification(declared, rederived),
    verificationLevel: proof.source === "dual_readback" ? "dual_readback_rederived" : "deterministic_seed_rederived",
    limitation: proof.source === "dual_readback"
      ? "Hashes are re-derived from the configured DUAL object readback."
      : "DUAL readback is not configured, so hashes are re-derived from the deterministic seed instrument.",
    checks,
    caveats: proof.caveats
  };
}

async function prepareSyncPayload(args = {}) {
  const snapshot = await snapshotFromArgs(args);
  const properties = normalizeInstrumentProperties(snapshot.properties);
  const view = viewMode(args);
  const config = dualConfig();
  const payload = updatePayload(config.objectId || "<DUAL_CONDITIONAL_TRADE_OBJECT_ID>", properties, {
    event_hash: properties.last_event_hash || properties.settlement_hash
  });
  return {
    ok: true,
    prepared: true,
    executed: false,
    publicWrites: false,
    operatorGate: operatorGateSummary(),
    reason: "Public MCP returns an update payload preview only. Operator-gated sync means the REST endpoint requires DEMO_OPERATOR_TOKEN plus live-write env and explicit approval before DUAL event-bus execution.",
    readiness: readiness(),
    instrument: instrumentEnvelope(snapshot, { view }),
    payload_preview: payload
  };
}

async function prepareMintPayload(args = {}) {
  const snapshot = await snapshotFromArgs(args);
  const properties = normalizeInstrumentProperties(snapshot.properties);
  const view = viewMode(args);
  const config = dualConfig();
  const payload = mintPayload(config.templateId || "<DUAL_CONDITIONAL_TRADE_TEMPLATE_ID>", properties);
  return {
    ok: true,
    prepared: true,
    executed: false,
    publicWrites: false,
    operatorGate: operatorGateSummary(),
    reason: "Public MCP returns a mint payload preview only. Operator-gated mint means the REST endpoint requires DEMO_OPERATOR_TOKEN plus live-write env and explicit approval before DUAL event-bus execution.",
    readiness: readiness(),
    instrument: instrumentEnvelope(snapshot, { view }),
    payload_preview: payload
  };
}

async function getMintStatus() {
  const snapshot = await currentInstrumentSnapshot();
  const status = readiness();
  return {
    ok: true,
    publicWrites: false,
    configured: status.readbackReady,
    writable: false,
    templateId: status.templateId,
    objectId: status.objectId,
    source: snapshot.source,
    mintedInstrument: snapshot.object ? objectEnvelope(snapshot) : null,
    localSeedId: snapshot.properties.instrument_id,
    operatorGate: operatorGateSummary(),
    caveats: proofCaveats(status)
  };
}

async function simulateLifecycle(args = {}) {
  const snapshot = await snapshotFromArgs(args);
  const gates = gatesFromArgs(args);
  const view = viewMode(args);
  const stepsView = stepsViewMode(args, view);
  const haltOnBlock = args.halt_on_block !== false;
  let state = normalizeInstrumentProperties({
    ...snapshot.properties,
    released_usd: Number(snapshot.properties.released_usd || 0),
    remaining_usd: Number(snapshot.properties.remaining_usd || snapshot.properties.value_usd)
  });
  const steps = [];
  let halted = false;
  let lastGate = null;

  for (let index = 0; index < gates.length; index += 1) {
    const gate = normalizeGateRequest(gates[index]);
    lastGate = gate;
    const evaluation = evaluateInstrumentGate(state, gate, {
      source: `simulate:${snapshot.source}`,
      object: snapshot.object
    });
    const nextGate = gates[index + 1] ? normalizeGateRequest(gates[index + 1]) : null;
    if (evaluation.allowed) {
      const released = Math.min(state.value_usd, state.released_usd + gate.release_usd);
      const settled = !nextGate && released >= state.value_usd;
      state = normalizeInstrumentProperties({
        ...state,
        state: settled ? "Settled" : nextGate ? "Milestone verified" : "Payment releasing",
        verified_milestones: state.verified_milestones + 1,
        released_usd: released,
        remaining_usd: Math.max(0, state.value_usd - released),
        current_milestone: nextGate?.milestone_name || "Closed",
        last_decision_result: evaluation.result,
        last_decision_reason: evaluation.reason,
        evidence_refs: mergeEvidenceRefs(state.evidence_refs, gate.evidence_refs),
        updated_at: state.updated_at
      });
    } else {
      const haltReason = evaluation.reason;
      state = normalizeInstrumentProperties({
        ...state,
        state: haltOnBlock ? "Halted" : state.state,
        blocked_actions: state.blocked_actions + 1,
        halt_reason: haltOnBlock ? haltReason : state.halt_reason,
        last_decision_result: evaluation.result,
        last_decision_reason: haltReason,
        evidence_refs: mergeEvidenceRefs(state.evidence_refs, gate.evidence_refs),
        updated_at: state.updated_at
      });
      halted = haltOnBlock;
    }
    const hashes = deriveProofHashes(state, { gate, evidence_refs: state.evidence_refs });
    state = normalizeInstrumentProperties({
      ...state,
      policy_hash: hashes.policy_hash,
      instrument_hash: hashes.instrument_hash,
      evidence_hash: hashes.evidence_hash,
      last_event_hash: hashes.event_hash,
      settlement_hash: hashes.settlement_hash,
      updated_at: state.updated_at
    });
    steps.push({
      step: index + 1,
      gate,
      evaluation: stepsView === "full" || view === "full" ? evaluation : compactEvaluation(evaluation),
      halted_after_step: halted,
      state: {
        status: state.state,
        released_usd: state.released_usd,
        remaining_usd: state.remaining_usd,
        verified_milestones: state.verified_milestones,
        current_milestone: state.current_milestone,
        blocked_actions: state.blocked_actions,
        halt_reason: state.halt_reason
      }
    });
    if (halted) break;
  }
  const finalHashes = deriveProofHashes(state, { gate: lastGate, evidence_refs: state.evidence_refs });
  const summarizedSteps = steps.map(lifecycleStepSummary);

  const response = {
    ok: true,
    simulated: true,
    halted,
    halt_on_block: haltOnBlock,
    steps_view: stepsView,
    persisted: false,
    publicWrites: false,
    stateModel: "This helper threads state only inside the response. The public MCP does not persist lifecycle state; callers must carry returned state if they want to continue later.",
    policy_uri: "tradeflow://policy",
    initial: instrumentEnvelope(snapshot, { view }),
    steps: stepsView === "evaluation" ? steps : summarizedSteps,
    final_instrument: instrumentEnvelope({
      ...snapshot,
      source: `simulation:${snapshot.source}`,
      properties: state
    }, { view, eventGate: lastGate, evidenceRefs: state.evidence_refs }),
    final_hashes: finalHashes,
    final_hash_verification: hashVerification(declaredHashes(state), finalHashes)
  };
  if (stepsView === "full") response.full_steps = steps;
  return response;
}

async function evaluateAdversarialGate(args = {}) {
  if (!args.expect) {
    throw Object.assign(new Error("expect is required for adversarial gate assertions."), {
      status: 400,
      code: "argument_required"
    });
  }
  if (!args.gate) {
    throw Object.assign(new Error("gate is required for adversarial gate assertions."), {
      status: 400,
      code: "argument_required"
    });
  }
  const snapshot = await snapshotFromArgs(args);
  const gate = gateFromArgs(args);
  const view = viewMode(args);
  const evaluation = evaluateInstrumentGate(snapshot.properties, gate, {
    source: `adversarial:${snapshot.source}`,
    object: snapshot.object
  });
  const expected = args.expect;
  const actual = evaluation.result;
  const matchedExpectation = expected === "blocked_or_escalated"
    ? actual !== "Approved"
    : actual === expected;
  const response = {
    ok: true,
    publicWrites: false,
    expected,
    actual,
    matchedExpectation,
    expectSemantics: "blocked_or_escalated matches Blocked, Needs evidence, and Approved with review.",
    evaluation: view === "full" ? evaluation : compactEvaluation(evaluation),
    resultConvention: "ok=true means the adversarial tool executed. matchedExpectation=true means the verifier produced the expected result."
  };
  if (view === "full") response.instrument = instrumentEnvelope(snapshot, { view: "full" });
  return response;
}

async function redTeamScenario(args = {}) {
  const snapshot = await currentInstrumentSnapshot();
  const scenario = args.scenario || "corridor_mismatch";
  const view = viewMode(args);
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
    resultConvention: "ok=true means the red-team tool executed. blockedOrEscalated=true means the verifier blocked or escalated the unsafe scenario.",
    evaluation: view === "full" ? evaluation : compactEvaluation(evaluation)
  };
}

function policyMetadata() {
  const status = readiness();
  return {
    name: "TradeFlow conditional trade mandate",
    version: 1,
    supported: {
      corridors: ["SG-AU"],
      commodity_classes: ["medical-devices"],
      payment_rails: ["bank-escrow", "stablecoin-escrow", "erp-payable"]
    },
    mandate: {
      max_instrument_usd: 180000,
      review_threshold_usd: 120000,
      sanctions_clear_required: true,
      customs_preclearance_required_for: ["customs"],
      evidence_required_for_every_gate: true
    },
    resultConvention: "Tool ok=true means the MCP call succeeded. The business decision lives in evaluation.result and evaluation.allowed.",
    currentMilestoneSemantics: {
      current_milestone: "Next milestone awaiting verification.",
      verified_milestones: "Count of completed milestone gates before the current gate."
    },
    evidenceContract: {
      booleanFallback: "evidence_attached is retained for simple demos.",
      firstClassRefs: "Prefer evidence_refs with type, id, hash, issuer, and uri. Hashes are re-derived from refs when hash is omitted.",
      acceptedUriSchemes: ["ipfs://", "ar://", "https://", "demo://"]
    },
    stateModel: "Public MCP read/evaluate calls are stateless. Use tradeflow_dual_simulate_lifecycle for a response-local sequence, or thread returned state on the caller side.",
    policyHistory: policyHistory(),
    operatorGate: operatorGateSummary(),
    orgExposure: {
      org_id: status.orgId,
      decision: "Included as a public demo routing handle; it is not an API secret."
    }
  };
}

function policyHistory() {
  return [
    {
      version: 1,
      status: "active",
      effective_from: "2026-05-27",
      supported_corridors: ["SG-AU"],
      supported_commodity_classes: ["medical-devices"],
      max_instrument_usd: 180000,
      review_threshold_usd: 120000,
      verification_note: "Existing proofs must be checked against the policy version carried in their instrument/proof payload, not whichever policy is current later."
    }
  ];
}

function operatorGateSummary() {
  return {
    operator: "The demo operator is the holder of DEMO_OPERATOR_TOKEN for this deployment.",
    meaning: "Operator-gated sync/mint endpoints require that token, DUAL_API_KEY, template/object ids as applicable, DUAL_WRITE_MODE=event_bus, and explicit live-write approval.",
    publicMcp: "The public MCP exposes previews only and never executes DUAL writes.",
    endpoints: ["/api/instruments/sync", "/api/instruments/mint"],
    auth: "REST callers send x-demo-operator-token or Authorization: Bearer <token>. Tokens are never returned by status or MCP tools."
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
    policy: policyMetadata(),
    publicWrites: false
  };
}

function safetySummary() {
  return {
    ok: true,
    publicWrites: false,
    writeExecutionExposed: false,
    operatorGatedRestEndpoints: ["/api/instruments/sync", "/api/instruments/mint"],
    operatorGate: operatorGateSummary(),
    publicMcpToolsExecuteWrites: false,
    redTeamScenarios: ["corridor_mismatch", "missing_evidence", "over_limit", "customs_missing"],
    adversarialTool: "tradeflow_dual_evaluate_adversarial_gate accepts arbitrary gate inputs and an expected-result assertion.",
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
