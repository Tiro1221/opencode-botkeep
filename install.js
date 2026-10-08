// Descarga el binario de opencode con Node puro (el container no trae curl).
const fs = require("fs");
const https = require("https");
const path = require("path");
const tar = require("tar");

const URL = "https://github.com/anomalyco/opencode/releases/download/v1.18.35/opencode-linux-x64.tar.gz";
const DIR = path.join(__dirname, ".bin");
const BIN = path.join(DIR, "opencode");
const TMP = "/tmp/oc.tgz";

if (fs.existsSync(BIN)) {
  console.log("opencode ya descargado.");
  process.exit(0);
}
fs.mkdirSync(DIR, { recursive: true });

function get(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "opencode-botkeep" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        if (redirects > 5) return reject(new Error("demasiados redirects"));
        res.resume();
        return resolve(get(res.headers.location, redirects + 1));
      }
      if (res.statusCode !== 200) return reject(new Error("HTTP " + res.statusCode));
      const file = fs.createWriteStream(TMP);
      res.pipe(file);
      file.on("finish", () => file.close(resolve));
      file.on("error", reject);
    }).on("error", reject);
  });
}

get(URL)
  .then(() => tar.x({ file: TMP, C: DIR }))
  .then(() => {
    fs.chmodSync(BIN, 0o755);
    console.log("opencode descargado en .bin/opencode");
  })
  .catch((e) => {
    console.error("Fallo descarga:", e.message);
    process.exit(1);
  });
