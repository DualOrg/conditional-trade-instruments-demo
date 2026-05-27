import {
  deriveProofHashes,
  dualConfig,
  dualClient,
  extractResultObject,
  mintPayload,
  normalizeInstrumentProperties,
  readBody,
  requireOperator,
  requireWritable,
  seedInstrumentProperties,
  semanticMetadata,
  sendError
} from "../_dual.js";

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.status(405).json({ error: { message: "Method not allowed" } });
    return;
  }

  try {
    requireOperator(request);
    requireWritable({ requireObject: false });
    const body = await readBody(request);
    const config = dualConfig();
    const properties = normalizeInstrumentProperties(body.properties || body.instrument || seedInstrumentProperties());
    const hashes = deriveProofHashes(properties);
    const enriched = normalizeInstrumentProperties({
      ...properties,
      policy_hash: properties.policy_hash || hashes.policy_hash,
      instrument_hash: properties.instrument_hash || hashes.instrument_hash,
      evidence_hash: properties.evidence_hash || hashes.evidence_hash,
      last_event_hash: properties.last_event_hash || hashes.event_hash,
      settlement_hash: properties.settlement_hash || hashes.settlement_hash
    });
    const metadata = semanticMetadata("conditional_trade_instrument_minted", enriched, body.audit || {});
    const payload = mintPayload(config.templateId, enriched, metadata);
    const result = await (await dualClient(config)).eventBus.execute(payload);
    const object = extractResultObject(result);

    response.status(200).json({
      minted: true,
      synced: true,
      action: "mint",
      publicWrites: false,
      object,
      result
    });
  } catch (error) {
    sendError(response, error);
  }
}
