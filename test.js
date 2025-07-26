// test.js
import { createClient } from "@supabase/supabase-js";

async function run() {
  // ——— Hard‑coded Supabase config ———
  const SUPABASE_URL = "https://jlldupcaiahsjslvcmor.supabase.co";
  const SUPABASE_ANON_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpsbGR1cGNhaWFoc2pzbHZjbW9yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM0NTQzMTMsImV4cCI6MjA2OTAzMDMxM30.hYwSPUV9mMzmbv3RBv3F3CjIUXbPUP_xqfn8kAuOjoQ";

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // ——— Sign in with test credentials ———
  const { data: signInData, error: signInError } =
    await supabase.auth.signInWithPassword({
      email: "naveedwaddo1123@gmail.com",
      password: "naveed1123",
    });
  if (signInError) {
    console.error("Sign-in error:", signInError);
    process.exit(1);
  }

  const userId = signInData.user.id;
  console.log("Signed in user ID:", userId);

  // ——— Prepare dummy buffer and path ———
  const buffer = Buffer.from("hello upsert");
  const path = `${userId}/test-upsert.txt`;

  // ——— Test INSERT only ———
  const insertResult = await supabase.storage
    .from("car-images")
    .upload(path, buffer, { upsert: false });
  console.log("no-upsert →", insertResult);

  // ——— Test UPSERT (overwrite) ———
  const upsertResult = await supabase.storage
    .from("car-images")
    .upload(path, buffer, { upsert: true });
  console.log("with-upsert →", upsertResult);
}

run().catch(console.error);
