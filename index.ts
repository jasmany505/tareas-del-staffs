// Supabase Edge Function: create-staff
// Creates auth users and their profile. Only an existing active Owner may call it.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return respond({ error: "Method not allowed" }, 405);
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) return respond({ error: "Server configuration missing" }, 500);
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return respond({ error: "Unauthorized" }, 401);
  const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) return respond({ error: "Unauthorized" }, 401);
  const admin = createClient(url, service);
  const { data: caller } = await admin.from("profiles").select("role,active").eq("id", user.id).maybeSingle();
  if (caller?.role !== "owner" || caller.active !== true) return respond({ error: "Owner access required" }, 403);
  let body: { email?: string; password?: string; display_name?: string; role?: string };
  try { body = await req.json(); } catch { return respond({ error: "Invalid JSON" }, 400); }
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const displayName = String(body.display_name || "").trim();
  const role = body.role === "owner" ? "owner" : "staff";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12 || displayName.length < 1 || displayName.length > 80) {
    return respond({ error: "Provide a valid email, display name, and password of at least 12 characters." }, 400);
  }
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { display_name: displayName },
  });
  if (createError || !created.user) return respond({ error: createError?.message || "Could not create user" }, 400);
  const { error: profileError } = await admin.from("profiles").insert({
    id: created.user.id, display_name: displayName, role, active: true,
  });
  if (profileError) {
    await admin.auth.admin.deleteUser(created.user.id);
    return respond({ error: "Profile creation failed; account creation was rolled back." }, 500);
  }
  return respond({ user: { id: created.user.id, email, display_name: displayName, role } }, 201);
});
