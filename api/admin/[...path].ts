import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleAdminRequest } from "../../src/server/admin-handler";

export default async function adminHandler(
  request: VercelRequest,
  response: VercelResponse,
): Promise<void> {
  await handleAdminRequest(request, response);
}
