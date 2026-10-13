---
name: descoberta
description: Entrevista de descoberta do narnia-jobs: pergunta só o que falta no perfil e manda as respostas para a revisão. Uso: /narnia-jobs:descoberta.
---

1. `profile_get_card` e `fact_gaps` para saber o que a extração não preencheu (datas, métricas, resumo, nível, pesquisa pendente). Se `fact_unverified` trouxer fatos ainda não conferidos, confira-os com o usuário no caminho.
2. Faça uma pergunta por vez, curta e concreta, começando pela lacuna mais importante para o cargo-alvo. Não pergunte o que já está no perfil.
3. Junte as respostas num relato em primeira pessoa. Quando ele tiver pelo menos 200 caracteres, ou o usuário quiser parar, chame `ingest_text` com o relato: as propostas vão para a revisão, nada é gravado direto.
4. Se a ingestão pedir confirmação, informe a estimativa e só chame `ingest_confirm` depois que o usuário concordar. Não acompanhe com `ingest_status`: encerre dizendo que a ingestão está rodando e que o progresso e a revisão aparecem no painel ao lado; o sistema avisa quando terminar.
