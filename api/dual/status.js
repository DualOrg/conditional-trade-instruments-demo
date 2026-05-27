import { readiness } from "../_dual.js";

export default function handler(_request, response) {
  response.status(200).json(readiness());
}
