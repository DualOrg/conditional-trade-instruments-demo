import {
  dualConfig,
  normalizeInstrumentProperties,
  readBody,
  requireOperator,
  requireWritable,
  sendError,
  updatePayload
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
    const payload = updatePayload(config.objectId, properties, {
      event_hash: properties.last_event_hash || properties.settlement_hash
    });

    response.status(501).json({
      synced: false,
      publicWrites: false,
      reason: "Operator gate passed, but live DUAL update execution is intentionally disabled in this scaffold until template/object IDs are approved for this demo.",
      payload_preview: payload
    });
  } catch (error) {
    sendError(response, error);
  }
}
