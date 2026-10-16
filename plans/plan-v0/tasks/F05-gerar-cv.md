# F05 · Gerar CV

Entregável 5 do plan-v0. Cobre a feature **#1** de `../02-fluxos-do-usuario.md §F5` e a arquitetura de `../03-arquitetura.md §14`: o agente gera o **conteúdo** do currículo em JSON, o servidor faz o **layout** a partir de templates e entrega PDF com bom padrão visual. É a peça fundamental do sistema (decisão 7 de `../06-decisoes-em-aberto.md`).

Status: **em escopo, replanejada pelo dono em 2026-10-15** (requisitos em §1.1, revisão contra o código em §2.0, decisões novas F05-10 a F05-23 em §5). Nada implementado. Plano reescrito em 2026-10-16 depois da última revisão contra o código (§2 a §7); todas as decisões fechadas. **M1 a M6 entregues (2026-10-16)**; M7 em andamento.

> O texto original (2026-10-07 e 2026-10-11) fica como referência. Onde ele conflita com §1.1, §1.2 e §2.0, valem estas seções.

---

## 1 · Objetivo e resultado esperado

Com o onboarding concluído (F01) e o recrutador funcionando (F04), a pessoa consegue:

1. abrir "Gerar CV", escolher perfil, idioma, tamanho (1 ou 2 páginas), template (3 padrão ou um enviado por ela) e, opcionalmente, uma vaga/candidatura;
2. ver a estimativa de tokens, disparar a geração e acompanhá-la como job em segundo plano;
3. receber uma prévia renderizada do PDF fiel ao template, editar o conteúdo inline (texto dos bullets, ordem das seções, o que incluir) e re-renderizar sem gastar tokens;
4. ver quais fatos **não verificados** entraram no documento e resolver antes de exportar;
5. exportar o PDF (sem DOCX, F05-14), salvar como versão ligada ao perfil (e à candidatura, se houver) e reabrir qualquer versão depois;
6. subir um template próprio em `.zip`, vê-lo validado e pré-visualizado, e usá-lo como qualquer template padrão;
7. no modo B (terminal), pedir `/narnia-jobs:gerar-cv` e receber o link da UI web com a prévia pronta.

### 1.1 · Requisitos do dono (2026-10-15)
| # | Requisito |
|---|-----------|
| R1 | Um currículo **por perfil**. A pessoa pode regerar pelo recrutador (no chat) ou por um botão. |
| R2 | Um currículo **para a vaga**, gerado depois da análise (na conversa e no cartão da análise) ou na página da vaga. |
| R3 | O CV do perfil fica ligado ao perfil (link para o perfil). |
| R4 | O CV da vaga fica salvo ligado à vaga. |
| R5 | Na página do perfil, a pessoa vê o currículo daquele perfil. |
| R6 | Todo currículo tem um botão "Atualizar" e mostra a data da última versão gerada. |
| R7 | A entrega é em **PDF**, e um **agente de revisão** confere o PDF gerado. |

### 1.2 · Efeito no plano anterior
- **Entrada:** sai a tela "Gerar CV" com formulário de parâmetros como ponto de partida. A geração nasce do perfil (aba nova na página do perfil), da vaga (página da vaga e cartão da análise) e do recrutador (tool no chat).
- **Ligação com a vaga:** o CV da vaga liga em `posting` (F06), não em candidatura. A F07 vai ligar candidatura a vaga e CV depois (F06-7: salvar a vaga não é se candidatar).
- **Botão no chat:** o "Criar CV para esta vaga" já existe desabilitado no chat (`PostingLinks`) e na página da vaga; passa a funcionar, e o `ui.suggest_action` (F04-6) continua no escopo para as sugestões do recrutador.
- **Revisão:** entra um agente revisor do PDF, que não existia no plano (F05-13).
- **Escopo do plano anterior (F05-14, dono):** tudo continua (três templates, templates do usuário, edição inline, comparar versões, `ui.suggest_action`), **menos o DOCX**: a entrega é só PDF.

### Dentro do escopo
- Schema de dados do CV em `packages/shared/cv-schema` (zod → JSON Schema) usado por agente, templates e validador de templates.
- Skill `plugin/skills/gerar-cv` + tools `document.*` no servidor MCP (F04).
- Motor de renderização (no core, usado pelo worker; §2.6): 3 templates padrão como componentes React → HTML estático; templates do usuário em Handlebars; PDF pelo serviço `browser` (§2.6); PNG de prévia. Sem DOCX (F05-14).
- Upload, validação, sandbox e gestão de templates do usuário.
- Versionamento (`document`, `document_version`), edição inline com re-render, exportação.
- Job `cv.generate` (modelo) e job `cv.render` (sem modelo), ambos na bandeja de atividades.
- Página L5 de `../05-layouts.md`.
- **Dois modos de geração (requisito do dono, 2026-10-11):** **sem vaga alvo** (CV do perfil, destacando pela relevância da F02) e **com vaga alvo** (lê a vaga/`JobAnalysis` da F06 e destaca o que ela pede: palavras-chave, conquistas aderentes, ordem das experiências); disponível pela tela e pelo chat (F04).
- **Todo arquivo gerado é salvo** (`document_version` com PDF e prévia; nada é descartável); o CV da vaga liga na vaga (`posting`); a F07 liga candidatura, vaga e CV depois.
- **Botões de ação no chat (F04-6, movido da F04):** tool `ui.suggest_action({ action, label, params })` validada pelo servidor (ação existe, parâmetros no schema, ids do usuário) → botão na mensagem do chat que abre a feature já preenchida; no terminal (modo B) a tool devolve um link. Primeira ação: "Gerar CV para esta vaga".

### Fora do escopo (e para onde vai)
- Análise da vaga e fit (a vaga aqui é só contexto para o conteúdo) → F06.
- Carta de apresentação, mensagem a recrutador, otimização de LinkedIn (reusam o motor de documentos) → F09.
- Template `.docx` com placeholders (`docxtemplater`) → fase 7 do plano.
- Edição livre dos fatos do usuário (a edição inline aqui altera só o conteúdo do documento, nunca os fatos) → F10.
- Impressão/exportação de outros documentos que não CV.

---

## 2 · Arquitetura deste entregável

> Reescrita em 2026-10-16 depois da última revisão contra o código, pedida pelo dono antes da implementação. Vale este texto; o plano de 2026-10-07 ficou só no histórico do git.

