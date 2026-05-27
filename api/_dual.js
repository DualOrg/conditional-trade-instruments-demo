import { createHash } from "node:crypto";

export const defaultOrgId = "69b935b4187e903f826bbe71";
export const templateName = "io.dual.conditional_trade_instrument.demo.v1";
export const seedUpdatedAt = "2026-05-27T00:00:00.000Z";

export function dualConfig() {
  const mode = process.env.DUAL_PERSISTENCE_MODE || "local";
  const writeMode = process.env.DUAL_WRITE_MODE || "read_only";
  return {
    mode,
    writeMode,
    apiUrl: process.env.DUAL_API_URL || "https://api-testnet.dual.network",
    orgId: process.env.DUAL_ORG_ID || defaultOrgId,
    templateId: process.env.DUAL_CONDITIONAL_TRADE_TEMPLATE_ID || "",
    objectId: process.env.DUAL_CONDITIONAL_TRADE_OBJECT_ID || "",
    apiKey: process.env.DUAL_API_KEY || "",
    operatorToken: process.env.DEMO_OPERATOR_TOKEN || ""
  };
}

export function readiness() {
  const config = dualConfig();
  const missing = [];
  if (!config.apiKey) missing.push("DUAL_API_KEY");
  if (!config.templateId) missing.push("DUAL_CONDITIONAL_TRADE_TEMPLATE_ID");
  if (!config.objectId) missing.push("DUAL_CONDITIONAL_TRADE_OBJECT_ID");

  const readbackReady = Boolean(config.apiKey && config.objectId);
  const writable = Boolean(readbackReady && config.templateId && config.operatorToken && config.writeMode === "event_bus");

  return {
    ok: readbackReady,
    mode: config.mode,
    runtime: process.env.VERCEL ? "vercel" : "node",
    orgId: config.orgId,
    templateId: config.templateId || null,
    objectId: config.objectId || null,
    templateName,
    readbackReady,
    writable,
    writeMode: config.writeMode,
    operatorGateConfigured: Boolean(config.operatorToken),
    publicWrites: false,
    missing,
    detail: writable
      ? "DUAL readback and operator-gated writes are configured."
      : readbackReady
        ? "DUAL readback is configured. Operator-gated writes need event_bus mode and DEMO_OPERATOR_TOKEN."
        : "Set DUAL_API_KEY and DUAL_CONDITIONAL_TRADE_OBJECT_ID to enable DUAL readback."
  };
}

export async function readCurrentObject() {
  const config = dualConfig();
  const client = await dualClient(config);
  const object = await client.objects.get(config.objectId);
  const properties = normalizeInstrumentProperties(extractCustom(object));
  return {
    available: true,
    object: summarizeObject(object),
    properties,
    status: readiness()
  };
}

export async function dualClient(config = dualConfig()) {
  return {
    objects: {
      get: (objectId) => dualRequest(config, "GET", `/objects/${encodeURIComponent(objectId)}`)
    },
    eventBus: {
      execute: (payload) => dualRequest(config, "POST", "/ebus/execute", payload)
    }
  };
}

export function extractCustom(object = {}) {
  return object?.properties
    || object?.custom
    || object?.data?.custom
    || object?.state?.custom
    || object?.object?.properties
    || object?.object?.custom
    || {};
}

export function summarizeObject(object = {}) {
  if (!object || typeof object !== "object") return null;
  return {
    id: stringValue(object.id || object.object_id || object.objectId),
    templateId: stringValue(object.template_id || object.templateId || object.template?.id),
    organizationId: stringValue(object.organization_id || object.organizationId || object.org_id),
    stateHash: stringValue(object.state_hash || object.stateHash),
    integrityHash: stringValue(object.integrity_hash || object.integrityHash),
    properties: normalizeInstrumentProperties(extractCustom(object))
  };
}

export function extractResultObject(result = {}) {
  const candidates = [
    result?.object,
    result?.data?.object,
    result?.result?.object,
    result?.objects?.[0],
    result?.data?.objects?.[0],
    result?.result?.objects?.[0],
    result?.affected_objects?.[0],
    result?.affectedObjects?.[0]
  ];
  return candidates.map((candidate) => summarizeObject(candidate)).find(Boolean) || null;
}

