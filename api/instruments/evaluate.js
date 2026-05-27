import {
  evaluateInstrumentGate,
  normalizeInstrumentProperties,
  readBody,
  readCurrentObject,
  readiness,
  seedInstrumentProperties,
  sendError
} from "../_dual.js";

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.status(405).json({ error: { message: "Method not allowed" } });
    return;
  }

  try {
    const body = await readBody(request);
    const status = readiness();
    let source = "request";
    let object = null;
    let properties = normalizeInstrumentProperties(body.instrument || body.properties || seedInstrumentProperties());

    if (status.readbackReady) {
      try {
        const current = await readCurrentObject();
        if (current.available && current.properties) {
          source = "dual_readback";
          object = current.object;
          properties = normalizeInstrumentProperties(current.properties);
        }
      } catch (error) {
        if (!body.instrument && !body.properties) throw error;
        source = "request_fallback";
      }
    }

    const evaluation = evaluateInstrumentGate(properties, body.gate || body.request || body, { source, object });
    response.status(200).json({
      evaluated: true,
      writable: false,
      publicWrites: false,
      status,
      evaluation
    });
  } catch (error) {
    sendError(response, error);
  }
}
