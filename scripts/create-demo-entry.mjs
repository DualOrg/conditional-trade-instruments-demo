import {
  deriveProofHashes,
  normalizeInstrumentProperties
} from "../api/_dual.js";
import { readFileSync } from "node:fs";

const envFile = readEnvFile(process.env.DEMO_ENV_FILE);
const baseUrl = (envValue("DEMO_BASE_URL") || "https://conditional-trade-instruments.vercel.app").replace(/\/+$/, "");
const operatorToken = envValue("DEMO_OPERATOR_TOKEN") || readOperatorTokenFile();

if (!operatorToken) {
  throw new Error("DEMO_OPERATOR_TOKEN, DEMO_OPERATOR_TOKEN_FILE, or DEMO_ENV_FILE with DEMO_OPERATOR_TOKEN is required to create the live TradeFlow demo entry.");
}

function envValue(name) {
  return process.env[name] || envFile[name] || "";
}

function readEnvFile(filePath = "") {
  if (!filePath) return {};
  const raw = readFileSync(filePath, "utf8");
  const parsed = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    parsed[key] = value.replace(/\\n/g, "\n");
  }
  return parsed;
}

function readOperatorTokenFile() {
  const filePath = envValue("DEMO_OPERATOR_TOKEN_FILE");
  if (!filePath) return "";
  return readFileSync(filePath, "utf8").trim();
}

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || "GET",
    headers: {
      accept: "application/json",
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.operator ? { "x-demo-operator-token": operatorToken } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}: ${body?.error?.message || response.statusText}`);
  }
  return body;
}

const properties = normalizeInstrumentProperties({
  instrument_id: "CTI-SG-AU-001",
  buyer: "AUS MedTech Pty Ltd",
  supplier: "Lion City Precision",
  buyer_agent: "procurement-agent.au",
  corridor: "SG-AU",
  commodity_class: "medical-devices",
  payment_rail: "bank-escrow",
  state: "Milestone verified",
  value_usd: 148500,
  max_instrument_usd: 180000,
  review_threshold_usd: 120000,
  sanctions_clear: true,
  customs_preclearance: true,
  current_milestone: "Customs cleared",
  verified_milestones: 3,
  released_usd: 29700,
  remaining_usd: 118800,
  blocked_actions: 0,
  policy_version: 1,
  evidence_refs: [
    {
      type: "bill_of_lading",
      id: "BOL-8842",
      issuer: "Lion City Precision",
      uri: "demo://evidence/bol-8842"
    },
    {
      type: "gps_fix",
      id: "GPS-SIN-SYD-20260527",
      issuer: "TradeFlow route oracle",
      uri: "demo://evidence/gps-sin-syd-20260527"
    },
    {
      type: "seal_attestation",
      id: "SEAL-SIN-8842",
      issuer: "Singapore Port operator",
      uri: "demo://evidence/seal-sin-8842"
    }
  ],
  last_decision_result: "Approved",
  last_decision_reason: "Cargo loaded gate verified with BOL, GPS fix, and seal attestation.",
  updated_at: new Date().toISOString()
});

const hashes = deriveProofHashes(properties);
const enriched = normalizeInstrumentProperties({
  ...properties,
  policy_hash: hashes.policy_hash,
  instrument_hash: hashes.instrument_hash,
  evidence_hash: hashes.evidence_hash,
  last_event_hash: hashes.event_hash,
  settlement_hash: hashes.settlement_hash
});

const sync = await request("/api/instruments/sync", {
  method: "POST",
  operator: true,
  body: {
    properties: enriched,
    audit: {
      demo_entry: "operator-cargo",
      operator_action: "create_live_demo_entry",
      release_usd: 29700,
      evidence_refs: enriched.evidence_refs.map((ref) => ({ type: ref.type, id: ref.id }))
    }
  }
});

const proof = await request("/api/proof");
const proofObject = proof.proof?.instrument?.object || {};
const proofProperties = proof.proof?.instrument?.properties || {};

console.log(JSON.stringify({
  ok: true,
  baseUrl,
  demoEntryUrl: `${baseUrl}/?demo=operator-cargo`,
  synced: Boolean(sync.synced),
  payloadStyle: sync.payloadStyle,
  objectId: sync.object?.id || proof.proof?.object?.object_id || null,
  templateId: sync.object?.templateId || proof.proof?.template?.template_id || null,
  state: proofProperties.state || sync.object?.properties?.state || enriched.state,
  released_usd: proofProperties.released_usd ?? sync.object?.properties?.released_usd ?? enriched.released_usd,
  remaining_usd: proofProperties.remaining_usd ?? sync.object?.properties?.remaining_usd ?? enriched.remaining_usd,
  current_milestone: proofProperties.current_milestone || sync.object?.properties?.current_milestone || enriched.current_milestone,
  verificationLevel: proof.verification?.verificationLevel || null,
  proofBundle: proof.proof?.bundle_hash || null,
  stateHash: proofObject.state_hash || null,
  integrityHash: proofObject.integrity_hash || null,
  explorerLinks: Array.isArray(proof.links) ? proof.links.length : 0
}, null, 2));
