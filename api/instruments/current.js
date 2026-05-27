import { readCurrentObject, readiness, seedInstrumentProperties, sendError } from "../_dual.js";

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.status(405).json({ error: { message: "Method not allowed" } });
    return;
  }

  try {
    const status = readiness();
    if (!status.readbackReady) {
      response.status(200).json({
        available: false,
        reason: status.detail,
        status,
        properties: seedInstrumentProperties()
      });
      return;
    }
    response.status(200).json(await readCurrentObject());
  } catch (error) {
    sendError(response, error);
  }
}
