---
name: gerar-cv
description: Gera o currículo de um perfil ou para uma vaga e a carta de apresentação, em PDF revisado, e devolve o link. Use quando o usuário pedir um currículo, um CV para uma vaga, uma carta de apresentação (cover letter) ou para alterar um deles.
---

Gere o documento pelo narnia-jobs; você não escreve o currículo nem a carta no chat.

1. **Perfil e vaga.** Sem vaga: o CV do perfil (`profile_list` para escolher, se o usuário não disse qual). Com vaga: ache com `posting_search` (ou salve com `posting_create`) e use o perfil recomendado da análise (`analysis_get`) ou o que o usuário escolher.
2. **Gerar.** Chame `cv_generate` com `kind` ("cv" ou "cover_letter"), `profileId`, `postingId` quando houver, `withCoverLetter: true` se ele quiser os dois, `format: "text"` se quiser a carta para colar num formulário, e o pedido dele em `instructions`. Se o status voltar "needs_language_confirmation", explique que o currículo não mostra fluência no idioma da vaga e pergunte se continua; só com o sim chame de novo com `acceptLanguage: true`.
3. **Responder.** Em poucas linhas: o que está sendo gerado, que passa por uma revisão automática (fatos, links, layout e ATS) e o link de cada documento (o caminho devolvido, no endereço do narnia-jobs). O andamento aparece na bandeja do app.
4. **Alterar.** Para mudar um documento pronto: `cv_get` (conteúdo, revisão e versão), mude só o que o usuário pediu, mantendo a origem `factIds` de cada bullet e nada fora dos dados, e mande inteiro com `cv_edit` com a versão lida. Se a revisão reprovou, `cv_get` traz os apontamentos para explicar.
