# TradeFlow Demo Runbook

This runbook creates and presents the canonical TradeFlow demo entry: the buyer mandate is active, Cargo loaded evidence has been accepted, USD 29,700 is released through the escrow mirror, and DUAL proof readback is visible with block explorer links.

Disclosure line for cold reviewers: the shipment, payment, and evidence names are synthetic demo data; the DUAL object, template, readback hashes, verifier bundle, and block explorer links are live testnet anchors.

## Demo Entry

Use this URL for the prepared operator view:

```text
https://conditional-trade-instruments.vercel.app/?demo=operator-cargo
```

Use this URL when a reviewer should be guided through the story:

```text
https://conditional-trade-instruments.vercel.app/?demo=operator-cargo&reviewer=1
```

The demo entry shows:

- corridor: Singapore to Australia;
- instrument: `CTI-SG-AU-001`;
- state: `Milestone verified`;
- verified gates: buyer mandate, instrument issued, and cargo loaded;
- next gate: Customs cleared;
- released: USD 29,700;
- remaining: USD 118,800;
- evidence: BOL-8842, GPS-SIN-SYD-20260527, and SEAL-SIN-8842;
- DUAL proof rail: object, template, instrument hash, policy hash, event hash, settlement proof, state hash, integrity hash, proof bundle, and explorer links.

## Operator Flow

1. Open the demo entry URL.
2. Confirm DUAL readiness shows `Operator gated`, `readback configured`, and `event-bus gated`.
3. Confirm Proof rail shows `source dual_readback` and verifier level `dual_readback_rederived`.
4. Open `Open Object Proof` from the Proof rail.
5. Return to the app and open `Open Template Proof`.
6. Open `Recompute Proof` to show the public re-derivation report.
7. Use `REVIEWER MODE` when the audience needs the guided mandate -> milestone -> DUAL proof -> verifier path.
8. Use `PREVIEW BREACH` to show the system saying no with a blocked decision hash.
9. Use the top action `VERIFY NEXT GATE` only when you want to demonstrate the local verifier flow for the next milestone.
10. Use `GENERATE PROOF BUNDLE` to refresh the proof bundle view without exposing public writes.

Use `docs/tradeflow-demo-script.md` for the short talk track and `docs/tradeflow-reviewer-pack.md` for the handoff checklist.

## Live DUAL Sync

The prepared URL is browser-local presentation state. To write the matching demo entry into the configured DUAL object, run:

```text
npm run demo:entry
```

For the production deployment, the caller needs one of:

```text
DEMO_OPERATOR_TOKEN
DEMO_OPERATOR_TOKEN_FILE
DEMO_ENV_FILE
```

Use `DEMO_ENV_FILE` only for a temporary env file outside the repo, such as a short-lived Vercel env pull. Delete the file immediately after the sync.
If Vercel env pull returns empty sensitive values for this account, rotate only `DEMO_OPERATOR_TOKEN` in Vercel to a private temp token file, redeploy, run with `DEMO_OPERATOR_TOKEN_FILE`, then delete the local token file.

The production deployment already carries the DUAL read/write environment. When running the endpoint locally, the local server also needs:

```text
DUAL_API_KEY
DUAL_CONDITIONAL_TRADE_TEMPLATE_ID
DUAL_CONDITIONAL_TRADE_OBJECT_ID
DUAL_WRITE_MODE=event_bus
DUAL_PERSISTENCE_MODE=dual
```

The script calls the operator-gated `/api/instruments/sync` endpoint, then reads `/api/proof` back and prints only non-secret proof identifiers and hashes.

Controlled operator sync can run in GitHub Actions using `docs/tradeflow-demo-entry.workflow.yml` as the workflow file. Publish it to `.github/workflows/tradeflow-demo-entry.yml` only from an account/token with `workflow` scope and repository secret `DEMO_OPERATOR_TOKEN`; it writes only through the existing operator-gated production endpoint.

To check readiness without executing a write:

```text
npm run demo:ready
```

To rederive the portable proof hashes without credentials:

```text
npm run proof:rederive -- https://conditional-trade-instruments.vercel.app
```

The same report is hosted at `/api/proof/rederive`. It recomputes the policy, instrument, evidence, event, settlement, and bundle hashes from public JSON and links the DUAL state/integrity hashes to the explorer.

The readiness report prints only presence/length checks for local sensitive values, never the values themselves.

## Safety Boundary

Public users can read status, evaluate gates, verify proof, and open explorer links. Public users cannot write to DUAL. Live writes require the operator token and the configured event-bus deployment.
