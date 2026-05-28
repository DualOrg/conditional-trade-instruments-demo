import { readFileSync } from "node:fs";

const envFile = readEnvFile(process.env.DEMO_ENV_FILE);

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

const baseUrl = (envValue("DEMO_BASE_URL") || "https://conditional-trade-instruments.vercel.app").replace(/\/+$/, "");

const envNames = [
  "DEMO_ENV_FILE",
  "DEMO_OPERATOR_TOKEN",
  "DEMO_OPERATOR_TOKEN_FILE",
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
    present: Boolean(envValue(name)),
    length: envValue(name).length,
    value: name.endsWith("_MODE") ? envValue(name) : undefined
  }
]));

const statusResponse = await readJson("/api/dual/status");
const proofResponse = await readJson("/api/proof");
const status = statusResponse.body || {};
const proof = proofResponse.body || {};
const proofObject = proof.proof?.instrument?.object || {};
const operatorReady = Boolean(envValue("DEMO_OPERATOR_TOKEN") || envValue("DEMO_OPERATOR_TOKEN_FILE"));
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
