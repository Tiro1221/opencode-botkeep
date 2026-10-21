// router-setup.js — deja listo AIClient2API en ./router (sin Caddy; el edge es router.js).
// - Descarga AIClient2API (tarball main) a ./router (solo 1ª vez), npm install --omit=dev
// - Siembra router/configs/config.json (solo si no existe): SERVER_PORT 3000 + REQUIRED_API_KEY
const fs = require("fs");
const https = require("https");
const { execSync } = require("child_process");
const tar = require("tar");

const ROUTER_URL = "https://codeload.github.com/justlovemaki/AIClient2API/tar.gz/refs/heads/main";
const CONFIG_PORT = Number(process.env.AICLIENT_PORT || 3000);

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
  const cfgPath = "./router/configs/config.json";
  if (!fs.existsSync(cfgPath)) {
    fs.mkdirSync("./router/configs", { recursive: true });
    fs.writeFileSync(cfgPath, JSON.stringify({
      REQUIRED_API_KEY: process.env.ROUTER_API_KEY || "cambia-esto",
      SERVER_PORT: CONFIG_PORT,
      HOST: "127.0.0.1",
    }, null, 2));
    console.log("router: config inicial creada");
  }
  console.log("router: listo");
})().catch((e) => { console.error("router-setup ERROR:", e.message); process.exit(1); });
