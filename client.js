const initialState = {
  selectedTab: "instrument",
  selectedView: "timeline",
  nonce: 1,
  policyVersion: 1,
  exported: false,
  localPreviewDirty: false,
  lastDecision: {
    result: "Ready",
    reason: "Awaiting next verification",
    evidence: "BOL + GPS + inspection",
    tone: "ready"
  },
  dualStatus: {
    checked: false,
    mode: "local",
    runtime: "browser",
    orgId: "69b935b4187e903f826bbe71",
    readbackReady: false,
    writable: false,
    publicWrites: false,
    missing: [],
    detail: "DUAL status has not been checked yet."
  },
  verifierResult: {
    ran: false,
    result: "Not run",
    reason: "Calls the public read-only evaluator and returns a decision hash without writing to DUAL.",
    source: "not run",
    decisionHash: "",
    publicWrites: false
  },
  dualProof: {
    checked: false,
    ok: false,
    source: "pending",
    objectId: "",
    templateId: "",
    stateHash: "",
    integrityHash: "",
    bundleHash: "",
    verificationLevel: "pending",
    verificationOk: false,
    hashes: {},
    links: []
  },
  policy: {
    buyerAgent: "procurement-agent.au",
    maxInstrumentUsd: 180000,
    reviewThreshold: 120000,
    sanctionsClear: true,
    customsPreclearance: true,
    allowedCorridor: "SG-AU",
    allowedCommodity: "medical-devices"
  },
  instrument: {
    id: "CTI-SG-AU-001",
    corridor: "SG-AU",
    commodity: "medical-devices",
    valueUsd: 148500,
    paymentRail: "bank-escrow",
    state: "Issued",
    supplier: "Lion City Precision",
    buyer: "AUS MedTech Pty Ltd",
    route: "Singapore bonded warehouse to Sydney distribution centre",
    hashes: {
      instrument: "",
      policy: "",
      event: "",
      settlement: ""
    }
  },
  milestones: [
    {
      id: "mandate",
      name: "Buyer mandate approved",
      place: "Sydney",
      description: "Principal authorizes the buyer agent to issue one trade instrument.",
      evidence: "Delegation signature",
      releasePct: 0,
      status: "verified",
      evidenceAttached: true
    },
    {
      id: "issued",
      name: "Instrument issued",
      place: "DUAL",
      description: "Conditional instrument minted with corridor, commodity, and payment terms.",
      evidence: "Token template + policy hash",
      releasePct: 0,
      status: "verified",
      evidenceAttached: true
    },
    {
      id: "loaded",
      name: "Cargo loaded",
      place: "Singapore Port",
      description: "Bill of lading, seal number, and container GPS packet are attached.",
      evidence: "BOL-8842 + GPS fix",
      releasePct: 0.2,
      status: "active",
      evidenceAttached: false
    },
    {
      id: "customs",
      name: "Customs cleared",
      place: "Sydney Customs",
      description: "Customs pre-clearance and import declaration are verified.",
      evidence: "AU-ICS clearance",
      releasePct: 0.25,
      status: "pending",
      evidenceAttached: false
    },
    {
      id: "inspection",
      name: "Quality inspection passed",
      place: "Buyer DC",
      description: "Warehouse inspection confirms shipment condition and quantity.",
      evidence: "Inspection photo set",
      releasePct: 0.25,
      status: "pending",
      evidenceAttached: false
    },
    {
      id: "delivered",
      name: "Final delivery accepted",
      place: "Buyer DC",
      description: "Buyer acceptance closes the instrument and settlement proof is locked.",
      evidence: "Acceptance certificate",
      releasePct: 0.3,
      status: "pending",
      evidenceAttached: false
    }
  ],
  audit: [
    {
      type: "ok",
      title: "Buyer mandate approved",
      detail: "procurement-agent.au authorized for SG-AU medical device trade.",
      at: "09:12:06"
    },
    {
      type: "ok",
      title: "Instrument object minted",
      detail: "CTI-SG-AU-001 linked to policy v1 and buyer principal.",
      at: "09:14:33"
    },
    {
      type: "ok",
      title: "Escrow mirror initialized",
      detail: "Bank escrow mirror registered as external settlement rail.",
      at: "09:16:51"
    },
    {
      type: "warn",
      title: "Human review rule armed",
      detail: "Review required when cumulative release exceeds USD 120,000.",
      at: "09:18:04"
    }
  ]
};

let state = loadState();
let reviewerMode = false;
let reviewerStepIndex = 0;

const reviewerSteps = [
  {
    id: "instrument",
    targetId: "instrumentPanel",
    title: "Instrument state",
    body: "Start with the live commercial state: one SG-AU medical-device instrument, Cargo loaded verified, and Customs cleared next.",
    facts: () => [
      ["Instrument", state.instrument.id],
      ["Face value", formatUsd(state.instrument.valueUsd)],
      ["Released", formatUsd(releasedAmount())],
      ["Next gate", nextMilestone()?.name || "Closed"]
    ]
  },
  {
    id: "mandate",
    targetId: "mandatePanel",
    title: "Mandate boundary",
    body: "The buyer agent is bounded by corridor, commodity class, instrument value, sanctions clearance, and manual review threshold.",
    facts: () => [
      ["Buyer agent", state.policy.buyerAgent],
      ["Corridor", corridorLabel()],
      ["Commodity", commodityLabel()],
      ["Ceiling", formatUsd(state.policy.maxInstrumentUsd)]
    ]
  },
  {
    id: "milestones",
    targetId: "milestonePanel",
    title: "Milestone gate",
    body: "Each payment release waits for evidence and policy evaluation; the verified Cargo loaded gate released the first tranche.",
    facts: () => [
      ["Verified", `${verifiedCount()} of ${state.milestones.length}`],
      ["Gate", "Cargo loaded"],
      ["Release", formatUsd(state.instrument.valueUsd * 0.2)],
      ["Evidence", "BOL-8842 + GPS fix"]
    ]
  },
  {
    id: "readiness",
    targetId: "dualReadinessPanel",
    title: "DUAL readiness",
    body: "Production is reading live DUAL state while public writes stay disabled; write execution is operator-gated.",
    facts: () => [
      ["Runtime", `${state.dualStatus?.runtime || "browser"} / ${state.dualStatus?.mode || "local"}`],
      ["Readback", state.dualStatus?.readbackReady ? "configured" : "seed fallback"],
      ["Writable", state.dualStatus?.writable ? "event-bus gated" : "disabled"],
      ["Public writes", String(Boolean(state.dualStatus?.publicWrites))]
    ]
  },
  {
    id: "proof",
    targetId: "proofRailPanel",
    title: "Proof rail",
    body: "The object and template proof buttons open the block explorer; hashes are re-derived from the DUAL readback.",
    facts: () => [
      ["Source", state.dualProof?.source || "pending"],
      ["Verifier", state.dualProof?.verificationLevel || "pending"],
      ["Object", shortHash(state.dualProof?.objectId)],
      ["Template", shortHash(state.dualProof?.templateId)]
    ]
  },
  {
    id: "verifier",
    targetId: "verifierPanel",
    title: "Agent verifier",
    body: "Agents can evaluate the next gate and get a decision hash without receiving authority to write to DUAL.",
    facts: () => [
      ["Decision", state.verifierResult?.result || "Not run"],
      ["Decision hash", shortHash(state.verifierResult?.decisionHash)],
      ["Public writes", String(Boolean(state.verifierResult?.publicWrites))],
      ["Boundary", "read/evaluate/verify only"]
    ]
  }
];

