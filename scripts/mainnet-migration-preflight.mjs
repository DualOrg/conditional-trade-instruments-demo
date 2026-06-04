import assert from "node:assert/strict";
import {
  dualConfig,
  networkMigrationPreflight,
  readiness
} from "../api/_dual.js";

const ENV_KEYS = [
  "DUAL_NETWORK",
  "TRADEFLOW_DUAL_NETWORK",
  "CONDITIONAL_TRADE_DUAL_NETWORK",
  "TRADEFLOW_MAINNET_CUTOVER_CONFIRMED",
  "DUAL_MAINNET_CUTOVER_CONFIRMED",
  "DUAL_API_URL",
  "DUAL_CONSOLE_BASE_URL",
  "DUAL_L3_EXPLORER_BASE_URL",
  "DUAL_L2_EXPLORER_BASE_URL",
  "DUAL_BLOCKSCOUT_BASE_URL",
  "DUAL_API_KEY",
  "DUAL_ORG_ID",
  "DUAL_CONDITIONAL_TRADE_TEMPLATE_ID",
  "DUAL_CONDITIONAL_TRADE_OBJECT_ID",
  "DUAL_WRITE_MODE",
  "DUAL_PERSISTENCE_MODE",
  "DEMO_OPERATOR_TOKEN"
];

function withEnv(overrides, fn) {
  const snapshot = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined && value !== null) process.env[key] = String(value);
  }
  try {
    return fn();
  } finally {
    for (const key of ENV_KEYS) delete process.env[key];
    for (const [key, value] of snapshot.entries()) {
      if (value !== undefined) process.env[key] = value;
    }
  }
}

function runCheck(name, fn) {
  const result = fn();
  return { name, passed: true, ...result };
}

const checks = [];

checks.push(runCheck("default_testnet_mode_is_not_a_mainnet_claim", () => withEnv({}, () => {
  const config = dualConfig();
  const preflight = networkMigrationPreflight(config);
  const status = readiness();
  assert.equal(preflight.ready, true);
  assert.equal(preflight.target_network, "testnet");
  assert.equal(preflight.mainnet_requested, false);
  assert.equal(preflight.api_url_kind, "testnet_api");
  assert.equal(preflight.console_url_kind, "testnet_console");
  assert.equal(preflight.l3_explorer_url_kind, "testnet_l3_explorer");
  assert.equal(preflight.l2_explorer_url_kind, "testnet_l2_explorer");
  assert.equal(status.readbackReady, false);
  assert.equal(status.writable, false);
  assert.equal(status.publicWrites, false);
  return { preflight, readiness: status };
})));

checks.push(runCheck("mainnet_mode_with_default_testnet_endpoints_fails_closed", () => withEnv({
  DUAL_NETWORK: "mainnet",
  DUAL_API_KEY: "dummy-key",
  DUAL_CONDITIONAL_TRADE_TEMPLATE_ID: "dummy-template",
  DUAL_CONDITIONAL_TRADE_OBJECT_ID: "dummy-object",
  DEMO_OPERATOR_TOKEN: "dummy-token",
  DUAL_WRITE_MODE: "event_bus",
  DUAL_PERSISTENCE_MODE: "dual"
}, () => {
  const config = dualConfig();
  const preflight = networkMigrationPreflight(config);
  const status = readiness();
  assert.equal(preflight.ready, false);
  assert.equal(preflight.mainnet_requested, true);
  assert.equal(preflight.read_allowed, false);
  assert.equal(preflight.write_allowed, false);
  assert.equal(preflight.testnet_or_legacy_endpoint_count, 4);
  assert.equal(status.readbackReady, false);
  assert.equal(status.writable, false);
  assert.equal(status.publicWrites, false);
  assert(preflight.missing.includes("TRADEFLOW_MAINNET_CUTOVER_CONFIRMED=true"));
  assert(preflight.missing.includes("DUAL_API_URL=mainnet_api_base"));
  assert(preflight.missing.includes("DUAL_CONSOLE_BASE_URL=mainnet_console_base"));
  assert(preflight.missing.includes("DUAL_L3_EXPLORER_BASE_URL=mainnet_l3_explorer_base"));
  assert(preflight.missing.includes("DUAL_L2_EXPLORER_BASE_URL=mainnet_l2_explorer_base"));
  return { preflight, readiness: status };
})));

checks.push(runCheck("mainnet_mode_with_explicit_non_testnet_endpoints_passes_preflight_only", () => withEnv({
  DUAL_NETWORK: "mainnet",
  TRADEFLOW_MAINNET_CUTOVER_CONFIRMED: "true",
  DUAL_API_URL: "https://tradeflow-mainnet-api.example.invalid",
  DUAL_CONSOLE_BASE_URL: "https://tradeflow-mainnet-console.example.invalid",
  DUAL_L3_EXPLORER_BASE_URL: "https://tradeflow-mainnet-l3.example.invalid",
  DUAL_L2_EXPLORER_BASE_URL: "https://tradeflow-mainnet-l2.example.invalid"
}, () => {
  const config = dualConfig();
  const preflight = networkMigrationPreflight(config);
  const status = readiness();
  assert.equal(preflight.ready, true);
  assert.equal(preflight.mainnet_requested, true);
  assert.equal(preflight.read_allowed, true);
  assert.equal(preflight.write_allowed, true);
  assert.equal(preflight.api_url_kind, "custom");
  assert.equal(preflight.console_url_kind, "custom");
  assert.equal(preflight.l3_explorer_url_kind, "custom");
  assert.equal(preflight.l2_explorer_url_kind, "custom");
  assert.equal(status.readbackReady, false);
  assert.equal(status.writable, false);
  assert(status.missing.includes("DUAL_API_KEY"));
  return { preflight, readiness: status };
})));

checks.push(runCheck("current_environment_network_config_is_not_blocked", () => {
  const config = dualConfig();
  const preflight = networkMigrationPreflight(config);
  const status = readiness();
  assert.equal(preflight.ready, true);
  assert.equal(status.publicWrites, false);
  return {
    preflight,
    readiness: status,
    note: "This check does not call the DUAL API and does not run setup, mint, sync, or gate-advance writes."
  };
}));

console.log(JSON.stringify({
  ok: true,
  service: "dual-conditional-trade-instruments",
  check: "mainnet_migration_preflight",
  secret_returned: false,
  public_writes: false,
  live_dual_calls: false,
  checks
}, null, 2));