### 2.0 · Revisão contra o código (2026-10-15 e 2026-10-16)
| Plano anterior | Código hoje | Consequência |
|----------------|-------------|--------------|
| Playwright Chromium dentro do container do api (F05-2) | serviço `browser` da F06 (Chromium do Debian, `launchServer`, rede `browser` só com o api, `NARNIA_BROWSER_WS`); `page.pdf` e capturas funcionam por `chromium.connect` | o PDF sai do mesmo serviço; o **worker entra na rede `browser`** (F05-12) e ganha `playwright-core` 1.58.0 (mesma versão da imagem) |
| Assets do template por `file://` | o Chromium roda em outro container, sem volumes | **tudo inline** no HTML (`data:`): fontes, imagens e CSS; `page.setContent` com toda requisição abortada, menos `data:` |
| Fontes embutidas (F05-3) | imagem `browser` só com `fonts-liberation`; não existe pacote Debian do Source Serif 4 | fontes OFL **versionadas no repositório** (`woff2`) e inline em `@font-face`; a imagem não muda |
| Categoria de sessão `feature:cv` | não existe | geração por tarefa estruturada (F05-11); o recrutador usa tools `cv.*` nas categorias de carreira e `job` |
| `application.get` (F07) | a vaga é `posting`, análise em `job_analysis` (`latest`, `analysisStale`) | o CV da vaga lê a vaga, `preAnalysis.keywords` (exigido · desejável) e a análise mais recente |
| Idioma da vaga | `posting` não tem idioma; `detectLanguage(text)` → `pt`/`en` | idioma da vaga = `detectLanguage(jdText)`; desconhecido → idioma do perfil |
| `CvContent.certifications[]` | sem tabela de certificações | fora desta entrega; contato de `user` (nome, e-mail, telefone E.164, cidade, `links`) |
| Link do GitHub | o login do `gh` não é guardado | GitHub de `user.links` (domínio `github.com`); sem ele, o `owner` dos repositórios ingeridos |
| Ênfase por conquista (§2.4b) | backend pronto (`achievement` em `profile_emphasis`); o quadro da web só mostra 5 tipos ("conquistas só em F05") | falta a parte web do quadro |
| Visão no provider | chamada estruturada só aceita texto; leitura de PDF pelo modelo já existe com a tool `Read` (`readDocument`) | revisor Haiku lê os PNGs das páginas e o texto pela tool `Read` numa pasta temporária, como o `readDocument`; PNGs por `renderPdfPages` (pdftoppm, já no worker) |
| Avaliação de prompt com imagem | a ponte da assinatura no Phoenix descarta blocos que não são texto; prompts com tools ficam fora de `evals prompts` | o gerador e a carta entram no `evals prompts --gate`; o revisor tem dataset de texto no Phoenix e avaliação local com imagens (`evals cv-review`, como `evals pdf`), ambas no gate |
| Anti-SSRF no worker | `hostGuard`/`checkHost` vivem em `apps/api/src/postings/fetch.ts` | movem para `packages/core/src/net/guard.ts`; o api reimporta; o checador de links usa a mesma regra a cada redirecionamento |
| Progresso da tarefa | `job` guarda só tipo e percentual; a nota não é gravada | as etapas da geração ficam em `cv_version.status`, com o evento WS `cv.updated` |
| Arquivos e downloads | não há rota binária; auth aceita o cookie `narnia_token` | `<img>` e `<a download>` mesmo-origem funcionam pelo cookie; rotas devolvem `application/pdf` e `image/png` |
| Backup | SQLite + `uploads/` | `backupTemplates` para os templates do usuário; os PDFs são derivados (`content_json` no banco) e não entram |
| e2e | `start.sh e2e` sobe `web api worker redis`; o api tem `NARNIA_BROWSER_WS=` vazio | o e2e passa a subir o `browser` (renderer real, como o plano pedia); o api segue sem busca de vaga por navegador no e2e |
| Menu suspenso na web | não há componente (só o seletor de perfil feito à mão) | `Menu` novo em `components/ui` (teclado, Esc, clique fora) para o "Gerar" |

### 2.1 Pipeline
```
gatilho: botão Gerar/Atualizar · recrutador (cv.generate) · botão no chat
   │  api: perfil + vaga? + tipo (cv | cover_letter) + instruções? ; checa o idioma (F05-16):
   │       idioma pedido fora dos idiomas da pessoa → 409 language_not_covered → "continuar" reenvia com acceptLanguage
   ▼
tarefa cv.generate (worker, fila documents, id por documento: coalesce)
   collecting  user + perfil + fatos com score (ênfases, conquistas, ocultos fora) + [vaga, keywords, análise]
               score de match por experiência e skill (F05-15); seleção ≤ 2 páginas; ocultas → roteiro de entrevista
   generating  Sonnet, JSON CvContent | CoverLetterContent (models.cv_generate)
   validating  schema; todo fact_id existe; termo da vaga sem evidência no texto = erro (F05-20)
   rendering   template → HTML inline → browser (setContent, rede bloqueada) → PDF ; pdftoppm → PNGs
   checking    código: páginas ≤ 2, fonte mínima, espaçamento, quebras, links (existem nos dados + HTTP), ATS ≥ 90
   reviewing   Haiku (models.cv_review), tool Read nos PNGs + texto + CvContent + fatos → apontamentos
   ├─ aprovado ─────────────────────────────────────────► ready
   ├─ reprovado (1ª) → retrying: gera de novo com os apontamentos → rendering…
   └─ reprovado (2ª) ───────────────────────────────────► ready_with_issues (alerta com os apontamentos)
edição inline / cv.edit / troca de template: nova versão a partir de validating (sem o gerador)
```
- O modelo **nunca** escreve HTML; só preenche o JSON. O render é determinístico (mesmo JSON + template = mesmo HTML).
- Checagens por código antes do Haiku: o que é medível (links, páginas, fonte, espaçamento, ATS) não gasta tokens nem depende da leitura do modelo; o resultado entra no prompt do revisor e no alerta.
- Cada clique em "Atualizar" é um ciclo novo (gera → revisa → no máximo uma regeração automática).

### 2.2 Schemas (`packages/shared/src/schemas/cv.ts`)
| Bloco | Campos |
|-------|--------|
| `meta` | `kind` (cv · cover_letter), `locale` (pt-BR · en-US), `paper` (A4 · Letter), `profileId`, `postingId?`, `generatedAt` |
| `header` | nome, título-alvo, cidade/país, e-mail, telefone (formatado para o mercado), `links[]` `{kind: email · whatsapp · linkedin · github · portfolio · other, url, label}` |
| `summary` | 3 a 5 linhas |
| `experiences[]` | empresa, cargo, período, local, `bullets[]` `{text, factIds[]}`, `tech[]`, `matchScore` |
| `skills[]` (grupos com `matchScore` por skill), `projects[]`, `education[]`, `languages[]` | todo item com `factIds[]` |
| `adjacent[]` | `{asked, shown, factIds}`: termo da vaga sem evidência × experiência próxima mostrada com o nome verdadeiro (F05-20) |
| `sectionsOrder[]` | ordem e inclusão |
| `omitted[]` | experiências ocultas `{factId, reason, matchScore}` = **roteiro para aprofundar na entrevista** |
| `provenance` | `factIdsUsed[]`, `unverifiedFactIds[]` |
| `CoverLetterContent` | `header` (o mesmo), `greeting`, `paragraphs[]` `{role: why · covers · gaps · closing, text, factIds[]}`, `signature`; 250 a 400 palavras |
| `CvReview` | `passed`, `issues[]` `{area: links · relevance · hallucination · facts · layout · ats · language · pages, severity, message, where}`, `atsScore`, `checks` (resultado das checagens por código) |

### 2.3 Score de match e seleção (F05-15, F05-20)
- **CV do perfil:** score = relevância da F02 (`scoreFacts`, com as ênfases de experiência e conquista).
- **CV da vaga:** score por experiência = requisitos da análise atendidos com evidência nela (`matches[].evidence`, pelo peso do requisito: exigido > desejável) + keywords da vaga nas tecnologias e conquistas dela (`matchKeywords`) + relevância da F02. Skills: o mesmo, por skill.
- Entram as experiências exigidas pela vaga, na ordem do score, até caber em 2 páginas; em carreira longa, as de score baixo vão para `omitted[]` com o motivo. Ocultas pela pessoa (ênfase) nunca entram, nem no roteiro.
- O score aparece na tela do CV (por experiência e skill), não no PDF.