async function dualRequest(config, method, path, body) {
  if (!config.apiKey) {
    const error = new Error("DUAL_API_KEY is not configured.");
    error.status = 409;
    throw error;
  }
  const response = await fetch(`${config.apiUrl.replace(/\/+$/, "")}${path}`, {
    method,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-api-key": config.apiKey
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.message || payload?.error || `DUAL request failed with HTTP ${response.status}`);
    error.status = response.status;
    error.body = payload;
    throw error;
  }
  return payload;
}

export function requireOperator(request) {
  const config = dualConfig();
  if (!config.operatorToken) {
    const error = new Error("DEMO_OPERATOR_TOKEN is not configured for this deployment.");
    error.status = 403;
    throw error;
  }
  const headerToken = request.headers?.["x-demo-operator-token"] || request.headers?.get?.("x-demo-operator-token") || "";
  const auth = request.headers?.authorization || request.headers?.get?.("authorization") || "";
  const bearerToken = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (headerToken !== config.operatorToken && bearerToken !== config.operatorToken) {
    const error = new Error("Invalid or missing operator token.");
    error.status = 403;
    throw error;
  }
}

export function requireWritable(options = {}) {
  const requireObject = options.requireObject !== false;
  const status = readiness();
  const config = dualConfig();
  const baseWritable = Boolean(config.apiKey && config.templateId && config.operatorToken && config.writeMode === "event_bus");
  if (!baseWritable || (requireObject && !config.objectId)) {
    const error = new Error(status.detail);
    error.status = 409;
    error.readiness = status;
    throw error;
  }
}

export async function readBody(request) {
  if (request.body && typeof request.body === "object" && !request.readable) return request.body;
  if (typeof request.body === "string") return JSON.parse(request.body || "{}");
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8") || "{}";
  return JSON.parse(raw);
}

export function instrumentTemplateProperties() {
  return {
    instrument_id: "string",
    buyer: "string",
    supplier: "string",
    buyer_agent: "string",
    corridor: "string",
    commodity_class: "string",
    payment_rail: "string",
    state: "string",
    value_usd: "number",
    max_instrument_usd: "number",
    review_threshold_usd: "number",
    sanctions_clear: "boolean",
    customs_preclearance: "boolean",
    current_milestone: "string",
    verified_milestones: "number",
    released_usd: "number",
    remaining_usd: "number",
    blocked_actions: "number",
    halt_reason: "string",
    policy_version: "number",
    policy_hash: "string",
    instrument_hash: "string",
    evidence_hash: "string",
    evidence_refs: "array",
    last_event_hash: "string",
    settlement_hash: "string",
    last_decision_result: "string",
    last_decision_reason: "string",
    updated_at: "string"
  };
}

export function seedInstrumentProperties() {
  const properties = normalizeInstrumentProperties({ updated_at: seedUpdatedAt });
  const hashes = deriveProofHashes(properties);
  return {
    ...properties,
    policy_hash: hashes.policy_hash,
    instrument_hash: hashes.instrument_hash,
    evidence_hash: hashes.evidence_hash,
    last_event_hash: hashes.event_hash,
    settlement_hash: hashes.settlement_hash
  };
}

