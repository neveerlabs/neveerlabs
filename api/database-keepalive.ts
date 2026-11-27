import { createClient } from "@supabase/supabase-js";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { timingSafeEqual } from "node:crypto";

type Environment = Record<string, string | undefined>;

function isAuthorized(request: VercelRequest, secret: string): boolean {
  const authorization = request.headers.authorization;
  const value = Array.isArray(authorization) ? authorization[0] : authorization;
  if (typeof value !== "string") return false;

  const supplied = Buffer.from(value);
  const expected = Buffer.from(`Bearer ${secret}`);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export async function handleDatabaseKeepalive(
  request: VercelRequest,
  response: VercelResponse,
  env: Environment = process.env,
): Promise<void> {
  response.setHeader("Cache-Control", "no-store");

  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ error: "Method not allowed." });
    return;
  }

  const secret = env.CRON_SECRET;
  const supabaseUrl = env.SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret || !supabaseUrl || !serviceRoleKey) {
    console.error("Database keepalive requires CRON_SECRET and Supabase server credentials.");
    response.status(500).json({ error: "Database keepalive is not configured." });
    return;
  }

  if (!isAuthorized(request, secret)) {
    response.status(401).json({ error: "Unauthorized." });
    return;
  }

  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await supabase.rpc("run_database_keepalive");
    if (error) throw error;
    if (!Array.isArray(data) || !data[0]) {
      throw new Error("Database keepalive returned no status.");
    }

    response.status(200).json(data[0]);
  } catch (error) {
    console.error(
      "Database keepalive failed:",
      error instanceof Error ? error.message : String(error),
    );
    response.status(500).json({ error: "Database keepalive failed." });
  }
}

export default async function databaseKeepaliveHandler(
  request: VercelRequest,
  response: VercelResponse,
): Promise<void> {
  await handleDatabaseKeepalive(request, response);
}