### 2.4 Links (F05-19)
- Cabeçalho: e-mail (`mailto:`), WhatsApp (`https://wa.me/<E.164 só dígitos>`), LinkedIn e GitHub (reconhecidos pelo domínio em `user.links`; GitHub cai para o `owner` dos repositórios ingeridos), portfólio (link com rótulo de portfólio ou o primeiro link restante).
- Link ausente não entra; a tela avisa qual falta, com atalho para cadastrar.
- Checagem (código): o link do PDF (anotações do PDF por `unpdf`) bate com os dados; `mailto:` com e-mail válido; WhatsApp com telefone válido (`libphonenumber-js`); http(s) responde (HEAD, e GET se o HEAD for recusado, timeout de 8 s, anti-SSRF a cada redirecionamento). Regra de F05-23: domínio que resolve e resposta diferente de 404 = funciona (inclui 999/403 de sites que bloqueiam robôs, como o LinkedIn).

### 2.5 ATS (F05-20)
- Leitura (30%): texto extraído do PDF na ordem, títulos de seção reconhecíveis no idioma, contato encontrado, nenhum texto só em imagem, datas num formato padrão.
- Termos (70%): keywords da vaga (`preAnalysis.keywords`, exigido pesa 2, desejável 1) **com evidência nos fatos**, presentes no texto do PDF (normalização do dicionário da F06). No CV do perfil, os termos são as skills destacadas e os termos do cargo-alvo (`targetTerms` da F02).
- Nota < 90 reprova; lacunas reais não contam e aparecem no aviso "a vaga pede X, Y, Z sem registro nos seus dados".

### 2.6 Render
| Peça | Decisão |
|------|---------|
| Onde | `packages/core/src/documents/` (o worker usa o core): templates, HTML, checagens; cliente do navegador em `packages/core/src/documents/browser.ts` (`playwright-core`) |
| Templates padrão | **Clássico, Moderno, Compacto** como funções que devolvem HTML por template literal com escape automático (`html`…``; sem React: JSX no core exigiria configurar vitest e o tsx do api e do worker, e o resultado é o mesmo HTML estático); rótulos por locale; uma coluna, texto real (bom para ATS) |
| Templates do usuário | `.zip` com `template.html` (Handlebars, helpers `date`, `join`, `t`), `style.css`, `manifest.json`, `preview.png`, fontes `woff2` e imagens; ≤ 5 MB; validados por `sanitize-html` (sem `<script>`, `on*`, `@import`, `url()` externo), zip-slip bloqueado; assets inline |
| Navegador | contexto novo por render, `javaScriptEnabled: false` para templates do usuário, toda requisição abortada menos `data:`, WebSocket fechado |
| PDF | `page.pdf({ format: paper, printBackground: true, preferCSSPageSize: true })`, timeout 30 s |
| Prévia | PNG por página (`pdftoppm`, 110 dpi) |
| Arquivos | `<data>/documents/<documentId>/v<n>/{cv.pdf, render.html, pages/<p>.png}`; templates em `<data>/templates/<id>/` |

### 2.7 Tarefas e fila
| Tarefa | Modelo | Etapas (`cv_version.status`) |
|--------|--------|-------------------------------|
| `cv.generate` | Sonnet + Haiku | `collecting` → `generating` → `validating` → `rendering` → `checking` → `reviewing` → (`retrying`) → `ready` · `ready_with_issues` · `error` |
| `cv.render` | Haiku (revisão) | edição inline, `cv.edit` ou troca de template: `validating` → `rendering` → `checking` → `reviewing` → `ready` · `ready_with_issues` |
| `template.validate` | — | `unzip` → `sanitize` → `render_sample` → `valid` · `invalid` |
- Fila `extract` (a mesma das tarefas da vaga, concorrência 2; o serviço `browser` abre um contexto por documento), id por documento (`taskJobId`) para coalescer. Uma fila própria mexeria nas filas falsas de dezenas de testes da ingestão sem ganho real (decisão de implementação, 2026-10-16).
- Infraestrutura de jobs caros (§2.5 antigo, mantida): coalescência por chave; conflito tipado (edição sobre versão que não é a atual → 409 e oferta de refazer); página **`/processos`** (ativos, pendentes e recentes, cancelar e repetir; o indicador da bandeja mostra a fila); **concorrência por fila em Configurações**, aplicada em tempo de execução.
- Notificações: `cv.ready` (informativa) e `cv.review_failed` (aviso, com os apontamentos); bandeja com a seção "Currículos".

### 2.8 Tools MCP e agentes
| Tool | Função |
|------|--------|
| `cv.generate({kind, profileId, postingId?, instructions?, acceptLanguage?, withCoverLetter?})` | dispara a tarefa (mesmo caminho do botão); devolve `documentId`, versão e link |
| `cv.get({documentId \| profileId+postingId?, kind})` | conteúdo da versão atual, status, revisão, validade |
| `cv.edit({documentId, baseVersion, content})` | o recrutador altera o CV pronto: nova versão por `cv.render` (sem o gerador); mesma validação de `factIds` |
| `cv.list({profileId?, postingId?})` | documentos e versões |
| `ui.suggest_action({action, label, params})` | botão validado na mensagem do chat (ação existe, parâmetros no schema, ids existem); no modo B devolve link. Ações: `cv.generate`, `cover_letter.generate`, `cv.open` |
- Persona `recrutador.md` (seção Vagas e regra 7) e skill nova `plugin/skills/gerar-cv` (modo B: `/narnia-jobs:gerar-cv` → link). Mudam prompts: gate do chat.
- Prompts estruturados novos: `narnia-cv-generate`, `narnia-cover-letter-generate` (Sonnet) e `narnia-cv-review` (Haiku), com mock, dataset, avaliadores (schema, `no-invented-years`, `supporting-ids`, termos sem evidência) e juiz.

### 2.9 Ênfase por conquista (F02-3, obrigatória em F05)
No quadro de ênfases do perfil, cada experiência expande as conquistas com destacar · normal · ocultar e ordem; o gerador recebe só as não ocultas, destacadas primeiro; o `CvContent` guarda o id da conquista de cada bullet.

### 2.10 API
| Método e rota | Função |
|---------------|--------|
| `GET /api/documents?profileId=&postingId=&kind=` (as rotas usam `/api/documents`, CV e carta) | documentos com a última versão, status e validade |
| `POST /api/cvs` | gera (perfil, vaga?, tipo, instruções?, `acceptLanguage?`, `withCoverLetter?`, `templateId?`, `format` da carta) → 202 com o documento; 409 `language_not_covered` |
| `POST /api/cvs/:id/regenerate` | "Atualizar" (instruções?) |
| `GET /api/cvs/:id` · `GET /api/cvs/:id/versions/:n` | documento, versões, revisão, roteiro, scores |
| `PUT /api/cvs/:id/content` | edição inline com `baseVersion` (409 se não é a atual) |
| `PATCH /api/cvs/:id` | template, papel, formato da carta → só re-render |
| `GET /api/cvs/:id/versions/:n/pdf` · `/pages/:p.png` · `/text` | PDF, prévia e texto da carta |
| `GET /api/cvs/:id/diff?from=&to=` | diff de texto entre versões |
| `DELETE /api/cvs/:id` | apaga o documento e os arquivos |
| `POST /api/cv-templates` (zip) · `GET` · `DELETE /:id` · `GET /:id/preview.png` | templates do usuário |
| `GET /api/processes` · `POST /api/processes/:id/cancel` · `/retry` · `PUT /api/settings/workers` | página `/processos` e concorrência |

