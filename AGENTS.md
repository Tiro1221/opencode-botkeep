# AGENTS.md — reglas del server (Botkeep Founder: 2GB RAM / 1.5 vCPU / 2GB disco)

1. El disco es pequeño (2GB). No clones repos gigantes, no guardes `node_modules` innecesarios, no dupliques datos.
2. Todo lo que crees y valga la pena guardar va al bucket HF `Tiro1221/app-data` con:
   - `node bucket.js ls [prefijo]` ver qué hay
   - `node bucket.js push <ruta> [prefijo]` subir archivo o carpeta
   - `node bucket.js pull [prefijo] [dir]` bajar
   En local solo temporal (`./data`, `./tmp`). El arranque ya verifica el bucket solo.
3. `git push` a GitHub siempre que termines una tarea. El server es efímero.
4. Responde en español, corto y directo. Resume archivos tocados al final.
5. Nunca ejecutes nada destructivo (`rm -rf`, `push --force`) sin pedir confirmación.
6. Secretos solo por variables de entorno (`.server.env`, fuera de git). Nunca los escribas en archivos del repo ni en el chat.
