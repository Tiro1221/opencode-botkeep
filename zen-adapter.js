const http = require("http");
const https = require("https");

const PORT = Number(process.env.ZEN_ADAPTER_PORT || 8791);
const HOST = process.env.ZEN_ADAPTER_HOST || "127.0.0.1";
const KEY = process.env.ZEN_ADAPTER_KEY || "sk-zen-free";
const CLIENT_VERSION = process.env.ZEN_CLIENT_VERSION || "1.19.3";
const UPSTREAM_PATH = "/zen/v1/chat/completions";
const MAX_BODY = 24 * 1024 * 1024;
const TIMEOUT_MS = 180000;

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const HEX = "0123456789abcdef";

function randomFrom(chars, len) {
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

const SESSION_ID = "ses_" + randomFrom(HEX, 12) + randomFrom(ALPHABET, 14);

const MODELS = [
  ["deepseek-v4.1-flash-free", 200000, 32768],
  ["big-pickle", 200000, 32768],
  ["space-bunny-free", 1000000, 512000],
  ["longcat-2.5-preview-free", 1000000, 128000],
  ["step-5-preview-free", 262144, 32768],
  ["mimo-v2.6-flash-free", 200000, 32768],
  ["mimo-v2.5-free", 200000, 32768],
  ["glm-5.3-flash-free", 200000, 32768],
  ["nemotron-3-ultra-free", 1000000, 128000],
  ["nemotron-3.5-lightning-free", 262144, 262144],
  ["nemotron-3.5-super-vl-free", 1000000, 128000],
  ["minimax-m3.1-flash-free", 200000, 32768],
  ["beam-free", 1000000, 128000],
  ["flint-40b-free", 131072, 32768],
];

const FINGERPRINT_TOOLS = ["bash", "glob", "grep", "read"].map((name) => ({
  type: "function",
  function: { name },
}));

function log(message) {
  console.log("[" + new Date().toISOString() + "] " + message);
}

function authorized(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : req.headers["x-api-key"] || "";
  return token === KEY;
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function ensureTools(body) {
  const tools = Array.isArray(body.tools) ? body.tools.slice() : [];
  const names = new Set();
  for (const tool of tools) {
    const name = tool && tool.function && tool.function.name;
    if (name) names.add(name);
  }
  for (const tool of FINGERPRINT_TOOLS) {
    if (!names.has(tool.function.name)) tools.push(tool);
  }
  return tools;
}

function upstreamRequest(payload) {
  const body = JSON.stringify(payload);
  const requestId = "msg_" + randomFrom(HEX, 12) + randomFrom(ALPHABET, 14);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "opencode.ai",
        path: UPSTREAM_PATH,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          Accept: "text/event-stream",
          Authorization: "Bearer public",
          "User-Agent": "opencode/" + CLIENT_VERSION,
          "x-opencode-client": "desktop",
          "x-opencode-session": SESSION_ID,
          "x-opencode-request": requestId,
        },
      },
      (res) => resolve({ res, requestId })
    );
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error("upstream timeout")));
    req.on("error", reject);
    req.end(body);
  });
}

function parseSseLine(line, state) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return;
  const data = trimmed.slice(5).trim();
  if (!data || data === "[DONE]") return;
  let chunk;
  try {
    chunk = JSON.parse(data);
  } catch (_) {
    return;
  }
  if (chunk.model) state.model = chunk.model;
  if (chunk.id) state.id = chunk.id;
  if (chunk.usage) state.usage = chunk.usage;
  const choice = chunk.choices && chunk.choices[0];
  if (!choice) return;
  if (choice.finish_reason) state.finishReason = choice.finish_reason;
  const delta = choice.delta || choice.message || {};
  if (typeof delta.content === "string") state.content += delta.content;
  if (typeof delta.reasoning_content === "string") state.reasoning += delta.reasoning_content;
  if (Array.isArray(delta.tool_calls)) {
    for (const call of delta.tool_calls) {
      const index = typeof call.index === "number" ? call.index : state.toolCalls.length;
      if (!state.toolCalls[index]) {
        state.toolCalls[index] = { id: call.id || "", type: "function", function: { name: "", arguments: "" } };
      }
      const target = state.toolCalls[index];
      if (call.id) target.id = call.id;
      if (call.function) {
        if (call.function.name) target.function.name += call.function.name;
        if (call.function.arguments) target.function.arguments += call.function.arguments;
      }
    }
  }
}

