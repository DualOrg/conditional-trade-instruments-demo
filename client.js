const initialState = {
  selectedTab: "instrument",
  selectedView: "timeline",
  nonce: 1,
  policyVersion: 1,
  exported: false,
  lastDecision: {
    result: "Ready",
    reason: "Awaiting next verification",
    evidence: "BOL + GPS + inspection",
    tone: "ready"
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

const $ = (id) => document.getElementById(id);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadState() {
  const stored = localStorage.getItem("dual-tradeflow-state");
  if (!stored) return clone(initialState);
  try {
    const parsed = JSON.parse(stored);
    return {
      ...clone(initialState),
      ...parsed,
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
  return state.audit.filter((item) => item.type === "block").length
    + state.milestones.filter((milestone) => milestone.status === "blocked").length;
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
      latest_policy_hash: shortHash(state.instrument.hashes.policy)
    }
  };
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

function renderRouteMap() {
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
  $("nonceLabel").textContent = `nonce ${state.nonce}`;
  $("schemaPanel").textContent = JSON.stringify(currentToken()[state.selectedTab], null, 2);
  $("instrumentHash").textContent = shortHash(state.instrument.hashes.instrument);
  $("policyHash").textContent = shortHash(state.instrument.hashes.policy);
  $("eventHash").textContent = shortHash(state.instrument.hashes.event);
  $("settlementHash").textContent = shortHash(state.instrument.hashes.settlement);
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
  renderAudit();
}

async function savePolicy() {
  syncFromInputs();
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
  next.status = "blocked";
  next.evidenceAttached = true;
  state.exported = false;
  state.lastDecision = {
    result: "Blocked",
    reason: "Red-team customs evidence references an unapproved corridor",
    evidence: next.evidence,
    tone: "block"
  };
  addAudit("block", "Policy breach blocked", `${next.name} rejected because the evidence packet does not match the mandate corridor.`);
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
  await render();
}

async function resetDemo() {
  state = clone(initialState);
  bindInputs();
  await render();
}

function wireEvents() {
  $("savePolicyBtn").addEventListener("click", savePolicy);
  $("attachEvidenceBtn").addEventListener("click", attachEvidence);
  $("verifyBtn").addEventListener("click", verifyNextGate);
  $("forceBreachBtn").addEventListener("click", forceBreach);
  $("exportBtn").addEventListener("click", exportProof);
  $("resetBtn").addEventListener("click", resetDemo);

  ["corridorSelect", "commoditySelect", "buyerAgent", "maxInstrumentUsd", "reviewThreshold", "sanctionsClear", "customsPreclearance", "instrumentValue", "paymentRail"].forEach((id) => {
    $(id).addEventListener("change", async () => {
      syncFromInputs();
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
render();
