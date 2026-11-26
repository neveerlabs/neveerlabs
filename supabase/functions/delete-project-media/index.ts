import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Content-Type": "application/json",
};

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed." }), {
      status: 405,
      headers: { ...corsHeaders, Allow: "POST" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Storage cleanup requires Supabase server credentials.");
    return new Response(JSON.stringify({ error: "Cleanup unavailable." }), {
      status: 500,
      headers: corsHeaders,
    });
  }

  const expectedAuthorization = `Bearer ${serviceRoleKey}`;
  if (request.headers.get("authorization") !== expectedAuthorization) {
    return new Response(JSON.stringify({ error: "Unauthorized." }), {
      status: 401,
      headers: corsHeaders,
    });
  }

  let payload: { bucket?: unknown; paths?: unknown };
  try {
    payload = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body." }), {
      status: 400,
      headers: corsHeaders,
    });
  }

  const bucket = Deno.env.get("SUPABASE_STORAGE_BUCKET") || "project-media";
  if (
    payload.bucket !== bucket ||
    !Array.isArray(payload.paths) ||
    !payload.paths.every(
      (path) =>
        typeof path === "string" &&
        path.length > 0 &&
        !path.startsWith("/") &&
        !path.split("/").some((segment) => segment === "." || segment === ".."),
    )
  ) {
    return new Response(JSON.stringify({ error: "Invalid media cleanup request." }), {
      status: 400,
      headers: corsHeaders,
    });
  }

  let paths: string[];
  try {
    paths = [
      ...new Set(
        (payload.paths as string[]).map((path) =>
          path
            .split("/")
            .map((segment) => decodeURIComponent(segment))
            .join("/"),
        ),
      ),
    ];
  } catch {
    return new Response(JSON.stringify({ error: "Invalid media object path." }), {
      status: 400,
      headers: corsHeaders,
    });
  }
  if (paths.length === 0) {
    return new Response(JSON.stringify({ removed: 0 }), {
      status: 200,
      headers: corsHeaders,
    });
  }

  if (
    paths.some(
      (path) =>
        path.length === 0 ||
        path.startsWith("/") ||
        path.split("/").some((segment) => segment === "." || segment === ".."),
    )
  ) {
    return new Response(JSON.stringify({ error: "Invalid media object path." }), {
      status: 400,
      headers: corsHeaders,
    });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await supabase.storage.from(bucket).remove(paths);
  if (error) {
    console.error("Supabase Storage cleanup failed:", error.message);
    return new Response(JSON.stringify({ error: "Storage cleanup failed." }), {
      status: 502,
      headers: corsHeaders,
    });
  }

  return new Response(JSON.stringify({ removed: data.length }), {
    status: 200,
    headers: corsHeaders,
  });
});