export function normalizeInstrumentProperties(input = {}) {
  const updatedAt = input.updated_at === undefined ? seedUpdatedAt : input.updated_at;
  const value = numberValue(input.value_usd, 148500);
  const released = numberValue(input.released_usd, 0);
  return {
    instrument_id: stringValue(input.instrument_id, "CTI-SG-AU-001"),
    buyer: stringValue(input.buyer, "AUS MedTech Pty Ltd"),
    supplier: stringValue(input.supplier, "Lion City Precision"),
    buyer_agent: stringValue(input.buyer_agent, "procurement-agent.au"),
    corridor: stringValue(input.corridor, "SG-AU"),
    commodity_class: stringValue(input.commodity_class, "medical-devices"),
    payment_rail: stringValue(input.payment_rail, "bank-escrow"),
    state: stringValue(input.state, "Issued"),
    value_usd: value,
    max_instrument_usd: numberValue(input.max_instrument_usd, 180000),
    review_threshold_usd: numberValue(input.review_threshold_usd, 120000),
    sanctions_clear: booleanValue(input.sanctions_clear, true),
    customs_preclearance: booleanValue(input.customs_preclearance, true),
    current_milestone: stringValue(input.current_milestone, "Cargo loaded"),
    verified_milestones: numberValue(input.verified_milestones, 2),
    released_usd: released,
    remaining_usd: numberValue(input.remaining_usd, Math.max(0, value - released)),
    blocked_actions: numberValue(input.blocked_actions, 0),
    halt_reason: stringValue(input.halt_reason),
    policy_version: numberValue(input.policy_version, 1),
    policy_hash: stringValue(input.policy_hash),
    instrument_hash: stringValue(input.instrument_hash),
    evidence_hash: stringValue(input.evidence_hash),
    evidence_refs: normalizeEvidenceRefs(input.evidence_refs),
    last_event_hash: stringValue(input.last_event_hash),
    settlement_hash: stringValue(input.settlement_hash),
    last_decision_result: stringValue(input.last_decision_result, "Ready"),
    last_decision_reason: stringValue(input.last_decision_reason, "Awaiting next verification"),
    updated_at: stringValue(updatedAt, seedUpdatedAt)
  };
}

export function normalizeGateRequest(input = {}) {
  const evidenceRefs = normalizeEvidenceRefs(input.evidence_refs, []);
  const evidenceType = input.evidence_type === undefined || input.evidence_type === ""
    ? evidenceTypeFromRefs(evidenceRefs) || "BOL + GPS fix"
    : stringValue(input.evidence_type, "BOL + GPS fix");
  return {
    milestone_id: stringValue(input.milestone_id, "loaded"),
    milestone_name: stringValue(input.milestone_name, "Cargo loaded"),
    corridor: stringValue(input.corridor, "SG-AU"),
    commodity_class: stringValue(input.commodity_class, "medical-devices"),
    release_usd: numberValue(input.release_usd, 29700),
    evidence_attached: evidenceRefs.length ? true : booleanValue(input.evidence_attached, true),
    evidence_type: evidenceType,
    evidence_refs: evidenceRefs,
    customs_preclearance: booleanValue(input.customs_preclearance, true)
  };
}

function evidenceTypeFromRefs(evidenceRefs = []) {
  const types = [...new Set(evidenceRefs.map((ref) => ref.type).filter(Boolean))];
  return types.join(" + ");
}

export function defaultEvidenceRefs() {
  return [
    {
      type: "bill_of_lading",
      id: "BOL-8842",
      hash: hashJson({ type: "bill_of_lading", id: "BOL-8842", issuer: "Lion City Precision" }),
      issuer: "Lion City Precision",
      uri: "demo://evidence/bol-8842"
    },
    {
      type: "gps_fix",
      id: "GPS-SIN-SYD-20260527",
      hash: hashJson({ type: "gps_fix", id: "GPS-SIN-SYD-20260527", corridor: "SG-AU" }),
      issuer: "TradeFlow route oracle",
      uri: "demo://evidence/gps-sin-syd-20260527"
    }
  ];
}

export function normalizeEvidenceRefs(input = undefined, fallback = defaultEvidenceRefs()) {
  const source = Array.isArray(input) ? input : fallback;
  return source
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const base = {
        type: stringValue(item.type, "attestation"),
        id: stringValue(item.id || item.cid || item.attestation_id),
        hash: stringValue(item.hash),
        issuer: stringValue(item.issuer),
        uri: stringValue(item.uri)
      };
      return {
        ...base,
        hash: base.hash || hashJson({
          type: base.type,
          id: base.id,
          issuer: base.issuer,
          uri: base.uri
        })
      };
    })
    .filter((item) => item.id || item.hash || item.uri);
}

