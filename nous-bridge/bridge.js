// nous-bridge.js — OAuth Nous Portal (igual que Hermes) + proxy OpenAI-compatible.
// Sin Hermes instalado: implementa el mismo device-code flow con client_id hermes-cli.
// ENV: ROUTER_KEY (requerido, protege el bridge), BRIDGE_PORT (def 8099),
//      NOUS_PORTAL_URL, NOUS_CLIENT_ID, NOUS_STATE_FILE (def ./.nous-tokens.json)
const http = require("http");
const fs = require("fs");

const PORTAL = (process.env.NOUS_PORTAL_URL || "https://portal.nousresearch.com").replace(/\/$/, "");
const CLIENT_ID = process.env.NOUS_CLIENT_ID || "hermes-cli";
const STATE_FILE = process.env.NOUS_STATE_FILE || "./.nous-tokens.json";
const ROUTER_KEY = process.env.ROUTER_KEY || "";
const PORT = parseInt(process.env.BRIDGE_PORT || "8099", 10);
if (!ROUTER_KEY) { console.error("Falta ROUTER_KEY"); process.exit(1); }

let state = {};
try { state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch { state = {}; }
let pending = null; // {device_code, url, code, deadline}

function save() { fs.writeFileSync(STATE_FILE, JSON.stringify({ access_token: state.access_token, refresh_token: state.refresh_token, inference_base_url: state.inference_base_url, expires_at: state.expires_at })); }
function jwtExp(tok) {
  try {
    const p = JSON.parse(Buffer.from(tok.split(".")[1], "base64url").toString());
    return (p.exp || 0) * 1000;
  } catch { return 0; }
}
async function form(url, params, headers = {}) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", ...headers }, body: new URLSearchParams(params) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
  return j;
}
async function refresh() {
  if (!state.refresh_token) throw new Error("sin refresh_token");
  const j = await form(`${PORTAL}/api/oauth/token`, { grant_type: "refresh_token", client_id: CLIENT_ID }, { "x-nous-refresh-token": state.refresh_token });
  if (!j.access_token) throw new Error("refresh sin access_token");
  state.access_token = j.access_token;
  if (j.refresh_token) state.refresh_token = j.refresh_token;
  if (j.inference_base_url && j.inference_base_url.startsWith("https://")) state.inference_base_url = j.inference_base_url.replace(/\/$/, "");
  state.expires_at = Date.now() + (parseInt(j.expires_in || "3600", 10) * 1000);
  save();
  console.log("nous: token refrescado, expira", new Date(state.expires_at).toISOString());
}
async function ensureToken() {
  if (!state.access_token) throw new Error("no autorizado: usa /setup/start");
  if (Date.now() > (state.expires_at || 0) - 120000) await refresh();
  return state;
}
async function pollLoop() {
  while (pending && Date.now() < pending.deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const j = await form(`${PORTAL}/api/oauth/token`, { grant_type: "urn:ietf:params:oauth:grant-type:device_code", client_id: CLIENT_ID, device_code: pending.device_code });
      if (j.access_token) {
        state.access_token = j.access_token;
        state.refresh_token = j.refresh_token || null;
        state.inference_base_url = (j.inference_base_url && j.inference_base_url.startsWith("https://") ? j.inference_base_url : "https://inference-api.nousresearch.com/v1").replace(/\/$/, "");
        state.expires_at = Date.now() + (parseInt(j.expires_in || "3600", 10) * 1000);
        save(); pending.done = true; pending = null;
        console.log("nous: login OK, inference:", state.inference_base_url);
        return;
      }
    } catch (e) { /* authorization_pending: sigue */ }
  }
  if (pending) { pending.expired = true; pending = null; }
}
function send(res, code, obj) { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); }
function body(req) { return new Promise((res, rej) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { try { res(b ? JSON.parse(b) : {}); } catch (e) { rej(e); } }); }); }

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  const loopback = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress);
  if (!loopback && req.headers.authorization !== `Bearer ${ROUTER_KEY}`) return send(res, 401, { error: "unauthorized" });
  try {
    if (u.pathname === "/setup/start") {
      const j = await form(`${PORTAL}/api/oauth/device/code`, { client_id: CLIENT_ID, scope: "inference:invoke" });
      pending = { device_code: j.device_code, deadline: Date.now() + parseInt(j.expires_in || "600", 10) * 1000 };
      pollLoop();
      return send(res, 200, { url: j.verification_uri_complete || j.verification_uri, code: j.user_code });
    }
    if (u.pathname === "/setup/status") {
      if (state.access_token) return send(res, 200, { status: "ready", inference_base_url: state.inference_base_url });
      if (pending) return send(res, 200, { status: "pending" });
      return send(res, 200, { status: "none" });
    }
    const s = await ensureToken();
    let p = u.pathname.includes("/v1/") ? u.pathname.slice(u.pathname.indexOf("/v1/")) : u.pathname;
    const base = s.inference_base_url.replace(/\/$/, "");
    if (base.endsWith("/v1") && p.startsWith("/v1")) p = p.slice(3);
    const target = base + p + u.search;
    if (req.method === "GET" && u.pathname === "/v1/models") {
      const r = await fetch(target, { headers: { Authorization: `Bearer ${s.access_token}` } });
      const j = await r.json();
      return send(res, r.status, j);
    }
    if (req.method === "POST" && u.pathname === "/v1/chat/completions") {
      const b = await body(req);
      const r = await fetch(target, { method: "POST", headers: { Authorization: `Bearer ${s.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify(b) });
      res.writeHead(r.status, { "Content-Type": r.headers.get("content-type") || "application/json" });
      if (r.body) for await (const c of r.body) res.write(c);
      return res.end();
    }
    return send(res, 404, { error: "solo /v1/models y /v1/chat/completions" });
  } catch (e) { return send(res, 500, { error: e.message }); }
});
server.listen(PORT, "127.0.0.1", async () => {
  console.log(`nous-bridge en 127.0.0.1:${PORT}`);
  if (state.access_token) {
    console.log("nous: sesion existente, lista");
    try {
      const t = await ensureToken();
      const r = await fetch(t.inference_base_url + "/v1/models", { headers: { Authorization: `Bearer ${t.access_token}` } });
      const txt = await r.text();
      console.log(`nous selftest: HTTP ${r.status} ${(txt || "").slice(0, 120)}`);
    } catch (e) { console.log("nous selftest ERROR:", e.message); }
    return;
  }
  try {
    const j = await form(`${PORTAL}/api/oauth/device/code`, { client_id: CLIENT_ID, scope: "inference:invoke" });
    pending = { device_code: j.device_code, deadline: Date.now() + parseInt(j.expires_in || "600", 10) * 1000 };
    console.log("==== NOUS LOGIN ==== Entra a: " + (j.verification_uri_complete || j.verification_uri) + "  CODIGO: " + j.user_code + " ====");
    pollLoop();
  } catch (e) { console.log("nous setup error:", e.message); }
});