const $ = (id) => document.getElementById(id);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadState() {
  const demoEntry = demoEntryState(requestedDemoEntry());
  if (demoEntry) return demoEntry;

  const stored = localStorage.getItem("dual-tradeflow-state");
  if (!stored) return clone(initialState);
  try {
    const parsed = JSON.parse(stored);
    return {
      ...clone(initialState),
      ...parsed,
      dualStatus: { ...clone(initialState.dualStatus), ...(parsed.dualStatus || {}) },
      verifierResult: { ...clone(initialState.verifierResult), ...(parsed.verifierResult || {}) },
      dualProof: { ...clone(initialState.dualProof), ...(parsed.dualProof || {}) },
      policy: { ...clone(initialState.policy), ...(parsed.policy || {}) },
      instrument: {
        ...clone(initialState.instrument),
        ...(parsed.instrument || {}),
        hashes: { ...clone(initialState.instrument.hashes), ...((parsed.instrument || {}).hashes || {}) }
      },
      milestones: Array.isArray(parsed.milestones) ? parsed.milestones : clone(initialState.milestones),
      audit: Array.isArray(parsed.audit) ? parsed.audit : clone(initialState.audit)
    };
  } catch {
    return clone(initialState);
  }
}

function requestedReviewerMode() {
  try {
    const params = new URLSearchParams(window.location.search);
    return ["1", "true", "yes"].includes((params.get("reviewer") || "").trim().toLowerCase());
  } catch {
    return false;
  }
}

function requestedDemoEntry() {
  try {
    const params = new URLSearchParams(window.location.search);
    return (params.get("demo") || "").trim().toLowerCase();
  } catch {
    return "";
  }
}

function demoEntryState(name) {
  if (!["operator-cargo", "cargo-verified"].includes(name)) return null;

  const demo = clone(initialState);
  demo.selectedTab = "mutable";
  demo.selectedView = "timeline";
  demo.nonce = 7;
  demo.exported = true;
  demo.instrument.corridor = "SG-AU";
  demo.instrument.commodity = "medical-devices";
  demo.instrument.valueUsd = 148500;
  demo.instrument.paymentRail = "bank-escrow";
  demo.milestones = demo.milestones.map((milestone) => {
    if (milestone.id === "loaded") return { ...milestone, status: "verified", evidenceAttached: true };
    if (milestone.id === "customs") return { ...milestone, status: "active", evidenceAttached: false };
    return milestone;
  });
  demo.lastDecision = {
    result: "Proof exported",
    reason: "Cargo loaded gate verified; proof bundle ready for DUAL readback and explorer review",
    evidence: "BOL-8842 + GPS fix -> $29,700 release",
    tone: "ready"
  };
  demo.audit = [
    {
      type: "export",
      title: "Demo proof bundle generated",
      detail: "Cargo loaded verification exported for DUAL readback and block explorer review.",
      at: "20:32:18"
    },
    {
      type: "ok",
      title: "Cargo loaded verified",
      detail: "$29,700 released through bank escrow mirror.",
      at: "20:31:57"
    },
    {
      type: "ok",
      title: "Evidence packet attached",
      detail: "BOL-8842 + GPS fix attached for Cargo loaded.",
      at: "20:31:34"
    },
    ...demo.audit
  ];
  return demo;
}

