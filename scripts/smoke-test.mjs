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
assert(mcpToolNames.includes("tradeflow_dual_get_policy"), "MCP tools include policy discovery");
assert(mcpToolNames.includes("tradeflow_dual_get_policy_history"), "MCP tools include policy history");
assert(mcpToolNames.includes("tradeflow_dual_evaluate_gate"), "MCP tools include gate evaluator");
assert(mcpToolNames.includes("tradeflow_dual_verify_proof"), "MCP tools include proof verifier");
assert(mcpToolNames.includes("tradeflow_dual_get_mint_status"), "MCP tools include mint status read");
assert(mcpToolNames.includes("tradeflow_dual_simulate_lifecycle"), "MCP tools include lifecycle simulator");
assert(mcpToolNames.includes("tradeflow_dual_evaluate_adversarial_gate"), "MCP tools include adversarial gate evaluator");
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
assert(mcpInstrument.instrument.semantics.current_milestone.includes("Next milestone"), "MCP instrument documents current milestone semantics");

const mcpPolicy = mcpJson(await mcp("tools/call", {
  name: "tradeflow_dual_get_policy",
  arguments: {}
}));
assert(mcpPolicy.policy.supported.corridors.includes("SG-AU"), "MCP policy lists supported corridor");
assert(mcpPolicy.policy.supported.commodity_classes.includes("medical-devices"), "MCP policy lists supported commodity class");
assert(mcpPolicy.policy.operatorGate.publicMcp.includes("previews only"), "MCP policy defines operator gate boundary");
assert(mcpPolicy.policy.policyHistory[0].version === 1, "MCP policy includes policy history");

const mcpPolicyHistory = mcpJson(await mcp("tools/call", {
  name: "tradeflow_dual_get_policy_history",
  arguments: {}
}));
assert(mcpPolicyHistory.policy_history[0].status === "active", "MCP policy history lists active version");

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
assert(mcpApproved.evaluation.proof.event_hash, "MCP evaluator returns event hash");
assert(Array.isArray(mcpApproved.evaluation.proof.evidence_refs), "MCP evaluator returns evidence refs");
assert(mcpApproved.evaluation.proof.evidence_anchor.source === "instrument", "MCP evaluator declares instrument-level evidence fallback");
assert(mcpApproved.publicWrites === false, "MCP evaluator reports no public writes");

const mcpEvidenceType = mcpJson(await mcp("tools/call", {
  name: "tradeflow_dual_evaluate_gate",
  arguments: {
    gate: {
      milestone_id: "in_transit",
      milestone_name: "In transit",
      corridor: "SG-AU",
      commodity_class: "medical-devices",
      release_usd: 1,
      evidence_refs: [{ type: "ais_track", id: "AIS-SG-AU-001", issuer: "Route oracle" }]
    }
  }
}));
assert(mcpEvidenceType.evaluation.gate.evidence_type === "ais_track", "MCP evaluator derives evidence_type from evidence refs");

