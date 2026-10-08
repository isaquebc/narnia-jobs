# F05 · Gerar CV

Entregável 5 do plan-v0. Cobre a feature **#1** de `../02-fluxos-do-usuario.md §F5` e a arquitetura de `../03-arquitetura.md §14`: o agente gera o **conteúdo** do currículo em JSON, o servidor faz o **layout** a partir de templates e entrega PDF/DOCX com bom padrão visual. É a peça fundamental do sistema (decisão 7 de `../06-decisoes-em-aberto.md`).

Status: **em escopo** (2026-10-07). Nada implementado.

---

## 1 · Objetivo e resultado esperado

Com o onboarding concluído (F01) e o recrutador funcionando (F04), a pessoa consegue:

1. abrir "Gerar CV", escolher perfil, idioma, tamanho (1 ou 2 páginas), template (3 padrão ou um enviado por ela) e, opcionalmente, uma vaga/candidatura;
2. ver a estimativa de tokens, disparar a geração e acompanhá-la como job em segundo plano;
3. receber uma prévia renderizada do PDF fiel ao template, editar o conteúdo inline (texto dos bullets, ordem das seções, o que incluir) e re-renderizar sem gastar tokens;
4. ver quais fatos **não verificados** entraram no documento e resolver antes de exportar;
5. exportar PDF e DOCX, salvar como versão ligada ao perfil (e à candidatura, se houver) e reabrir qualquer versão depois;
6. subir um template próprio em `.zip`, vê-lo validado e pré-visualizado, e usá-lo como qualquer template padrão;
7. no modo B (terminal), pedir `/narnia-jobs:gerar-cv` e receber o link da UI web com a prévia pronta.

### Dentro do escopo
- Schema de dados do CV em `packages/shared/cv-schema` (zod → JSON Schema) usado por agente, templates e validador de templates.
- Skill `plugin/skills/gerar-cv` + tools `document.*` no servidor MCP (F04).
- Motor de renderização no `api`: 3 templates padrão como componentes React → HTML estático; templates do usuário em Handlebars; PDF por Chromium headless (Playwright) no container; DOCX via `docx`; PNG de prévia.
- Upload, validação, sandbox e gestão de templates do usuário.
- Versionamento (`document`, `document_version`), edição inline com re-render, exportação.
- Job `cv.generate` (modelo) e job `cv.render` (sem modelo), ambos na bandeja de atividades.
- Página L5 de `../05-layouts.md`.

### Fora do escopo (e para onde vai)
- Análise da vaga e fit (a vaga aqui é só contexto para o conteúdo) → F06.
- Carta de apresentação, mensagem a recrutador, otimização de LinkedIn (reusam o motor de documentos) → F09.
- Template `.docx` com placeholders (`docxtemplater`) → fase 7 do plano.
- Edição livre dos fatos do usuário (a edição inline aqui altera só o conteúdo do documento, nunca os fatos) → F10.
- Impressão/exportação de outros documentos que não CV.

---

## 2 · Arquitetura deste entregável

### 2.1 Separação conteúdo × layout
```
parâmetros ─► skill gerar-cv (agente, Sonnet) ─► cv_content.json (schema CvContent) ─► document.save_content
                                                       │
                      template (padrão ou usuário) + cv_content.json ─► renderer (sem modelo) ─► HTML ─► PDF (Chromium) · DOCX (docx) · PNG (prévia)
```
- O agente **nunca** escreve HTML, Markdown ou formatação; só preenche `CvContent`. Isso corta tokens e garante consistência visual.
- O renderer é determinístico: mesmo JSON + mesmo template = mesmo PDF (testável por snapshot).
- Re-render após edição inline não chama o modelo.

### 2.2 `CvContent` (resumo do schema em `packages/shared/cv-schema`)
| Bloco | Campos |
|-------|--------|
| `meta` | `locale`, `pages` (1/2), `paper` (A4/Letter), `profile_id`, `application_id?`, `generated_at` (UTC) |
| `header` | nome, título-alvo, cidade/país, e-mail, telefone (formatado para o mercado), links |
| `summary` | 3–5 linhas |
| `experiences[]` | empresa, cargo, período, local, bullets[] (cada bullet com `fact_ids[]`), tech[] |
| `projects[]`, `education[]`, `certifications[]`, `skills[]` (agrupadas), `languages[]`, `extras[]` | |
| `sections_order[]` | ordem e inclusão das seções |
| `provenance` | `fact_ids_used[]`, `unverified_fact_ids[]` |
Cada bullet e cada item carregam `fact_ids` para rastrear a origem e marcar não verificados.