---

## 3 · Dados deste entregável (migração `0015_documents.sql`)
| Tabela | Colunas principais |
|--------|--------------------|
| `document` | `id`, `kind` (cv · cover_letter), `profile_id` (cascade), `posting_id?` (cascade), `template_id`, `paper`, `locale`, `format` (pdf · text, só carta), `current_version`, `created_at`, `updated_at`; únicos parciais: um por (kind, perfil) sem vaga e um por (kind, perfil, vaga) |
| `document_version` | `id`, `document_id`, `version`, `source` (agent · edit · recruiter · template), `instructions?`, `template_id`, `locale`, `content_json`, `status` (§2.7), `attempts`, `review_json`, `ats_score?`, `pages_rendered?`, `pdf_path?`, `text?` (carta em texto), `facts_version`, `posting_updated_at?`, `profile_updated_at`, `job_id?`, `usage_json?`, `error?`, `created_at` |
| `cv_template` | `id`, `name`, `origin` (builtin · user), `engine` (react · handlebars), `path?`, `manifest_json`, `preview_path?`, `status` (validating · valid · invalid), `validation_errors_json?`, `created_at` |
| `settings` | `models.cv_generate` (sonnet), `models.cv_review` (haiku), `workers.concurrency.<fila>` |

Regras: `content_json` é a verdade e o PDF é derivado (refeito por `cv.render`); apagar um template do usuário não apaga versões (guardam `render.html`); validade = `facts_version`, `profile.updated_at` (inclui ênfases) e `posting.content_updated_at` posteriores à versão.

---

## 4 · Layouts deste entregável
| Tela | Componentes | Estados |
|------|-------------|---------|
| Perfil › **Currículo** (aba nova) | `CvPanel` do CV do perfil; lista dos CVs e cartas de vaga feitos com o perfil (link para a vaga) | sem CV ("Gerar") · gerando (etapa) · pronto · com alerta · desatualizado · erro |
| Página da vaga | botão **"Gerar"** com menu (CV · Cover letter); diálogo com perfil (recomendado por padrão), "gerar carta junto", formato da carta, instruções; seção "Currículos e cartas" | sem documentos · idioma não coberto (continuar · parar) · gerando · pronto |
| `CvPanel` | prévia PNG por página, "Baixar PDF", **"Atualizar"** (instruções opcionais), "gerado em <data no fuso>", status, **alerta da revisão** com os apontamentos, selo "desatualizado", nota ATS, links faltando, banner de não verificados, score por experiência e skill, **roteiro de entrevista** (ocultas), experiências adjacentes, versões (lista, abrir, comparar), template e papel | os de §2.7 |
| Carta | texto com "Copiar" ou prévia do PDF, mesmos controles | idem |
| Edição inline | `ContentEditor`: seções reordenáveis, incluir · excluir, bullets editáveis mantendo `factIds`, "Re-renderizar" | editando · re-render · conflito |
| Chat | "Criar CV para esta vaga" passa a funcionar; botões de `ui.suggest_action` e de `cv_*` (link do documento) | — |
| Bandeja | seção "Currículos": gerando (etapa), pronto, não passou na revisão | — |
| Configurações | Modelos (`cv_generate`, `cv_review`), Templates (upload, válido · inválido, prévia, excluir), Concorrência dos processos | — |
| `/processos` | lista de jobs com cancelar e repetir | vazio · ativos · erro |
| Perfil › Ênfases | conquistas por experiência | — |

---

## 5 · Decisões em aberto deste entregável

| # | Decisão | Opções | Padrão proposto |
|---|---------|--------|-----------------|
| F05-1 | Motor de template do usuário | Handlebars · EJS · Liquid | **Padrão adotado (2026-10-16): Handlebars** (sem JS arbitrário; helpers `date`, `join`, `t`) |
| F05-2 | Chromium | — | **Fechada pelo código:** serviço `browser` da F06, com o worker na rede (F05-12) |
| F05-3 | Fontes | — | **Padrão adotado (2026-10-16): Inter, Source Serif 4 e IBM Plex Mono (OFL) versionadas e inline em `@font-face`**; `woff2` do zip do usuário também inline (§2.0: o Chromium não acessa arquivos do worker) |
| F05-4 | Sandbox dos templates do usuário | — | **Padrão adotado (2026-10-16): `sanitize-html` com allowlist, JS desligado e toda rede bloqueada** (só `data:`) |
| F05-5 | Papel | — | **Padrão adotado (2026-10-16): pelo mercado do perfil** (BR/EU → A4, US → Letter), com troca na tela |
| F05-6 | Fidelidade do DOCX | — | **Sai (F05-14, dono, 2026-10-15): sem DOCX; a entrega é só PDF.** |
| F05-7 | Modelo da geração | Sonnet · Haiku | **Fechada com F05-13 (dono, 2026-10-16): Sonnet gera, Haiku revisa** |
| F05-8 | Passou do tamanho | — | **Superada por F05-13 e F05-15:** a checagem de páginas reprova acima de 2 e a regeração automática encurta |
| F05-9 | Comparar versões | — | **Padrão adotado (2026-10-16): diff de texto do conteúdo** |

---

### 5.1 · Decisões do replanejamento (2026-10-15)
F05-2 fechada pelo código; F05-6 sai com F05-14; F05-7 fecha com F05-13; F05-1, F05-3, F05-4, F05-5 e F05-9 com padrão adotado na revisão de 2026-10-16; F05-8 superada.

