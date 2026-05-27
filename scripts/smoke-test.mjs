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

console.log("smoke test passed");
