// Cheapanel WhatsApp sender (Cloudflare Worker)
// Variables (Settings > Variables and Secrets):
//   FIREBASE_API_KEY  the apiKey from your Firebase web config
//   PROJECT_ID        cheapanel-01
//   ALLOW_ORIGIN      https://cheapanel.store
// The WaSMS API key and account ID are saved from your admin Settings page.
const BASE = "https://wasms.net/api/public/v1";
export default {
  async fetch(req, env) {
    const cors = {
      "Access-Control-Allow-Origin": env.ALLOW_ORIGIN || "https://cheapanel.store",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "POST, OPTIONS"
    };
    const j = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    if (req.method !== "POST") return j({ error: "NOT_FOUND" }, 404);

    const tok = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!tok) return j({ error: "NO_TOKEN" }, 401);

    // 1. Who is calling? (Firebase checks the login token)
    const lk = await fetch("https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + env.FIREBASE_API_KEY, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken: tok })
    });
    if (!lk.ok) return j({ error: "BAD_TOKEN" }, 401);
    const uid = ((await lk.json()).users || [])[0]?.localId;
    if (!uid) return j({ error: "BAD_TOKEN" }, 401);

    // 2. Is that person an admin? (your Firestore rules answer this)
    const doc = `https://firestore.googleapis.com/v1/projects/${env.PROJECT_ID}/databases/(default)/documents/`;
    const ad = await fetch(doc + "admins/" + uid, { headers: { Authorization: "Bearer " + tok } });
    if (!ad.ok) return j({ error: "NOT_ADMIN" }, 403);

    // 3. Read the WaSMS key you saved in the admin (only admins can read it)
    let body;
    try { body = await req.json(); } catch (e) { return j({ error: "BAD_JSON" }, 400); }
    let key = "", acc = "";
    const sec = await fetch(doc + "secrets/wasms", { headers: { Authorization: "Bearer " + tok } });
    if (sec.ok) { const f = (await sec.json()).fields || {}; key = f.apiKey?.stringValue || ""; acc = f.accountId?.stringValue || ""; }
    if (!key) return j({ ok: false, error: "NO_KEY" }, 400);
    const auth = { Authorization: "Bearer " + key };

    // List connected WhatsApp numbers (to find the account ID)
    if (body.action === "accounts") {
      const r = await fetch(BASE + "/whatsapp/accounts", { headers: auth });
      const o = await r.json().catch(() => ({}));
      return r.ok && o.success !== false ? j({ ok: true, accounts: o.data || [] }) : j({ ok: false, error: o.code || o.error || "FAILED" }, 502);
    }

    // Send a WhatsApp message
    const to = String(body.to || "").replace(/\D/g, "");
    const message = String(body.message || "");
    if (!/^\d{8,15}$/.test(to) || !message || message.length > 2000) return j({ ok: false, error: "BAD_INPUT" }, 400);
    const payload = { to, message };
    if (acc) payload.whatsapp_id = acc;
    const r = await fetch(BASE + "/whatsapp/send", {
      method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify(payload)
    });
    const out = await r.json().catch(() => ({}));
    const ok = r.ok && out.success !== false;
    return j({ ok, error: ok ? undefined : (out.code || out.error || "SEND_FAILED") }, ok ? 200 : 502);
  }
};