function handleChat(req, res, body) {
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch (_) {
    return sendJson(res, 400, { error: { message: "invalid JSON body", type: "invalid_request_error" } });
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.messages)) {
    return sendJson(res, 400, { error: { message: "messages is required", type: "invalid_request_error" } });
  }

  const wantsStream = parsed.stream === true;
  const payload = Object.assign({}, parsed, {
    stream: true,
    tools: ensureTools(parsed),
  });
  if (payload.stream_options) delete payload.stream_options;

  upstreamRequest(payload).then(({ res: upstream }) => {
    if (upstream.statusCode !== 200) {
      let raw = "";
      upstream.setEncoding("utf8");
      upstream.on("data", (d) => { raw += d; });
      upstream.on("end", () => {
        let message = raw.slice(0, 600) || "upstream error";
        let type = "upstream_error";
        try {
          const parsedError = JSON.parse(raw);
          if (parsedError.error) {
            message = parsedError.error.message || message;
            type = parsedError.error.type || type;
          }
        } catch (_) {}
        log("upstream " + upstream.statusCode + " " + type + ": " + message);
        sendJson(res, upstream.statusCode, { error: { message, type, code: upstream.statusCode } });
      });
      upstream.on("error", () => sendJson(res, 502, { error: { message: "upstream stream failed", type: "upstream_error" } }));
      return;
    }

    if (wantsStream) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      upstream.setEncoding("utf8");
      upstream.on("data", (chunk) => res.write(chunk));
      upstream.on("end", () => res.end());
      upstream.on("error", () => res.end());
      res.on("close", () => upstream.destroy());
      return;
    }

    const state = {
      id: "",
      model: parsed.model || "",
      content: "",
      reasoning: "",
      finishReason: "stop",
      usage: null,
      toolCalls: [],
    };
    let buffer = "";
    upstream.setEncoding("utf8");
    upstream.on("data", (chunk) => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        parseSseLine(line, state);
      }
    });
    upstream.on("end", () => {
      if (buffer) parseSseLine(buffer, state);
      const calls = state.toolCalls.filter(Boolean);
      const message = { role: "assistant", content: state.content };
      if (state.reasoning) message.reasoning_content = state.reasoning;
      if (calls.length) {
        message.tool_calls = calls.map((call, index) => ({
          id: call.id || "call_" + index + "_" + randomFrom(HEX, 8),
          type: "function",
          function: call.function,
        }));
      }
      const usage = state.usage || {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      };
      sendJson(res, 200, {
        id: state.id || "chatcmpl-" + randomFrom(HEX, 24),
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: state.model || parsed.model,
        choices: [{ index: 0, message, finish_reason: calls.length ? "tool_calls" : state.finishReason }],
        usage,
      });
    });
    upstream.on("error", () => sendJson(res, 502, { error: { message: "upstream stream failed", type: "upstream_error" } }));
    res.on("close", () => upstream.destroy());
  }).catch((error) => {
    log("request failed: " + error.message);
    sendJson(res, 502, { error: { message: error.message, type: "upstream_error" } });
  });
}

const server = http.createServer((req, res) => {
  const url = (req.url || "").split("?")[0];

  if (req.method === "GET" && (url === "/health" || url === "/v1/health")) {
    return sendJson(res, 200, { status: "ok", upstream: "opencode.ai/zen", session: SESSION_ID });
  }

  if (!authorized(req)) {
    return sendJson(res, 401, { error: { message: "invalid api key", type: "authentication_error" } });
  }

  if (req.method === "GET" && (url === "/v1/models" || url === "/models")) {
    return sendJson(res, 200, {
      object: "list",
      data: MODELS.map(([id, context]) => ({
        id,
        object: "model",
        created: 1750000000,
        owned_by: "opencode",
        context_length: context,
      })),
    });
  }

  if (req.method === "POST" && (url === "/v1/chat/completions" || url === "/chat/completions")) {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        req.destroy();
        return sendJson(res, 413, { error: { message: "payload too large", type: "invalid_request_error" } });
      }
      chunks.push(chunk);
    });
    req.on("end", () => handleChat(req, res, Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => sendJson(res, 400, { error: { message: "request aborted", type: "invalid_request_error" } }));
    return;
  }

  sendJson(res, 404, { error: { message: "not found", type: "invalid_request_error" } });
});

server.listen(PORT, HOST, () => {
  log("zen-adapter listening on http://" + HOST + ":" + PORT + "/v1 (" + MODELS.length + " models, session " + SESSION_ID + ")");
});

process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
