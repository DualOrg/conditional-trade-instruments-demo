const baseUrl = process.env.DEMO_BASE_URL || "http://127.0.0.1:4176";

function assert(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`ok - ${message}`);
}

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || "GET",
    headers: {
      accept: "application/json",
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.operatorToken ? { "x-demo-operator-token": options.operatorToken } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json") ? await response.json() : await response.text();
  return { response, body };
}

async function mcp(method, params = {}) {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json"
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: method, method, params })
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`/mcp ${method} returned ${response.status}`);
  if (body.error) throw new Error(`/mcp ${method} error: ${body.error.message}`);
  return body.result;
}

function mcpJson(result) {
  const text = result.content?.find((item) => item.type === "text")?.text;
  if (!text) throw new Error("MCP result did not include JSON text content");
  return JSON.parse(text);
}

const home = await fetch(baseUrl);
assert(home.ok, "home page loads");
assert((await home.text()).includes("TradeFlow Control Desk"), "home page includes demo title");

const status = await request("/api/dual/status");
assert(status.response.ok, "status endpoint returns 200");
assert(status.body.publicWrites === false, "status endpoint reports no public writes");
assert(!("apiKey" in status.body), "status endpoint does not expose API key");
assert(status.body.orgId === "69b935b4187e903f826bbe71", "status endpoint defaults to IanTest org");

const current = await request("/api/instruments/current");
assert(current.response.ok, "current instrument endpoint degrades safely");
assert(typeof current.body.available === "boolean", "current instrument endpoint reports availability");
assert(current.body.properties?.instrument_id === "CTI-SG-AU-001", "current instrument endpoint returns seed properties");

const approvedEvaluation = await request("/api/instruments/evaluate", {
  method: "POST",
  body: {
    instrument: {
      instrument_id: "CTI-SG-AU-001",
      state: "Issued",
      corridor: "SG-AU",
      commodity_class: "medical-devices",
      value_usd: 148500,
      max_instrument_usd: 180000,
      review_threshold_usd: 120000,
      released_usd: 0,
      sanctions_clear: true,
      customs_preclearance: true
    },
    gate: {
      milestone_id: "loaded",
      milestone_name: "Cargo loaded",
      corridor: "SG-AU",
      commodity_class: "medical-devices",
      release_usd: 29700,
      evidence_attached: true
    }
  }
});
assert(approvedEvaluation.response.ok, "evaluate endpoint returns 200");
assert(approvedEvaluation.body.evaluation?.result === "Approved", "evaluate endpoint approves in-scope gate");
assert(approvedEvaluation.body.evaluation?.proof?.decision_hash, "evaluate endpoint returns a decision hash");
assert(approvedEvaluation.body.publicWrites === false, "evaluate endpoint never enables public writes");

const blockedEvaluation = await request("/api/instruments/evaluate", {
  method: "POST",
  body: {
    instrument: {
      instrument_id: "CTI-SG-AU-001",
      state: "Issued",
      corridor: "SG-AU",
      commodity_class: "medical-devices",
      value_usd: 148500,
      max_instrument_usd: 180000,
      sanctions_clear: true,
      customs_preclearance: true
    },
    gate: {
      milestone_id: "customs",
      milestone_name: "Customs cleared",
      corridor: "CN-AU",
      commodity_class: "medical-devices",
      release_usd: 37125,
      evidence_attached: true
    }
  }
});
assert(blockedEvaluation.response.ok, "evaluate endpoint returns blocked decision as 200");
assert(blockedEvaluation.body.evaluation?.result === "Blocked", "evaluate endpoint blocks corridor mismatch");

const rejectedSync = await request("/api/instruments/sync", {
  method: "POST",
  operatorToken: "wrong",
  body: {
    properties: {
      instrument_id: "CTI-SG-AU-001",
      state: "Issued"
    }
  }
});
assert(rejectedSync.response.status === 403, "sync endpoint rejects missing or wrong operator token");

const mcpInit = await mcp("initialize", {});
assert(mcpInit.protocolVersion === "2025-06-18", "MCP initialize returns protocol version");
assert(mcpInit.serverInfo.name === "dual-conditional-trade-instruments", "MCP initialize returns server name");
assert(mcpInit.auth?.required === false, "MCP initialize reports no public auth requirement");

