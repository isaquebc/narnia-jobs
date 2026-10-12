---
name: clarificar
description: Clarifica uma ingestão do narnia-jobs com perguntas objetivas. Uso: /narnia-jobs:clarificar <execução>.
---

1. `ingest_status` da execução e `file_get_digest` do arquivo ou repositório de origem. A execução precisa estar pronta para revisão; se não estiver, diga isso ao usuário e pare.
2. Faça uma pergunta objetiva por vez sobre lacunas e ambiguidades (datas, métricas, nomes de empresa, responsabilidade).
3. A cada resposta, `ingest_propose` com a correção na mesma execução; nada é gravado direto, tudo vai para a revisão.
4. Encerre com um resumo do que foi proposto e o link da revisão.
