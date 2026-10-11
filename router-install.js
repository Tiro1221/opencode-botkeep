// router-install.js — deja listo AIClient2API + Caddy en el mismo slot.
// - Descarga AIClient2API (tarball main) a ./router (solo 1ª vez), npm install --omit=dev
// - Descarga binario Caddy a ./caddy (solo 1ª vez)
// - Siembra router/configs/config.json (solo si no existe): SERVER_PORT 3000 + REQUIRED_API_KEY
// - Genera ./Caddyfile con el $PORT real: /v1/* y /router/* -> router, resto -> opencode
const fs = require("fs");
const path = require("path");
const https = require("https");
const { execSync } = require("child_process");
const tar = require("tar");

const ROUTER_URL = "https://codeload.github.com/justlovemaki/AIClient2API/tar.gz/refs/heads/main";
const CADDY_URL = "https://github.com/caddyserver/caddy/releases/download/v2.11.7/caddy_2.11.7_linux_amd64.tar.gz";
const PORT = process.env.PORT || process.env.SERVER_PORT || "3000";

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
  if (!fs.existsSync("./caddy")) {
    console.log("descargando caddy...");
    await fetchFile(CADDY_URL, "/tmp/caddy.tgz");
    await tar.x({ file: "/tmp/caddy.tgz", C: "/tmp" });
    fs.copyFileSync("/tmp/caddy", "./caddy");
    fs.chmodSync("./caddy", 0o755);
  }
  const cfgPath = "./router/configs/config.json";
  if (!fs.existsSync(cfgPath)) {
    fs.mkdirSync("./router/configs", { recursive: true });
    fs.writeFileSync(cfgPath, JSON.stringify({
      REQUIRED_API_KEY: process.env.ROUTER_API_KEY || "cambia-esto",
      SERVER_PORT: 3000,
      HOST: "127.0.0.1",
    }, null, 2));
    console.log("router: config inicial creada");
  }
  fs.writeFileSync("./Caddyfile", `{
  admin off
  auto_https off
}
:${PORT} {
  @routerhost host tiro-router.bot-keep.xyz
  handle @routerhost {
    reverse_proxy 127.0.0.1:3000
  }
  handle /v1/* {
    reverse_proxy 127.0.0.1:3000
  }
  handle */v1/* {
    reverse_proxy 127.0.0.1:3000
  }
  handle /router {
    redir /router/ permanent
  }
  handle /router/* {
    uri strip_prefix /router
    reverse_proxy 127.0.0.1:3000
  }
  handle /* {
    reverse_proxy 127.0.0.1:4097
  }
}
`);
  console.log("router: listo (Caddyfile puerto " + PORT + ")");
})().catch((e) => { console.error("router-install ERROR:", e.message); process.exit(1); });
