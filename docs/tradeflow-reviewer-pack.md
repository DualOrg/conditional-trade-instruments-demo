# TradeFlow Reviewer Pack

## Public Demo

Prepared route:

```text
https://conditional-trade-instruments.vercel.app/?demo=operator-cargo
```

Guided reviewer route:

```text
https://conditional-trade-instruments.vercel.app/?demo=operator-cargo&reviewer=1
```

Default route:

```text
https://conditional-trade-instruments.vercel.app
```

Repository:

```text
https://github.com/DualOrg/conditional-trade-instruments-demo
```

CI:

```text
https://github.com/DualOrg/conditional-trade-instruments-demo/actions/workflows/tradeflow-ci.yml
```

Walkthrough:

```text
https://conditional-trade-instruments.vercel.app/assets/tradeflow-walkthrough.webm
```

## What To Verify

- The public banner says the shipment/payment story is synthetic demo data while the DUAL object, template, hashes, bundle, and explorer links are real testnet anchors.
- The prepared route opens directly into Cargo loaded verified.
- The instrument is `CTI-SG-AU-001`.
- Released amount is USD 29,700.
- Next gate is Customs cleared.
- DUAL readiness shows `vercel / dual`, readback configured, and event-bus gated.
- Proof rail shows `source dual_readback`.
- Verifier level is `dual_readback_rederived`.
- `Open Object Proof` opens the DUAL object explorer.
- `Open Template Proof` opens the DUAL template explorer.
- `Reviewer Mode` walks through instrument, mandate, milestone, DUAL readiness, proof rail, and verifier boundary.
- The proof rail exposes object, template, state hash, integrity hash, proof bundle, and L2 state-hash links.
- `Recompute Proof` opens a public verifier report for reviewer-side hash re-derivation.
- `Preview breach` visibly produces a blocked decision and decision hash without writing to DUAL.
- Public writes remain disabled.
- The landing page embeds the short reviewer walkthrough asset.
- The reviewer pack includes mobile viewport evidence for the 390 x 844 pass.

## Live Proof IDs

```text
Object:   6a167b2c5fed83e4855a86dd
Template: 6a167b2b5fed83e4855a86db
```

## API Checks

Read proof:

```bash
curl -s https://conditional-trade-instruments.vercel.app/api/proof
```

Read DUAL status:

```bash
curl -s https://conditional-trade-instruments.vercel.app/api/dual/status
```

Run the local readiness report:

```bash
npm run demo:ready
```

Recompute the portable proof hashes from public JSON:

```bash
npm run proof:rederive -- https://conditional-trade-instruments.vercel.app
```

Or read the hosted re-derive report:

```bash
curl -s https://conditional-trade-instruments.vercel.app/api/proof/rederive
```

The re-derive path uses `sha256(JSON.stringify(stableSort(value)))` to recompute the policy, instrument, evidence, event, settlement, and bundle hashes. DUAL `state_hash` and `integrity_hash` are DUAL-chain canonical readback values; verify those via the linked DUAL block explorer object page.

## Mobile Evidence

Artifact:

```text
assets/tradeflow-mobile-390x844.png
```

Viewport checked:

```text
390 x 844
```

Result:

```text
scrollWidth = 390
clientWidth = 390
overflowing elements = []
```

Reviewer expectation: the disclosure band and walkthrough preview are first-viewport visible; proof actions, DUAL proof rail, and controls remain reachable without horizontal overflow.

## MCP Checks

Initialize:

```bash
curl -s https://conditional-trade-instruments.vercel.app/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
```

Verify proof:

```bash
curl -s https://conditional-trade-instruments.vercel.app/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"tradeflow_dual_verify_proof","arguments":{}}}'
```

## Write Boundary

Public MCP and public browser users can read, evaluate, simulate, red-team, prepare payloads, and verify proofs. They cannot execute DUAL writes.

Live writes require:

```text
DEMO_OPERATOR_TOKEN
DEMO_ENV_FILE
DUAL_API_KEY
DUAL_CONDITIONAL_TRADE_TEMPLATE_ID
DUAL_CONDITIONAL_TRADE_OBJECT_ID
DUAL_WRITE_MODE=event_bus
DUAL_PERSISTENCE_MODE=dual
```

When those are present locally, run:

```bash
npm run demo:entry
```

For the production deployment, the caller needs `DEMO_OPERATOR_TOKEN`, `DEMO_OPERATOR_TOKEN_FILE`, or `DEMO_ENV_FILE` with `DEMO_OPERATOR_TOKEN`; DUAL API credentials stay in the Vercel environment. If sensitive values cannot be read back from Vercel, rotate only the operator token, redeploy, run with a private `DEMO_OPERATOR_TOKEN_FILE`, and delete the local token file afterward. The same sync can be run from GitHub Actions by publishing `docs/tradeflow-demo-entry.workflow.yml` to `.github/workflows/tradeflow-demo-entry.yml` with repository secret `DEMO_OPERATOR_TOKEN`.