const mcpApprovedAgain = mcpJson(await mcp("tools/call", {
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
assert(mcpApprovedAgain.evaluation.proof.decision_content_hash === mcpApproved.evaluation.proof.decision_content_hash, "MCP evaluator returns stable decision content hash");
assert(mcpApprovedAgain.evaluation.proof.decision_envelope_hash, "MCP evaluator returns timestamped decision envelope hash");

const mcpInvalidTopLevel = await mcp("tools/call", {
  name: "tradeflow_dual_evaluate_gate",
  arguments: { made_up_field: "reject-me" }
});
assert(mcpInvalidTopLevel.isError === true, "MCP evaluator rejects unknown top-level fields");
assert(mcpJson(mcpInvalidTopLevel).error.code === "invalid_arguments", "MCP evaluator reports invalid arguments code");

const mcpInvalidEvidenceRef = await mcp("tools/call", {
  name: "tradeflow_dual_evaluate_gate",
  arguments: {
    gate: {
      milestone_id: "loaded",
      corridor: "SG-AU",
      commodity_class: "medical-devices",
      evidence_refs: [{ id: "DOC-1", unsupported: "reject-me" }]
    }
  }
});
assert(mcpInvalidEvidenceRef.isError === true, "MCP evaluator rejects unknown evidence ref fields");
assert(mcpJson(mcpInvalidEvidenceRef).error.code === "invalid_evidence_ref_fields", "MCP evaluator reports invalid evidence ref field code");

const mcpProof = mcpJson(await mcp("tools/call", {
  name: "tradeflow_dual_get_proof",
  arguments: {}
}));
assert(mcpProof.proof.bundle_hash, "MCP proof tool returns bundle hash");
assert(mcpProof.proof.object.public_writes === false, "MCP proof reports no public writes");
assert(mcpProof.proof.instrument.properties.instrument_id === "CTI-SG-AU-001", "MCP proof uses canonical instrument envelope");
const mcpProofAgain = mcpJson(await mcp("tools/call", {
  name: "tradeflow_dual_get_proof",
  arguments: {}
}));
assert(mcpProofAgain.proof.bundle_hash === mcpProof.proof.bundle_hash, "MCP proof bundle hash is stable across read calls");

const mcpVerify = mcpJson(await mcp("tools/call", {
  name: "tradeflow_dual_verify_proof",
  arguments: {}
}));
assert(mcpVerify.verification.ok === true, "MCP proof verifier passes seed proof");
assert(mcpVerify.verification.publicWrites === false, "MCP proof verifier reports no public writes");
assert(mcpVerify.verification.checks.find((check) => check.name === "policy_hash_rederived")?.ok === true, "MCP proof verifier re-derives policy hash");
assert(mcpVerify.verification.checks.find((check) => check.name === "event_hash_rederived")?.ok === true, "MCP proof verifier re-derives event hash");

const mcpSyncPreview = mcpJson(await mcp("tools/call", {
  name: "tradeflow_dual_prepare_sync_payload",
  arguments: {
    instrument: {
      instrument_id: "CTI-SG-AU-001",
      policy_hash: "policy-override",
      instrument_hash: "instrument-override",
      settlement_hash: "settlement-override",
      last_event_hash: "event-override",
      evidence_hash: "evidence-override"
    }
  }
}));
assert(mcpSyncPreview.executed === false, "MCP sync payload is not executed");
assert(mcpSyncPreview.publicWrites === false, "MCP sync payload reports no public writes");
assert(mcpSyncPreview.payload_preview?.action?.update, "MCP sync payload returns update preview");
assert(mcpSyncPreview.payload_preview.action.update.custom.policy_hash === "policy-override", "MCP sync payload honours policy hash override");
assert(mcpSyncPreview.payload_preview.action.update.custom.instrument_hash === "instrument-override", "MCP sync payload honours instrument hash override");
assert(mcpSyncPreview.payload_preview.action.update.custom.settlement_hash === "settlement-override", "MCP sync payload honours settlement hash override");

const mcpInvalidOverride = await mcp("tools/call", {
  name: "tradeflow_dual_prepare_sync_payload",
  arguments: { instrument: { made_up_field: "silently-drop-me" } }
});
assert(mcpInvalidOverride.isError === true, "MCP sync payload rejects unknown instrument fields");
assert(mcpJson(mcpInvalidOverride).error.code === "invalid_instrument_fields", "MCP sync payload reports invalid instrument field code");

const mcpMintStatus = mcpJson(await mcp("tools/call", {
  name: "tradeflow_dual_get_mint_status",
  arguments: {}
}));
assert(mcpMintStatus.publicWrites === false, "MCP mint status reports no public writes");

const mcpSimulation = mcpJson(await mcp("tools/call", {
  name: "tradeflow_dual_simulate_lifecycle",
  arguments: {}
}));
assert(mcpSimulation.persisted === false, "MCP lifecycle simulation does not persist state");
assert(mcpSimulation.steps.length === 4, "MCP lifecycle simulation runs default four milestones");
assert(!("evaluation" in mcpSimulation.steps[0]), "MCP compact lifecycle steps are summary-only by default");
assert(mcpSimulation.final_instrument.properties.released_usd === 148500, "MCP lifecycle simulation releases full seed value");
assert(mcpSimulation.final_instrument.properties.state === "Settled", "MCP lifecycle simulation ends in settled state");
assert(mcpSimulation.steps.some((step) => step.result === "Approved with review"), "MCP lifecycle simulation preserves cumulative human-review escalation");
assert(mcpSimulation.steps.every((step) => step.decision_content_hash), "MCP lifecycle summary includes step decision hashes");
assert(mcpSimulation.final_hash_verification.last_event_hash.verifies === true, "MCP lifecycle final event hash verifies against last gate context");

const mcpBlockedSimulation = mcpJson(await mcp("tools/call", {
  name: "tradeflow_dual_simulate_lifecycle",
  arguments: {
    gates: [{
      milestone_id: "loaded",
      milestone_name: "Cargo loaded",
      corridor: "NZ-AU",
      commodity_class: "medical-devices",
      release_usd: 29700,
      evidence_attached: true
    }]
  }
}));
assert(mcpBlockedSimulation.halted === true, "MCP lifecycle simulation halts on blocked gate by default");
assert(mcpBlockedSimulation.final_instrument.properties.blocked_actions === 1, "MCP lifecycle simulation increments blocked actions");
assert(mcpBlockedSimulation.final_instrument.properties.state === "Halted", "MCP lifecycle halted simulation exposes halted terminal state");
assert(mcpBlockedSimulation.final_instrument.properties.halt_reason, "MCP lifecycle halted simulation exposes halt reason");

const mcpAdversarial = mcpJson(await mcp("tools/call", {
  name: "tradeflow_dual_evaluate_adversarial_gate",
  arguments: {
    expect: "Blocked",
    gate: {
      milestone_id: "loaded",
      milestone_name: "Cargo loaded",
      corridor: "NZ-AU",
      commodity_class: "medical-devices",
      release_usd: 29700,
      evidence_attached: true
    }
  }
}));
assert(mcpAdversarial.matchedExpectation === true, "MCP adversarial evaluator matches expected block");
assert(mcpAdversarial.expectSemantics.includes("Approved with review"), "MCP adversarial evaluator documents blocked_or_escalated semantics");

const mcpAdversarialOverride = mcpJson(await mcp("tools/call", {
  name: "tradeflow_dual_evaluate_adversarial_gate",
  arguments: {
    expect: "Blocked",
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
      milestone_id: "loaded",
      milestone_name: "Cargo loaded",
      corridor: "NZ-AU",
      commodity_class: "medical-devices",
      release_usd: 29700,
      evidence_attached: true
    }
  }
}));
assert(mcpAdversarialOverride.matchedExpectation === true, "MCP adversarial evaluator handles instrument overrides");

const mcpAdversarialMissingExpect = await mcp("tools/call", {
  name: "tradeflow_dual_evaluate_adversarial_gate",
  arguments: {
    gate: {
      milestone_id: "loaded",
      corridor: "NZ-AU",
      commodity_class: "medical-devices",
      release_usd: 29700,
      evidence_attached: true
    }
  }
});
assert(mcpAdversarialMissingExpect.isError === true, "MCP adversarial evaluator requires explicit expectation");
assert(mcpJson(mcpAdversarialMissingExpect).error.code === "argument_required", "MCP adversarial evaluator reports missing expectation");

const mcpRedTeam = mcpJson(await mcp("tools/call", {
  name: "tradeflow_dual_red_team",
  arguments: { scenario: "corridor_mismatch" }
}));
assert(mcpRedTeam.blockedOrEscalated === true, "MCP red-team scenario blocks unsafe gate");
assert(mcpRedTeam.evaluation.result === "Blocked", "MCP red-team returns blocked decision");

const mcpResources = await mcp("resources/list", {});
assert(mcpResources.resources.some((resource) => resource.uri === "tradeflow://proof"), "MCP resources include proof");
assert(mcpResources.resources.some((resource) => resource.uri === "tradeflow://policy"), "MCP resources include policy");
assert(mcpResources.resources.some((resource) => resource.uri === "tradeflow://policy-history"), "MCP resources include policy history");
assert(mcpResources.resources.some((resource) => resource.uri === "tradeflow://mint-status"), "MCP resources include mint status");
assert(mcpResources.resources.some((resource) => resource.uri === "tradeflow://template"), "MCP resources include template");

const mcpProofResource = await mcp("resources/read", { uri: "tradeflow://proof" });
const proofResource = JSON.parse(mcpProofResource.contents[0].text);
assert(proofResource.proof.bundle_hash, "MCP proof resource returns bundle hash");

const mcpPrompts = await mcp("prompts/list", {});
assert(mcpPrompts.prompts.some((prompt) => prompt.name === "tradeflow_next_gate_review"), "MCP prompts include next-gate review");

console.log("smoke test passed");
