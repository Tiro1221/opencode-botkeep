# AGENTS.md — reglas del server (Botkeep Founder: 2GB RAM / 1.5 vCPU / 2GB disco)

1. El disco es pequeño (2GB). No clones repos gigantes, no guardes `node_modules` innecesarios, no dupliques datos.
2. Archivos grandes y datos van al bucket de Hugging Face (`hf://buckets/<user>/app-data`), nunca permanentes en local. Para traer algo: `hf buckets cp` o `sync` solo de lo necesario.
3. `git push` a GitHub siempre que termines una tarea. El server es efímero.
4. Responde en español, corto y directo. Resume archivos tocados al final.
5. Nunca ejecutes nada destructivo (`rm -rf`, `push --force`) sin pedir confirmación.
6. Secretos solo por variables de entorno. Nunca los escribas en archivos ni en el chat.
