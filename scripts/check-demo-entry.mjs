const baseUrl = (process.env.DEMO_BASE_URL || "https://conditional-trade-instruments.vercel.app").replace(/\/+$/, "");

const envNames = [
  "DEMO_OPERATOR_TOKEN",
  "DUAL_API_KEY",
  "DUAL_API_URL",
  "DUAL_CONDITIONAL_TRADE_TEMPLATE_ID",
  "DUAL_CONDITIONAL_TRADE_OBJECT_ID",
  "DUAL_WRITE_MODE",
  "DUAL_PERSISTENCE_MODE"
];

async function readJson(path) {
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      headers: { accept: "application/json" }
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { ok: false, status: response.status, body };
    }
    return { ok: true, status: response.status, body };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      body: {},
      error: error.message || "network request failed"
    };
  }
}

const env = Object.fromEntries(envNames.map((name) => [
  name,
  {
    present: Boolean(process.env[name]),
    length: (process.env[name] || "").length,
    value: name.endsWith("_MODE") ? process.env[name] || "" : undefined
  }
]));

const statusResponse = await readJson("/api/dual/status");
const proofResponse = await readJson("/api/proof");
const status = statusResponse.body || {};
const proof = proofResponse.body || {};
const proofObject = proof.proof?.instrument?.object || {};
const operatorReady = Boolean(process.env.DEMO_OPERATOR_TOKEN);
const liveSyncRunnable = operatorReady && Boolean(status.writable);

const report = {
  ok: Boolean(statusResponse.ok && proofResponse.ok),
  baseUrl,
  demoEntryUrl: `${baseUrl}/?demo=operator-cargo`,
  localEnv: env,
  productionStatus: {
    ok: statusResponse.ok,
    error: statusResponse.error || "",
    mode: status.mode || "",
    source: status.source || "",
    readbackReady: Boolean(status.readbackReady),
    writable: Boolean(status.writable),
    publicWrites: Boolean(status.publicWrites),
    missing: status.missing || [],
    warnings: status.warnings || []
  },
  proof: {
    ok: proofResponse.ok && Boolean(proof.ok),
    error: proofResponse.error || "",
    source: proof.proof?.source || "",
    verificationLevel: proof.verification?.verificationLevel || "",
    objectId: proof.proof?.object?.object_id || proofObject.object_id || "",
    templateId: proof.proof?.template?.template_id || proofObject.template_id || "",
    stateHash: proofObject.state_hash || "",
    integrityHash: proofObject.integrity_hash || "",
    explorerLinks: Array.isArray(proof.links) ? proof.links.length : 0
  },
  operator: {
    localOperatorTokenPresent: operatorReady,
    liveSyncRunnable,
    nextAction: liveSyncRunnable
      ? "Run npm run demo:entry to write the canonical demo state, then rerun this check."
      : "Load DEMO_OPERATOR_TOKEN locally or run the sync from an environment that already has the production operator token."
  }
};

console.log(JSON.stringify(report, null, 2));
