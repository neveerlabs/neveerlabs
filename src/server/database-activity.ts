import type { SupabaseClient } from "@supabase/supabase-js";

export async function trackDatabaseActivity(
  supabase: SupabaseClient,
): Promise<void> {
  const { error } = await supabase.rpc("touch_database_activity");
  if (error) {
    throw new Error(`Unable to record database activity: ${error.message}`);
  }
}
