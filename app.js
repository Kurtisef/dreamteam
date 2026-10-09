// Add these values from Supabase Project Settings > API.
const SUPABASE_URL = "https://buvvmpodmcfcjgzglmsw.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_xMx7SkOGDda30kzYxwrtpA_K6wmmmN6";

let supabaseClient = null;

if (SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY) {
  supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY
  );
  console.log("Supabase client connected.");
} else {
  console.info(
    "Supabase is ready to connect. Add your project URL and publishable key in app.js."
  );
}
