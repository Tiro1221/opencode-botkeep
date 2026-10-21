const http = require("http");
const net = require("net");
const crypto = require("crypto");

const PUERTO = Number(process.env.SERVER_PORT || 35791);
const ERP = { host: "127.0.0.1", port: Number(process.env.ERP_PORT || 8081) };
const WEB = { host: "127.0.0.1", port: Number(process.env.OPENCODE_PORT || 4097) };
const LLM = { host: "127.0.0.1", port: Number(process.env.AICLIENT_PORT || 3000) };

const AUTH_USER = process.env.OPENCODE_SERVER_USERNAME || "opencode";
const AUTH_PASS = process.env.OPENCODE_SERVER_PASSWORD || "";
const AUTH_B64 = AUTH_PASS ? Buffer.from(AUTH_USER + ":" + AUTH_PASS).toString("base64") : "";
const COOKIE = "oc_auth";
const COOKIE_TOKEN = AUTH_PASS
  ? crypto.createHash("sha256").update("oc-auth|" + AUTH_USER + "|" + AUTH_PASS).digest("hex")
  : "";
const COOKIE_MAX_AGE = 31536000;

const ERP_EXACT = new Set([
  "/app", "/subir", "/upload", "/files",
  "/api/estado", "/api/archivo/usar", "/api/archivos", "/api/descargar",
  "/api/ventas", "/api/gastos", "/api/factura", "/api/facturas",
  "/api/pregunta", "/api/hoja1", "/api/celda", "/api/chat",
  "/api/bandeja", "/api/bandeja/propuesta", "/api/bandeja/regla", "/api/reporte",
]);
const ERP_PREFIX = ["/app/", "/subir/", "/api/archivo/", "/api/bandeja/"];
const LLM_PREFIX = ["/v1/", "/openai-custom/", "/claude-custom/", "/gemini-custom/"];

function esErp(ruta) {
  const r = String(ruta || "/").split("?")[0];
  if (ERP_EXACT.has(r)) return true;
  return ERP_PREFIX.some(pref => r.startsWith(pref));
}

function esLlm(ruta) {
  const r = String(ruta || "/").split("?")[0];
  if (r === "/v1" || LLM_PREFIX.some(pref => r.startsWith(pref))) return true;
  if (r === "/router" || r.startsWith("/router/")) return true;
  return false;
}

function esAliasRouter(host) {
  return String(host || "").toLowerCase().startsWith("tiro-router.");
}

function resolver(ruta, host) {
  const p = String(ruta || "/");
  const limpia = p.split("?")[0];
  if (esAliasRouter(host)) return { dst: LLM, path: p };
  if (esErp(limpia)) return { dst: ERP, path: p };
  for (const base of ["/panel", "/admin", "/router"]) {
    if (limpia === base || limpia.startsWith(base + "/")) {
      const resto = p.slice(base.length);
      return { dst: LLM, path: resto === "" ? "/" : resto };
    }
  }
  if (esLlm(limpia)) return { dst: LLM, path: p };
  return { dst: WEB, path: p };
}

function cabeceras(headers) {
  const h = Object.assign({}, headers);
  const ct = String(h["content-type"] || "");
  if (/text\/html/i.test(ct)) {
    h["cache-control"] = "no-store, max-age=0";
    delete h.etag;
    delete h["last-modified"];
    delete h.expires;
  } else if (/text\/event-stream/i.test(ct)) {
    h["cache-control"] = "no-store";
  } else if (/javascript|text\/css|font\/|image\//i.test(ct)) {
    h["cache-control"] = "public, max-age=31536000, immutable";
  }
  return h;
}

function leerCookies(header) {
  const out = {};
  String(header || "").split(";").forEach(par => {
    const i = par.indexOf("=");
    if (i > 0) out[par.slice(0, i).trim()] = decodeURIComponent(par.slice(i + 1).trim());
  });
  return out;
}

