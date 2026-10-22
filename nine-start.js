const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const tar = require("tar");

const VERSION = "0.5.104";
const ROOT = __dirname;
const INSTALL = path.join(ROOT, ".nine-runtime");
const DATA = path.join(ROOT, ".nine-data");
const PORT = Number(process.env.NINE_PORT || 3000);
const PASSWORD = process.env.NINE_PASSWORD || process.env.OPENCODE_SERVER_PASSWORD;
const BASE = `http://127.0.0.1:${PORT}`;
let child;
let cookie = "";

async function api(route, method = "GET", body) {
  const res = await fetch(BASE + route, {
    method,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  const data = await res.json();
  if (!res.ok) throw new Error(`${route}: HTTP ${res.status}: ${data.error || "request failed"}`);
  return data;
}

async function main() {
  if (!PASSWORD) throw new Error("OPENCODE_SERVER_PASSWORD or NINE_PASSWORD is required");
  fs.mkdirSync(DATA, { recursive: true, mode: 0o700 });
  const serverFile = path.join(INSTALL, "app", "server.js");
  if (!fs.existsSync(serverFile)) {
    fs.mkdirSync(INSTALL, { recursive: true });
    const metadata = await fetch(`https://registry.npmjs.org/9router/${VERSION}`, { signal: AbortSignal.timeout(30000) });
    if (!metadata.ok) throw new Error(`Registry HTTP ${metadata.status}`);
    const { dist } = await metadata.json();
    const res = await fetch(dist.tarball, { signal: AbortSignal.timeout(120000) });
    if (!res.ok) throw new Error(`Download HTTP ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    const digest = crypto.createHash("sha512").update(bytes).digest("base64");
    if (dist.integrity !== `sha512-${digest}`) throw new Error("9Router integrity mismatch");
    const archive = path.join(INSTALL, "package.tgz");
    fs.writeFileSync(archive, bytes);
    await tar.x({ file: archive, cwd: INSTALL, strip: 1,
      filter: name => !name.includes(".build-home/") });
    fs.unlinkSync(archive);
  }
  const secretFile = path.join(DATA, "jwt-secret");
  if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, crypto.randomBytes(48).toString("hex"), { mode: 0o600 });
  child = spawn(process.execPath, [serverFile], {
    cwd: INSTALL,
    env: { ...process.env, PORT: String(PORT), HOSTNAME: "127.0.0.1", DATA_DIR: DATA,
      INITIAL_PASSWORD: PASSWORD, JWT_SECRET: fs.readFileSync(secretFile, "utf8"),
      NEXT_TELEMETRY_DISABLED: "1", NODE_ENV: "production", AUTH_COOKIE_SECURE: "true" },
    stdio: "inherit",
  });
  child.on("exit", code => process.exit(code || 0));
  let isReady = false;
  for (let i = 0; i < 90; i++) {
    try { await api("/api/auth/status"); isReady = true; break; }
    catch { await new Promise(resolve => setTimeout(resolve, 1000)); }
  }
  if (!isReady) throw new Error("9Router startup timed out");
  await api("/api/auth/login", "POST", { password: PASSWORD });
  await api("/api/settings", "PATCH", { requireLogin: true, requireApiKey: true, rtkEnabled: true, pxpipeAutoInstall: false });
  const keyFile = path.join(DATA, "edge-key.json");
  if (!fs.existsSync(keyFile)) {
    const result = await api("/api/keys", "POST", { name: "Botkeep edge" });
    fs.writeFileSync(keyFile, JSON.stringify({ key: result.key }), { mode: 0o600 });
  }
  if (process.env.GROQ_API_KEY) {
    const { nodes } = await api("/api/provider-nodes");
    let node = nodes.find(item => item.prefix === "groq");
    if (!node) ({ node } = await api("/api/provider-nodes", "POST", {
      name: "Groq", prefix: "groq", baseUrl: "https://api.groq.com/openai/v1", type: "openai-compatible", apiType: "chat",
    }));
    const { connections } = await api("/api/providers");
    const existingGroq = connections.find(item => item.provider === node.id || item.provider === `groq/${node.id}`);
    if (!existingGroq) await api("/api/providers", "POST", {
      provider: node.id, name: "Groq", apiKey: process.env.GROQ_API_KEY,
    });
    else await api(`/api/providers/${existingGroq.id}`, "PUT", {
      apiKey: process.env.GROQ_API_KEY, isActive: true, testStatus: "unknown",
    });
    for (const [alias, model] of [["gpt-oss-120b", "groq/openai/gpt-oss-120b"], ["gpt-oss-20b", "groq/openai/gpt-oss-20b"], ["qwen3.8-27b", "groq/qwen/qwen3.8-27b"], ["allam-2-7b", "groq/allam-2-7b"]]) {
      await api("/api/models/alias", "PUT", { alias, model });
    }
  }
  console.log(`[9Router] ${VERSION} ready; Groq migrated; API authentication enabled`);
}

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child ? child.kill(signal) : process.exit(0));
main().catch(error => { console.error("[9Router]", error.message); if (child) child.kill(); process.exitCode = 1; });
