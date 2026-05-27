import {
  deriveProofHashes,
  dualConfig,
  dualClient,
  executeEventBusWithFallback,
  extractResultObject,
  normalizeInstrumentProperties,
  readBody,
  requireOperator,
  requireWritable,
  semanticMetadata,
  sendError,
  updatePayloadAttempts
} from "../_dual.js";

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.status(405).json({ error: { message: "Method not allowed" } });
    return;
  }

  try {
    requireOperator(request);
    requireWritable();
    const body = await readBody(request);
    const config = dualConfig();
    const properties = normalizeInstrumentProperties(body.properties || body.instrument || body);
    const hashes = deriveProofHashes(properties);
    const enriched = normalizeInstrumentProperties({
      ...properties,
      policy_hash: properties.policy_hash || hashes.policy_hash,
      instrument_hash: properties.instrument_hash || hashes.instrument_hash,
      evidence_hash: properties.evidence_hash || hashes.evidence_hash,
      last_event_hash: properties.last_event_hash || hashes.event_hash,
      settlement_hash: properties.settlement_hash || hashes.settlement_hash
    });
    const metadata = semanticMetadata("conditional_trade_instrument_synced", enriched, body.audit || body.gate || {});
    const { result, payloadStyle } = await executeEventBusWithFallback(
      await dualClient(config),
      updatePayloadAttempts(config.objectId, enriched, metadata)
    );
    const object = extractResultObject(result) || {
      id: config.objectId,
      templateId: config.templateId,
      organizationId: config.orgId,
      properties: enriched
    };

    response.status(200).json({
      synced: true,
      action: "update",
      payloadStyle,
      publicWrites: false,
      object,
      result
    });
  } catch (error) {
    sendError(response, error);
  }
}
