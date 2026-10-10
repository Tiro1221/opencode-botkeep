// bucket.js — sync con Hugging Face Storage Bucket (API S3 compatible).
// Uso: node bucket.js ls [prefijo] | push <ruta-local> [prefijo] | pull [prefijo] [dir-local]
// Credenciales por entorno: HF_NAMESPACE, HF_BUCKET, HF_S3_KEY, HF_S3_SECRET
const fs = require("fs");
const path = require("path");
const { S3Client, ListObjectsV2Command, PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");

const NS = process.env.HF_NAMESPACE;
const BUCKET = process.env.HF_BUCKET || "app-data";
if (!NS || !process.env.HF_S3_KEY || !process.env.HF_S3_SECRET) {
  console.error("Faltan HF_NAMESPACE / HF_S3_KEY / HF_S3_SECRET en entorno.");
  process.exit(1);
}
const s3 = new S3Client({
  endpoint: `https://s3.hf.co/${NS}`,
  region: "us-east-1",
  forcePathStyle: true,
  credentials: { accessKeyId: process.env.HF_S3_KEY, secretAccessKey: process.env.HF_S3_SECRET },
});

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules" && e.name !== ".bin" && !e.name.startsWith(".")) walk(p, out); }
    else out.push(p);
  }
  return out;
}
async function ls(prefix = "") {
  let token;
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken: token }));
    for (const o of r.Contents || []) console.log(o.Size, o.Key);
    token = r.IsTruncated ? r.NextContinuationToken : null;
  } while (token);
}
async function push(local, prefix = "") {
  const abs = path.resolve(local);
  const isDir = fs.statSync(abs).isDirectory();
  const files = isDir ? walk(abs) : [abs];
  const base = prefix ? (isDir ? abs : path.dirname(abs)) : process.cwd();
  for (const f of files) {
    const rel = path.relative(base, f).replace(/\\/g, "/");
    const key = (prefix ? prefix.replace(/\/$/, "") + "/" : "") + rel;
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: fs.createReadStream(f) }));
    console.log("subido:", key);
  }
}
async function pull(prefix = "", dest = "./data") {
  fs.mkdirSync(dest, { recursive: true });
  let token;
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken: token }));
    for (const o of r.Contents || []) {
      const out = path.join(dest, o.Key);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: o.Key }));
      await new Promise((res2, rej) => {
        const w = fs.createWriteStream(out);
        res.Body.pipe(w).on("finish", res2).on("error", rej);
      });
      console.log("bajado:", o.Key);
    }
    token = r.IsTruncated ? r.NextContinuationToken : null;
  } while (token);
}
(async () => {
  const [cmd, a, b] = process.argv.slice(2);
  try {
    if (cmd === "ls") await ls(a || "");
    else if (cmd === "push" && a) await push(a, b || "");
    else if (cmd === "pull") await pull(a || "", b || "./data");
    else { console.log("Uso: node bucket.js ls [prefijo] | push <ruta> [prefijo] | pull [prefijo] [dir]"); process.exit(1); }
  } catch (e) { console.error("ERROR:", e.message); process.exit(1); }
})();
