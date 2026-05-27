# TradeFlow Control Desk

Local-first deployable demo for the DUAL Conditional Trade Instruments concept.

Production demo:

```text
https://conditional-trade-instruments.vercel.app
```

Open:

```text
index.html
```

Or run:

```text
npm run start
```

Then visit:

```text
http://127.0.0.1:4176
```

The app demonstrates:

- a buyer mandate controlling a trade finance instrument;
- one Singapore to Australia shipment corridor;
- milestone gates for cargo loading, customs, inspection, and delivery;
- evidence attachment before verification;
- DUAL-style approve, review, and block paths;
- partial payment release as milestones verify;
- token object fields, proof hashes, settlement hash, and audit log;
- local proof export state.

## API Surface

Safe read/evaluate endpoints:

- `GET /api/dual/status`
- `GET /api/instruments/current`
- `POST /api/instruments/evaluate`

Operator-gated scaffold endpoints:

- `POST /api/instruments/sync`
- `POST /api/instruments/mint`

The scaffold rejects public writes. Live DUAL write execution is intentionally disabled until the template/object IDs and write phase are explicitly approved.

## DUAL Object Model

Template name:

```text
io.dual.conditional_trade_instrument.demo.v1
```

Template payload:

```text
dual-conditional-trade-template.json
```

Core fields:

- instrument, buyer, supplier, buyer agent, corridor, commodity, payment rail;
- value, released amount, remaining amount, milestone state, blocked actions;
- policy, instrument, evidence, event, and settlement hashes;
- last decision result/reason and update timestamp.

## Validation

```text
npm run check
npm run smoke
```

This is a local-first prototype. It does not write to live DUAL objects by default.
