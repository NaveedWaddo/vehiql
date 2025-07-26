// lib/supabase.js
import { createServerComponentClient } from "@supabase/auth-helpers-nextjs";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

/**
 * Create a Supabase client using the user's cookies
 * (use this in Server Components / Actions where authentication is required)
 */
export function createClient(cookieStore = cookies()) {
  return createServerComponentClient({
    cookies: () => cookieStore,
  });
}

/**
 * Supabase client using service role key (for admin operations)
 * ⚠️ DO NOT expose this client to the browser
 */
export const supabaseServer = createSupabaseClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);