function credencialesOk(user, pass) {
  const a = Buffer.from(String(user) + ":" + String(pass));
  const b = Buffer.from(AUTH_USER + ":" + AUTH_PASS);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function autenticado(req) {
  if (!AUTH_PASS) return true;
  if (leerCookies(req.headers.cookie)[COOKIE] === COOKIE_TOKEN) return true;
  const h = String(req.headers.authorization || "");
  if (h.toLowerCase().startsWith("basic ")) {
    try {
      return credencialesOk(...Buffer.from(h.slice(6), "base64").toString("utf8").split(/:(.*)/s).slice(0, 2));
    } catch (_) { return false; }
  }
  return false;
}

function aceptaHtml(req) {
  return /text\/html/i.test(String(req.headers.accept || ""));
}

function paginaLogin(error) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Iniciar sesión</title>
<style>
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0f0f16;
font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#e8e8f0;
background-image:radial-gradient(circle at 20% 20%,rgba(0,170,255,.12),transparent 45%),radial-gradient(circle at 80% 80%,rgba(255,170,0,.08),transparent 45%)}
.card{width:min(360px,92vw);background:#1a1a26;border:1px solid #2a2a3a;border-radius:16px;
padding:28px 24px;box-shadow:0 24px 60px rgba(0,0,0,.55)}
h1{font-size:19px;margin:0 0 4px;font-weight:650}
p.sub{font-size:12.5px;color:#8b8ba0;margin:0 0 20px}
label{display:block;font-size:12px;color:#a0a0b8;margin:14px 0 6px}
input{width:100%;padding:11px 12px;border-radius:10px;border:1px solid #30304a;background:#12121c;
color:#f0f0f8;font-size:14px;outline:none;transition:border-color .15s,box-shadow .15s}
input:focus{border-color:#00aaff;box-shadow:0 0 0 3px rgba(0,170,255,.18)}
button{width:100%;margin-top:20px;padding:12px;border:0;border-radius:10px;cursor:pointer;
background:linear-gradient(180deg,#00b4ff,#0090e6);color:#04121c;font-weight:700;font-size:14px;
transition:transform .12s,filter .15s}
button:hover{filter:brightness(1.08)}button:active{transform:scale(.985)}
.err{margin-top:14px;padding:10px 12px;border-radius:10px;background:rgba(255,80,80,.12);
border:1px solid rgba(255,80,80,.35);color:#ff9d9d;font-size:12.5px}
.foot{margin-top:16px;font-size:11.5px;color:#6c6c85;text-align:center}
</style></head><body>
<form class="card" method="POST" action="/__login">
<h1>Iniciar sesión</h1>
<p class="sub">Acceso a OpenCode</p>
<label>Nombre de usuario</label>
<input name="user" value="${AUTH_USER.replace(/"/g, "&quot;")}" autocomplete="username" required>
<label>Contraseña</label>
<input name="pass" type="password" autocomplete="current-password" required autofocus>
${error ? '<div class="err">' + error + "</div>" : ""}
<button type="submit">Entrar</button>
<div class="foot">Este dispositivo quedará recordado 1 año</div>
</form></body></html>`;
}

function setCookieAuth(res) {
  res.setHeader("set-cookie", COOKIE + "=" + COOKIE_TOKEN + "; Max-Age=" + COOKIE_MAX_AGE +
    "; Path=/; HttpOnly; SameSite=Lax; Secure");
}

function enviarLogin(res, status) {
  res.writeHead(status || 200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(paginaLogin(status === 401 ? "Usuario o contraseña incorrectos." : ""));
}

const server = http.createServer((req, res) => {
  const limpia = String(req.url || "/").split("?")[0];

  if (limpia === "/__login") {
    if (req.method === "GET") {
      if (autenticado(req)) { setCookieAuth(res); res.writeHead(302, { location: "/", "cache-control": "no-store" }); return res.end(); }
      return enviarLogin(res, 200);
    }
    if (req.method === "POST") {
      let cuerpo = "";
      req.on("data", c => { cuerpo += c; if (cuerpo.length > 4096) req.destroy(); });
      req.on("end", () => {
        const p = new URLSearchParams(cuerpo);
        const user = p.get("user") || "";
        const pass = p.get("pass") || "";
        if (credencialesOk(user, pass)) {
          setCookieAuth(res);
          res.writeHead(302, { location: "/", "cache-control": "no-store" });
          return res.end();
        }
        return enviarLogin(res, 401);
      });
      return;
    }
    res.writeHead(405, { allow: "GET, POST" });
    return res.end();
  }

  if (limpia === "/OpenCode" || limpia === "/OpenCode/" || limpia === "/opencode" || limpia === "/opencode/") {
    res.writeHead(302, { location: "/", "cache-control": "no-store" });
    return res.end();
  }

  for (const base of ["/panel", "/admin", "/router"]) {
    if (limpia === base) {
      res.writeHead(302, { location: base + "/", "cache-control": "no-store" });
      return res.end();
    }
  }

  const t = resolver(req.url, req.headers.host);
  const esWeb = t.dst === WEB;

  if (esWeb && !autenticado(req)) {
    if (req.method === "GET" && aceptaHtml(req)) return enviarLogin(res, 200);
    res.writeHead(401, { "content-type": "text/plain; charset=utf-8" });
    return res.end("login requerido");
  }

  const cab = Object.assign({}, req.headers, { host: t.dst.host + ":" + t.dst.port });
  if (esWeb && AUTH_PASS) cab.authorization = "Basic " + AUTH_B64;

  const pr = http.request(
    { host: t.dst.host, port: t.dst.port, method: req.method, path: t.path, headers: cab },
    pres => {
      res.writeHead(pres.statusCode || 502, cabeceras(pres.headers));
      pres.pipe(res);
    }
  );
  pr.on("error", () => {
    if (!res.headersSent) res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("servicio no disponible");
  });
  req.pipe(pr);
});

server.on("upgrade", (req, socket, head) => {
  const t = resolver(req.url, req.headers.host);
  if (t.dst === WEB && !autenticado(req)) return socket.destroy();
  const cab = Object.assign({}, req.headers);
  if (t.dst === WEB && AUTH_PASS) cab.authorization = "Basic " + AUTH_B64;
  const s = net.connect(t.dst.port, t.dst.host, () => {
    const lineas = [req.method + " " + t.path + " HTTP/1.1"];
    for (const k of Object.keys(cab)) lineas.push(k + ": " + cab[k]);
    s.write(lineas.join("\r\n") + "\r\n\r\n");
    if (head && head.length) s.write(head);
  });
  socket.pipe(s);
  s.pipe(socket);
  s.on("error", () => socket.destroy());
  socket.on("error", () => s.destroy());
});

function iniciar(intentos) {
  server.once("error", (e) => {
    if (e.code === "EADDRINUSE" && intentos < 30) {
      console.error("puerto " + PUERTO + " ocupado, reintento " + (intentos + 1));
      setTimeout(() => iniciar(intentos + 1), 2000);
      return;
    }
    console.error("router error:", e.message);
    process.exit(1);
  });
  server.listen(PUERTO, "0.0.0.0", () => {
    console.log("router :" + PUERTO + " -> erp:" + ERP.port + ", web:" + WEB.port + ", llm:" + LLM.port +
      " (cookie-auth " + (AUTH_PASS ? "on" : "off") + ")");
  });
}

iniciar(0);