export function deriveProofHashes(properties, options = {}) {
  const instrument = normalizeInstrumentProperties(properties);
  const gate = options.gate ? normalizeGateRequest(options.gate) : null;
  const evidenceRefs = normalizeEvidenceRefs(
    options.evidence_refs !== undefined ? options.evidence_refs : instrument.evidence_refs,
    []
  );
  const evidenceHash = evidenceRefs.length
    ? hashJson(evidenceRefs)
    : hashJson({
        instrument_id: instrument.instrument_id,
        current_milestone: instrument.current_milestone,
        evidence_attached: Boolean(gate?.evidence_attached),
        evidence_type: gate?.evidence_type || ""
      });
  const policyHash = hashJson({
    corridor: instrument.corridor,
    commodity_class: instrument.commodity_class,
    max_instrument_usd: instrument.max_instrument_usd,
    review_threshold_usd: instrument.review_threshold_usd,
    sanctions_clear: instrument.sanctions_clear,
    customs_preclearance: instrument.customs_preclearance,
    policy_version: instrument.policy_version
  });
  const instrumentHash = hashJson({
    instrument_id: instrument.instrument_id,
    buyer: instrument.buyer,
    supplier: instrument.supplier,
    corridor: instrument.corridor,
    commodity_class: instrument.commodity_class,
    payment_rail: instrument.payment_rail,
    value_usd: instrument.value_usd,
    max_instrument_usd: instrument.max_instrument_usd
  });
  const settlementHash = hashJson({
    instrument_id: instrument.instrument_id,
    released_usd: instrument.released_usd,
    remaining_usd: instrument.remaining_usd,
    state: instrument.state
  });
  const eventHash = hashJson({
    instrument_id: instrument.instrument_id,
    current_milestone: instrument.current_milestone,
    last_decision_result: instrument.last_decision_result,
    last_decision_reason: instrument.last_decision_reason,
    gate: gate ? {
      milestone_id: gate.milestone_id,
      milestone_name: gate.milestone_name,
      release_usd: gate.release_usd,
      evidence_hash: evidenceHash
    } : null,
    policy_hash: policyHash,
    instrument_hash: instrumentHash,
    settlement_hash: settlementHash
  });
  return {
    policy_hash: policyHash,
    instrument_hash: instrumentHash,
    evidence_hash: evidenceHash,
    event_hash: eventHash,
    settlement_hash: settlementHash
  };
}

