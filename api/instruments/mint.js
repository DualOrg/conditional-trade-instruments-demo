import {
  dualConfig,
  mintPayload,
  normalizeInstrumentProperties,
  readBody,
  requireOperator,
  requireWritable,
  seedInstrumentProperties,
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
    const payload = mintPayload(config.templateId, properties);

    response.status(501).json({
      minted: false,
      publicWrites: false,
      reason: "Operator gate passed, but live DUAL mint execution is intentionally disabled in this scaffold until this demo receives explicit live-write approval.",
      payload_preview: payload
    });
  } catch (error) {
    sendError(response, error);
  }
}
