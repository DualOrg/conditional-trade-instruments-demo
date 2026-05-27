import { createHash } from "node:crypto";

export const defaultOrgId = "69b935b4187e903f826bbe71";
export const templateName = "io.dual.conditional_trade_instrument.demo.v1";

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
  const object = await dualRequest(config, "GET", `/objects/${encodeURIComponent(config.objectId)}`);
  const properties = normalizeInstrumentProperties(
    object?.properties || object?.custom || object?.data?.custom || object?.state?.custom || {}
  );
  return {
    available: true,
    object,
    properties,
    status: readiness()
  };
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
    policy_version: "number",
    policy_hash: "string",
    instrument_hash: "string",
    evidence_hash: "string",
    last_event_hash: "string",
    settlement_hash: "string",
    last_decision_result: "string",
    last_decision_reason: "string",
    updated_at: "string"
  };
}

export function seedInstrumentProperties() {
  const properties = normalizeInstrumentProperties({});
  const policyHash = hashJson({
    corridor: properties.corridor,
    commodity_class: properties.commodity_class,
    max_instrument_usd: properties.max_instrument_usd,
    review_threshold_usd: properties.review_threshold_usd,
    sanctions_clear: properties.sanctions_clear,
    customs_preclearance: properties.customs_preclearance,
    policy_version: properties.policy_version
  });
  const instrumentHash = hashJson({
    instrument_id: properties.instrument_id,
    buyer: properties.buyer,
    supplier: properties.supplier,
    corridor: properties.corridor,
    commodity_class: properties.commodity_class,
    value_usd: properties.value_usd
  });
  return {
    ...properties,
    policy_hash: policyHash,
    instrument_hash: instrumentHash,
    settlement_hash: hashJson({ instrument_id: properties.instrument_id, released_usd: properties.released_usd })
  };
}

export function normalizeInstrumentProperties(input = {}) {
  const now = new Date().toISOString();
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
    policy_version: numberValue(input.policy_version, 1),
    policy_hash: stringValue(input.policy_hash),
    instrument_hash: stringValue(input.instrument_hash),
    evidence_hash: stringValue(input.evidence_hash),
    last_event_hash: stringValue(input.last_event_hash),
    settlement_hash: stringValue(input.settlement_hash),
    last_decision_result: stringValue(input.last_decision_result, "Ready"),
    last_decision_reason: stringValue(input.last_decision_reason, "Awaiting next verification"),
    updated_at: stringValue(input.updated_at, now)
  };
}

export function normalizeGateRequest(input = {}) {
  return {
    milestone_id: stringValue(input.milestone_id, "loaded"),
    milestone_name: stringValue(input.milestone_name, "Cargo loaded"),
    corridor: stringValue(input.corridor, "SG-AU"),
    commodity_class: stringValue(input.commodity_class, "medical-devices"),
    release_usd: numberValue(input.release_usd, 29700),
    evidence_attached: booleanValue(input.evidence_attached, true),
    evidence_type: stringValue(input.evidence_type, "BOL + GPS fix"),
    customs_preclearance: booleanValue(input.customs_preclearance, true)
  };
}

export function evaluateInstrumentGate(properties, request, context = {}) {
  const instrument = normalizeInstrumentProperties(properties);
  const gate = normalizeGateRequest(request);
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

  const cumulative = instrument.released_usd + gate.release_usd;
  if (allowed && cumulative > instrument.review_threshold_usd) {
    code = "human_review_logged";
    result = "Approved with review";
    reasons.push(`Cumulative release ${cumulative} exceeds review threshold ${instrument.review_threshold_usd}.`);
  }
  if (!reasons.length) reasons.push("Corridor, commodity, evidence, value, sanctions, and customs checks passed.");

  const decisionHash = hashJson({
    instrument_id: instrument.instrument_id,
    gate,
    result,
    code,
    policy_hash: instrument.policy_hash,
    instrument_hash: instrument.instrument_hash,
    last_event_hash: instrument.last_event_hash
  });

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
      policy_hash: instrument.policy_hash,
      instrument_hash: instrument.instrument_hash,
      evidence_hash: instrument.evidence_hash,
      settlement_hash: instrument.settlement_hash,
      decision_hash: decisionHash,
      evaluated_at: new Date().toISOString()
    }
  };
}

export function updatePayload(objectId, properties, metadata = {}) {
  return {
    action: {
      update: {
        id: objectId,
        data: {
          custom: {
            ...properties,
            last_event_hash: metadata.event_hash || properties.last_event_hash || "",
            updated_at: new Date().toISOString()
          }
        }
      }
    }
  };
}

export function mintPayload(templateId, properties) {
  return {
    action: {
      mint: {
        template_id: templateId,
        data: {
          name: "Conditional Trade Instrument Demo",
          description: "Milestone-gated trade finance instrument for the TradeFlow Control Desk demo.",
          category: "conditional-trade-instrument",
          custom: properties
        }
      }
    }
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
