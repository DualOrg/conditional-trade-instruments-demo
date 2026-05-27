# TradeFlow Demo Runbook

This runbook creates and presents the canonical TradeFlow demo entry: the buyer mandate is active, Cargo loaded evidence has been accepted, USD 29,700 is released through the escrow mirror, and DUAL proof readback is visible with block explorer links.

## Demo Entry

Use this URL for the prepared operator view:

```text
https://conditional-trade-instruments.vercel.app/?demo=operator-cargo
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
4. Open the DUAL object explorer link from the Proof rail.
5. Return to the app and open the DUAL template explorer link.
6. Use the top action `VERIFY NEXT GATE` only when you want to demonstrate the local verifier flow for the next milestone.
7. Use `GENERATE PROOF BUNDLE` to refresh the proof bundle view without exposing public writes.

## Live DUAL Sync

The prepared URL is browser-local presentation state. To write the matching demo entry into the configured DUAL object, run:

```text
npm run demo:entry
```

Required environment:

```text
DEMO_OPERATOR_TOKEN
DUAL_API_KEY
DUAL_CONDITIONAL_TRADE_TEMPLATE_ID
DUAL_CONDITIONAL_TRADE_OBJECT_ID
DUAL_WRITE_MODE=event_bus
DUAL_PERSISTENCE_MODE=dual
```

The script calls the operator-gated `/api/instruments/sync` endpoint, then reads `/api/proof` back and prints only non-secret proof identifiers and hashes.

## Safety Boundary

Public users can read status, evaluate gates, verify proof, and open explorer links. Public users cannot write to DUAL. Live writes require the operator token and the configured event-bus deployment.