| # | Decisão | Opções | Padrão proposto |
|---|---------|--------|-----------------|
| F05-10 | Histórico | sobrescrever o CV · guardar versões e mostrar a última | **Fechada por F05-14 (2026-10-15): guardar versões**; a tela mostra a última com a data, lista as anteriores e compara (F05-9) |
| F05-11 | Como o conteúdo é gerado | tarefa estruturada no worker (JSON `CvContent`, sem conversa) · conversa com o recrutador (sessão `job`, como a análise) | **Fechada (dono, 2026-10-15): a geração é a mesma pelo botão e pelo chat** (tarefa estruturada `cv.generate` no worker, com instruções livres opcionais). A diferença do chat: o recrutador já tem todos os dados da pessoa e da vaga e pode **alterar o CV depois de pronto** a pedido. Tools: `cv.generate` (dispara, com instruções), `cv.get` (lê o conteúdo e o estado da versão atual) e `cv.edit` (aplica alterações no `CvContent` → nova versão, re-render e revisão, sem regerar tudo). Edição pelo recrutador obedece à mesma regra do gerador: só fatos existentes, `fact_ids` em cada bullet |
| F05-12 | Onde o PDF é montado | worker entra na rede `browser` · o api monta (o worker chama o api) | **Padrão técnico adotado (2026-10-15): o worker entra na rede `browser`** (geração e re-render já são tarefas do worker); o api continua lá para a busca de vagas |
| F05-13 | Agente de revisão | o que confere · modelo · o que fazer quando reprova | **Fechada (dono, 2026-10-15 e 2026-10-16).** Sonnet gera (`models.cv_generate`) e Haiku revisa (`models.cv_review`). A revisão confere: (1) **links**: todo link clicável do PDF existe nos dados e responde (checagem HTTP no servidor, com o anti-SSRF da F06); (2) **relevância das experiências**: as do PDF e as ocultas batem com o score de match (F05-15); (3) **alucinação e fatos**: nada inventado nem distorcido (empresa, cargo, datas, números das conquistas) contra o `CvContent` e os fatos; (4) **layout**: tamanho de fonte, espaçamento, quebra de linha e quebra de página errada (pela imagem de cada página e pelas posições do texto no PDF); (5) **aderência a ATS de no mínimo 90%** (F05-20). Contato, idioma e páginas também. Reprovou → **uma** regeração automática com os apontamentos. Reprovou de novo → entrega com **alerta visível** ("não passou na revisão" com os apontamentos) e a pessoa tenta de novo **quantas vezes quiser** pelo botão |
| F05-14 | Escopo desta entrega | o plano anterior inteiro · só o que o dono pediu | **Fechada (dono, 2026-10-15): o plano anterior continua inteiro, menos o DOCX.** Ficam os três templates, os templates do usuário em `.zip` com sandbox, a edição inline com re-render, comparar versões e o `ui.suggest_action`, somados aos requisitos R1 a R7. F05-6 sai (sem DOCX) |
| F05-15 | Tamanho e seleção | sempre 1 página · 1 ou 2 por escolha · pelo tamanho da carreira | **Fechada (dono, 2026-10-16): máximo de 2 páginas, independente da experiência** (o conteúdo decide entre 1 e 2). O CV é um relatório breve dos principais destaques e skills. **Seleção por score de match:** cada experiência recebe um score (no CV da vaga, contra os requisitos da vaga e a análise; no CV do perfil, a relevância da F02); entram as exigidas pela vaga, na ordem do score. **Skills destacadas seguem o mesmo padrão** (score por skill). Em carreira longa, as experiências menos relevantes ficam **ocultas** no PDF e viram um **roteiro para aprofundar na entrevista** (lista guardada na versão do CV, com o motivo, visível na tela e disponível para o recrutador e para a F08). O score aparece na tela do CV, não no PDF (interpretação, a confirmar) |
| F05-16 | Idioma | `profile.doc_locale` sempre · idioma da vaga no CV da vaga | **Fechada (dono, 2026-10-16): o CV da vaga sai no idioma da vaga**; o do perfil, no `doc_locale` do perfil. Se o currículo da pessoa não cobre o idioma (o idioma não está entre os idiomas dela, ou o nível declarado é baixo), **a pessoa é acionada antes de gerar** e escolhe continuar ou parar (na tela, um diálogo; no chat, o recrutador pergunta). A tradução muda só o texto do CV, nunca os fatos |
| F05-17 | CV da vaga e perfis | um CV por vaga com o perfil recomendado da análise · um por vaga e perfil | **Fechada (dono, 2026-10-16): um CV (e uma carta) por vaga e perfil.** O "Gerar" usa o perfil recomendado da análise mais recente (sem análise, o perfil ativo) e deixa trocar antes de gerar. A página da vaga lista os CVs e cartas da vaga (perfil, data da última versão, "Atualizar", alerta da revisão); a aba do currículo no perfil mostra o CV do perfil e lista os CVs de vaga feitos com ele, com link para a vaga |
| F05-18 | Validade | regerar sozinho quando os fatos mudam · marcar "desatualizado" | **Fechada (dono, 2026-10-16, junto com F05-22): marcar "desatualizado"** quando os fatos, o perfil ou a vaga mudam depois da versão, sem regerar sozinho (como F06-10) |
| F05-19 | Links no CV | — | **Requisito do dono (2026-10-16):** o cabeçalho traz links clicáveis no PDF para **portfólio, GitHub e LinkedIn** (de `user.links_json`, reconhecidos pelo domínio ou rótulo; o GitHub também da conta ligada na F03), **e-mail** (`mailto:`) e **WhatsApp** (`https://wa.me/<telefone E.164 só dígitos>`). Link que não existe nos dados não entra; a tela do CV avisa qual falta, com atalho para cadastrar. O revisor confere que os links do PDF batem com os dados. Templates do usuário recebem os mesmos links como variáveis |
| F05-20 | Aderência a ATS (mínimo 90%, F05-13) | termos da vaga sobre todos os pedidos · só sobre os que têm evidência | **Fechada (dono, 2026-10-16): o CV nunca mente; tudo bate com os dados da pessoa.** Nota = leitura do PDF (30%: texto extraível na ordem, títulos de seção reconhecíveis, contato, sem texto em imagem nem tabela que embaralha, datas padrão) + termos da vaga (70%: exigidos pesam mais), contados **só sobre os termos com evidência** nos dados. Lacunas reais não derrubam a nota e aparecem num aviso separado. **Experiência adjacente vale:** se a vaga pede um termo que a pessoa não tem (ex.: Kubernetes) e ela tem um próximo com evidência (ex.: Docker), o CV destaca o próximo com o nome verdadeiro, sem nunca escrever o termo que falta; o revisor reprova qualquer termo da vaga sem evidência |
| F05-21 | Carta de apresentação / cover letter | — | **Requisito do dono (2026-10-16): opcional.** Pode ser gerada **junto com o CV da vaga** (opção "gerar carta junto") ou **sozinha**. Na página da vaga, o botão "Criar CV" vira um botão **"Gerar"** com menu: **CV** ou **Cover letter**. Fala do que a vaga exige, do que a pessoa cobre (com evidência) e do que não cobre, mostrando abertura para aprender o que falta (contratação com 100% de aderência é rara). Mesma regra do CV: nada inventado, adjacências com o nome verdadeiro. A carta sai da F09 e entra aqui (F09 fica com LinkedIn e mensagem curta a recrutador) |
| F05-22 | Detalhes da carta | — | **Fechada (dono, 2026-10-16).** Dois formatos: **texto livre** (para colar em e-mail ou formulário, com botão copiar) ou **PDF** (mesmo visual e cabeçalho do CV, com os links), à escolha da pessoa. **Idioma sempre o da vaga.** Revisão no mesmo ciclo do CV (Haiku: fatos, invenção, links e, no PDF, layout; uma regeração automática; reprovou de novo → alerta e novas tentativas pelo botão; sem nota de ATS). Versões e validade como o CV. Estrutura proposta e não contestada: 250 a 400 palavras em quatro blocos (por que a vaga; o que cobre com 2 ou 3 destaques; as 2 ou 3 lacunas principais com a adjacência e a abertura para aprender; fechamento). O recrutador gera e altera a carta pelo chat, como o CV |
| F05-23 | Link que bloqueia robôs | reprovar · aviso sem reprovar | **Fechada (dono, 2026-10-16): domínio existe (DNS resolve) e a página não responde 404 = o link funciona.** Vale para os sites que bloqueiam robôs (LinkedIn responde 999/403 mesmo com o perfil existindo): status de bloqueio, ou sem resposta, contam como funcionando quando o domínio existe; DNS que não resolve ou 404 reprovam |