### 2.3 Skill `gerar-cv` e tools MCP
| Tool | Função |
|------|--------|
| `profile.get_card` (F04) | cartão do perfil |
| `experience.list/get`, `project.list/get`, `skill.list`, `education.list` (F04) | matéria-prima, por fatias |
| `application.get(id)` (F07) | descrição da vaga quando informada; antes de F07, a vaga vem como texto no parâmetro |
| `document.save_content(params, cv_content)` | valida contra o schema, cria `document` + `document_version` (status `content_ready`) e enfileira `cv.render` |
| `document.list(profile)`, `document.get(id, version?)` | reabrir versões |
| `template.list()` | nomes, idiomas e restrições (ex.: template suporta 1 página) |
A skill instrui: usar só fatos existentes, priorizar conquistas com métrica, adaptar ao idioma/mercado do perfil, respeitar `pages`, preencher `provenance`, e nunca inventar. Em modo A a UI chama a skill por sessão de categoria `feature:cv`; em modo B o usuário invoca `/narnia-jobs:gerar-cv` e recebe o link da prévia.

### 2.4 Renderer (no `api`, pacote `apps/api/src/documents/`)
| Peça | Decisão |
|------|---------|
| Templates padrão | componentes React (`templates/classico`, `moderno`, `compacto`) renderizados com `renderToStaticMarkup`; CSS próprio por template com variáveis (`--accent`, fontes); i18n dos rótulos ("Experiência"/"Experience") por `locale` |
| Templates do usuário | `.zip` com `template.html` (Handlebars), `style.css`, `manifest.json` (`name`, `version`, `locales[]`, `pages[]`, `paper[]`, `variables_required[]`, `accent_options[]`), `preview.png`; extraído para `/data/templates/<id>/` |
| Sandbox | HTML sanitizado (`sanitize-html` com allowlist), **sem `<script>`**, sem `@import`/`url()` externos no CSS, sem fontes remotas; Chromium abre com rede desabilitada (`route` bloqueando tudo exceto `file://` dos assets do template) |
| PDF | Playwright Chromium headless no container, `page.pdf({ format: paper, printBackground: true, preferCSSPageSize: true })`; timeout 30 s; uma instância de browser reutilizada, páginas isoladas |
| DOCX | gerado por `docx` a partir do mesmo `CvContent` com um mapeamento por template (estilos de parágrafo, cores); fidelidade "próxima", não idêntica ao PDF |
| Prévia | PNG da página 1 (`page.screenshot`) + contagem de páginas; se exceder `pages`, aviso "ultrapassou N páginas" com sugestão de cortar |
| Fontes | embutidas na imagem (`Inter`, `Source Serif 4`, `IBM Plex Mono`, licenças OFL) para render reproduzível nos 3 SOs |
| Saídas | `/data/exports/<document_id>/<version>/cv.pdf`, `cv.docx`, `content.json`, `preview.png`, `render.html` |

### 2.5 Jobs
| Job | Modelo? | Etapas persistidas |
|-----|---------|--------------------|
| `cv.generate` | sim (Sonnet por padrão) | `collecting` → `generating` → `validating` → `saved` |
| `cv.render` | não | `html` → `pdf` → `docx` → `preview` → `done` |
| `template.validate` | não | `unzip` → `sanitize` → `render_sample` → `done` |
Todos aparecem na bandeja de atividades (F01). Edição inline cria nova `document_version` e enfileira só `cv.render`.

**Infraestrutura de jobs caros (sugestão do dono em 2026-10-08, ao decidir F02-1; entra aqui porque F05 é a primeira task com jobs longos e repetíveis):**
- **Coalescência por chave**: jobs com id determinístico por alvo (`cv.render:<document_id>`, `cv.generate:<profile_id>`); uma atualização nova para o mesmo alvo substitui a pendente em vez de enfileirar outra (BullMQ: job id fixo + `removeOnComplete`; se o job já está ativo, enfileira um único "próximo" e descarta os intermediários).
- **Conflito**: quando duas atualizações do mesmo alvo não podem ser fundidas (por exemplo, edição inline de uma versão que já foi substituída), o job falha com erro tipado e a UI mostra ao usuário, com a opção de refazer sobre a versão atual.
- **Página de processos em segundo plano** (`/processos`): lista de jobs ativos, pendentes e recentes, com cancelar e repetir; o indicador do cabeçalho (bandeja do F01) passa a mostrar também o tamanho da fila.
- **Escala de workers**: concorrência por fila configurável em Configurações (F10), aplicada em tempo de execução (`worker.concurrency`), porque roda na máquina do usuário e o custo é da própria máquina.

