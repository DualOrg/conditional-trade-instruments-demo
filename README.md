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

- `POST /mcp`
- `GET /api/dual/status`
- `GET /api/instruments/current`
- `POST /api/instruments/evaluate`

Operator-gated scaffold endpoints:

- `POST /api/instruments/sync`
- `POST /api/instruments/mint`

The scaffold rejects public writes. Live DUAL write execution is intentionally disabled until the template/object IDs and write phase are explicitly approved.

## MCP Quick Start

`POST /mcp` is a JSON-RPC MCP facade for agent clients. It exposes the same safe read/evaluate boundary as the UI and does not execute live DUAL writes.

Initialize:

```bash
curl -s http://127.0.0.1:4176/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
```

List tools:

```bash
curl -s http://127.0.0.1:4176/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
```

Evaluate the next milestone gate:

```bash
curl -s http://127.0.0.1:4176/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"tradeflow_dual_evaluate_gate","arguments":{"gate":{"milestone_id":"loaded","milestone_name":"Cargo loaded","corridor":"SG-AU","commodity_class":"medical-devices","release_usd":29700,"evidence_attached":true}}}}'
```

Available MCP tools:

- `tradeflow_dual_get_status`
- `tradeflow_dual_get_instrument`
- `tradeflow_dual_get_policy`
- `tradeflow_dual_evaluate_gate`
- `tradeflow_dual_get_proof`
- `tradeflow_dual_verify_proof`
- `tradeflow_dual_prepare_sync_payload`
- `tradeflow_dual_prepare_mint_payload`
- `tradeflow_dual_get_mint_status`
- `tradeflow_dual_simulate_lifecycle`
- `tradeflow_dual_evaluate_adversarial_gate`
- `tradeflow_dual_red_team`

Available MCP resources:

- `tradeflow://status`
- `tradeflow://instrument`
- `tradeflow://policy`
- `tradeflow://proof`
- `tradeflow://mint-status`
- `tradeflow://template`
- `tradeflow://safety`

The sync and mint tools are preview-only on the public MCP surface. They return DUAL event-bus payload previews but do not execute writes. "Operator-gated" means the REST sync/mint endpoints require `DEMO_OPERATOR_TOKEN`, DUAL read/write environment values, `DUAL_WRITE_MODE=event_bus`, and explicit live-write approval.

Tool `ok: true` means the MCP call succeeded. The trade decision lives in `evaluation.result`, `evaluation.allowed`, or `blockedOrEscalated` for red-team tools.

The public MCP is stateless for read/evaluate calls. Use `tradeflow_dual_simulate_lifecycle` when an agent needs a response-local milestone sequence, or carry the returned instrument state on the caller side. Prefer `evidence_refs` with document hashes, CIDs, or signed attestation ids over the boolean `evidence_attached` shortcut.

For browser-based MCP hosts that send an `Origin` header from another host, set `DEMO_MCP_ALLOWED_ORIGINS` to the comma-separated allowed origins.

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
- first-class evidence references (`evidence_refs`) for document hashes, CIDs, or signed attestations;
- last decision result/reason and update timestamp.

## Validation

```text
npm run check
npm run smoke
```

This is a local-first prototype. It does not write to live DUAL objects by default.