## 6 · O que precisa estar coberto para o F05 funcionar

### 6.0 Marcos
Cada marco fecha com lint, typecheck, testes e e2e verdes na instância `claude`, commit local e aviso ao dono para `promote` (com `make dev-down && make dev` quando mudarem dependências, composes ou imagem). Prompt novo ou alterado passa pelo gate real (F06-14) antes do commit.
1. **M1 · Render sem modelo.** Schemas (`cv.ts`), migração 0015 e repos; guard anti-SSRF no core; template Clássico (React, fontes inline); worker na rede `browser` com `playwright-core`; PDF e PNGs; checagens por código (páginas, fonte, espaçamento, quebras, links, ATS); e2e sobe o `browser`.
2. **M2 · Geração.** Coleta com score de match (experiências, skills, conquistas, ocultas → roteiro), idioma, prompts `narnia-cv-generate` e `narnia-cover-letter-generate`, tarefa `cv.generate` na fila `documents`, mock, dataset, avaliadores, juiz e gate.
3. **M3 · Revisão.** `narnia-cv-review` (Haiku, `Read` nos PNGs), ciclo com uma regeração automática, `ready_with_issues`, notificações `cv.ready`/`cv.review_failed`, avaliação local com imagens e gate.
4. **M4 · API, MCP e chat.** Rotas, tools `cv.*` e `ui.suggest_action`, persona e skill `gerar-cv` (gate do chat), links das tools no chat, modelos por tarefa.
5. **M5 · Web.** Aba Currículo, "Gerar" na vaga, `CvPanel`, carta (texto e PDF), idioma não coberto, bandeja, quadro de conquistas.
6. **M6 · Versões e edição.** Lista e diff de versões, edição inline com re-render, Moderno e Compacto, troca de template e papel.
7. **M7 · Templates do usuário e processos.** Upload `.zip`, validação no worker, sandbox, backup dos templates; `/processos` e concorrência por fila.
8. **M8 · Fechamento.** e2e completos, modo B, README, CLAUDE.md e `../03`–`../05`.

### 6.1 Pré-requisitos
F01 (jobs, bandeja, uso, i18n, tempo), F02 (relevância, ênfases), F03 (fatos), F04 (MCP, chat, plugin), F06 (vaga, análise, keywords, serviço `browser`). F07 não é pré-requisito: o CV da vaga liga na vaga.

### 6.2 Testes unitários (Vitest)
- **shared:** schemas aceitam fixtures pt-BR e en-US; rejeitam bullet sem `factIds`, seção desconhecida, carta fora de 250–400 palavras; JSON Schema estável.
- **core/documents:** HTML por template × locale (snapshot), rótulos traduzidos, telefone por mercado, links (`mailto:`, `wa.me`, LinkedIn, GitHub, portfólio; ausente não entra); ATS (leitura e termos, só com evidência, adjacente não conta como o termo); score de match e seleção (exigidas primeiro, ocultas pela pessoa nunca entram, carreira longa → `omitted`); checagem de termo sem evidência; links (dados × PDF, HTTP com guard, redirect para IP interno barrado); layout (fonte mínima, espaçamento, > 2 páginas); validade.
- **core (Chromium real na instância):** PDF da fixture curta = 1 página, longa = 2; rede bloqueada (template com `url(http…)` não carrega); timeout → `error`.
- **templates do usuário:** helpers permitidos; helper desconhecido falha; `<script>`, `on*`, `@import`, `url(http…)` rejeitados; `url(./img.png)` vira `data:`; sem `manifest.json`, `.js` dentro, > 5 MB e zip-slip → inválido.
- **worker:** `cv.generate` com mock → `ready`; revisão reprova uma vez → regenera com os apontamentos → `ready`; reprova duas → `ready_with_issues` + `cv.review_failed`; edição inline → nova versão sem chamar o gerador; coalescência por documento.
- **providers:** `cvGenerate`, `coverLetterGenerate`, `cvReview` (spec, schema, mock).
- **api:** rotas (404, 409 de `baseVersion`, 409 `language_not_covered`, download com cookie), tools `cv.*` e `ui.suggest_action` (ação ou id inválido recusado), `postingLinks` com `cvId`.
- **web:** aba Currículo (estados), "Gerar" com menu e diálogo (perfil recomendado, carta junto, idioma não coberto), `CvPanel` (data no fuso, alerta, desatualizado, ATS, roteiro, versões), carta (copiar), `ContentEditor`, bandeja, Configurações, `/processos`, quadro de conquistas.

### 6.3 Testes e2e (Playwright, mock + renderer real)
- **f05-01 CV do perfil:** aba Currículo → Gerar → bandeja → prévia → PDF baixa com ≤ 2 páginas → v1 com data.
- **f05-02 CV e carta da vaga:** vaga analisada → Gerar › CV com "carta junto" → os dois na seção da vaga, ligados ao perfil recomendado; carta em texto copia.
- **f05-03 revisão:** mock reprova duas vezes → alerta com os apontamentos → "Atualizar" → mock aprova → alerta some.
- **f05-04 idioma:** vaga em inglês, perfil sem inglês → diálogo → parar não gera; continuar gera em en-US.
- **f05-05 edição inline e versões:** editar bullet e excluir Projetos → v2 sem a seção, v1 intacta, diff mostra a mudança, provider não chamado.
- **f05-06 templates:** trocar para Moderno sem tokens; enviar zip válido → usar; zip com `<script>` → rejeitado com o motivo.
- **f05-07 chat:** recrutador gera o CV da vaga e altera um bullet (`cv.edit`) → botão do documento na mensagem; ação inválida não vira botão.
- **f05-08 desatualizado:** alterar um fato → selo "desatualizado" no CV.
- **f05-09 persistência:** reiniciar api e worker → versões, PDFs e templates continuam.
- **f05-10 processos:** `/processos` lista a geração; cancelar e repetir.

### 6.4 Teste manual com provider real (antes de fechar)
Com os perfis reais do dono e vagas reais (pt-BR e en-US): CV do perfil e da vaga nos 3 templates, carta em texto e PDF; tokens, tempo, nota ATS, apontamentos da revisão, nada inventado, links clicáveis no PDF, PDF impresso legível. O dono aprova visualmente os 3 templates (prévias em §8).

### 6.5 Definição de pronto
- §6.2 e §6.3 verdes; cobertura ≥ 80% em `core/src/documents` e nos schemas.
- Gate verde para os prompts novos e alterados.
- Zero fato inventado e zero termo da vaga sem evidência no teste manual.
- README, CLAUDE.md, `../03`, `../04`, `../05` e o formato de template do usuário documentados.

---

