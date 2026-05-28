const baseUrl = (process.argv[2] || process.env.DEMO_BASE_URL || "https://conditional-trade-instruments.vercel.app").replace(/\/+$/, "");

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((accumulator, key) => {
    accumulator[key] = sortObject(value[key]);
    return accumulator;
  }, {});
}

async function hashJson(value) {
  const encoded = new TextEncoder().encode(JSON.stringify(sortObject(value)));
  const buffer = await crypto.subtle.digest("SHA-256", encoded);
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizeEvidenceRefs(input = []) {
  return (Array.isArray(input) ? input : [])
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      type: String(item.type || "attestation"),
      id: String(item.id || item.cid || item.attestation_id || ""),
      hash: String(item.hash || ""),
      issuer: String(item.issuer || ""),
      uri: String(item.uri || "")
    }))
    .filter((item) => item.id || item.hash || item.uri);
}

async function deriveProofHashes(properties) {
  const evidenceRefs = normalizeEvidenceRefs(properties.evidence_refs);
  const evidenceHash = evidenceRefs.length
    ? await hashJson(evidenceRefs)
    : await hashJson({
        instrument_id: properties.instrument_id,
        current_milestone: properties.current_milestone,
        evidence_attached: false,
        evidence_type: ""
      });
  const policyHash = await hashJson({
    corridor: properties.corridor,
    commodity_class: properties.commodity_class,
    max_instrument_usd: properties.max_instrument_usd,
    review_threshold_usd: properties.review_threshold_usd,
    sanctions_clear: properties.sanctions_clear,
    customs_preclearance: properties.customs_preclearance,
    policy_version: properties.policy_version
  });
  const instrumentHash = await hashJson({
    instrument_id: properties.instrument_id,
    buyer: properties.buyer,
    supplier: properties.supplier,
    corridor: properties.corridor,
    commodity_class: properties.commodity_class,
    payment_rail: properties.payment_rail,
    value_usd: properties.value_usd,
    max_instrument_usd: properties.max_instrument_usd
  });
  const settlementHash = await hashJson({
    instrument_id: properties.instrument_id,
    released_usd: properties.released_usd,
    remaining_usd: properties.remaining_usd,
    state: properties.state
  });
  const eventHash = await hashJson({
    instrument_id: properties.instrument_id,
    current_milestone: properties.current_milestone,
    last_decision_result: properties.last_decision_result,
    last_decision_reason: properties.last_decision_reason,
    gate: null,
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

function declaredHashes(properties) {
  return {
    policy_hash: properties.policy_hash || "",
    instrument_hash: properties.instrument_hash || "",
    evidence_hash: properties.evidence_hash || "",
    last_event_hash: properties.last_event_hash || "",
    settlement_hash: properties.settlement_hash || ""
  };
}

function check(name, declared, derived) {
  return {
    name,
    declared: declared || null,
    derived,
    verifies: declared ? declared === derived : null
  };
}

const response = await fetch(`${baseUrl}/api/proof`, {
  headers: { accept: "application/json" }
});
const payload = await response.json();
if (!response.ok) {
  throw new Error(`/api/proof returned HTTP ${response.status}: ${payload?.error?.message || "unknown error"}`);
}

const proof = payload.proof;
const properties = proof.instrument.properties;
const declared = declaredHashes(properties);
const derived = await deriveProofHashes(properties);
const bundleHash = await hashJson({
  template: proof.template,
  object: proof.object,
  instrument: proof.instrument,
  hashes: proof.hashes,
  declared_hashes: proof.declared_hashes,
  caveats: proof.caveats
});

const report = {
  ok: bundleHash === proof.bundle_hash
    && declared.policy_hash === derived.policy_hash
    && declared.instrument_hash === derived.instrument_hash
    && declared.evidence_hash === derived.evidence_hash
    && declared.last_event_hash === derived.event_hash
    && declared.settlement_hash === derived.settlement_hash,
  baseUrl,
  algorithm: "sha256(JSON.stringify(stableSort(value)))",
  source: proof.source,
  instrumentId: properties.instrument_id,
  bundleHash: {
    declared: proof.bundle_hash,
    rederived: bundleHash,
    verifies: bundleHash === proof.bundle_hash
  },
  hashChecks: [
    check("policy_hash", declared.policy_hash, derived.policy_hash),
    check("instrument_hash", declared.instrument_hash, derived.instrument_hash),
    check("evidence_hash", declared.evidence_hash, derived.evidence_hash),
    check("last_event_hash", declared.last_event_hash, derived.event_hash),
    check("settlement_hash", declared.settlement_hash, derived.settlement_hash)
  ],
  dualStateHash: {
    declared: proof.instrument.object.state_hash,
    note: "DUAL canonical object state hash; verify via the DUAL block explorer object link."
  },
  dualIntegrityHash: {
    declared: proof.instrument.object.integrity_hash,
    note: "DUAL canonical object integrity hash; verify via the DUAL block explorer object link."
  },
  explorerLinks: payload.links || proof.links || []
};

console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