### 2.6 API
| Método e rota | Função |
|---------------|--------|
| `POST /api/documents/cv` | parâmetros → cria job `cv.generate` (modo A: abre sessão da skill) |
| `GET /api/documents?profile=` · `GET /api/documents/:id` · `GET /api/documents/:id/versions/:v` | listar e abrir |
| `PUT /api/documents/:id/content` | edição inline → nova versão + `cv.render` |
| `GET /api/documents/:id/versions/:v/(pdf|docx|preview.png)` | download/prévia |
| `POST /api/templates` (zip) · `GET /api/templates` · `DELETE /api/templates/:id` · `GET /api/templates/:id/preview.png` | templates do usuário |
| `GET /api/documents/estimate?profile=&pages=` | estimativa de tokens antes de gerar |

---

## 3 · Dados deste entregável

| Tabela | Colunas principais |
|--------|--------------------|
| `document` | `id`, `profile_id`, `application_id?`, `type` (cv), `title`, `current_version`, `created_at`, `updated_at` (UTC) |
| `document_version` | `id`, `document_id`, `version`, `template_id`, `params_json` (locale, pages, paper, accent, model), `content_json` (CvContent), `content_source` (agent/edit), `status` (content_ready/rendering/rendered/error), `pages_rendered`, `pdf_path`, `docx_path`, `preview_path`, `unverified_fact_ids_json`, `usage_json?`, `job_id?`, `created_at` |
| `cv_template` | `id`, `name`, `origin` (builtin/user), `engine` (react/handlebars), `path`, `manifest_json`, `preview_path`, `status` (valid/invalid), `validation_errors_json?`, `created_at` |
| `fact_source` (F01) | ganha `kind = document` para rastrear "usado no documento X" (opcional, só leitura) |

Regras:
- `content_json` é a verdade; PDF/DOCX são derivados e podem ser regenerados (`cv.render`) a qualquer momento, inclusive após atualizar um template.
- Apagar um template do usuário não apaga versões já renderizadas; a versão guarda `template_id` e o `render.html` congelado.
- Tamanho máximo do `.zip`: 5 MB; só `html`, `css`, `png`, `jpg`, `svg`, `json` dentro.

---

## 4 · Layouts deste entregável

Referência: `../05-layouts.md` L5. Componentes a construir:

| Tela | Componentes | Estados a cobrir |
|------|-------------|------------------|
| Gerar CV (L5) | `CvParamsForm` (perfil, candidatura/vaga opcional, idioma, páginas, papel, acento), `TemplatePicker` (cards com prévia, padrão + usuário, "+ enviar"), `EstimateBadge`, botão "Gerar" | sem documentos · estimando · gerando (job) · erro |
| Prévia | `PdfPreview` (PNG por página, zoom), `PagesWarning`, `UnverifiedBanner` ("2 fatos não verificados usados" com lista e link para verificar em Meus dados) | renderizando · rendered · ultrapassou páginas · com não verificados |
| Edição inline | `ContentEditor` (seções reordenáveis, incluir/excluir, bullets editáveis, rastro `fact_ids`), botão "Re-renderizar" | editando · re-render em andamento · conflito (versão nova criada por outra sessão) |
| Versões | `VersionList` (v1…vN com data no fuso do usuário, template, origem agente/edição), "comparar" simples (diff de texto) | 1 versão · várias · versão com erro |
| Exportar | botões PDF/DOCX, "salvar na candidatura" | pronto · indisponível (render com erro) |
| Templates (Config) | `TemplateUpload` (zip), `TemplateCard` (válido/inválido com erros), prévia, excluir | válido · inválido · em validação |
| Modo B | resposta textual da skill com resumo do conteúdo + link `http://127.0.0.1:<porta>/cv/<id>` | — |

---

## 5 · Decisões em aberto deste entregável

