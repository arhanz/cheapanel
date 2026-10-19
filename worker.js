// Cheapanel WhatsApp sender (Cloudflare Worker)
// Secret:    WASMS_KEY        (your WaSMS API key, needs the messages:send scope)
// Variables: FIREBASE_API_KEY (the apiKey from your Firebase web config)
//            PROJECT_ID       (cheapanel-01)
//            ALLOW_ORIGIN     (https://cheapanel.store)
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
    const ad = await fetch(`https://firestore.googleapis.com/v1/projects/${env.PROJECT_ID}/databases/(default)/documents/admins/${uid}`, {
      headers: { Authorization: "Bearer " + tok }
    });
    if (!ad.ok) return j({ error: "NOT_ADMIN" }, 403);

    // 3. Send the WhatsApp message through WaSMS
    let body;
    try { body = await req.json(); } catch (e) { return j({ error: "BAD_JSON" }, 400); }
    const to = String(body.to || "").replace(/\D/g, "");
    const message = String(body.message || "");
    if (!/^\d{8,15}$/.test(to) || !message || message.length > 2000) return j({ error: "BAD_INPUT" }, 400);

    const r = await fetch("https://wasms.net/api/public/v1/whatsapp/send", {
      method: "POST",
      headers: { Authorization: "Bearer " + env.WASMS_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ to, message })
    });
    const out = await r.json().catch(() => ({}));
    const ok = r.ok && out.success !== false;
    return j({ ok, status: r.status, error: ok ? undefined : (out.code || out.error || "SEND_FAILED") }, ok ? 200 : 502);
  }
};