## 7 · Riscos específicos
| Risco | Mitigação |
|-------|-----------|
| CV inventa conquista ou termo da vaga | `factIds` obrigatórios, validação de termos sem evidência, revisor, avaliadores e gate |
| Haiku perde defeito visual | checagens por código para fonte, espaçamento e páginas; avaliação local com PDFs quebrados de propósito; números ao dono antes de mudar o modelo |
| Link "não funciona" por bloqueio a robôs (LinkedIn) | F05-23: domínio que resolve e resposta diferente de 404 bastam |
| Template do usuário malicioso | sanitização, JS desligado, rede toda bloqueada, zip-slip, limite de tamanho |
| Chromium ocupado ou fora do ar | fila `documents` com concorrência 1, timeout, `error` com "tentar de novo" |
| Custo do ciclo (até 2 gerações e 2 revisões) | Haiku na revisão, checagens por código antes, coalescência, uso registrado por chamada |
| Worker na rede do navegador | o navegador continua sem enxergar redis e web; documentado no compose |

## 8 · Registro de execução
| Data | Marco | O que aconteceu |
|------|-------|-----------------|
| 2026-10-11 | — | **Plano incrementado (dono):** modos sem/com vaga alvo, todo arquivo salvo, ligação com a candidatura (F07) e os botões de ação no chat (`ui.suggest_action`), movidos da F04-6; testes e2e correspondentes. |
| 2026-10-11 | — | **Requisitos do dono (registro antecipado):** o agente gera CV **sem vaga alvo** (perfil puro) e/ou **com vaga alvo**, destacando o que a vaga pede; **todo arquivo gerado é salvo** (versões, PDF/DOCX); quando o CV é feito para uma vaga, a vaga e o CV ficam ligados numa candidatura (F07); geração disponível também pelo chat (F04). |
| 2026-10-15 | — | **Replanejamento (dono):** requisitos R1 a R7 (§1.1): CV por perfil e por vaga, ligados ao perfil e à vaga, aba no perfil, botão Atualizar com a data, PDF com agente de revisão. Revisão contra o código (§2.0) e decisões F05-10 a F05-18 (§5.1) em aberto. |
| 2026-10-15 | — | **F05-14 fechada (dono):** nada do plano anterior foi cancelado; só o DOCX sai. F05-10 fecha junto (versões guardadas). |
| 2026-10-15 | — | **F05-11 fechada (dono):** botão e chat geram do mesmo jeito (tarefa `cv.generate`); pelo chat o recrutador, com acesso a todos os dados e à vaga, também altera o CV pronto (`cv.edit`). F05-12 segue o padrão técnico (worker na rede `browser`). |
| 2026-10-15 | — | **F05-13 fechada (dono):** revisor com texto e imagem das páginas; uma regeração automática; se reprovar, alerta visível com os apontamentos e novas tentativas ilimitadas pelo botão. |
| 2026-10-16 | — | **F05-13 ajustada (dono):** Sonnet gera e Haiku revisa, com o mesmo ciclo (uma regeração automática, alerta e novas tentativas pelo botão). |
| 2026-10-16 | — | **F05-15 fechada (dono):** máximo 2 páginas; CV breve com os principais destaques e skills. **F05-19 (requisito novo):** links para portfólio, GitHub, LinkedIn, e-mail e WhatsApp. |
| 2026-10-16 | — | **F05-15 e F05-16 fechadas, F05-13 ampliada (dono):** máximo 2 páginas sempre; experiências e skills por score de match, as menos relevantes ocultas viram roteiro de entrevista; CV no idioma da vaga, com a pessoa acionada quando não cobre o idioma; revisão de links (existem e respondem), relevância, alucinação, fatos, layout e ATS ≥ 90%. |
| 2026-10-16 | — | **F05-20 fechada (dono):** CV nunca mente; ATS ≥ 90% sobre os termos com evidência; experiência adjacente (Docker para Kubernetes) entra com o nome verdadeiro. **F05-21 (requisito novo):** carta de apresentação / cover letter opcional, com o que cobre e o que falta e abertura para aprender; sai da F09. |
| 2026-10-16 | — | **F05-21 e F05-22 fechadas (dono):** carta junto do CV da vaga ou sozinha, pelo botão "Gerar" (CV · Cover letter) na página da vaga; formatos texto livre ou PDF; idioma sempre o da vaga; revisão, versões e validade como o CV. |
| 2026-10-16 | — | **F05-17 e F05-18 fechadas (dono):** um CV e uma carta por vaga e perfil, perfil recomendado por padrão; validade marcada como "desatualizado". Dono pediu uma última revisão contra o código antes da implementação. |
| 2026-10-16 | — | **Última revisão contra o código (dono pediu antes de implementar).** §2 a §7 reescritos: assets e fontes inline (o Chromium não vê arquivos do worker), worker na rede `browser` com `playwright-core`, revisor Haiku pela tool `Read` nos PNGs (o provider não recebe imagem; a ponte do Phoenix descarta imagem → avaliação local), guard anti-SSRF no core, idioma da vaga por `detectLanguage`, GitHub por `user.links`/repositórios, e2e com o `browser`, backup dos templates, menu novo na web, quadro de conquistas. F05-1, 3, 4, 5 e 9 com padrão adotado; F05-8 superada; F05-23 (link que bloqueia robôs) em aberto. Marcos M1 a M8 em §6.0. |
| 2026-10-16 | — | **F05-23 fechada (dono):** domínio que resolve e página sem 404 = link funcionando. Todas as decisões fechadas; início do M1. |
| 2026-10-16 | M1 | **Render sem modelo.** Schemas `cv.ts` (CV, carta de 250–400 palavras, revisão; todo bullet com origem `{kind,id}`; links só http(s), `mailto:` e `wa.me`); migração 0015 (`document`, `document_version`, `cv_template`) e repos; anti-SSRF movido para `core/net/guard.ts`; links do cabeçalho (`buildHeaderLinks`); templates Clássico, Moderno e Compacto por template literal com escape (sem React; §2.6) e fontes OFL `@fontsource` inline; PDF pelo serviço `browser` só com `data:` (worker na rede `browser`; e2e sobe o navegador); `inspectPdf` (posição, fonte e links); checagens de layout (páginas, fonte < 8 pt, margem, sobreposição, linhas apertadas, título sozinho no fim da página, última página quase vazia), links (F05-23) e ATS (F05-20). Chromium real na instância `claude`: CV curto em 1 página sem apontamento nos 3 templates; longo reprova por páginas. Verdes: lint, typecheck, unitários (shared 144, providers 92, core 505, worker 55, api 301, web 266), bats 54, Pester 32, e2e 67 + operação. Intermitente fora da F05: `EPIPE` em `audit-c-plugin` numa rodada (duas seguintes limpas). |
| 2026-10-16 | M2 | **Geração.** `buildCvBrief` (score de match por experiência, skill e projeto: na vaga, keywords com peso exigido 2 / desejável 1 + requisitos atendidos da análise + relevância da F02; no perfil, a relevância; ocultos fora; até 6 experiências, as de score baixo e encerradas há mais de 10 anos numa carreira longa viram roteiro; lacunas = termos da vaga sem evidência), idioma pela vaga (`detectLanguage`) e cobertura do idioma (B2 ou mais; pt-BR para quem mora no Brasil), `profileHash` da validade. O gerador devolve só textos e origens; `assembleCv`/`assembleCoverLetter` preenchem cabeçalho, empresa, cargo, datas e scores e apontam origem inexistente, experiência fora do resumo, tecnologia ou skill que a pessoa não tem (competência traduzida com a origem certa passa) e termo sem evidência. No PDF as experiências ficam em ordem cronológica inversa (o score escolhe quais entram). Prompts `narnia-cv-generate` e `narnia-cover-letter-generate` (Sonnet), mock, datasets, avaliadores `origens_do_resumo` e `sem_termo_sem_evidencia`, juízes; tarefa `cv.generate` (fila `extract`) com uma regeração automática e `ready_with_issues`; evento WS `document.updated`. **Gate real (assinatura):** CV e carta com 100% em todos os avaliadores e no juiz depois de três ajustes (o avaliador contava o termo de `adjacent.asked`; competência sem tradução em CV en-US; carta inventava lacuna quando a vaga não tinha nenhuma); linha de base gravada. **Correções encontradas no caminho:** a ponte do Phoenix guardava a chave antiga depois de um reset e respondia 401 (agora o boot sempre atualiza a chave), e o gate gravava linha de base vazia quando todas as execuções falhavam (agora rodada incompleta reprova e não grava). Verdes: unitários (core 519, worker 60, api 303), Chromium real no worker e e2e 67 + operação. |
| 2026-10-16 | M3 | **Revisão.** Prompt `narnia-cv-review` (Haiku): lê as páginas em PNG pela tool `Read` (a chamada estruturada só aceita texto) e confere alucinação, fatos, relevância, layout visual, idioma e contato, sem repetir o que o código mediu. Na tarefa, roda depois das checagens por código; quando o código já reprovou, só na última tentativa. Avisos `document.ready` (informativo) e `document.review_failed` (alerta, resolvido quando uma versão nova passa). Mock com `cvReviewFailures` para o e2e. Avaliação local `evals cv-review` com imagens reais (CV correto, CV com número inventado e termo de lacuna, CV com o cabeçalho sobreposto de propósito). **Gate real:** o revisor reprovou o CV em inglês com cargos em português, e eu concordei: o gerador passou a traduzir cargo-alvo, cargo, local, curso e grau (`headline`, `title`, `location`, `education`), com o revisor aceitando tradução de mesmo significado; o juiz do gerador passou a saber o que o sistema preenche, e o prompt proíbe enfeite nos bullets. Revisor 100% nos três casos; gerador 100%; linhas de base gravadas. **Números do defeito visual (pedido do dono em F05-13):** o cabeçalho sobreposto passou pelo Haiku em 1 de 3 rodadas e foi pego nas outras 2; a checagem por código (posição do texto no PDF) pega esse defeito sempre (teste com Chromium real). Verdes: unitários (core 522, worker 62), Chromium real (core 50, worker 8), e2e 67 + operação, bats 54, Pester 32. |
| 2026-10-16 | M4 | **API, MCP e chat.** `requestDocument` no core (o mesmo pedido para botão, "Atualizar" e recrutador): idioma pela vaga, cobertura do idioma (`language_not_covered` → a pessoa decide), um documento por (tipo, perfil, vaga), papel pelo mercado, geração em andamento devolvida em vez de duplicada; validade por `documentStale`. Rotas `/api/documents` (gerar com `withCoverLetter`, listar por perfil ou vaga, ver, "Atualizar", baixar PDF com nome legível, páginas em PNG, texto da carta, apagar com os arquivos; apagar a vaga também apaga os arquivos dos documentos dela). Tools `cv.generate` (idioma não coberto volta como pergunta), `cv.get`, `cv.edit` (versão nova por `cv.render`, sem o gerador, com conflito de versão), `cv.list` e `ui.suggest_action` (ids conferidos; só caminho interno vira botão), no escopo de carreira e vaga; links dos documentos e o botão sugerido gravados na mensagem. Persona com a seção "Currículo e carta" e a regra 7 de botões validados; `analisar-vaga` oferece o CV da vaga; skill nova `gerar-cv` (modo B); modelos `cv_generate` e `cv_review` em Configurações. **Gate real do chat** com o caso novo `cv-pelo-chat`: sem regressão (o caso chamou `cv_generate` e não escreveu o CV no chat). Depois do gate só troquei crases por aspas em dois valores da skill `gerar-cv` (a auditoria lia como nome de tool). O disco da máquina encheu durante o e2e; o dono liberou espaço; as imagens órfãs das minhas rodadas passaram a ser apagadas depois de cada e2e. Verdes: unitários (core 532, worker 63, api 309), e2e 67 + operação. |
| 2026-10-16 | M5 | **Web.** Aba Perfil › Currículo (CV do perfil; "Gerar currículo"; documentos de vagas feitos com o perfil, com link; `?gerar=1` abre o Gerar); página da vaga com o menu **"Gerar"** (CV · Cover letter; componente `Menu` novo) e a seção "Currículos e cartas" (um painel por documento, com o perfil; `?gerar=cv|cover_letter&perfil=` e `?doc=`); diálogo de geração (perfil recomendado pela análise, carta junto, formato texto ou PDF, instruções; idioma não coberto pergunta e "Continuar mesmo assim" / "Parar"); painel do documento (etapa enquanto gera, data, ATS, "desatualizado" com o motivo, alerta "não passou na revisão" com os apontamentos, avisos, prévia das páginas, Baixar PDF, Atualizar com instruções, Apagar, carta em texto com Copiar, fatos não verificados, score por experiência e skill, roteiro de entrevista, adjacências, versões); atalho para cadastrar LinkedIn, GitHub e portfólio que faltam (rota `POST /api/user/links`); chat com "Criar CV para esta vaga" funcionando, links dos documentos e o botão sugerido; bandeja com "Currículos e cartas" (pronto e não aprovado, contando no número) e as etapas `cv.generate`/`cv.render`; quadro de ênfases com a aba Conquistas (§2.9). Conferido no navegador da instância `claude` (CV do perfil gerado pelo mock e montado pelo Chromium real); dois ajustes vistos no print: campos de link sem nome visível e "native" sem tradução no PDF. Corrigido também o `EPIPE` intermitente do `audit-c-plugin` (o script terminava sem ler a entrada). Verdes: unitários (core 533, api 311, web 276), e2e 67 + operação (os dois da F06 que esperavam o "Criar CV" desabilitado foram atualizados). |
| 2026-10-16 | M6 | **Versões e edição.** `editDocument` e `changeDocumentLayout` no core (a mesma edição para a tela e para o `cv.edit`; versão nova por `cv.render`, sem o gerador; conflito de versão e documento ocupado); `documentDiff` por linha (F05-9). Rotas `PUT /api/documents/:id/content`, `PATCH /api/documents/:id` (modelo, papel, formato da carta), `GET /api/documents/:id/diff` e `GET /api/cv-templates`. Web: editor na tela (cargo do cabeçalho, resumo, bullets editáveis e removíveis, ordem e inclusão das seções, tirar skill; na carta, saudação e parágrafos), seletores de modelo (Clássico, Moderno, Compacto) e papel, origem de cada versão e "Comparar com a anterior". Conferido na instância `claude`: troca para Moderno gerou a v2 sem o gerador, a edição do resumo gerou a v3, ambas aprovadas com ATS 100% e o diff mostrou só o resumo. Verdes: unitários (core 537, api 314, web 279), e2e 67 + operação. |
(Preencher durante a implementação: datas, prévias dos templates, resultados do teste manual, decisões tomadas.)
