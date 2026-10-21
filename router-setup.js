// router-setup.js — deja listo AIClient2API en ./router (sin Caddy; el edge es router.js).
// - Descarga AIClient2API (tarball main) a ./router (solo 1ª vez), npm install --omit=dev
// - Siembra/actualiza router/configs/{config.json,provider_pools.json,custom_models.json}
//   para que /v1 funcione out-of-the-box con Groq como pool "openai-custom".
const fs = require("fs");
const https = require("https");
const { execSync } = require("child_process");
const tar = require("tar");

const ROUTER_URL = "https://codeload.github.com/justlovemaki/AIClient2API/tar.gz/refs/heads/main";
const CONFIG_PORT = Number(process.env.AICLIENT_PORT || 3000);
const ROUTER_API_KEY = process.env.ROUTER_API_KEY || "cambia-esto";
const GROQ_API_KEY = process.env.GROQ_API_KEY || "";
const GROQ_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-120b";

function fetchFile(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "opencode-botkeep" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        if (redirects > 5) return reject(new Error("redirects"));
        res.resume();
        return resolve(fetchFile(res.headers.location, dest, redirects + 1));
      }
      if (res.statusCode !== 200) return reject(new Error("HTTP " + res.statusCode));
      const f = fs.createWriteStream(dest);
      res.pipe(f);
      f.on("finish", () => f.close(resolve));
      f.on("error", reject);
    }).on("error", reject);
  });
}

function writeJson(path, value) {
  fs.writeFileSync(path, JSON.stringify(value, null, 2));
}

// Modelos expuestos por /v1 en el pool "openai-custom".
const CUSTOM_MODELS = [
  ["gpt-oss-120b", "openai/gpt-oss-120b", 131072],
  ["gpt-oss-20b", "openai/gpt-oss-20b", 131072],
  ["qwen3.8-27b", "qwen/qwen3.8-27b", 131072],
  ["allam-2-7b", "allam-2-7b", 4096],
];

function seedConfigs() {
  const dir = "./router/configs";
  fs.mkdirSync(dir, { recursive: true });

  // config.json: conserva lo existente y fuerza los campos clave.
  const cfgPath = dir + "/config.json";
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8")); } catch (_) {}
  cfg.REQUIRED_API_KEY = ROUTER_API_KEY;
  cfg.SERVER_PORT = CONFIG_PORT;
  cfg.HOST = "127.0.0.1";
  cfg.MODEL_PROVIDER = "openai-custom";
  cfg.PROVIDER_POOLS_FILE_PATH = "configs/provider_pools.json";
  cfg.CUSTOM_MODELS_FILE_PATH = "configs/custom_models.json";
  cfg.PROMPT_LOG_MODE = cfg.PROMPT_LOG_MODE || "none";
  cfg.LOG_ENABLED = cfg.LOG_ENABLED !== false;
  cfg.LOG_DIR = cfg.LOG_DIR || "logs";
  cfg.UI_ENABLED = true;
  writeJson(cfgPath, cfg);

  // provider_pools.json: pool openai-custom -> Groq (clave desde env).
  if (GROQ_API_KEY) {
    writeJson(dir + "/provider_pools.json", {
      "openai-custom": [{
        customName: "Groq",
        OPENAI_API_KEY: GROQ_API_KEY,
        OPENAI_BASE_URL: "https://api.groq.com/openai/v1",
        checkModelName: GROQ_MODEL,
        checkHealth: true,
        notSupportedModels: [],
        uuid: "b6a1c0de-0001-4a01-9f01-000000000001",
        isHealthy: true,
        isDisabled: false,
        lastUsed: null,
        usageCount: 0,
        errorCount: 0,
        lastErrorTime: null,
      }],
    });
    console.log("router: provider_pools.json (Groq) creado");
  } else {
    console.log("router: sin GROQ_API_KEY; provider_pools.json no sembrado");
  }

  // custom_models.json: modelos expuestos por /v1.
  writeJson(dir + "/custom_models.json", CUSTOM_MODELS.map(([alias, actual, ctx]) => ({
    id: "openai-custom-" + alias,
    name: alias + " (Groq)",
    alias,
    provider: "openai-custom",
    actualProvider: "openai-custom",
    actualModel: actual,
    contextLength: ctx,
    maxTokens: 32768,
    temperature: 0.7,
    topP: 1.0,
  })));
  console.log("router: configs sembradas (MODEL_PROVIDER=openai-custom)");
}

(async () => {
  if (!fs.existsSync("./router/package.json")) {
    console.log("router: descargando AIClient2API...");
    fs.mkdirSync("./router", { recursive: true });
    await fetchFile(ROUTER_URL, "/tmp/router.tgz");
    await tar.x({ file: "/tmp/router.tgz", C: "./router", strip: 1 });
  }
  if (!fs.existsSync("./router/node_modules")) {
    console.log("router: npm install (tarda unos minutos)...");
    execSync("npm install --omit=dev --no-audit --no-fund", { cwd: "./router", stdio: "inherit" });
  }
  seedConfigs();
  console.log("router: listo");
})().catch((e) => { console.error("router-setup ERROR:", e.message); process.exit(1); });
