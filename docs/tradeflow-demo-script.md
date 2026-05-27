# TradeFlow Demo Script

## Product Description

TradeFlow turns a cross-border trade instrument into a DUAL-backed control surface: every payment release is gated by mandate, corridor, commodity, and evidence checks. Buyers, agents, and reviewers can verify the live proof trail through DUAL readback and block explorer links without receiving write access.

## 90-Second Walkthrough

1. Open `https://conditional-trade-instruments.vercel.app/?demo=operator-cargo`.
2. Click `Reviewer Mode` if the audience needs a guided path; otherwise walk the panels manually.
3. Start with the instrument header: `CTI-SG-AU-001`, Singapore to Australia, USD 148,500 face value.
4. Point to the mandate panel: the buyer agent is authorized, the max instrument is USD 180,000, and manual review starts above USD 120,000.
5. Point to the milestone grid: buyer mandate, instrument issued, and Cargo loaded are verified; Customs cleared is the next gate and needs evidence.
6. Point to releases: Cargo loaded released USD 29,700, while later releases are queued.
7. Move to DUAL readiness: runtime is `vercel / dual`, readback is configured, and writes are event-bus gated.
8. Open `Open Object Proof`, then return to the app.
9. Open `Open Template Proof`, then return to the app.
10. Point to the verifier level: `dual_readback_rederived`.
11. Close with the boundary: public users can read, verify, evaluate, and open proofs; only the operator path can write to DUAL.

## One-Line Close

This is a live proof desk for mandate-gated trade finance: the UI explains the commercial state, DUAL proves the object state, and agents can verify decisions without gaining write authority.

## Recording Shot List

- First frame: full app at the prepared demo URL.
- Optional first click: `Reviewer Mode`.
- Zoom target: instrument metric strip showing face value, released amount, and next gate.
- Zoom target: milestone cards showing Cargo loaded verified and Customs cleared needing evidence.
- Zoom target: DUAL readiness and proof rail.
- Browser action: open Object Proof.
- Browser action: open Template Proof.
- Final frame: proof rail with `source dual_readback` and `dual_readback_rederived`.