function saveState() {
  localStorage.setItem("dual-tradeflow-state", JSON.stringify(state));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatUsd(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(Number(value || 0));
}

function nowStamp() {
  return new Date().toLocaleTimeString("en-AU", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
}

function shortHash(value) {
  if (!value) return "pending";
  return `${value.slice(0, 10)}...${value.slice(-8)}`;
}

function fallbackDigest(input) {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return `fallback-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

async function digest(input) {
  if (!globalThis.crypto?.subtle) return fallbackDigest(input);
  const encoded = new TextEncoder().encode(input);
  const buffer = await crypto.subtle.digest("SHA-256", encoded);
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function addAudit(type, title, detail) {
  state.audit.unshift({ type, title, detail, at: nowStamp() });
  state.audit = state.audit.slice(0, 30);
  state.nonce += 1;
}

function syncFromInputs() {
  state.instrument.corridor = $("corridorSelect").value;
  state.instrument.commodity = $("commoditySelect").value;
  state.policy.buyerAgent = $("buyerAgent").value.trim() || "procurement-agent.au";
  state.policy.maxInstrumentUsd = Number($("maxInstrumentUsd").value || 0);
  state.policy.reviewThreshold = Number($("reviewThreshold").value || 0);
  state.policy.sanctionsClear = $("sanctionsClear").checked;
  state.policy.customsPreclearance = $("customsPreclearance").checked;
  state.instrument.valueUsd = Number($("instrumentValue").value || 0);
  state.instrument.paymentRail = $("paymentRail").value;
}

function markPreviewDirty() {
  state.localPreviewDirty = true;
}

function bindInputs() {
  $("corridorSelect").value = state.instrument.corridor;
  $("commoditySelect").value = state.instrument.commodity;
  $("buyerAgent").value = state.policy.buyerAgent;
  $("maxInstrumentUsd").value = state.policy.maxInstrumentUsd;
  $("reviewThreshold").value = state.policy.reviewThreshold;
  $("sanctionsClear").checked = state.policy.sanctionsClear;
  $("customsPreclearance").checked = state.policy.customsPreclearance;
  $("instrumentValue").value = state.instrument.valueUsd;
  $("paymentRail").value = state.instrument.paymentRail;
}

function nextMilestone() {
  return state.milestones.find((milestone) => milestone.status === "active")
    || state.milestones.find((milestone) => milestone.status === "pending")
    || null;
}

function verifiedCount() {
  return state.milestones.filter((milestone) => milestone.status === "verified").length;
}

function blockedCount() {
  const blockedMilestones = state.milestones.filter((milestone) => milestone.status === "blocked").length;
  const blockedAuditEvents = state.audit.filter((item) => item.type === "block").length;
  return blockedMilestones || blockedAuditEvents;
}

function releasedAmount() {
  return state.milestones.reduce((sum, milestone) => {
    if (milestone.status !== "verified") return sum;
    return sum + state.instrument.valueUsd * milestone.releasePct;
  }, 0);
}

function activePaymentAmount() {
  const next = nextMilestone();
  if (!next) return 0;
  return state.instrument.valueUsd * next.releasePct;
}

function paymentRailLabel(value = state.instrument.paymentRail) {
  const labels = {
    "bank-escrow": "bank escrow mirror",
    "stablecoin-escrow": "stablecoin escrow",
    "erp-payable": "ERP payable trigger"
  };
  return labels[value] || value;
}

function commodityLabel(value = state.instrument.commodity) {
  const labels = {
    "medical-devices": "medical devices",
    "lithium-cells": "lithium cells",
    "luxury-goods": "luxury goods"
  };
  return labels[value] || value;
}

function corridorLabel(value = state.instrument.corridor) {
  const labels = {
    "SG-AU": "Singapore to Australia",
    "SG-US": "Singapore to United States",
    "CN-AU": "China to Australia"
  };
  return labels[value] || value;
}

function milestoneClass(milestone) {
  if (milestone.status === "verified") return "verified";
  if (milestone.status === "active") return "active";
  if (milestone.status === "blocked") return "blocked";
  return "";
}

function visibleStatus(milestone) {
  if (milestone.status === "verified") return "Verified";
  if (milestone.status === "active") return milestone.evidenceAttached ? "Ready" : "Needs evidence";
  if (milestone.status === "blocked") return "Blocked";
  return "Pending";
}

function setNextActive() {
  const hasBlocked = state.milestones.some((milestone) => milestone.status === "blocked");
  if (hasBlocked) return;

  let activeAssigned = false;
  state.milestones = state.milestones.map((milestone) => {
    if (milestone.status === "verified") return milestone;
    if (!activeAssigned) {
      activeAssigned = true;
      return { ...milestone, status: "active" };
    }
    return { ...milestone, status: "pending" };
  });
}

function evaluatePolicy(milestone) {
  if (!milestone) {
    return { ok: false, tone: "review", reason: "All milestone gates already closed" };
  }
  if (state.instrument.corridor !== state.policy.allowedCorridor) {
    return { ok: false, tone: "block", reason: `${corridorLabel(state.instrument.corridor)} is outside mandate corridor` };
  }
  if (state.instrument.commodity !== state.policy.allowedCommodity) {
    return { ok: false, tone: "block", reason: `${commodityLabel(state.instrument.commodity)} is outside approved commodity class` };
  }
  if (!state.policy.sanctionsClear) {
    return { ok: false, tone: "block", reason: "Counterparty sanctions clearance is missing" };
  }
  if (state.instrument.valueUsd > state.policy.maxInstrumentUsd) {
    return { ok: false, tone: "block", reason: `${formatUsd(state.instrument.valueUsd)} exceeds ${formatUsd(state.policy.maxInstrumentUsd)} mandate ceiling` };
  }
  if (milestone.id === "customs" && !state.policy.customsPreclearance) {
    return { ok: false, tone: "block", reason: "Customs pre-clearance is required before release" };
  }
  if (!milestone.evidenceAttached) {
    return { ok: false, tone: "review", reason: `${milestone.name} needs evidence attachment before verification` };
  }

  const cumulative = releasedAmount() + activePaymentAmount();
  if (cumulative > state.policy.reviewThreshold) {
    return { ok: true, tone: "review", reason: `Human review logged because cumulative release reaches ${formatUsd(cumulative)}` };
  }

  return { ok: true, tone: "ready", reason: "Scope, corridor, value, evidence, and compliance checks passed" };
}

function updateInstrumentState() {
  const blocked = state.milestones.some((milestone) => milestone.status === "blocked");
  const allVerified = state.milestones.every((milestone) => milestone.status === "verified");
  const count = verifiedCount();

  if (blocked) state.instrument.state = "Blocked";
  else if (allVerified) state.instrument.state = "Settled";
  else if (count >= 4) state.instrument.state = "Payment releasing";
  else if (count >= 3) state.instrument.state = "Milestone verified";
  else state.instrument.state = "Issued";
}

function currentToken() {
  const next = nextMilestone();
  return {
    instrument: {
      instrument_id: state.instrument.id,
      buyer: state.instrument.buyer,
      supplier: state.instrument.supplier,
      buyer_agent: state.policy.buyerAgent,
      corridor: state.instrument.corridor,
      commodity_class: state.instrument.commodity,
      payment_rail: state.instrument.paymentRail,
      value_usd: state.instrument.valueUsd
    },
    mutable: {
      state: state.instrument.state,
      verified_milestones: verifiedCount(),
      next_gate: next ? next.name : "None",
      released_usd: Math.round(releasedAmount()),
      remaining_usd: Math.max(0, Math.round(state.instrument.valueUsd - releasedAmount())),
      nonce: state.nonce,
      exported: state.exported
    },
    compliance: {
      mandate_policy_version: state.policyVersion,
      allowed_corridor: state.policy.allowedCorridor,
      allowed_commodity: state.policy.allowedCommodity,
      max_instrument_usd: state.policy.maxInstrumentUsd,
      review_threshold_usd: state.policy.reviewThreshold,
      sanctions_clear: state.policy.sanctionsClear,
      customs_preclearance: state.policy.customsPreclearance,
      blocked_actions: blockedCount(),
      latest_policy_hash: shortHash(state.instrument.hashes.policy),
      dual_readback_ready: Boolean(state.dualStatus?.readbackReady),
      public_writes: Boolean(state.dualStatus?.publicWrites),
      proof_anchor: state.dualProof?.objectId ? `DUAL object ${shortHash(state.dualProof.objectId)}` : "seed object",
      local_preview_dirty: Boolean(state.localPreviewDirty)
    }
  };
}

function currentInstrumentProperties() {
  const next = nextMilestone();
  const released = Math.round(releasedAmount());
  return {
    instrument_id: state.instrument.id,
    buyer: state.instrument.buyer,
    supplier: state.instrument.supplier,
    buyer_agent: state.policy.buyerAgent,
    corridor: state.instrument.corridor,
    commodity_class: state.instrument.commodity,
    payment_rail: state.instrument.paymentRail,
    state: state.instrument.state,
    value_usd: state.instrument.valueUsd,
    max_instrument_usd: state.policy.maxInstrumentUsd,
    review_threshold_usd: state.policy.reviewThreshold,
    sanctions_clear: state.policy.sanctionsClear,
    customs_preclearance: state.policy.customsPreclearance,
    current_milestone: next ? next.name : "Closed",
    verified_milestones: verifiedCount(),
    released_usd: released,
    remaining_usd: Math.max(0, Math.round(state.instrument.valueUsd - released)),
    blocked_actions: blockedCount(),
    policy_version: state.policyVersion,
    policy_hash: state.instrument.hashes.policy,
    instrument_hash: state.instrument.hashes.instrument,
    evidence_hash: state.instrument.hashes.event,
    last_event_hash: state.instrument.hashes.event,
    settlement_hash: state.instrument.hashes.settlement,
    last_decision_result: state.lastDecision.result,
    last_decision_reason: state.lastDecision.reason,
    updated_at: new Date().toISOString()
  };
}

function currentGateRequest() {
  const next = nextMilestone();
  return {
    milestone_id: next?.id || "closed",
    milestone_name: next?.name || "Closed",
    corridor: state.instrument.corridor,
    commodity_class: state.instrument.commodity,
    release_usd: Math.round(activePaymentAmount()),
    evidence_attached: Boolean(next?.evidenceAttached),
    evidence_type: next?.evidence || "Settlement proof",
    customs_preclearance: state.policy.customsPreclearance
  };
}

async function refreshDualStatus() {
  try {
    const response = await fetch("/api/dual/status", {
      headers: { accept: "application/json" }
    });
    const payload = await response.json();
    state.dualStatus = {
      ...clone(initialState.dualStatus),
      ...payload,
      checked: true,
      error: response.ok ? "" : `HTTP ${response.status}`
    };
  } catch (error) {
    state.dualStatus = {
      ...clone(initialState.dualStatus),
      checked: true,
      error: error.message || "Status check failed",
      detail: "DUAL status endpoint is unavailable in this runtime. The UI remains local-only."
    };
  }
}

async function refreshDualProof() {
  try {
    const response = await fetch("/api/proof", {
      headers: { accept: "application/json" }
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error?.message || `HTTP ${response.status}`);
    const proof = payload.proof || {};
    const proofObject = proof.instrument?.object || {};
    state.dualProof = {
      ...clone(initialState.dualProof),
      checked: true,
      ok: Boolean(payload.ok),
      source: proof.source || "unknown",
      objectId: proof.object?.object_id || proofObject.object_id || "",
      templateId: proof.template?.template_id || proofObject.template_id || "",
      stateHash: proofObject.state_hash || "",
      integrityHash: proofObject.integrity_hash || "",
      bundleHash: proof.bundle_hash || "",
      verificationLevel: payload.verification?.verificationLevel || "pending",
      verificationOk: Boolean(payload.verification?.ok),
      hashes: proof.hashes || {},
      links: payload.links || proof.links || []
    };
  } catch (error) {
    state.dualProof = {
      ...clone(initialState.dualProof),
      checked: true,
      source: "unavailable",
      verificationLevel: "unavailable",
      error: error.message || "Proof endpoint unavailable"
    };
  }
}

async function refreshHashes() {
  const instrumentPayload = JSON.stringify({
    instrument: state.instrument,
    milestones: state.milestones,
    nonce: state.nonce
  });
  const policyPayload = JSON.stringify({
    policy: state.policy,
    policyVersion: state.policyVersion
  });
  const lastEvent = JSON.stringify(state.audit[0] || {});
  const settlementPayload = JSON.stringify({
    id: state.instrument.id,
    released: releasedAmount(),
    state: state.instrument.state,
    verified: verifiedCount()
  });

  state.instrument.hashes.instrument = await digest(instrumentPayload);
  state.instrument.hashes.policy = await digest(policyPayload);
  state.instrument.hashes.event = await digest(lastEvent);
  state.instrument.hashes.settlement = await digest(settlementPayload);
}

async function postVerifierGate(gate) {
  await refreshHashes();
  const response = await fetch("/api/instruments/evaluate", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      instrument: currentInstrumentProperties(),
      gate
    })
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || `Verifier returned HTTP ${response.status}`);
  return {
    evaluation: payload.evaluation || {},
    publicWrites: Boolean(payload.publicWrites)
  };
}

function renderRouteMap() {
  const view = state.selectedView || "timeline";
  $("routeMap").className = `route-map ${view === "evidence" ? "evidence-view" : view === "payments" ? "payment-view" : ""}`;

  if (view === "evidence") {
    $("routeMap").innerHTML = state.milestones.map((milestone) => {
      const status = milestone.status === "verified" ? "ready" : milestone.status === "blocked" ? "blocked" : milestone.status === "active" ? "active" : "";
      const evidenceState = milestone.evidenceAttached ? "Attached" : milestone.status === "verified" ? "Verified" : "Waiting";
      return `
        <article class="route-evidence-card ${status}">
          <span>${escapeHtml(visibleStatus(milestone))}</span>
          <strong>${escapeHtml(milestone.evidence)}</strong>
          <small>${escapeHtml(milestone.name)} · ${escapeHtml(evidenceState)} · ${escapeHtml(milestone.place)}</small>
        </article>
      `;
    }).join("");
    return;
  }

  if (view === "payments") {
    const paymentMilestones = state.milestones.filter((milestone) => milestone.releasePct > 0);
    $("routeMap").innerHTML = paymentMilestones.map((milestone) => {
      const status = milestone.status === "verified" ? "released" : milestone.status === "blocked" ? "blocked" : "queued";
      return `
        <article class="route-payment-card ${status}">
          <span>${escapeHtml(status)}</span>
          <strong>${formatUsd(state.instrument.valueUsd * milestone.releasePct)}</strong>
          <small>${escapeHtml(milestone.name)} · ${escapeHtml(paymentRailLabel())}</small>
        </article>
      `;
    }).join("");
    return;
  }

  const cargo = state.milestones.find((milestone) => milestone.id === "loaded");
  const customs = state.milestones.find((milestone) => milestone.id === "customs");
  const inspection = state.milestones.find((milestone) => milestone.id === "inspection");
  const delivered = state.milestones.find((milestone) => milestone.id === "delivered");
  const nodes = [
    {
      step: "01",
      name: "Singapore Port",
      detail: "Cargo seal and GPS packet",
      status: cargo.status === "verified" ? "verified" : cargo.status === "blocked" ? "blocked" : "active"
    },
    {
      step: "02",
      name: "Sea transit",
      detail: "Container telemetry retained",
      status: cargo.status === "verified" ? "active" : ""
    },
    {
      step: "03",
      name: "Sydney Customs",
      detail: "Import declaration and clearance",
      status: customs.status === "verified" ? "verified" : customs.status === "blocked" ? "blocked" : customs.status === "active" ? "active" : ""
    },
    {
      step: "04",
      name: "Buyer DC",
      detail: inspection.status === "verified" && delivered.status !== "verified" ? "Awaiting final acceptance" : "Inspection and delivery",
      status: delivered.status === "verified" ? "verified" : inspection.status === "active" || delivered.status === "active" ? "active" : inspection.status === "blocked" || delivered.status === "blocked" ? "blocked" : ""
    }
  ];

  $("routeMap").innerHTML = nodes.map((node) => `
    <article class="route-node ${escapeHtml(node.status)}">
      <span>${escapeHtml(node.step)}</span>
      <strong>${escapeHtml(node.name)}</strong>
      <small>${escapeHtml(node.detail)}</small>
    </article>
  `).join("");
}

function renderDualReadiness() {
  const status = state.dualStatus || {};
  const modeLabel = status.writable
    ? "Operator gated"
    : status.readbackReady
      ? "Read-linked"
      : status.checked
        ? "Read-only"
        : "Checking";
  const tone = status.writable || status.readbackReady ? "verified" : status.error ? "blocked" : "review";
  const missing = Array.isArray(status.missing) && status.missing.length ? ` Missing: ${status.missing.join(", ")}.` : "";

  $("dualModeChip").textContent = modeLabel;
  $("dualModeChip").className = `status-chip ${tone}`;
  $("dualRuntime").textContent = `${status.runtime || "browser"} / ${status.mode || "local"}`;
  $("dualOrg").textContent = status.orgId || "not configured";
  $("dualReadback").textContent = status.readbackReady ? "configured" : "seed fallback";
  $("dualWritable").textContent = status.writable ? "event-bus gated" : "disabled";
  $("dualDetail").textContent = `${status.detail || "Status pending."}${missing}`;
  $("objectSource").textContent = status.readbackReady ? "DUAL readback" : `seed object · nonce ${state.nonce}`;
  $("proofModeChip").textContent = modeLabel;
  $("proofModeChip").className = `status-chip ${tone}`;
  $("publicWrites").textContent = String(Boolean(status.publicWrites || state.verifierResult?.publicWrites));
}

function renderVerifier() {
  const result = state.verifierResult || clone(initialState.verifierResult);
  const decision = result.result || "Not run";
  $("verifierSource").textContent = result.source || "not run";
  $("verifierDecision").textContent = decision;
  $("verifierReason").textContent = result.reason || "Calls the public read-only evaluator and returns a decision hash without writing to DUAL.";
  $("decisionHash").textContent = shortHash(result.decisionHash);
  $("publicWrites").textContent = String(Boolean(result.publicWrites));
}

function renderDualProof() {
  const proof = state.dualProof || clone(initialState.dualProof);
  const hashes = proof.hashes || {};
  $("instrumentHash").textContent = shortHash(hashes.instrument_hash || state.instrument.hashes.instrument);
  $("policyHash").textContent = shortHash(hashes.policy_hash || state.instrument.hashes.policy);
  $("eventHash").textContent = shortHash(hashes.event_hash || state.instrument.hashes.event);
  $("settlementHash").textContent = shortHash(hashes.settlement_hash || state.instrument.hashes.settlement);
  $("stateHash").textContent = shortHash(proof.stateHash);
  $("integrityHash").textContent = shortHash(proof.integrityHash);
  $("bundleHash").textContent = shortHash(proof.bundleHash);
  $("proofVerificationLevel").textContent = proof.verificationOk
    ? proof.verificationLevel
    : proof.checked
      ? proof.error || "proof pending"
      : "checking proof";
  $("proofObjectId").textContent = proof.objectId ? shortHash(proof.objectId) : "pending";
  $("proofTemplateId").textContent = proof.templateId ? shortHash(proof.templateId) : "pending";
  $("proofSource").textContent = proof.source || "pending";
  renderProofLinks(proof.links || []);
  renderPrimaryProofActions(proof.links || []);
}

function renderControlAnchorNote() {
  const note = $("controlAnchorNote");
  const object = state.dualProof?.objectId ? `DUAL object ${shortHash(state.dualProof.objectId)}` : "the seed object";
  note.classList.toggle("preview-dirty", Boolean(state.localPreviewDirty));
  note.textContent = state.localPreviewDirty
    ? `Local preview changed. The proof rail is still pinned to ${object}; only an operator-gated sync can persist a new DUAL state.`
    : `Controls update local preview only. The proof rail remains pinned to ${object} until an operator-gated sync writes a new state.`;
}

function renderProofLinks(links = []) {
  const uniqueLinks = [...new Map(links
    .filter((link) => link?.href)
    .map((link) => [link.id || link.href, link])).values()];
  if (!uniqueLinks.length) {
    $("proofLinks").innerHTML = `<div class="proof-link-empty">DUAL block explorer links appear after proof readback.</div>`;
    return;
  }
  $("proofLinks").innerHTML = uniqueLinks.slice(0, 6).map((link) => `
    <a class="proof-link ${escapeHtml(link.source || "")}" href="${escapeHtml(link.href)}" target="_blank" rel="noreferrer">
      <span>${escapeHtml(link.label || "DUAL block explorer")}</span>
      <strong>${escapeHtml(shortHash(link.value || link.detail || link.href))}</strong>
      <small>${escapeHtml(link.detail || "Open proof")}</small>
    </a>
  `).join("");
}

function renderPrimaryProofActions(links = []) {
  const objectLink = links.find((link) => link?.id === "dual-blockexplorer-object")
    || links.find((link) => /object/i.test(link?.label || ""));
  const templateLink = links.find((link) => link?.id === "dual-blockexplorer-template")
    || links.find((link) => /template/i.test(link?.label || ""));
  setProofAction("proofObjectAction", objectLink, "Open Object Proof");
  setProofAction("proofTemplateAction", templateLink, "Open Template Proof");
}

function setProofAction(id, link, fallbackLabel) {
  const element = $(id);
  element.textContent = fallbackLabel;
  if (link?.href) {
    element.href = link.href;
    element.target = "_blank";
    element.rel = "noreferrer";
    element.classList.remove("disabled");
    element.removeAttribute("aria-disabled");
    return;
  }
  element.removeAttribute("href");
  element.removeAttribute("target");
  element.removeAttribute("rel");
  element.classList.add("disabled");
  element.setAttribute("aria-disabled", "true");
}

function renderReviewerGuide() {
  const guide = $("reviewerGuide");
  document.querySelectorAll(".review-focus").forEach((element) => element.classList.remove("review-focus"));

  if (!reviewerMode) {
    guide.hidden = true;
    $("reviewerModeBtn").classList.remove("active");
    return;
  }

  const step = reviewerSteps[reviewerStepIndex] || reviewerSteps[0];
  const target = $(step.targetId);
  if (target) target.classList.add("review-focus");

  guide.hidden = false;
  $("reviewerModeBtn").classList.add("active");
  $("reviewerEyebrow").textContent = `Step ${reviewerStepIndex + 1} of ${reviewerSteps.length}`;
  $("reviewerTitle").textContent = step.title;
  $("reviewerBody").textContent = step.body;
  $("reviewerFacts").innerHTML = step.facts().map(([label, value]) => `
    <div>
      <dt>${escapeHtml(label)}</dt>
      <dd>${escapeHtml(value)}</dd>
    </div>
  `).join("");
  $("reviewerProgress").style.setProperty("--progress", `${((reviewerStepIndex + 1) / reviewerSteps.length) * 100}%`);
  $("reviewerPrevBtn").disabled = reviewerStepIndex === 0;
  $("reviewerNextBtn").textContent = reviewerStepIndex === reviewerSteps.length - 1 ? "Finish" : "Next";
}

function scrollReviewerTarget() {
  const step = reviewerSteps[reviewerStepIndex] || reviewerSteps[0];
  const target = $(step.targetId);
  if (target) target.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
}

async function toggleReviewerMode() {
  reviewerMode = !reviewerMode;
  if (reviewerMode) reviewerStepIndex = 0;
  await render();
  if (reviewerMode) scrollReviewerTarget();
}

async function advanceReviewerStep() {
  if (reviewerStepIndex >= reviewerSteps.length - 1) {
    reviewerMode = false;
    await render();
    return;
  }
  reviewerStepIndex += 1;
  await render();
  scrollReviewerTarget();
}

async function retreatReviewerStep() {
  reviewerStepIndex = Math.max(0, reviewerStepIndex - 1);
  await render();
  scrollReviewerTarget();
}

async function closeReviewerMode() {
  reviewerMode = false;
  await render();
}

function renderMilestones() {
  $("milestoneGrid").innerHTML = state.milestones.map((milestone) => `
    <article class="milestone ${milestoneClass(milestone)}">
      <div class="milestone-top">
        <div>
          <h3>${escapeHtml(milestone.name)}</h3>
          <p>${escapeHtml(milestone.description)}</p>
        </div>
        <span class="state-tag ${milestoneClass(milestone)}">${escapeHtml(visibleStatus(milestone))}</span>
      </div>
      <div class="milestone-meta">
        <div><span>Place</span><strong>${escapeHtml(milestone.place)}</strong></div>
        <div><span>Evidence</span><strong>${escapeHtml(milestone.evidence)}</strong></div>
        <div><span>Release</span><strong>${milestone.releasePct ? formatUsd(state.instrument.valueUsd * milestone.releasePct) : "No payment"}</strong></div>
      </div>
    </article>
  `).join("");
}

function renderEvidenceTable() {
  const next = nextMilestone();
  const rows = [
    {
      name: next ? next.evidence : "Settlement certificate",
      detail: next ? `${next.place} packet for ${next.name}` : "All proof packets accepted",
      status: next?.evidenceAttached ? "Attached" : "Missing",
      actor: state.policy.buyerAgent
    },
    {
      name: "Mandate boundary",
      detail: `${corridorLabel()} / ${commodityLabel()} / ${formatUsd(state.policy.maxInstrumentUsd)}`,
      status: state.instrument.corridor === state.policy.allowedCorridor && state.instrument.commodity === state.policy.allowedCommodity ? "Matched" : "Mismatch",
      actor: "DUAL policy"
    },
    {
      name: "Counterparty screening",
      detail: "Supplier, buyer, and bank escrow mirror",
      status: state.policy.sanctionsClear ? "Clear" : "Blocked",
      actor: "Compliance"
    },
    {
      name: "Release amount",
      detail: next ? `${formatUsd(activePaymentAmount())} at this gate` : "No remaining release",
      status: activePaymentAmount() ? "Pending" : "Closed",
      actor: paymentRailLabel()
    }
  ];

  $("evidenceTable").innerHTML = rows.map((row) => `
    <div class="evidence-row">
      <div><strong>${escapeHtml(row.name)}</strong><span>${escapeHtml(row.detail)}</span></div>
      <strong>${escapeHtml(row.status)}</strong>
      <span>${escapeHtml(row.actor)}</span>
    </div>
  `).join("");
}

function renderPayments() {
  const paymentMilestones = state.milestones.filter((milestone) => milestone.releasePct > 0);
  $("paymentList").innerHTML = paymentMilestones.map((milestone) => {
    const released = milestone.status === "verified";
    const blocked = milestone.status === "blocked";
    const status = released ? "Released" : blocked ? "Blocked" : "Queued";
    return `
      <article class="payment-item ${released ? "released" : ""}">
        <div>
          <strong>${escapeHtml(milestone.name)}</strong>
          <span>${escapeHtml(status)} via ${escapeHtml(paymentRailLabel())}</span>
        </div>
        <strong>${formatUsd(state.instrument.valueUsd * milestone.releasePct)}</strong>
      </article>
    `;
  }).join("");
}

function renderAudit() {
  $("auditLog").innerHTML = state.audit.map((item) => `
    <article class="audit-item ${item.type === "warn" ? "warn" : item.type === "block" ? "block" : item.type === "export" ? "export" : ""}">
      <strong>${escapeHtml(item.title)}</strong>
      <span>${escapeHtml(item.detail)}</span>
      <span>${escapeHtml(item.at)}</span>
    </article>
  `).join("");
}

async function render() {
  updateInstrumentState();
  await refreshHashes();
  saveState();

  const next = nextMilestone();
  const released = releasedAmount();
  const remaining = Math.max(0, state.instrument.valueUsd - released);
  const breaches = blockedCount();
  const corridorAllowed = state.instrument.corridor === state.policy.allowedCorridor;
  const proofScore = Math.max(58, 100 - breaches * 10 - state.milestones.filter((milestone) => milestone.status === "pending").length);

  $("corridorStatus").textContent = corridorAllowed ? "Allowed" : "Mismatch";
  $("corridorStatus").className = `status-chip ${corridorAllowed ? "allowed" : "blocked"}`;
  $("policyVersion").textContent = `policy v${state.policyVersion}`;
  $("instrumentSubtitle").textContent = `Milestone-gated letter of credit for ${corridorLabel()} shipment ${state.instrument.id}.`;
  $("instrumentState").textContent = state.instrument.state;
  $("proofScore").textContent = String(proofScore);
  $("faceValue").textContent = formatUsd(state.instrument.valueUsd);
  $("releasedValue").textContent = formatUsd(released);
  $("nextGate").textContent = next ? next.name : "Closed";
  $("milestoneCount").textContent = `${verifiedCount()} of ${state.milestones.length} verified`;
  $("decisionTone").textContent = state.lastDecision.result;
  $("decisionTone").className = `status-chip ${state.lastDecision.tone === "block" ? "blocked" : state.lastDecision.tone === "review" ? "review" : "allowed"}`;
  $("decisionStrip").className = `decision-strip ${state.lastDecision.tone === "block" ? "blocked" : state.lastDecision.tone === "review" ? "review" : ""}`;
  $("policyResult").textContent = state.lastDecision.result;
  $("policyReason").textContent = state.lastDecision.reason;
  $("evidencePacket").textContent = state.lastDecision.evidence;
  $("paymentRailLabel").textContent = paymentRailLabel();
  $("schemaPanel").textContent = JSON.stringify(currentToken()[state.selectedTab], null, 2);
  $("auditCount").textContent = `${state.audit.length} events`;
  $("stateMachine").textContent = state.instrument.state === "Settled"
    ? "Issued -> Milestone verified -> Payment released -> Settled"
    : state.instrument.state === "Blocked"
      ? "Issued -> Milestone pending -> Policy breach -> Blocked"
      : "Issued -> Milestone pending -> Payment released -> Settled";
  $("blockedCount").textContent = String(breaches);
  $("remainingExposure").textContent = formatUsd(remaining);
  $("exportStatus").textContent = state.exported ? "Proof bundle exported" : "Not exported";

  document.querySelectorAll(".schema-tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === state.selectedTab);
  });
  document.querySelectorAll(".segment").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === state.selectedView);
  });

  renderRouteMap();
  renderMilestones();
  renderEvidenceTable();
  renderPayments();
  renderDualReadiness();
  renderDualProof();
  renderVerifier();
  renderControlAnchorNote();
  renderAudit();
  renderReviewerGuide();
}

async function savePolicy() {
  syncFromInputs();
  markPreviewDirty();
  state.policyVersion += 1;
  state.exported = false;
  setNextActive();
  addAudit("ok", "Mandate boundary updated", `${corridorLabel()} and ${commodityLabel()} capped at ${formatUsd(state.policy.maxInstrumentUsd)}.`);
  state.lastDecision = {
    result: "Policy saved",
    reason: "Policy hash refreshed and token mutable fields updated",
    evidence: `policy v${state.policyVersion}`,
    tone: "ready"
  };
  await render();
}

async function attachEvidence() {
  syncFromInputs();
  markPreviewDirty();
  const next = nextMilestone();
  if (!next) {
    state.lastDecision = {
      result: "Closed",
      reason: "All milestone evidence is already verified",
      evidence: "settlement proof",
      tone: "ready"
    };
    await render();
    return;
  }
  next.evidenceAttached = true;
  next.status = "active";
  state.exported = false;
  addAudit("ok", "Evidence packet attached", `${next.evidence} attached for ${next.name}.`);
  state.lastDecision = {
    result: "Evidence attached",
    reason: `${next.name} can now be checked against mandate policy`,
    evidence: next.evidence,
    tone: "ready"
  };
  await render();
}

async function verifyNextGate() {
  syncFromInputs();
  markPreviewDirty();
  const next = nextMilestone();
  const evaluation = evaluatePolicy(next);

  if (!evaluation.ok) {
    if (next && evaluation.tone === "block") next.status = "blocked";
    state.exported = false;
    state.lastDecision = {
      result: evaluation.tone === "block" ? "Blocked" : "Needs evidence",
      reason: evaluation.reason,
      evidence: next ? next.evidence : "closed",
      tone: evaluation.tone
    };
    addAudit(evaluation.tone === "block" ? "block" : "warn", state.lastDecision.result, evaluation.reason);
    await render();
    return;
  }

  next.status = "verified";
  next.evidenceAttached = true;
  state.exported = false;
  setNextActive();
  state.lastDecision = {
    result: evaluation.tone === "review" ? "Approved with review" : "Approved",
    reason: evaluation.reason,
    evidence: `${next.evidence} -> ${formatUsd(state.instrument.valueUsd * next.releasePct)} release`,
    tone: evaluation.tone
  };
  addAudit(evaluation.tone === "review" ? "warn" : "ok", `${next.name} verified`, `${formatUsd(state.instrument.valueUsd * next.releasePct)} released through ${paymentRailLabel()}.`);
  await render();
}

async function forceBreach() {
  syncFromInputs();
  markPreviewDirty();
  const next = nextMilestone();
  if (!next) {
    state.lastDecision = {
      result: "Closed",
      reason: "No open gate remains to breach",
      evidence: "settlement proof",
      tone: "review"
    };
    await render();
    return;
  }
  const breachGate = {
    ...currentGateRequest(),
    milestone_id: next.id,
    milestone_name: next.name,
    corridor: state.instrument.corridor === "SG-AU" ? "NZ-AU" : "SG-AU",
    evidence_attached: true,
    evidence_type: `${next.evidence} red-team packet`
  };
  let evaluation = null;
  let publicWrites = false;
  try {
    const verified = await postVerifierGate(breachGate);
    evaluation = verified.evaluation;
    publicWrites = verified.publicWrites;
  } catch (error) {
    evaluation = {
      result: "Blocked",
      reason: error.message || "Verifier API unavailable; local breach preview blocked.",
      source: "browser_fallback",
      proof: {
        decision_hash: await digest(JSON.stringify({
          instrument: currentInstrumentProperties(),
          gate: breachGate,
          result: "Blocked"
        }))
      }
    };
  }
  next.status = "blocked";
  next.evidenceAttached = true;
  state.exported = false;
  state.verifierResult = {
    ran: true,
    result: evaluation.result || "Blocked",
    reason: evaluation.reason || "Red-team breach blocked before release.",
    source: evaluation.source || "public evaluator",
    decisionHash: evaluation.proof?.decision_hash || "",
    publicWrites
  };
  state.lastDecision = {
    result: state.verifierResult.result,
    reason: state.verifierResult.reason,
    evidence: `${next.evidence} -> decision ${shortHash(state.verifierResult.decisionHash)}`,
    tone: "block"
  };
  addAudit("block", "Verifier refusal proof", `${next.name} rejected with decision hash ${shortHash(state.verifierResult.decisionHash)}.`);
  await render();
}

async function exportProof() {
  syncFromInputs();
  state.exported = true;
  addAudit("export", "Proof bundle exported", `${state.instrument.id} proof bundle includes ${verifiedCount()} verified milestones and ${blockedCount()} blocked actions.`);
  state.lastDecision = {
    result: "Proof exported",
    reason: "Instrument, policy, event, and settlement hashes bundled for verifier readback",
    evidence: shortHash(state.instrument.hashes.settlement),
    tone: "ready"
  };
  await refreshDualProof();
  await render();
}

async function runVerifier() {
  syncFromInputs();

  try {
    const { evaluation, publicWrites } = await postVerifierGate(currentGateRequest());
    state.verifierResult = {
      ran: true,
      result: evaluation.result || "No decision",
      reason: evaluation.reason || "Verifier returned no reason.",
      source: evaluation.source || "request",
      decisionHash: evaluation.proof?.decision_hash || "",
      publicWrites
    };
    addAudit("ok", "Verifier API checked", `${state.verifierResult.result}: ${state.verifierResult.reason}`);
  } catch (error) {
    state.verifierResult = {
      ran: true,
      result: "Verifier unavailable",
      reason: error.message || "Verifier API call failed.",
      source: "browser",
      decisionHash: "",
      publicWrites: false
    };
    addAudit("warn", "Verifier API unavailable", state.verifierResult.reason);
  }

  await render();
}

async function resetDemo() {
  state = clone(initialState);
  state.localPreviewDirty = false;
  bindInputs();
  await refreshDualStatus();
  await refreshDualProof();
  await render();
}

function wireEvents() {
  $("reviewerModeBtn").addEventListener("click", toggleReviewerMode);
  $("reviewerPrevBtn").addEventListener("click", retreatReviewerStep);
  $("reviewerNextBtn").addEventListener("click", advanceReviewerStep);
  $("reviewerCloseBtn").addEventListener("click", closeReviewerMode);
  $("savePolicyBtn").addEventListener("click", savePolicy);
  $("attachEvidenceBtn").addEventListener("click", attachEvidence);
  $("verifyBtn").addEventListener("click", verifyNextGate);
  $("forceBreachBtn").addEventListener("click", forceBreach);
  $("exportBtn").addEventListener("click", exportProof);
  $("runVerifierBtn").addEventListener("click", runVerifier);
  $("resetBtn").addEventListener("click", resetDemo);

  ["corridorSelect", "commoditySelect", "buyerAgent", "maxInstrumentUsd", "reviewThreshold", "sanctionsClear", "customsPreclearance", "instrumentValue", "paymentRail"].forEach((id) => {
    $(id).addEventListener("change", async () => {
      syncFromInputs();
      markPreviewDirty();
      await render();
    });
  });

  document.querySelectorAll(".schema-tab").forEach((button) => {
    button.addEventListener("click", async () => {
      state.selectedTab = button.dataset.tab;
      await render();
    });
  });

  document.querySelectorAll(".segment").forEach((button) => {
    button.addEventListener("click", async () => {
      state.selectedView = button.dataset.view;
      await render();
    });
  });
}

bindInputs();
wireEvents();
reviewerMode = requestedReviewerMode();
render();
Promise.all([refreshDualStatus(), refreshDualProof()]).then(render);