const mcpTools = await mcp("tools/list", {});
const mcpToolNames = mcpTools.tools.map((tool) => tool.name);
assert(mcpToolNames.includes("tradeflow_dual_get_status"), "MCP tools include status read");
assert(mcpToolNames.includes("tradeflow_dual_get_instrument"), "MCP tools include instrument read");
assert(mcpToolNames.includes("tradeflow_dual_evaluate_gate"), "MCP tools include gate evaluator");
assert(mcpToolNames.includes("tradeflow_dual_verify_proof"), "MCP tools include proof verifier");
assert(mcpToolNames.includes("tradeflow_dual_red_team"), "MCP tools include red-team check");
assert(mcpTools.tools.find((tool) => tool.name === "tradeflow_dual_prepare_sync_payload")?.["x-dual"]?.previewOnly === true, "MCP sync tool is preview-only");

const mcpStatus = mcpJson(await mcp("tools/call", {
  name: "tradeflow_dual_get_status",
  arguments: { compact: true }
}));
assert(mcpStatus.publicWrites === false, "MCP status reports no public writes");
assert(mcpStatus.writeExecutionExposed === false, "MCP status reports write execution is not exposed");
assert(Array.isArray(mcpStatus.warnings), "MCP status returns warnings array");

const mcpInstrument = mcpJson(await mcp("tools/call", {
  name: "tradeflow_dual_get_instrument",
  arguments: {}
}));
assert(mcpInstrument.instrument.properties.instrument_id === "CTI-SG-AU-001", "MCP instrument tool returns seed instrument");

const mcpApproved = mcpJson(await mcp("tools/call", {
  name: "tradeflow_dual_evaluate_gate",
  arguments: {
    gate: {
      milestone_id: "loaded",
      milestone_name: "Cargo loaded",
      corridor: "SG-AU",
      commodity_class: "medical-devices",
      release_usd: 29700,
      evidence_attached: true
    }
  }
}));
assert(mcpApproved.evaluation.result === "Approved", "MCP evaluator approves in-scope gate");
assert(mcpApproved.evaluation.proof.decision_hash, "MCP evaluator returns decision hash");
assert(mcpApproved.publicWrites === false, "MCP evaluator reports no public writes");

const mcpProof = mcpJson(await mcp("tools/call", {
  name: "tradeflow_dual_get_proof",
  arguments: {}
}));
assert(mcpProof.proof.bundle_hash, "MCP proof tool returns bundle hash");
assert(mcpProof.proof.object.public_writes === false, "MCP proof reports no public writes");

const mcpVerify = mcpJson(await mcp("tools/call", {
  name: "tradeflow_dual_verify_proof",
  arguments: {}
}));
assert(mcpVerify.verification.ok === true, "MCP proof verifier passes seed proof");
assert(mcpVerify.verification.publicWrites === false, "MCP proof verifier reports no public writes");

const mcpSyncPreview = mcpJson(await mcp("tools/call", {
  name: "tradeflow_dual_prepare_sync_payload",
  arguments: {}
}));
assert(mcpSyncPreview.executed === false, "MCP sync payload is not executed");
assert(mcpSyncPreview.publicWrites === false, "MCP sync payload reports no public writes");
assert(mcpSyncPreview.payload_preview?.action?.update, "MCP sync payload returns update preview");

const mcpRedTeam = mcpJson(await mcp("tools/call", {
  name: "tradeflow_dual_red_team",
  arguments: { scenario: "corridor_mismatch" }
}));
assert(mcpRedTeam.blockedOrEscalated === true, "MCP red-team scenario blocks unsafe gate");
assert(mcpRedTeam.evaluation.result === "Blocked", "MCP red-team returns blocked decision");

const mcpResources = await mcp("resources/list", {});
assert(mcpResources.resources.some((resource) => resource.uri === "tradeflow://proof"), "MCP resources include proof");
assert(mcpResources.resources.some((resource) => resource.uri === "tradeflow://template"), "MCP resources include template");

const mcpProofResource = await mcp("resources/read", { uri: "tradeflow://proof" });
const proofResource = JSON.parse(mcpProofResource.contents[0].text);
assert(proofResource.proof.bundle_hash, "MCP proof resource returns bundle hash");

const mcpPrompts = await mcp("prompts/list", {});
assert(mcpPrompts.prompts.some((prompt) => prompt.name === "tradeflow_next_gate_review"), "MCP prompts include next-gate review");

console.log("smoke test passed");
