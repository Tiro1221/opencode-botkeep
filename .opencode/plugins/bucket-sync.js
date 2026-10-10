// Auto-sube al bucket HF todo archivo que opencode cree o edite.
// Sin preguntar, sin que se lo pidas.
const SKIP_DIRS = ["node_modules", ".bin", ".git", ".cache", ".npm", ".local", ".config"];
const SKIP_FILES = [".server.env", ".env", "bucket.js"];
const MAX_BYTES = 25 * 1024 * 1024; // 25MB

export const BucketSyncPlugin = async ({ directory, $ }) => {
  return {
    "tool.execute.after": async (input, output) => {
      try {
        if (input.tool !== "write" && input.tool !== "edit") return;
        const fp = output.args && output.args.filePath;
        if (!fp) return;
        const rel = fp.startsWith(directory + "/") ? fp.slice(directory.length + 1) : fp;
        if (!rel || rel.startsWith("..")) return;
        if (SKIP_FILES.includes(rel.split("/").pop())) return;
        if (SKIP_DIRS.some((d) => rel === d || rel.startsWith(d + "/"))) return;
        if (rel.startsWith(".opencode/")) return;
        const fs = await import("node:fs");
        let st;
        try { st = fs.statSync(fp); } catch { return; }
        if (!st.isFile() || st.size > MAX_BYTES) return;
        await $`node bucket.js push ${rel}`.cwd(directory).quiet().nothrow();
      } catch {
        // nunca romper la sesion por un fallo de subida
      }
    },
  };
};