export function evaluateInstrumentGate(properties, request, context = {}) {
  const instrument = normalizeInstrumentProperties(properties);
  const gate = normalizeGateRequest(request);
  const evidenceAnchor = gate.evidence_refs.length
    ? {
        source: "gate",
        detail: "Gate-level evidence_refs anchored this decision.",
        refs: gate.evidence_refs
      }
    : instrument.evidence_refs.length
      ? {
          source: "instrument",
          detail: "No gate-level evidence_refs were supplied; instrument-level evidence_refs anchored this decision.",
          refs: instrument.evidence_refs
        }
      : gate.evidence_attached
        ? {
            source: "boolean_fallback",
            detail: "No evidence_refs were supplied; demo boolean evidence_attached anchored this decision.",
            refs: []
          }
        : {
            source: "missing",
            detail: "No evidence_refs or evidence_attached flag anchored this decision.",
            refs: []
          };
  const derivedHashes = deriveProofHashes(instrument, { gate, evidence_refs: evidenceAnchor.refs });
  const proofHashes = {
    policy_hash: instrument.policy_hash || derivedHashes.policy_hash,
    instrument_hash: instrument.instrument_hash || derivedHashes.instrument_hash,
    evidence_hash: evidenceAnchor.refs.length ? derivedHashes.evidence_hash : (instrument.evidence_hash || derivedHashes.evidence_hash),
    event_hash: derivedHashes.event_hash,
    settlement_hash: instrument.settlement_hash || derivedHashes.settlement_hash
  };
  const reasons = [];
  let code = "approved";
  let result = "Approved";
  let allowed = true;

  if (!["issued", "milestone verified", "payment releasing"].includes(instrument.state.toLowerCase())) {
    code = "inactive_instrument";
    result = "Blocked";
    allowed = false;
    reasons.push(`Instrument state is ${instrument.state}.`);
  }
  if (gate.corridor !== instrument.corridor) {
    code = "corridor_mismatch";
    result = "Blocked";
    allowed = false;
    reasons.push(`Gate corridor ${gate.corridor} does not match ${instrument.corridor}.`);
  }
  if (gate.commodity_class !== instrument.commodity_class) {
    code = "commodity_mismatch";
    result = "Blocked";
    allowed = false;
    reasons.push(`Gate commodity ${gate.commodity_class} does not match ${instrument.commodity_class}.`);
  }
  if (!instrument.sanctions_clear) {
    code = "sanctions_missing";
    result = "Blocked";
    allowed = false;
    reasons.push("Counterparty sanctions clearance is missing.");
  }
  if (instrument.value_usd > instrument.max_instrument_usd) {
    code = "instrument_limit_exceeded";
    result = "Blocked";
    allowed = false;
    reasons.push(`Instrument value ${instrument.value_usd} exceeds mandate ceiling ${instrument.max_instrument_usd}.`);
  }
  if (gate.milestone_id === "customs" && (!instrument.customs_preclearance || !gate.customs_preclearance)) {
    code = "customs_preclearance_missing";
    result = "Blocked";
    allowed = false;
    reasons.push("Customs pre-clearance is required before release.");
  }
  if (!gate.evidence_attached) {
    code = "evidence_missing";
    result = "Needs evidence";
    allowed = false;
    reasons.push(`${gate.milestone_name} requires an evidence packet before verification.`);
  }
  if (allowed && evidenceAnchor.source === "instrument") {
    reasons.push("No gate-level evidence_refs supplied; verified against instrument-level evidence refs.");
  }
  if (allowed && evidenceAnchor.source === "boolean_fallback") {
    reasons.push("No evidence_refs supplied; accepted demo boolean evidence_attached fallback.");
  }

  const cumulative = instrument.released_usd + gate.release_usd;
  if (allowed && cumulative > instrument.review_threshold_usd) {
    code = "human_review_logged";
    result = "Approved with review";
    reasons.push(`Cumulative release ${cumulative} exceeds review threshold ${instrument.review_threshold_usd}.`);
  }
  if (!reasons.length) reasons.push("Corridor, commodity, evidence, value, sanctions, and customs checks passed.");

  const decisionContent = {
    instrument_id: instrument.instrument_id,
    gate,
    result,
    code,
    policy_hash: proofHashes.policy_hash,
    instrument_hash: proofHashes.instrument_hash,
    evidence_hash: proofHashes.evidence_hash,
    event_hash: proofHashes.event_hash,
    settlement_hash: proofHashes.settlement_hash
  };
  const evaluatedAt = new Date().toISOString();
  const decisionContentHash = hashJson(decisionContent);
  const decisionEnvelopeHash = hashJson({ ...decisionContent, evaluated_at: evaluatedAt });

  return {
    allowed,
    result,
    code,
    reason: reasons.join(" "),
    source: context.source || "request",
    gate,
    instrument: {
      id: instrument.instrument_id,
      state: instrument.state,
      corridor: instrument.corridor,
      commodity_class: instrument.commodity_class,
      value_usd: instrument.value_usd,
      released_usd: instrument.released_usd
    },
    proof: {
      object_id: context.object?.id || null,
      template_id: context.object?.templateId || null,
      state_hash: context.object?.stateHash || null,
      integrity_hash: context.object?.integrityHash || null,
      policy_hash: proofHashes.policy_hash,
      instrument_hash: proofHashes.instrument_hash,
      evidence_hash: proofHashes.evidence_hash,
      event_hash: proofHashes.event_hash,
      settlement_hash: proofHashes.settlement_hash,
      decision_hash: decisionContentHash,
      decision_content_hash: decisionContentHash,
      decision_envelope_hash: decisionEnvelopeHash,
      decision_hash_semantics: "decision_hash is stable and aliases decision_content_hash. decision_envelope_hash includes evaluated_at for fresh attestations.",
      evidence_refs: evidenceAnchor.refs,
      evidence_anchor: {
        source: evidenceAnchor.source,
        detail: evidenceAnchor.detail,
        ref_count: evidenceAnchor.refs.length,
        hash: proofHashes.evidence_hash
      },
      derived_hashes: derivedHashes,
      evaluated_at: evaluatedAt
    }
  };
}