| # | Decisão | Opções | Padrão proposto |
|---|---------|--------|-----------------|
| F05-1 | Motor de template do usuário | Handlebars · EJS · Liquid | **Handlebars** (sem JS arbitrário, helpers controlados: `date`, `join`, `t`) |
| F05-2 | Chromium na imagem | Playwright Chromium no mesmo container (+~300 MB) · container separado de render · `wkhtmltopdf` | **mesmo container** (um serviço; o tamanho é aceito em `03 §14`) |
| F05-3 | Fontes | embutidas (Inter, Source Serif 4, IBM Plex Mono) · fontes do sistema · permitir fontes no zip do usuário | **embutidas** + permitir `.woff2` dentro do zip, referenciadas por caminho relativo |
| F05-4 | Sandbox dos templates do usuário | sanitize-html allowlist + rede bloqueada · iframe sandbox só na prévia · sem sandbox | **allowlist + rede bloqueada** no Chromium |
| F05-5 | Papel | por mercado do perfil (BR/EU → A4, US → Letter) · sempre A4 · escolha manual | **por mercado com override** manual |
| F05-6 | Fidelidade do DOCX | mapeamento por template · DOCX genérico único · não gerar DOCX | **mapeamento por template** para os 3 padrão; templates do usuário recebem o DOCX genérico |
| F05-7 | Modelo da geração | Sonnet · Haiku | **Sonnet** (qualidade de texto importa; medir em 6.4) |
| F05-8 | Estimativa de 1 página | cortar automaticamente (modelo regenera mais curto) · só avisar · escala de fonte no CSS | **avisar + oferecer "regerar mais curto"** |
| F05-9 | Comparar versões | diff de texto do `CvContent` · diff visual de PNG · nenhum | **diff de texto** |

---

## 6 · O que precisa estar coberto para o F05 funcionar

### 6.1 Pré-requisitos e dependências
1. **F01**: jobs, bandeja, `usage_event`, perfil com dados obrigatórios, i18n, tempo.
2. **F04**: servidor MCP em `/mcp`, `plugin/` com skills, sessões de chat (modo A), tools `profile.*`/`experience.*`/`skill.*`/`education.*`.
3. **F03** desejável, não obrigatório: mais fatos (GitHub) tornam o CV melhor; o F05 funciona só com o CV ingerido em F01.
4. **F07** opcional: ligação com candidatura; antes dele, a vaga é texto no parâmetro.
5. Ordem interna: schema `CvContent` → renderer com os 3 templates (sem modelo, testável cedo) → tools/skill → página L5 → templates do usuário → DOCX.

### 6.2 Testes unitários (Vitest) · obrigatórios
**`packages/shared`**
- `cv-schema`: aceita fixtures válidas pt-BR/en-US; rejeita bullet sem `fact_ids`, `pages` fora de {1,2}, seção desconhecida em `sections_order`; JSON Schema estável (snapshot).

**`apps/api` (documents)**
- Renderer HTML: para cada template padrão × locale × pages, o HTML gerado é snapshot estável; rótulos traduzidos; telefone formatado por mercado; datas no formato do locale.
- Handlebars: helpers permitidos funcionam; helper não registrado falha com erro claro; template sem `variables_required` presentes é rejeitado na validação.
- Sanitização: `<script>`, `onload=`, `@import`, `url(http…)` são removidos/rejeitados; `url(./img.png)` relativo é mantido.
- Validação de zip: faltando `manifest.json` → inválido; arquivo `.js` dentro → inválido; > 5 MB → rejeitado; zip-slip (`../`) → rejeitado.
- PDF: com Chromium real em CI, gera PDF com N páginas para fixtures conhecidas (1 página para a fixture curta, 2 para a longa); `pages_rendered` correto; timeout gera `status = error` com mensagem.
- DOCX: gera arquivo válido (abre com `mammoth` e contém nome, empresa e 1º bullet).
- Jobs: `cv.generate` com provider mock → `document_version(content_ready)` → `cv.render` enfileirado automaticamente; edição inline cria versão N+1 e **não** chama o provider.
- `UnverifiedBanner` dados: `unverified_fact_ids_json` calculado a partir de `provenance` × `verified` dos fatos.
- Rotas: 404 documento inexistente; 409 ao editar versão que não é a atual; 400 template inválido; 403 ao baixar PDF de outra versão sem token.

**`apps/web`**
- `CvParamsForm`: defaults por perfil (locale, papel por mercado), validação, estimativa atualiza ao mudar `pages`.
- `TemplatePicker`: lista padrão + usuário, desabilita template que não suporta o locale/pages escolhidos com explicação.
- `ContentEditor`: reordenar seções, incluir/excluir, editar bullet mantém `fact_ids`; "Re-renderizar" envia `PUT` e mostra progresso do job.
- `PdfPreview`: pagina entre PNGs, mostra aviso de páginas excedidas.
- `VersionList`: datas no fuso do usuário; selecionar versão troca prévia e downloads.

