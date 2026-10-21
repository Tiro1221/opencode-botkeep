const http = require("http");
const net = require("net");

const PUERTO = Number(process.env.SERVER_PORT || 35791);
const ERP = { host: "127.0.0.1", port: Number(process.env.ERP_PORT || 8081) };
const WEB = { host: "127.0.0.1", port: Number(process.env.OPENCODE_PORT || 4097) };
const LLM = { host: "127.0.0.1", port: Number(process.env.AICLIENT_PORT || 3000) };

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

function resolver(ruta) {
  const p = String(ruta || "/");
  const limpia = p.split("?")[0];
  if (esErp(limpia)) return { dst: ERP, path: p };
  if (limpia === "/router" || limpia.startsWith("/router/")) {
    const resto = p.slice("/router".length);
    return { dst: LLM, path: resto === "" ? "/" : resto };
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

const server = http.createServer((req, res) => {
  const limpia = String(req.url || "/").split("?")[0];
  if (limpia === "/OpenCode" || limpia === "/OpenCode/" || limpia === "/opencode" || limpia === "/opencode/") {
    res.writeHead(302, { location: "/", "cache-control": "no-store" });
    return res.end();
  }
  const t = resolver(req.url);
  const pr = http.request(
    {
      host: t.dst.host,
      port: t.dst.port,
      method: req.method,
      path: t.path,
      headers: Object.assign({}, req.headers, { host: t.dst.host + ":" + t.dst.port }),
    },
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
  const t = resolver(req.url);
  const s = net.connect(t.dst.port, t.dst.host, () => {
    const lineas = [req.method + " " + t.path + " HTTP/1.1"];
    for (const k of Object.keys(req.headers)) lineas.push(k + ": " + req.headers[k]);
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
    console.log("router :" + PUERTO + " -> erp:" + ERP.port + ", web:" + WEB.port + ", llm:" + LLM.port);
  });
}

iniciar(0);
