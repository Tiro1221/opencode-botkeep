# AGENTS.md — reglas del server (Botkeep Founder: 2GB RAM / 1.5 vCPU / 2GB disco)

1. El disco es pequeño (2GB). No clones repos gigantes, no guardes `node_modules` innecesarios, no dupliques datos.
2. Subida automática al bucket HF `Tiro1221/app-data`: el plugin `.opencode/plugins/bucket-sync.js` sube solo cada archivo que crees o edites (menos secretos, node_modules, .bin, .git y +25MB). No hay que pedirlo ni hacerlo a mano. Para ver/descargar: `node bucket.js ls [prefijo]` / `node bucket.js pull [prefijo] [dir]`.
3. `git push` a GitHub siempre que termines una tarea. El server es efímero.
4. Responde en español, corto y directo. Resume archivos tocados al final.
5. Nunca ejecutes nada destructivo (`rm -rf`, `push --force`) sin pedir confirmación.
6. Secretos solo por variables de entorno (`.server.env`, fuera de git). Nunca los escribas en archivos del repo ni en el chat.