### 6.3 Testes e2e (Playwright, Chromium) · obrigatórios
Rodam contra o compose com `NARNIA_PROVIDER=mock` (o mock devolve um `CvContent` fixo para o perfil de fixture; o renderer é real).
- **E2E-01 gerar com template Clássico**: abrir Gerar CV → defaults → Gerar → job na bandeja → prévia aparece → PDF baixa e tem 1 página → versão v1 listada.
- **E2E-02 trocar template sem gastar tokens**: selecionar Moderno → "Re-renderizar" → nova versão sem chamada ao provider (contador do mock inalterado) → prévia muda.
- **E2E-03 edição inline**: editar um bullet e excluir a seção "Projetos" → re-render → PDF não contém a seção; v2 criada; v1 intacta.
- **E2E-04 não verificados**: fixture com 2 fatos não verificados usados → banner lista os dois → clicar leva a Meus dados; após verificar (F10 mock ou endpoint de teste) e re-render, banner some.
- **E2E-05 template do usuário válido**: enviar `fixtures/templates/minimal.zip` → validado → prévia gerada → disponível no picker → gerar CV com ele.
- **E2E-06 template do usuário inválido**: zip com `<script>` → rejeitado com mensagem listando o motivo.
- **E2E-07 2 páginas e aviso**: fixture longa com `pages = 1` → aviso "ultrapassou" → "regerar mais curto" cria v2 com 1 página (mock devolve versão curta).
- **E2E-08 en-US e Letter**: perfil com mercado US → papel Letter e rótulos em inglês no PDF (texto extraído com `unpdf`).
- **E2E-09 ligar à candidatura** (após F07): gerar a partir do cartão de uma candidatura → documento aparece no cartão.
- **E2E-10 modo B**: `claude -p "/narnia-jobs:gerar-cv" --plugin-dir plugin/` contra o container (mock) → resposta contém link da prévia → link abre a página com v1.
- **E2E-11 persistência**: `docker compose down/up` → versões, PDFs e templates do usuário continuam disponíveis.

### 6.4 Teste manual com provider real (antes de fechar F05)
Com 3 perfis reais (pt-BR backend, en-US backend, pt-BR gestão): gerar com os 3 templates, 1 e 2 páginas; registrar tokens reais × estimativa, taxa de edição inline necessária, se o conteúdo inventou algo (deve ser zero), legibilidade do PDF impresso, abertura do DOCX no Word/LibreOffice/Google Docs. Decide F05-7 e ajusta a skill.

### 6.5 Definição de pronto
- Testes de 6.2 e 6.3 verdes na CI (CI instala Chromium do Playwright); cobertura ≥ 80 % em `documents/` e `cv-schema`.
- Os 3 templates padrão aprovados visualmente pelo dono do projeto (prévias anexadas em §8).
- Imagem Docker builda nos 3 SOs e o PDF gerado em cada um é idêntico (hash do `render.html` + páginas) para a fixture.
- Documentação do formato de template do usuário (`docs` do repositório) com exemplo mínimo.
- `../03`, `../04`, `../05` atualizados com o que mudou.

---

## 7 · Riscos específicos
| Risco | Mitigação |
|-------|-----------|
| Chromium aumenta a imagem e o tempo de build | camada separada no Dockerfile com cache; `--only-shell`/chromium headless shell |
| Template do usuário malicioso (exfiltração, JS) | allowlist, rede bloqueada no Chromium, sem JS, zip-slip bloqueado, tamanho limitado |
| Conteúdo gerado inventa conquistas | skill proíbe, `provenance` obrigatória: bullet sem `fact_ids` falha na validação do schema |
| Render diferente entre SOs | fontes embutidas, Chromium fixado pela versão do Playwright, teste de hash em CI |
| DOCX feio em templates do usuário | DOCX genérico claramente rotulado "versão editável"; PDF é a saída principal |
| Documento longo estoura 1 página sem o modelo perceber | contagem real de páginas pós-render + "regerar mais curto" |

## 8 · Registro de execução
(Preencher durante a implementação: datas, prévias dos templates, resultados do teste manual, decisões tomadas.)