export function updatePayload(objectId, properties, metadata = {}) {
  return updatePayloadByStyle("direct_custom", objectId, properties, metadata);
}

export function updatePayloadAttempts(objectId, properties, metadata = {}) {
  return [
    { style: "direct_custom", payload: updatePayloadByStyle("direct_custom", objectId, properties, metadata) },
    { style: "direct_data_custom", payload: updatePayloadByStyle("direct_data_custom", objectId, properties, metadata) }
  ];
}

function updatePayloadByStyle(style, objectId, properties, metadata = {}) {
  const custom = {
    ...properties,
    last_event_hash: metadata.event_hash || properties.last_event_hash || "",
    updated_at: new Date().toISOString()
  };
  if (style === "direct_data_custom") {
    return {
      action: {
        update: {
          id: objectId,
          data: { custom }
        }
      },
      metadata
    };
  }
  return {
    action: {
      update: {
        id: objectId,
        custom
      }
    },
    metadata
  };
}

export function mintPayload(templateId, properties, metadata = {}) {
  return mintPayloadByStyle("direct_custom", templateId, properties, metadata);
}

export function mintPayloadAttempts(templateId, properties, metadata = {}) {
  return [
    { style: "direct_custom", payload: mintPayloadByStyle("direct_custom", templateId, properties, metadata) },
    { style: "direct_data_custom", payload: mintPayloadByStyle("direct_data_custom", templateId, properties, metadata) }
  ];
}

function mintPayloadByStyle(style, templateId, properties, metadata = {}) {
  const custom = {
    ...properties,
    updated_at: new Date().toISOString()
  };
  if (style === "direct_data_custom") {
    return {
      action: {
        mint: {
          template_id: templateId,
          num: 1,
          data: { custom }
        }
      },
      metadata: mintMetadata(metadata)
    };
  }
  return {
    action: {
      mint: {
        template_id: templateId,
        num: 1,
        custom
      }
    },
    metadata: mintMetadata(metadata)
  };
}

function mintMetadata(metadata = {}) {
  return {
    name: "Conditional Trade Instrument Demo",
    description: "Milestone-gated trade finance instrument for the TradeFlow Control Desk demo.",
    category: "conditional-trade-instrument",
    ...metadata
  };
}

export async function executeEventBusWithFallback(client, attempts) {
  const errors = [];
  for (const attempt of attempts) {
    try {
      const result = await client.eventBus.execute(attempt.payload);
      return { result, payloadStyle: attempt.style };
    } catch (error) {
      errors.push({
        style: attempt.style,
        status: error.status || null,
        message: error.message,
        body: error.body || null
      });
    }
  }
  const error = new Error(`DUAL event-bus write failed. ${errors.map((item) => `${item.style}: ${item.message}`).join(" | ")}`);
  error.status = errors[0]?.status || 400;
  error.body = { attempts: errors };
  throw error;
}

export function semanticMetadata(eventType, properties, audit = {}) {
  return {
    source: "tradeflow_conditional_trade_demo",
    event_type: eventType,
    event_status: properties.state,
    event_hash: properties.last_event_hash || properties.settlement_hash || "",
    instrument_id: properties.instrument_id,
    current_milestone: properties.current_milestone,
    released_usd: properties.released_usd,
    remaining_usd: properties.remaining_usd,
    generated_at: new Date().toISOString(),
    audit
  };
}

export function hashJson(value) {
  return createHash("sha256").update(JSON.stringify(sortObject(value))).digest("hex");
}

export function sendError(response, error) {
  response.status(error.status || 500).json({
    error: {
      message: error.message || "Unknown error",
      code: error.code || error.name || "SERVER_ERROR",
      readiness: error.readiness || undefined
    }
  });
}

function stringValue(value, fallback = "") {
  if (value === undefined || value === null || value === "") return fallback;
  return String(value);
}

function numberValue(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function booleanValue(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return ["true", "1", "yes", "on"].includes(value.toLowerCase());
  return Boolean(value);
}

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((accumulator, key) => {
    accumulator[key] = sortObject(value[key]);
    return accumulator;
  }, {});
}
