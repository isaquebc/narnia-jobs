# F01 · Primeiro uso (onboarding)

Entregável 1 do plan-v0. Cobre o fluxo **F1** de `../02-fluxos-do-usuario.md` e toda a fundação técnica que ele exige (monorepo, Docker, banco, provider, testes). Os demais fluxos viram entregáveis próprios: F02 troca de perfil, F03 ingestão (GitHub/LinkedIn/profundidades), F04 chat com o recrutador, F05 features, F06 gestão de dados.

Status: **em implementação** desde 2026-10-07. Decisões de §5 fechadas pelo dono do projeto; marcos M1–M7 em andamento, progresso em §8.

---

## 1 · Objetivo e resultado esperado

Uma pessoa com Docker e assinatura do Claude consegue, sem ajuda:

1. subir o sistema com `./start.sh` (ou `.\start.ps1`), tendo só Docker instalado; o script escolhe uma porta livre, sobe os serviços (web, api, worker, redis) e imprime a URL;
2. fazer o login da assinatura no container uma única vez e ver a UI confirmar;
3. enviar um currículo pronto (PDF/DOCX/MD), **ou** escrever a história profissional em texto livre, **ou** pular;
4. ver o material extraído em fatos + registro de contexto, com estimativa de tokens antes de rodar; para PDF, o texto vem de **três leituras consolidadas** (camada de texto, OCR e leitura do documento pelo modelo); a extração roda como jobs no worker e aparece na bandeja de atividades;
5. revisar e corrigir cada fato, preencher identidade e contato (telefone com país + DDD, situação de trabalho e relocação obrigatórios);
6. confirmar o primeiro perfil, sugerido a partir do CV, com faixa salarial, tipos de contrato, localidades e disponibilidade obrigatórios;
7. cair num dashboard mínimo do perfil, com os dados persistidos em `./data` e sobrevivendo a `docker compose down` e reboot.

### Dentro do escopo
- Passos 1 a 5 do fluxo F1 (sem passo 6: decisão F01-11, nada de tela "em breve"), mais o dashboard mínimo (L0 shell + cartão do perfil + contadores + bandeja de atividades).
- Fonte de ingestão: arquivo **ou texto livre** (textarea). A sessão de clarificação pós-ingestão é F04, mas o botão já aparece desabilitado na revisão.
- Fundação de jobs em segundo plano com **BullMQ + Redis** e serviço `worker` separado (tabela `job` como espelho durável, eventos via WS, bandeja), porque a extração já é um conjunto de jobs.
- Leitura de PDF por três métodos consolidados: camada de texto (`unpdf`), **OCR** (Tesseract) e **leitura do documento pelo modelo** (tool `Read`), com consolidador por seção.
- **Tudo em Docker**, inclusive desenvolvimento (`docker-compose.dev.yml` com hot reload) e e2e (Playwright em container). O host só precisa de Docker.
- **TDD** em todos os marcos (`../09-metodologia-tdd.md`): teste que falha antes do código, registro em §8.
- Fundação do medidor: `usage_event` gravado a partir do `result.usage` do SDK e log JSONL próprio. A leitura dos logs do Claude Code e a tela completa são F06.
- Lançador multiplataforma com porta dinâmica.
- Tempo em UTC no banco e exibição no fuso do usuário via `moment-timezone` (isolado em `packages/shared/time.ts`).
- Passo 6 ("mais fontes") aparece só como tela de **pular/depois** com os cartões GitHub/LinkedIn desabilitados. A ingestão em si é F03.
- Fundação: monorepo, `apps/web`, `apps/api`, `apps/worker`, `packages/core`, `packages/shared`, imagens e composes, SQLite + Redis, provider Claude Code via Agent SDK (`detect`, `extractFacts`, `buildDigest`, `readDocument`), setup de testes unitários e e2e, CI em containers.

### Fora do escopo (e para onde vai)
- Passo 7, entrevista de descoberta → F04 (depende do chat).
- Ingestão GitHub/LinkedIn, profundidades, re-ingestão, passo 6 do wizard → F03.
- Servidor MCP HTTP e `plugin/` (modo B) → F04. Em F01 o SDK é usado direto pelo `api`, sem MCP, porque a extração não precisa de tools.
- Troca/criação de outros perfis → F02. F01 cria exatamente um.
- Edição livre de dados fora do fluxo de revisão → F06.
- Codex, Google Calendar, voz, templates de CV, medidor completo e "limpar cache" (F05/F06).
- i18n: a **estrutura** entra em F01 (dicionário `pt-BR.ts`, hook `t()`, nenhuma string em componente); só o idioma pt-BR é entregue.
- Pesquisa na internet pelo recrutador para dados obrigatórios: depende do chat (F04). Em F01, campo obrigatório sem resposta mostra "não sei" → o wizard aceita um valor provisório marcado `needs_research = 1`, que o recrutador resolve em F04.

---

## 2 · Arquitetura deste entregável

### 2.1 Stack (decidido)
| Camada | Escolha | Observação |
|--------|---------|------------|
| Linguagem | TypeScript em tudo | Node ≥ 22.13 (SQLite embutido) |
| Monorepo | pnpm workspaces + Turborepo (decidido) | `apps/*`, `packages/*`; pnpm roda **dentro dos containers** |
| `apps/web` | React 19 + Vite + TanStack Router + TanStack Query + react-hook-form + zod + **Tailwind com tema claro/escuro** (componentes shadcn/ui copiados, por serem Tailwind nativos) | SPA servida por **nginx** no serviço `web`, que faz proxy de `/api`, `/ws`, `/mcp` |
| `apps/api` | Node + **Hono** (decidido) + `@hono/node-server` + WebSocket (`ws`) | REST + WS; enfileira jobs; hospeda o SDK para chamadas síncronas curtas (`detect`) |
| `apps/worker` | Node + **BullMQ** (decidido) | processadores das filas `ingest`, `ocr`, `extract`; hospeda o SDK para extração; mesma imagem da api, comando diferente |
| Redis | `redis:7-alpine` | filas BullMQ, eventos de progresso, locks; `appendonly` em volume |
| OCR | `tesseract.js` (WASM, idiomas `por`+`eng`, dados de idioma empacotados na imagem) | roda no worker; sem binário nativo |
| `packages/core` | domínio, storage (`node:sqlite` + migrations **SQL puro**, decidido), leituras de PDF e **consolidador**, validações | sem dependência de HTTP nem de Redis |
| `packages/shared` | tipos e schemas zod compartilhados (API contracts, JSON Schema da extração) | importado por web e api |
| Provider | `@anthropic-ai/claude-agent-sdk` (fixado) + CLI `@anthropic-ai/claude-code` na imagem | em `packages/providers/` (usado por api e worker) |
| Testes unitários | Vitest (api, core, shared) + Vitest + Testing Library + jsdom (web) | |
| Testes e2e | Playwright **em container** (`mcr.microsoft.com/playwright`) contra `docker-compose.e2e.yml`, com `NARNIA_PROVIDER=mock` | um conjunto por fluxo (`09-metodologia-tdd.md`) |
| Lint/format | Biome | |
| CI | GitHub Actions: lint, unit, build das imagens, e2e, tudo via `docker compose` | matriz de SO (ubuntu/windows/macos) só para o smoke `./start.sh`/`start.ps1` + health; unit e e2e em ubuntu dentro de containers |

### 2.2 Estrutura de pastas
```
narnia-jobs-helpper/
├─ apps/
│  ├─ web/                 React (Vite). src/{app,routes,features/onboarding,components,lib,i18n}
│  ├─ api/                 Hono. src/{server.ts,routes,ws,services,queues (enqueue),cli (narnia-jobs doctor|login|install-plugin)}
│  └─ worker/              BullMQ. src/{main.ts,processors/{ingest,ocr,extract},progress}
├─ packages/
│  ├─ core/                src/{db (migrations, repos), domain, pdf/{text,ocr,consolidate}, extract (docx,md,text), phone, digest, jobs (espelho), usage, salary}
│  ├─ shared/              src/{schemas (zod), types, api-contracts, time.ts, i18n/types.ts}
│  └─ providers/           src/{provider.ts (interface), claude-code/, mock/}
├─ plugin/                 (vazio em F01; criado em F04)
├─ docker/                 Dockerfile (app), web.Dockerfile (nginx), nginx.conf, entrypoint.sh
├─ docker-compose.yml · docker-compose.dev.yml · docker-compose.e2e.yml
├─ start.sh · start.ps1    lançador (só Docker no host): up | down | login | doctor | logs | dev | test | e2e
├─ plans/plan-v0/
├─ turbo.json · pnpm-workspace.yaml · biome.json · .github/workflows/ci.yml
```
(`../03-arquitetura.md §2` foi ajustado para esta estrutura.)

### 2.3 Processos e portas
```
host: ./start.sh up  →  acha porta livre 3100–3199 → grava NARNIA_PORT em .env → docker compose up -d → espera /api/health → imprime URL com token
rede do compose:
  web    (nginx :80)   ─ publica 127.0.0.1:${NARNIA_PORT}:80; serve a SPA; proxy /api, /ws, /mcp → api:3100
  api    (hono :3100)  ─ REST, WS, enqueue BullMQ, SDK para `detect`
  worker (bullmq)      ─ filas ingest · ocr · extract; SDK para extração; progresso → Redis → api → WS
  redis  (:6379)       ─ filas, eventos, locks
volumes: ./data:/data (SQLite, uploads, digests, logs) em api e worker · claude-auth:/home/node/.claude em api e worker · redis-data
```
Desenvolvimento: `./start.sh dev` sobe `docker-compose.dev.yml` (fonte montada, Vite e `tsx watch` em containers, Redis local); `./start.sh test` roda Vitest em container; `./start.sh e2e` roda Playwright em container. Nada exige Node/pnpm no host. A pasta de dados é a mesma independentemente da porta.

### 2.4 Provider: `ClaudeCodeProvider` (mínimo para F01)
```ts
interface Provider {
  id: "claude-code" | "mock";
  detect(): Promise<ProviderStatus>;        // { installed, loggedIn, authMethod, version, loginHint }
  readDocument(input: { filePath: string; locale: string }): Promise<{ text: string; sections: Section[]; usage: Usage }>;  // leitura 3 do PDF
  extractFacts(input: { text: string; locale: string }): Promise<{ proposals: FactProposal[]; usage: Usage }>;
  buildDigest(input: { text: string; proposals: FactProposal[]; locale: string }): Promise<{ digest: FileDigest; usage: Usage }>;
}
```
- `detect()` roda `claude auth status` (JSON; exit 0 logado, 1 não) e `claude --version`. Zero tokens. Verificado em https://code.claude.com/docs/en/cli-reference.
- `readDocument()` entrega o PDF ao modelo: `query()` com `tools: ["Read"]`, `cwd`/`additionalDirectories` restritos à pasta do upload, `maxTurns: 3`, `model: settings.models.extraction.document` (padrão **haiku**), `outputFormat` com schema `{ text, sections[] }`. A tool `Read` do Claude Code lê PDFs (inclusive por páginas). É a terceira leitura do PDF (decisão F01-3); para DOCX/MD só roda quando a confiança da camada de texto for baixa.
- `extractFacts()` + `buildDigest()` são as **duas chamadas** `query()` do SDK já decididas em F01-5, cada uma com `tools: []`, `maxTurns: 1`, `systemPrompt` próprio e **`outputFormat: { type: "json_schema", schema }`** (schemas de `packages/shared`, zod → JSON Schema). (a) `extractFacts`: `model: settings.models.extraction.facts` (padrão **haiku**), saída `{ identity, experiences[], education[], skills[], languages[], links[] }` com `confidence` por item. (b) `buildDigest`: `model: settings.models.extraction.digest` (padrão **sonnet**), entrada = texto + fatos extraídos, saída `FileDigest` (resumo, pontos principais, índice de seções, metadados). As duas rodam como estágios do mesmo job (`extracting_facts` → `building_digest`), cada uma grava seu `usage_event`. Verificado em https://code.claude.com/docs/en/agent-sdk/typescript (`outputFormat`).
- Estimativa pré-execução: soma das duas chamadas (`chars/4` do texto + overhead de cada prompt; a segunda inclui os fatos), mostrada ao usuário por modelo ("~6k Haiku + ~5k Sonnet") antes de confirmar. Pós-execução: `usage` real por chamada gravado em `ingestion_run.usage_json` e em `usage_event`.
- Login: a UI nunca faz login. `detect()` devolve também `authMethod` (campo do `claude auth status`: `claude.ai` = login por volume, `oauth_token` = token do `.env`, `none`). Se não logado, a UI mostra os dois caminhos: o padrão `narnia-jobs login` (login interativo no container, credencial no volume `claude-auth`) e a alternativa `claude setup-token` no host + `CLAUDE_CODE_OAUTH_TOKEN` no `.env`, com botão "verificar de novo". Decisão global 11 (2026-10-07): os dois mecanismos, volume como padrão.
- `MockProvider`: lê fixtures em `apps/api/test/fixtures/extractions/*.json`; ativado por `NARNIA_PROVIDER=mock`. Usado em e2e e em desenvolvimento sem gastar plano.

### 2.5 Pipeline da extração (cadeia de jobs BullMQ por upload)
```
POST /api/files (multipart) ─► /data/uploads/<hash>.<ext> ─► source_file(kind=cv)     POST /api/texts ─► source_file(kind=text)
POST /api/ingestions {fileId} ─► ingestion_run(status=queued) + job raiz ─► filas:
  [ingest.read_text]   unpdf / mammoth / md            ─► reading(kind=text_layer, text, quality)            (sem tokens)
  [ocr.pages]          (PDF) renderiza páginas → tesseract.js por+eng ─► reading(kind=ocr, text por página, confiança)   (sem tokens; pulado se quality alta E sem imagens? NÃO: roda sempre em PDF, decisão F01-3; pode ser desligado em Configurações)
  [extract.read_doc]   (PDF) provider.readDocument ─► reading(kind=model_read, text, sections)              (tokens)
  [ingest.consolidate] alinha as leituras por seção, vota por trecho, gera texto canônico + mapa de origem ─► /data/digests/<hash>.txt + estimativa
  [extract.facts]      provider.extractFacts  (Haiku)  ─► ingestion_proposal[]                                (tokens)
  [extract.digest]     provider.buildDigest   (Sonnet) ─► file_digest                                         (tokens)
  cada etapa: progresso → Redis events → api → WS {jobId, stage, pct} → bandeja; usage_event + JSONL por chamada ao modelo
  └─► ingestion_run(status=review, usage_json por chamada)
POST /api/ingestions/:id/review {decisions[]} ─► aceita/edita/rejeita ─► fatos + fact_source ─► status=done; facts_version++
```
Observações:
- A **estimativa** mostrada antes de confirmar inclui as três chamadas com tokens (leitura do documento, fatos, digest), por modelo. O usuário pode desligar a leitura pelo modelo e o OCR por ingestão (checkboxes no passo 2) para economizar; o padrão é tudo ligado em PDF.
- Consolidação (decisão F01-22): segmenta cada leitura em blocos por heurística de seção; alinha blocos por similaridade; por bloco, escolhe o texto com maior confiança e resolve divergências de números/datas por voto (2 de 3); registra em `reading_segment.origin` qual leitura venceu, para a tela de revisão mostrar a fonte de cada trecho.
- Texto livre e MD/TXT: só `ingest.read_text` → `consolidate` (trivial) → `facts` → `digest`.
- Limites: upload 10 MB, texto livre 50k chars, PDF até 20 páginas em F01 (acima disso, OCR só nas 20 primeiras e aviso).
- Arquivos tratados como não confiáveis: parsers em JS/WASM, nunca executados; o modelo só lê a pasta do upload.

### 2.6 API (contratos em `packages/shared/api-contracts`)
| Método e rota | Função |
|---------------|--------|
| `GET /api/health` | versão, pasta de dados gravável |
| `GET /api/provider/status` | resultado de `detect()` |
| `GET /api/onboarding/state` | em que passo o usuário está (retomável após fechar o navegador) |
| `POST /api/files` · `POST /api/texts` · `GET /api/files/:id` · `GET /api/files/:id/estimate` | upload de arquivo ou texto livre, e estimativa |
| `GET /api/jobs` · `GET /api/jobs/:id` · `POST /api/jobs/:id/cancel` · `POST /api/jobs/:id/retry` | bandeja de atividades |
| `GET /api/usage/summary` | total de tokens por categoria (mínimo para o dashboard) |
| `POST /api/ingestions` {fileId, options: {ocr, modelRead}} · `GET /api/ingestions/:id` (inclui leituras e origem por trecho) · `POST /api/ingestions/:id/review` | extração e revisão |
| `GET/PUT /api/user` | identidade e contato (validação de telefone no servidor) |
| `POST /api/profiles` · `GET /api/profiles/suggestion?runId=` | primeiro perfil e sugestão heurística |
| `GET /api/dashboard` | cartão do perfil + contadores |
| `WS /ws` | eventos `provider.status`, `job.progress`, `job.done`, `job.error` |

### 2.7 Segurança mínima em F01
- `api` escuta em `0.0.0.0` dentro do container, mas o compose publica só em `127.0.0.1:3100`.
- Token de sessão aleatório gerado no boot, impresso no log e embutido na URL de abertura; exigido em todas as rotas (`Authorization: Bearer`). Evita que outra aba/site local chame a API.
- Uploads validados por magic bytes, não por extensão.

---

## 3 · Dados deste entregável

Subconjunto de `../04-escopo-de-dados.md`. Migrations em SQL puro, versionadas (`0001_init.sql`...).

| Tabela | Colunas principais |
|--------|--------------------|
| `settings` | `key`, `value_json` (provider ativo, modelos padrão, onboarding_step, **`facts_version`**: inteiro incrementado em toda escrita de fato; F02 invalida o cartão do perfil e F06 chaveia o cache de análise por ele) |
| `user` | `id`, `display_name`, `full_name`, `pronouns?`, `email`, **`phone_e164`**, **`phone_country`** (ISO-2), **`phone_national`** (DDD+número, só dígitos), `city`, `region?`, `country` (ISO-2), `timezone` (IANA), `remote_pref` (remote/hybrid/onsite/any), **`relocation`** (none/country/anywhere + `relocation_countries_json`), **`work_auth_json`** (países onde pode trabalhar e situação), `links_json`, `created_at`, `updated_at` (UTC) |
| `language` | `id`, `user_id`, `name`, `level` (A1–C2/nativo), `source_id?`, `confidence`, `verified` |
| `experience` | `id`, `user_id`, `company`, `title`, `employment_type?`, `start_date`, `end_date?`, `is_current`, `location?`, `summary?`, `tech_json`, `source_id?`, `confidence`, `verified` |
| `achievement` | `id`, `experience_id`, `text`, `metric?`, `source_id?`, `confidence`, `verified` |
| `education` | `id`, `user_id`, `institution`, `course`, `degree?`, `start_date?`, `end_date?`, `status`, `source_id?`, `confidence`, `verified` |
| `skill` | `id`, `user_id`, `name`, `name_normalized`, `category`, `level?`, `source_id?`, `confidence`, `verified` |
| `profile` | `id`, `user_id`, `name`, `target_title`, `alt_titles_json`, `seniority`, `area`, `goal`, `market`, `doc_locale`, **`salary_min`, `salary_max`, `salary_currency`, `salary_period`**, `salary_below_reference` (bool, recalculado ao salvar), **`contract_types_json`**, **`locations_json`**, **`available_from`**, `needs_research_json` (campos marcados "não sei"), `pitch?`, `card_json?`, `card_updated_at?`, `is_active` |
| `salary_reference` | `id`, `country` (ISO-2), `source` (dieese), `indicator` (salario_minimo_necessario), `value`, `currency`, `period` (monthly), `reference_month` (YYYY-MM), `source_url`, `fetched_at` (UTC), `is_current` |
| `source_file` | `id`, `original_name?`, `mime`, `size`, `sha256`, `path`, `kind` (cv/text), `uploaded_at` |
| `job` | `id` (= BullMQ jobId determinístico), `queue`, `type`, `parent_id?` (cadeia), `profile_id?`, `status` (queued/active/done/error/cancelled/stalled), `progress` (0–100), `stage`, `payload_json`, `result_json?`, `error?`, `attempts`, `created_at`, `started_at?`, `finished_at?` — **espelho** do estado da BullMQ, atualizado pelos eventos |
| `reading` | `id`, `run_id`, `kind` (text_layer/ocr/model_read), `text_path`, `quality` (0–1), `pages_json`, `usage_json?`, `duration_ms` |
| `reading_segment` | `id`, `run_id`, `index`, `section_hint`, `text`, `origin` (kind vencedor), `agreement` (0–1), `divergences_json` |
| `usage_event` | `id`, `ts` (UTC), `origin` (narnia), `category` (ingest), `job_id?`, `session_id?`, `model`, `input_tokens`, `output_tokens`, `cache_read`, `cache_write`, `cost_usd_est` |
| `file_digest` | `file_id`, `summary`, `key_points_json`, `sections_json`, `meta_json` (pages, lang, doc_date), `text_path`, `edited_by_user` |
| `ingestion_run` | `id`, `file_id`, `provider`, `models_json` ({document, facts, digest}), `options_json` ({ocr, modelRead}), `depth` (=quick em F01), `status` (estimating/queued/running/review/done/error), `estimate_json` ({document_tokens, facts_tokens, digest_tokens}), `usage_json` (por chamada), `error?`, `started_at`, `finished_at` |
| `ingestion_proposal` | `id`, `run_id`, `kind` (identity/experience/achievement/education/skill/language/link), `payload_json`, `confidence`, `decision` (pending/accepted/edited/rejected), `edited_payload_json?`, `target_id?` |
| `fact_source` | `id`, `kind` (cv/manual), `file_id?`, `run_id?`, `created_at` |

Regras:
- Telefone: entrada em três campos (país, DDD, número), normalização e validação com `libphonenumber-js`, persistido em E.164 + partes. Obrigatório para sair do passo 4.
- Todo fato aceito em F01 nasce com `verified = 1` (passou pela revisão) e `source_id` apontando para o CV; fatos digitados à mão têm `source.kind = manual`.
- `onboarding_step` em `settings` permite retomar o wizard de onde parou.
- Faixa salarial, tipos de contrato, localidades e disponibilidade são obrigatórios no passo 5; cada um aceita "não sei", que grava um valor provisório e marca `needs_research` para o recrutador resolver com pesquisa em F04.
- **Referência DIEESE (usuário no Brasil).** `salary_reference` é semeada na migration com o salário mínimo necessário do DIEESE mais recente conhecido na data do build (valor, mês, URL da fonte) e marcada `is_current`. Ao salvar `salary_min` em BRL/mensal, o servidor compara com a referência corrente e grava `salary_below_reference`. A UI mostra alerta informativo (valor, mês, fonte, link) e nada mais: não bloqueia, não sugere outro valor, não altera o campo. Para moeda ou período diferentes, ou país ≠ BR, não há comparação. Atualização da referência: F04 (recrutador pesquisa e grava nova linha com fonte) e F10 (rotina/edição manual em Configurações). O valor provisório de "não sei" em BRL usa a própria referência DIEESE como piso inicial, marcado `needs_research`.
- Todos os timestamps em UTC. `moment-timezone` só na UI, via `packages/shared/time.ts`.
- Jobs: a BullMQ é a fonte da verdade da fila; a tabela `job` é atualizada pelos eventos (`active`, `progress`, `completed`, `failed`, `stalled`). Se o worker cair, a BullMQ reprocessa jobs `stalled` (até 3 tentativas); a UI mostra "reprocessando". `cancel` remove da fila e marca `cancelled`.
- api e worker abrem o mesmo SQLite em `/data` (WAL, `busy_timeout` 5 s). Escritas são curtas; o worker grava por etapa.
- Toda escrita em tabela de fato (`experience`, `achievement`, `education`, `skill`, `language`, `user`) passa por um único ponto do `core` que incrementa `settings.facts_version`. É o mecanismo de invalidação usado por F02 (cartão), F06 (cache de análise) e F10 (edição).
- Nenhuma linha de nenhuma tabela é criada antes do passo 4 ser salvo, exceto `source_file`, `file_digest`, `ingestion_*` (que existem para a revisão).

---

## 4 · Layouts deste entregável

Referência: `../05-layouts.md` L0 (shell) e L1 (passos 1–5). Componentes a construir:

| Tela | Componentes | Estados a cobrir |
|------|-------------|------------------|
| Shell L0 (mínimo) | topo com nome + perfil ativo + indicador de provider; menu lateral com itens futuros desabilitados; painel direito oculto em F01 | provider ok / não logado / CLI ausente |
| Passo 1 Provider | `ProviderCard` (Claude Code, mostra `authMethod`: volume ou token), `LoginInstructions` com os dois caminhos (padrão `narnia-jobs login`; alternativa token no `.env`) e comandos copiáveis, botão "verificar de novo" | checando · logado por volume · logado por token · não logado · erro ao executar CLI |
| Passo 2 Currículo | abas **Arquivo** (`FileDropzone`, PDF/DOCX/MD, 10 MB) e **Texto livre** (`FreeTextEditor`, até 50k chars, contador), `ExtractionOptions` (OCR e leitura pelo modelo, ligados por padrão em PDF, com custo em tokens ao lado), `EstimateBadge` por modelo, botões "Extrair" e "Não tenho" | vazio · arquivo inválido · arquivo grande · PDF > 20 páginas (aviso) · texto curto demais · estimando · pronto |
| Passo 3 Extração | `ProgressPanel` com as etapas da cadeia (texto · OCR · leitura pelo modelo · consolidação · fatos · digest), prévia do `FileDigestCard` assim que disponível; os jobs aparecem na `ActivityTray` do shell e o usuário pode sair e voltar | na fila · rodando (etapa N de 6) · reprocessando (worker reiniciou) · erro em uma etapa (tentar de novo a etapa / pular para manual) · concluído |
| Passo 4 Revisão | `ReadingOriginBadge` por proposta (de qual leitura veio o trecho: texto, OCR ou modelo; e divergências), `IdentityForm` (nome, e-mail, **`PhoneInput`** país+DDD+número, cidade, país, fuso, remoto, **relocação**, **situação de trabalho por país**), `ProposalList` agrupada por tipo com `ProposalRow` (aceitar/editar/rejeitar, confiança, fonte), ações em lote, contador "N pendentes", botão "Clarificar com o recrutador" desabilitado (F04) | sem fonte (formulário vazio) · com propostas · campos obrigatórios faltando · tudo decidido |
| Passo 5 Perfil | `ProfileForm` pré-preenchido pela sugestão ("sugerido porque...") + bloco **Carreira** obrigatório: `SalaryRangeInput` (mín/máx/moeda/período) com `SalaryReferenceAlert` (aparece quando BRL mensal < referência DIEESE: "Abaixo do salário mínimo necessário do DIEESE de <mês>: R$ X. Fonte."), `ContractTypes`, `LocationsInput`, `AvailableFrom`; cada campo com opção "não sei" (marca para pesquisa em F04; em BRL preenche o provisório com a referência DIEESE) | sugestão disponível · sem sugestão · campo "não sei" · salário abaixo da referência |
| Dashboard | `ProfileCard`, `StatsRow` (experiências, skills, formação, arquivos), `UsageMini` (tokens gastos até agora), `NextSteps` (links para features futuras desabilitadas) | com dados · vazio |
| Shell: `ActivityTray` | ícone com contador, lista de jobs (progresso, estágio, erro, cancelar, retomar, abrir) | vazio · 1+ rodando · com erro |

Regras de UI: wizard retomável (estado vem de `/api/onboarding/state`), tema claro/escuro desde o início, largura mínima 1024 px, textos via `t()` com dicionário `pt-BR.ts`, horários via `formatInUserTz()` de `packages/shared/time.ts`.

---

## 5 · Decisões deste entregável (fechadas em 2026-10-07)

Todas confirmadas ou alteradas pelo dono do projeto (registro em §8). Reabrir só com motivo registrado.

| # | Decisão | Fechada como | Motivo |
|---|---------|--------------|--------|
| F01-1 | Framework HTTP | **Hono** + `@hono/node-server` | leve, tipado, serve estático, WS via `ws` |
| F01-2 | Acesso ao SQLite | **SQL puro + repositórios finos** sobre `node:sqlite` | sem ORM até ~15 tabelas; migrations em arquivos `.sql` numerados |
| F01-3 | Leitura de PDF | **DECIDIDA (2026-10-07): três leituras consolidadas**: camada de texto (`unpdf`), OCR (`tesseract.js`, por+eng) e leitura do documento pelo modelo (tool `Read`); consolidador por seção com voto | robustez em PDFs escaneados, com colunas ou mal gerados |
| F01-4 | Saída estruturada | **`outputFormat: { type: "json_schema" }`** do SDK, com fallback de parse JSON | verificado na doc do SDK |
| F01-5 | Modelo da extração | **DECIDIDA (2026-10-07): duas chamadas.** Fatos candidatos com **Haiku**; registro de contexto do arquivo (digest) com **Sonnet**. Ambos configuráveis em `settings.models.extraction.{facts,digest}`. O teste manual (§6.4) mede a taxa de edição dos fatos e a qualidade do digest separadamente | qualidade do resumo que o agente reutiliza sempre, custo baixo na parte volumosa |
| F01-6 | Detecção de login | **`claude auth status`** (JSON, exit 0/1) | zero tokens, verificado na doc |
| F01-7 | Autenticação local da API | **token de boot** na URL e em `Authorization: Bearer` | protege a API local sem senha |
| F01-8 | Topologia | **DECIDIDA (2026-10-07): múltiplos containers** (web/nginx, api, worker, redis), preparados para mais serviços por task | filas e workers separados; o host só tem Docker |
| F01-9 | Monorepo | **pnpm workspaces + Turborepo** | cache de build/test |
| F01-10 | UI | **DECIDIDA (2026-10-07): Tailwind com tema claro/escuro.** Camada de componentes: shadcn/ui (copiados, Tailwind nativo), confirmado por ausência de objeção | controle visual total |
| F01-11 | Passo 6 | **DECIDIDA (2026-10-07): omitido** até o F03; nada de "em breve" | não mostrar o que não existe |
| F01-12 | Imagem base | **`node:22-slim`** + `git` + `ca-certificates` | glibc para o CLI |
| F01-13 | Lançador | **DECIDIDA (2026-10-07): `start.sh` + `start.ps1`**, finos, só Docker no host; subcomandos delegam a `docker compose run --rm api narnia-jobs <cmd>` | tudo dockerizado; nada de Node no host |
| F01-14 | Fila de jobs | **DECIDIDA (2026-10-07): BullMQ + Redis**, serviço `worker` separado, tabela `job` como espelho durável | escala por fila; sobrevive a reinício do worker |
| F01-15 | Obrigatórios sem resposta | **DECIDIDA (2026-10-07): valor provisório + `needs_research`.** Complemento do dono: para usuário brasileiro, o **salário mínimo necessário do DIEESE** é a referência de piso; se o valor informado ficar abaixo, a UI mostra um **alerta informativo** com o valor, o mês de referência e a fonte. O usuário decide sozinho; o sistema só mostra dados, nunca bloqueia nem altera o valor | não trava o onboarding; respeita a autonomia do usuário |
| F01-16 | Biblioteca de tempo | **`moment-timezone`** isolada em `packages/shared/src/time.ts` | decisão do dono |
| F01-17 | Node no `node:sqlite` | exigir **Node ≥ 22.13**; iniciar a api com `--no-warnings=ExperimentalWarning` | 22.16 ainda emite aviso experimental |
| F01-18 | Validação de schema na API | **zod** nos handlers via `@hono/zod-validator` | mesmo schema do `shared` |
| F01-19 | Geração de ids | **UUID v7** (`crypto.randomUUID` não é v7; usar `uuid`) | ordenável por tempo |
| F01-20 | Cobertura | **`@vitest/coverage-v8`**, limiar 80% em `core` e `shared` | definição de pronto §6.5 |
| F01-21 | Motor de OCR | **`tesseract.js`** (WASM, no worker) · binário Tesseract na imagem · serviço `ocr` separado | WASM evita binário nativo; migrar para serviço separado se o tempo por página passar de ~5 s |
| F01-22 | Consolidação das leituras | **por seção com voto e confiança** (origem registrada por trecho) · concatenar e deixar o modelo resolver · escolher a melhor leitura inteira | rastreabilidade: a revisão mostra de onde veio cada trecho |
| F01-23 | Desenvolvimento | **100% em containers** (`docker-compose.dev.yml`, `./start.sh dev|test|e2e`) | decisão do dono: sem conflitos no host |
| F01-24 | Metodologia | **TDD** em todos os marcos, e2e por fluxo, registro em §8 (`../09-metodologia-tdd.md`) | decisão do dono |
| F01-25 | Renderização de páginas para OCR | `pdfjs` via `unpdf` + `canvas` WASM (`@napi-rs/canvas` é nativo: evitar) · `pdftoppm` (poppler) na imagem | **poppler na imagem** (`pdftoppm`, pequeno e confiável) |

## 6 · O que precisa estar coberto para o F1 funcionar

### 6.1 Marcos de implementação (ordem obrigatória; cada marco termina com seus testes verdes)

Ambiente de desenvolvimento verificado em 2026-10-07: Node 22.16, pnpm 9.15, Docker 28 com Compose v2.36, Chromium do Playwright em cache, 24 núcleos, 60 GB RAM, ~32 GB livres em disco.

| Marco | Entrega | Verificação |
|-------|---------|-------------|
| **M1 Esqueleto em Docker** | `docker-compose.dev.yml` + `docker/Dockerfile` (estágio dev) + `start.sh`/`start.ps1` com `dev|test|lint|build`; `pnpm-workspace.yaml`, `turbo.json`, `biome.json`, `tsconfig.base.json`; pacotes vazios `apps/web`, `apps/api`, `apps/worker`, `packages/core`, `packages/shared`, `packages/providers` com Vitest e um teste trivial cada; `.github/workflows/ci.yml` rodando lint + test + build **via compose**; `.editorconfig`; `README` de desenvolvimento (só Docker) | `./start.sh test && ./start.sh lint && ./start.sh build` verdes sem Node no host |
| **M2 Shared** | schemas zod: `User`, `Profile`, `FactProposal` (union por `kind`), `FileDigest`, `ExtractionOutput`, `Job`, `UsageEvent`, contratos de API (request/response por rota); `toJsonSchema(ExtractionOutput)`; `time.ts` (`toUtcIso`, `formatInUserTz`, `nowUtc`); `i18n/types.ts`; fixtures válidas/inválidas | testes de §6.2 `packages/shared` |
| **M3 Core** | `db/` (WAL, `busy_timeout`, `migrate()` idempotente, `0001_init.sql` com todas as tabelas de §3, seed `salary_reference`), repositórios (`users`, `profiles`, `facts` por tipo, `sourceFiles`, `readings`, `digests`, `ingestionRuns`, `proposals`, `jobs` espelho, `usageEvents`, `settings` com `facts_version`), `phone/`, `salary/`, `pdf/` (`text.ts` via `unpdf`, `render.ts` via `pdftoppm`, `ocr.ts` via `tesseract.js`, `consolidate.ts`), `extract/` (docx, md/txt, texto livre; magic bytes; limites), `digest/`, `usage/` (evento + JSONL diário), `profile/suggest.ts`, `estimate.ts` | testes de §6.2 `packages/core`, cobertura ≥ 80% |
| **M4 Providers + Worker + API** | `packages/providers` (`Provider`, `MockProvider` com fixtures e modos `loggedOut`/`slow`/`error`/`authMethod` controláveis por `POST /api/_test/mock`, `ClaudeCodeProvider`: `detect` via `claude auth status`, `readDocument`/`extractFacts`/`buildDigest` via SDK + `outputFormat`); `apps/worker` com filas `ingest`, `ocr`, `extract` e a cadeia de §2.5, progresso via eventos BullMQ, espelho em `job`; `apps/api` Hono: token de boot, rotas de §2.6 com `zod-validator`, upload multipart, enqueue, WS `/ws` retransmitindo eventos do Redis, estimativa, `onboarding/state`, `dashboard`, CLI `narnia-jobs doctor|login|install-plugin` | testes de §6.2 `apps/api`, `apps/worker`, `packages/providers`; fluxo completo com mock via `curl` no compose de dev |
| **M5 Web** | Vite + React 19 + TanStack Router/Query + Tailwind (tema claro/escuro) + shadcn/ui; `i18n` (`t()`, `pt-BR.ts`); shell L0 mínimo com `ActivityTray` e indicador de provider; wizard de **5 passos** (Provider, Fonte arquivo/texto + opções, Extração em etapas, Revisão + identidade + origem por trecho, Perfil + carreira + alerta DIEESE) retomável; dashboard; `formatInUserTz` em todas as datas | testes de §6.2 `apps/web`; fluxo completo manual com mock em `./start.sh dev` |
| **M6 Produção** | `docker/Dockerfile` multi-stage (build → runtime `node:22-slim` + git + poppler-utils + dados de idioma do Tesseract + CLI `@anthropic-ai/claude-code` global), `docker/web.Dockerfile` (nginx + `nginx.conf` com proxy `/api`, `/ws`, `/mcp`), `docker/entrypoint.sh` (migrations na api), `docker-compose.yml` (web, api, worker, redis; `127.0.0.1:${NARNIA_PORT:-3100}:80`; volumes `./data`, `claude-auth`, `redis-data`; `CLAUDE_CODE_OAUTH_TOKEN` repassado do `.env` quando existir), `docker-compose.e2e.yml` (mock, dados temporários, Playwright em container), `start.sh`/`start.ps1` completos (`up`: porta livre 3100–3199, `.env`, compose, health, URL; `down`; `login` → `claude auth login` interativo no container; `doctor`; `logs`) | `docker compose build` ok; `./start.sh up` abre a UI nos 3 SOs; `down`/`up` mantém dados e login |
| **M7 E2E + fechamento** | Playwright em container sobre o compose e2e: cenários E2E-01 a E2E-17; CI roda build das imagens + e2e; smoke `start` nos 3 SOs; `README` de uso (pré-requisito: só Docker; `./start.sh up`, login, dados, backup, apagar, `down -v` apaga o login); checagem de `git ls-files` sem `data/`/`.env`; atualização dos documentos 02–05 e §8 | §6.5 completo |

Regras durante a implementação:
- **TDD** (`../09-metodologia-tdd.md`): em cada marco, o teste que falha vem antes do código; correções começam por teste de regressão; §8 registra os ids e "teste antes: sim/não".
- Nenhum comando exige Node/pnpm no host; tudo via `./start.sh`.
- Nenhum teste automatizado usa a assinatura real; só `MockProvider`. O `ClaudeCodeProvider` é testado com `exec`/`query` injetados.
- Cada marco registra em §8: data, o que foi entregue, desvios do escopo e decisões novas (`F01-21+`).
- Nada de dados reais em fixtures: currículos de fixture são fictícios (nomes, e-mails e telefones inventados).
- Commits: só quando o dono do projeto pedir; até lá, a árvore de trabalho é o registro.

### 6.2 Testes unitários (Vitest) · obrigatórios
**`packages/core`**
- `phone`: aceita `+55` + `11` + `999999999` → `+5511999999999`; rejeita DDD inválido, número curto, país desconhecido; formata para exibição pt-BR e en-US.
- `pdf/text`: fixtures PDF (texto, 2 páginas), DOCX, MD; extrai texto, conta páginas, detecta idioma, calcula `quality` (densidade de texto por página); rejeita arquivo com extensão falsa (magic bytes); rejeita > 10 MB; PDF > 20 páginas marca aviso.
- `pdf/render` + `pdf/ocr`: fixture PDF escaneado (imagem) → páginas PNG → texto por página com confiança; idioma por+eng; página em branco não gera texto.
- `pdf/consolidate`: três leituras de fixture com divergências plantadas (data "2021" vs "2027" em uma leitura; nome de empresa com erro de OCR) → voto escolhe a maioria, registra `origin` e `agreement` por segmento; leitura ausente (OCR desligado) não quebra; PDF só-imagem usa OCR + modelo.
- `db`: migrations aplicam do zero e são idempotentes; repos de `user`, `profile`, `experience`, `skill` fazem CRUD; `ingestion_proposal.review` aplica aceitar/editar/rejeitar e gera `fact_source`; aceitar `identity` não cria `user` duplicado.
- `digest`: valida schema; persiste texto e JSON; `edited_by_user` preservado em re-extração.
- `profile.suggest`: dado um conjunto de experiências, sugere cargo/senioridade/área por heurística (casos: 7 anos backend → sênior; 1 ano → júnior; títulos de gestão → PM).
- `jobs` (espelho): aplica eventos `active/progress/completed/failed/stalled` à tabela em ordem e de forma idempotente; `jobId` determinístico por `(run_id, etapa)`.
- `usage`: grava `usage_event` a partir de um `result` do SDK (com e sem campos de cache), escreve JSONL em arquivo do dia, soma por categoria.
- `extract.text` para texto livre: normaliza quebras, rejeita < 200 chars, aceita até 50k.

**`packages/shared`**
- Schemas zod aceitam fixtures válidas e rejeitam inválidas; JSON Schema gerado é estável (snapshot).
- `time.ts`: `toUtc`/`formatInUserTz` com `America/Sao_Paulo`, `Europe/Lisbon` e `UTC`, inclusive em transições de horário de verão; datas sem hora não sofrem conversão.
- `Profile`: rejeita sem faixa salarial/contrato/localidade/disponibilidade, exceto quando o campo está em `needs_research`.
- `salary/reference.ts`: `isBelowReference(min, currency, period, ref)` só compara BRL mensal; retorna `null` para outras moedas/períodos; normaliza anual→mensal quando `period = yearly` em BRL (÷ 12, documentado); migration semeia uma linha DIEESE `is_current` com `reference_month` e URL.

**`apps/worker`** (Redis real em container de teste ou `ioredis-mock`)
- Cadeia de §2.5 com `MockProvider`: ordem das etapas, progresso em ordem, `usage_event` por chamada ao modelo, `options` desligando OCR/leitura pelo modelo pulam as etapas certas; falha em `extract.digest` mantém fatos e deixa digest pendente; job `stalled` é reprocessado sem duplicar propostas (idempotência por `jobId`).
- `readDocument` restringe `Read` à pasta do upload (opções passadas ao SDK verificadas por mock).

**`packages/providers`**
- `ClaudeCodeProvider.readDocument`: `query()` mockado; valida `tools: ["Read"]`, diretório restrito, `maxTurns: 3`, `outputFormat`.

**`apps/api`**
- Rotas com `MockProvider`: fluxo completo upload → estimate → ingestion → review → user → profile → dashboard; erros: sem token (401), arquivo inválido (400), ingestion inexistente (404), review com decisão para proposta de outro run (409).
- `ClaudeCodeProvider.detect`: com `claude` ausente / `auth status` exit 1 / exit 0 com `authMethod` `claude.ai` e `oauth_token` (processos mockados por injeção de `exec`).
- `narnia-jobs doctor` (CLI na api): reporta "volume", "token" ou "não logado", Redis alcançável, `/data` gravável, worker vivo (heartbeat no Redis).
- `start.sh`/`start.ps1`: testes com `bats` e Pester em container: escolha de porta livre, escrita do `.env`, repasse de `CLAUDE_CODE_OAUTH_TOKEN` só quando presente, mensagem clara quando Docker não está rodando.
- `ClaudeCodeProvider.extractFacts`/`buildDigest`: `query()` mockado; valida **duas** chamadas na ordem fatos → digest, com `model` lido de `settings` (haiku/sonnet por padrão), `tools: []`, `maxTurns: 1`, `outputFormat` com o schema certo em cada uma; a segunda recebe os fatos da primeira; trata `structured_output` ausente e `error_max_structured_output_retries` em qualquer das duas (falha na segunda mantém os fatos e marca o digest como pendente, com "tentar de novo" só para o digest).
- Estimativa de tokens: função pura por chamada e total, casos de borda (texto vazio, 50k chars), rótulo por modelo.
- WS retransmite eventos do Redis para os clientes da sessão correta, sem duplicar.
- Rotas de jobs: listar, cancelar, retomar; 409 ao cancelar job concluído.
- Texto livre: `POST /api/texts` cria `source_file(kind=text)` e segue o mesmo fluxo do arquivo.
- WS: emite `ingestion.progress` em ordem e `done` uma única vez.

**`apps/web`**
- `PhoneInput`: três campos, validação ao sair, mensagem de erro, valor E.164 no submit.
- Wizard: 5 passos, avança/retrocede, retoma no passo salvo, bloqueia passo 4 com obrigatórios vazios; do passo 5 vai direto ao dashboard.
- `ProposalList`: aceitar/editar/rejeitar individual e em lote; contador de pendentes; proposta editada mostra badge "editado".
- `ProviderCard`: renderiza os 4 estados; botão "verificar" chama a API e atualiza.
- `FileDropzone`: aceita tipos corretos, rejeita extensão/tamanho com mensagem.
- `FreeTextEditor`: contador, mínimo de 200 chars, máximo 50k, aviso de rascunho salvo localmente.
- `ActivityTray`: renderiza jobs recebidos por WS, atualiza progresso por etapa, mostra erro e "reprocessando", botões cancelar/tentar de novo chamam a API.
- `ExtractionOptions`: desligar OCR/leitura pelo modelo atualiza a estimativa; `ReadingOriginBadge` mostra texto/OCR/modelo e divergências.
- `SalaryRangeInput`/`ContractTypes`/`LocationsInput`: obrigatórios, opção "não sei" marca o campo e libera o avanço.
- `SalaryReferenceAlert`: aparece só com BRL mensal abaixo da referência; mostra valor, mês e link da fonte; não desabilita o botão de avançar; some ao corrigir o valor; não aparece para USD/EUR.
- `i18n`: toda string renderizada vem do dicionário (teste que varre componentes em busca de literais em pt-BR fora de `pt-BR.ts`).
- Datas no dashboard aparecem no fuso do usuário (mock de `timezone`).

### 6.3 Testes e2e (Playwright, Chromium) · obrigatórios
Rodam contra `docker compose -f docker-compose.yml -f docker-compose.e2e.yml up` (provider mock, pasta de dados temporária).
- **E2E-01 caminho feliz com CV**: abrir URL com token → provider "logado" (mock) → upload `fixtures/cv_pt.pdf` → estimativa visível → extrair → progresso → revisão mostra ≥ 1 experiência, ≥ 3 skills, identidade pré-preenchida → preencher telefone → aceitar tudo → perfil sugerido → dashboard com contadores corretos.
- **E2E-02 sem CV**: "Não tenho" → formulário vazio → preencher obrigatórios → perfil manual → dashboard vazio.
- **E2E-03 telefone obrigatório**: tentar avançar sem telefone → erro; DDD inválido → erro; válido → avança.
- **E2E-04 provider não logado**: mock em estado `loggedOut` → instruções com os dois caminhos visíveis (`narnia-jobs login` em destaque, token como alternativa) → simular login (endpoint de teste do mock, `authMethod` = `claude.ai`) → "verificar de novo" → avança e o cartão mostra "logado por volume"; repetir com `authMethod` = `oauth_token` → "logado por token".
- **E2E-05 retomada**: fechar no passo 4, reabrir → volta ao passo 4 com propostas intactas.
- **E2E-06 persistência**: concluir onboarding → `docker compose down` → `up` → dashboard mantém os dados; arquivo em `./data/uploads` existe.
- **E2E-07 rejeição e edição**: rejeitar uma experiência e editar o título de outra → dashboard e banco refletem.
- **E2E-08 erro na extração**: mock retorna erro → tela oferece "tentar de novo" e "continuar manual" → ambos funcionam.
- **E2E-09 arquivo inválido**: `.exe` renomeado para `.pdf` → recusado com mensagem.
- **E2E-10 texto livre**: aba "Texto livre" → colar relato de ~2k chars → extrair → revisão com propostas → concluir.
- **E2E-11 job em segundo plano**: iniciar extração (mock lento, 10 s) → navegar para o dashboard pelo shell → bandeja mostra progresso → voltar ao wizard quando concluir.
- **E2E-12 worker reiniciado**: iniciar extração (mock lento) → `docker compose restart worker` no meio → bandeja mostra "reprocessando" → conclui sem propostas duplicadas.
- **E2E-13 porta ocupada**: ocupar 3100 no host antes de `./start.sh up` → sistema sobe em 3101 → URL impressa correta → dados criados em 3101 aparecem numa execução seguinte em 3100.
- **E2E-14 dados obrigatórios de carreira**: tentar concluir o perfil sem faixa salarial → erro; marcar "não sei" → avança e o dashboard mostra "1 item para pesquisar com o recrutador"; o provisório em BRL é a referência DIEESE.
- **E2E-17 PDF escaneado**: upload de `fixtures/cv_scan.pdf` (só imagem) → etapas OCR e leitura pelo modelo (mock) rodam → revisão mostra propostas com origem "OCR"/"modelo" e uma divergência plantada → concluir.
- **E2E-16 alerta DIEESE**: usuário no Brasil informa `salary_min` em BRL mensal abaixo da referência → alerta com valor, mês e fonte visível → avança mesmo assim → perfil salvo com o valor informado e `salary_below_reference = true`; mesmo valor em USD → sem alerta.
- **E2E-15 fuso horário**: usuário com `America/Sao_Paulo` vê a hora do upload convertida (comparar com o UTC gravado via API).

### 6.4 Teste manual com provider real (antes de fechar F01)
Checklist registrado em `tasks/F01-onboarding.md §8` ao final: 5 CVs reais (2 pt-BR, 2 en-US, 1 misto), medir tokens reais × estimativa por chamada, taxa de edição dos fatos (Haiku) e qualidade do digest (Sonnet) em separado, tempo total. Resultado calibra os padrões de `settings.models.extraction`.

### 6.5 Definição de pronto
- Todos os testes de 6.2 e 6.3 verdes na CI; cobertura ≥ 80% em `core` e `shared` (`@vitest/coverage-v8`).
- `docker compose up` funciona em Linux, Windows (Docker Desktop) e macOS, verificado manualmente uma vez cada.
- `README` com: pré-requisitos, `docker compose up`, login, onde ficam os dados, como fazer backup, como apagar.
- Nenhum dado pessoal, token ou `./data` no repositório (checagem na CI com `git ls-files`).
- Documentos `../02`, `../03`, `../04`, `../05` atualizados com o que mudou durante a implementação.
- Critério de entregável publicável de `README.md` (tasks) cumprido: instalação limpa, README de uso, estados de erro, i18n completo, CI nos 3 SOs, sem dados pessoais. Para o F01 vale também: um usuário sem contexto consegue instalar, logar, extrair o CV e chegar ao dashboard só com o README.

---

## 7 · Riscos específicos
| Risco | Mitigação |
|-------|-----------|
| `outputFormat` com Haiku devolver JSON incompleto em CVs longos | limitar texto a ~30k chars no passo rápido; fallback de parse; medir em 6.4 |
| CLI dentro do container pedir interação no primeiro `auth login` | comando documentado com `docker compose run --rm -it`; `detect()` orienta |
| Extração de texto ruim em PDFs com colunas/imagens | mostrar o texto extraído na revisão quando a confiança média for baixa; aviso "este PDF parece ser imagem; OCR fica para F03" |
| Volume de dados em bind mount lento no macOS | volume pequeno; aceitável |
| SDK em versão 0.3.x mudando opções | fixar versão exata; teste unitário de `extractCv` valida as opções usadas |
| Worker cai no meio da cadeia | BullMQ reprocessa `stalled`; etapas idempotentes por `jobId`; E2E-12 cobre |
| OCR lento (tesseract.js em WASM) em PDFs longos | limite de 20 páginas em F01; medir tempo por página; F01-21 prevê serviço `ocr` separado |
| Leitura do documento pelo modelo gasta tokens em todo PDF | opção desligável no passo 2; Haiku por padrão; estimativa visível |
| Dois processos (api, worker) no mesmo SQLite | WAL + `busy_timeout`; escritas curtas; teste de concorrência em `core` |
| Imagem maior (poppler, dados do Tesseract, CLI) | multi-stage; medir tamanho; aceitar até ~700 MB em F01 |
| Scripts `start.sh`/`start.ps1` divergirem | mesmos subcomandos e mesmos testes (bats/Pester) em CI; lógica mínima nos scripts, resto na CLI dentro do container |
| `moment-timezone` pesado no bundle | carregar só os dados de fuso necessários (`moment-timezone/builds/moment-timezone-with-data-10-year-range`) |

## 8 · Registro de execução
| Data | Marco | O que aconteceu |
|------|-------|-----------------|
| 2026-10-07 | — | F01 refinado: decisões F01-1 a F01-20 propostas; marcos M1–M7 definidos; ambiente local verificado (Node 22.16, pnpm 9.15, Docker 28, Compose 2.36). Implementação aguarda o fechamento das decisões. |
| 2026-10-07 | M1 | Implementação iniciada em segundo plano: M1 (esqueleto em Docker) e M2 (shared), em TDD. |
| 2026-10-07 | M6 | Marcos M1–M6 concluídos; falta M7 (e2e Playwright em container por fluxo, README público final, fechamento). |
| 2026-10-07 | M1 | **M1 entregue.** Imagem `docker/Dockerfile` (estágio `dev`: node:22-bookworm-slim, Node 22.23.3, pnpm 12.9.1 via corepack, git; esqueleto de `build`/`runtime`), `docker-compose.dev.yml` (serviço `dev` + perfis `app`: api/worker/web com hot reload, redis), `start.sh` e `start.ps1` (`dev|test|lint|typecheck|build|shell|test:sh|install`; produção stubada até M6), monorepo pnpm workspaces + Turborepo + Biome + tsconfig base (`moduleResolution: bundler`, strict), seis pacotes com Vitest, CI (`lint`, `typecheck`, `test`+cobertura, `build`, `shell-scripts`, `no-personal-data`, tudo via compose), README "Desenvolvimento". Resultado: `./start.sh lint` → 70 arquivos, 0 erros · `typecheck` 9/9 · `test` 9/9 · `build` 6/6 · `test:sh` 7/7. **Testes (TDD):** `M1/shared smoke`, `M1/core smoke`, `M1/providers MockProvider.detect` (3), `M1/api GET /api/health` (2), `M1/worker createQueues` (2), `M1/web App` (1): teste antes: **sim** (vermelho confirmado: "Cannot find module", depois verde). `scripts/test/start.bats` (7: `find_free_port`, `write_env`, `env_value`): teste antes: **não** (teste e função no mesmo passo); compensado por **mutação** (bug de prefixo em `write_env` → teste 6 falhou → restaurado). Exceções sem teste (configuração): Dockerfile, compose, turbo, biome, tsconfig, CI, README. |
| 2026-10-07 | M1 | **Decisões de implementação (F01-26+):** F01-26 pnpm **12.9.1** (versão corrente; `allowBuilds` em `pnpm-workspace.yaml`: esbuild sim, msgpackr-extract não). F01-27 **TypeScript 5.9.3**, não 7.x (7.0 é o compilador nativo recém-lançado; evitar risco na fundação). F01-28 pacotes do workspace exportam **fonte TS** (`exports → src/index.ts`); apps serão empacotadas em M6, `build` dos pacotes = `tsc --noEmit`. F01-29 `moduleResolution: bundler` em todo o monorepo (sem `.js` em imports relativos). F01-30 `@types/node` 22.x (alinhado ao runtime). F01-31 zod **4.6.5** com `z.toJSONSchema` nativo (sem `zod-to-json-schema`). F01-32 `COREPACK_HOME=/pnpm/corepack` na imagem para não baixar o pnpm a cada `run`. |
| 2026-10-07 | M2 | **M2 entregue** (`packages/shared`, 100% TDD, 3 lotes vermelho→verde). Lote A, schemas (`test/schemas.test.ts`, 19): `UserSchema` (telefone E.164+país+nacional, fuso IANA via `Intl`, relocação e `workAuth` obrigatórios), `ProfileSchema` (regra F01-15 em `requireCareerFields`: salário/contratos/localidades/disponibilidade obrigatórios salvo `needsResearch`), `FactProposalSchema` (união por `kind`, 7 tipos), `FileDigestSchema`, `JobSchema`, `UsageEventSchema`, `SalaryReferenceSchema`; fixtures fictícias em `test/fixtures/*.json`. Lote B (`extraction-output` 5, `json-schema` 3, `api-contracts` 8): `ReadDocumentOutput`/`ExtractFactsOutput`/`BuildDigestOutput` + `extractFactsOutputToProposals`; `toJsonSchema` (draft 2020-12) + `EXTRACTION_JSON_SCHEMAS` com snapshot; contratos de todas as rotas de §2.6 e `WsEventSchema`. Lote C (`time` 10, `i18n` 4): `nowUtc`, `toUtcIso`, `formatInUserTz` (Sao_Paulo, Lisbon com DST, UTC, virada de dia, fuso inválido), `isDateOnly`/`formatDateOnly` sem conversão; `createTranslator` tipado por caminho, interpolação, `onMissing` único. Vermelho confirmado em cada lote (19, 13 e 12 falhas) antes do código. Correção durante o lote B: `.omit()` não aceita schema com refinamento → exportado `ProfileBaseSchema` + `requireCareerFields` reutilizável (teste já existia, teste antes: sim). **Cobertura shared: 98,11% linhas · 90,24% branches · 100% funções** (limiar 80% ativo). Total shared: 50 testes. |
| 2026-10-07 | M3 | **M3 entregue** (`packages/core`, TDD em 3 lotes vermelho→verde + 1 lote de cobertura). **Lote A** (24 testes, vermelho confirmado: 5 arquivos sem módulo): `db/open` (WAL, `busy_timeout` 5 s, FKs), `db/migrate` (SQL puro, `schema_migrations`, idempotente), `0001_init.sql` com as 19 tabelas de §3 + seed DIEESE placeholder, repositórios `settings` (`bumpFactsVersion` único ponto), `users` (usuário único, `complete()` valida UserSchema), `profiles`, `facts` (fábrica genérica; toda escrita incrementa `facts_version`), `factSources`, `sourceFiles`, `readings`+segmentos, `digests` (preserva edição do usuário), `ingestionRuns`, `proposals.review` (aceitar/editar/rejeitar, `fact_source`, `experienceIndex`→id, idempotente, erro para run alheio), `jobs` (espelho idempotente, estado terminal não rebaixa), `usageEvents`, `salaryReferences`; `phone` (E.164 via libphonenumber-js, erros tipados), `salary/isBelowReference`, `ids` (UUID v7). Testes: `test/db/migrate`, `test/db/repos`, `test/phone`, `test/salary`, `test/ids`. Teste antes: sim. |
| 2026-10-07 | M3 | **Lote B** (19 testes, vermelho confirmado): fixtures fictícias geradas por `test/fixtures/generate.ts` em container (`cv_text.pdf` via pdf-lib, `cv_scan.pdf` = páginas renderizadas por `pdftoppm` embutidas como imagem + página em branco, `cv.docx` via docx, `cv.md`, `texto_livre.txt`, `readings/divergences.json` com erros plantados); `pdf/text` (unpdf, `quality` por densidade), `pdf/render` (`pdftoppm`, exec injetável + teste real), `pdf/ocr` (tesseract.js, `Recognizer` injetável; teste real atrás de `OCR_REAL=1`, **executado uma vez com sucesso**: 955 ms, encontrou Acme e Unicamp no PDF escaneado), `pdf/consolidate` (segmentação por seção, alinhamento por Dice, voto 2 de 3 por token/linha, `origin`/`agreement`/`divergences` por segmento), `extract/*` (magic bytes, DOCX via mammoth, Markdown, texto livre 200–50k, idioma por stopwords, limite 10 MB, despachante). Testes: `test/pdf/*`, `test/extract/extract`. Teste antes: sim. |
| 2026-10-07 | M3 | **Lote C** (10 testes, vermelho confirmado em 4 módulos; os 2 de concorrência já passaram com o código do lote A): `digest/saveDigest` + `readDigestText`, `usage/recordUsage` + `usageFromSdkResult` (JSONL diário em UTC), `profile/suggest` (anos sem sobreposição, área por títulos/skills, senioridade), `estimate` (por chamada, rótulos por modelo), `test/db/concurrency` (duas conexões no mesmo arquivo; `busy_timeout` espera e falha com "busy" só após o tempo). Teste antes: sim (exceto concorrência: teste depois, comportamento já existente). |
| 2026-10-07 | M3 | **Cobertura**: 1º run 93,1% linhas / 78,4% ramos (abaixo do limiar). `test/coverage-branches.test.ts` (12 testes, **teste depois: cobertura**) + refatoração para injetar a fábrica do worker do Tesseract + remoção de helpers mortos em `db/sql.ts`. Final: **97,3% statements · 89,7% ramos · 98,1% funções**, limiar 80% ativo. `./start.sh lint/typecheck/test/build` verdes: 123 testes no monorepo (65 core + 50 shared + 8 demais), 1 pulado (OCR real, opcional). |
| 2026-10-07 | M3 | **Decisões de implementação (F01-33+):** F01-33 colunas de contato do `user` **nullable no banco**; obrigatoriedade garantida pelo `UserSchema` nas fronteiras (a identidade do CV chega antes do telefone). F01-34 estágio `dev` da imagem ganha `poppler-utils` e dados `tessdata_fast` por+eng em `/usr/share/tessdata` (OCR sem rede); `tesseract.js` com `allowBuilds: false` (postinstall só imprime aviso). F01-35 `node:sqlite` rejeita parâmetros nomeados não usados: helper `omit` nos UPDATEs. F01-36 formato internacional de telefone segue a libphonenumber (`+55 11 99999 9999`, espaços). F01-37 densidade "completa" da camada de texto = 800 chars/página. F01-38 teste real de OCR opcional por `OCR_REAL=1` (lento, depende dos dados na imagem); CI roda só o pipeline com reconhecedor fake. F01-39 `zod` adicionado como dependência do `core` (tipos). F01-40 pnpm 12 gravou `minimumReleaseAgeExclude: docx` em `pnpm-workspace.yaml` ao instalar `docx@9.9.0` (pacote mais novo que a idade mínima); mantido. Seed DIEESE: valor placeholder 7300,00 (2026-09), comentado no SQL para confirmação na primeira execução real. |
| 2026-10-07 | M4 | **M4 entregue** (providers + worker + api), TDD em 3 lotes vermelho→verde. **Lote A `packages/providers`** (vermelho: 18 falhas, módulos inexistentes): interface `Provider` completa (`detect`, `readDocument`, `extractFacts`, `buildDigest`) com `ProviderResult` (saída validada + `usage` + `costUsd` + trecho `sdk` para `usageFromSdkResult`); `MockProvider` com fixtures fictícias (mesma "Ana Maria Exemplo" do core) e modos em memória (`loggedOut`, `authMethod`, `delayMs`, `errors` por operação, `setMode/getMode`); `ClaudeCodeProvider`: `detect` via `claude auth status` (JSON + exit code; `exec` injetável; versão via `--version`), `readDocument`/`extractFacts`/`buildDigest` via `query()` do Agent SDK 0.3.292 (`query` injetável) com `tools: []`/`["Read"]`, `allowedTools`, `cwd` restrito à pasta do upload, `maxTurns` 1/3, `systemPrompt` em `prompts/*.md`, `outputFormat: { type: "json_schema" }` com os schemas do shared, fallback de parse do texto, `ProviderError` (`query_failed`, `structured_output_failed`, `invalid_output`); `resolveClaudeBinary` (explícito → PATH → binário embutido do SDK); `createProviderFromEnv`. 22 testes. Teste antes: sim. |
| 2026-10-07 | M4 | **Lote B `packages/core` + `apps/worker`** (vermelho: 3 suítes sem módulo + 1 falha): no core, `ingest/chain.ts` (`planStages`, `stageJobId` sem `:`, `nextStage`, `enqueueStage` com espelho `queued`, `DEFAULT_JOB_OPTIONS`), `models.ts` (`resolveExtractionModels` lendo `settings.models.extraction`, padrões haiku/haiku/sonnet; `localeFromLanguage`), `usageEvents.summarizeByModel/totalTokens`, `jobs.requeue`. No worker: `pipeline.ts` (`processStage` idempotente por etapa, enfileira a próxima ou marca `review`; `onStageFailed`: digest pendente mantém `review`, o resto vira `error`), processadores `read-text`, `ocr` (pdftoppm + tesseract.js, 20 páginas), `read-doc`, `consolidate` (voto, segmentos com origem; fallback para a leitura mais longa), `facts`, `digest`; `events.ts` (`handleQueueEvent` → `jobs.applyEvent` + evento WS); `worker.ts` (`startWorkers`: um Worker BullMQ por fila, eventos → espelho, publicação em `<prefix>:ws`, heartbeat em `<prefix>:worker:heartbeat`, `failed` com tentativas restantes vira `retrying`); `main.ts`. Testes: core +8, worker 11 (processadores com SQLite em memória, mock e OCR fake; eventos; **integração com Redis real** da cadeia completa). Teste antes: sim. |
| 2026-10-07 | M4 | **Lote C `apps/api`** (vermelho: 10 suítes sem módulo): `createApp(deps)` com token de boot (bearer ou cookie HttpOnly gravado por `/api/auth/enter?token=`; query string só nessa rota), log JSONL de requisições em `/data/logs/api-*.jsonl`, rotas de §2.6 com `@hono/zod-validator` e contratos do shared (`provider/status`, `_test/mock` só com `MockProvider`, `onboarding/state` GET/PUT, `files` multipart com magic bytes e dedupe por sha + `<sha>.meta.json`, `texts`, `files/:id/estimate` por modelo, `ingestions` POST/GET/review com origem por trecho inferida dos segmentos, `jobs` list/get/cancel/retry, `usage/summary`, `user` GET/PUT com `parsePhone`, `profiles` POST/GET/suggestion com provisório DIEESE e `salaryBelowReference`, `dashboard`), WS `/ws` (`ws`, autenticado, fecha 4401), relay Redis → bus com dedupe de duplicatas consecutivas, `BullQueueAdapter` (cancel remove da fila; retry via `job.retry()` ou reenfileira), `doctor.ts` + CLI `narnia-jobs doctor|login|install-plugin` (stub F04), `server.ts`. 32 testes (11 arquivos). Teste antes: sim; o teste M1 de health foi adaptado à nova assinatura de `createApp`. |
| 2026-10-07 | M4 | **Verificação**: `./start.sh lint` → `Checked 183 files. No fixes applied.`; `typecheck` → 9/9; `test --force` → 9/9 (**189 testes**: shared 50, providers 22, core 73 + 1 opcional, worker 11, api 32, web 1); `build` → 6/6; `test:sh` → 7/7. **Fluxo `curl` completo executado no compose de dev** (api + worker + redis, provider mock, OCR e `pdftoppm` reais): upload `cv_text.pdf` (201, 2 páginas) → estimativa (`~3.6k haiku` + `~1.2k haiku` + `~2.5k sonnet`) → ingestão → 6 etapas `done` em ~4 s (text_layer q=0.63, ocr q=0.94 em 871 ms, model_read q=0.92; 19 segmentos; 16 propostas; digest) → revisão aceitando tudo (`runStatus: done`, 16 fatos verificados) → `PUT /api/user` → sugestão (`Engenheira de Software Sênior`, senior, software, 5.9 anos) → perfil com BRL 6000 → `salaryBelowReference: true` → dashboard (2 experiências, 6 skills, 1 formação, 1 arquivo, 6710 tokens) → `narnia-jobs doctor` ok (auth volume, redis, dados, worker vivo). |
| 2026-10-07 | M4 | **Decisões de implementação (F01-41+):** F01-41 o SDK traz o CLI embutido (`@anthropic-ai/claude-agent-sdk-linux-x64/claude`, 251 MB, v2.1.292): `detect` e `narnia-jobs login` usam esse binário quando não há `claude` no PATH; em M6 a imagem pode dispensar a instalação global do CLI. F01-42 prompts em `.md` lidos em runtime via `import.meta.url` (pacotes exportam fonte TS, F01-28). F01-43 provider devolve `usage` normalizado **e** o trecho `sdk` (snake_case) para `usageFromSdkResult`. F01-44 jobId `${runId}__${stage}` (BullMQ proíbe `:`); `removeOnComplete: true`, `removeOnFail: false`, `attempts: 2`; `failed` com tentativa restante é publicado como `retrying`, não como erro. F01-45 encadeamento por enfileiramento ao concluir (não FlowProducer). F01-46 qualidade da leitura pelo modelo fixada em 0,92 (perde para camada de texto completa, ganha de PDF escaneado); nota: a fixture `cv_text.pdf` (pdf-lib, pouco texto por página) dá q≈0,63 à camada de texto, então o OCR vira base nela. F01-47 o espelho `job` é escrito pelo **worker** (eventos do Worker), e a api só retransmite eventos WS via canal Redis `<prefix>:ws`. F01-48 origem por trecho inferida por busca do fato nos segmentos (mínimo 3 chars; palavra inteira abaixo de 5), senão `consolidated`. F01-49 Turborepo em modo estrito de env: `globalPassThroughEnv` para `REDIS_URL`, `OCR_REAL`, `TESSDATA_PATH`, `NARNIA_*`, `CI` (sem isso a integração com Redis era pulada via `start.sh`). F01-50 `ingestion.status` **não** entrou no `WsEventSchema`; a UI consulta `GET /api/ingestions/:id` ao receber `job.done`. F01-51 `GET /api/user` devolve `{ user }` com contato possivelmente incompleto; `PUT` recalcula o E.164 a partir de país + nacional. F01-52 dev: api exposta em `127.0.0.1:${NARNIA_DEV_API_PORT:-3100}` e `NARNIA_TOKEN=dev-token` só no compose de dev; `start.sh cli <cmd>` roda a CLI no container. **Desvios/achados:** `mkdirSync` recursivo em `/proc/...` bloqueia dentro do container (travou a suíte); o caso negativo do `doctor` passou a usar pasta temporária sem permissão. api e worker criam `NARNIA_DATA_DIR` no boot (bind mount vazio em dev). pnpm 12 gravou 9 entradas do SDK em `minimumReleaseAgeExclude`. Nada commitado; containers de dev derrubados ao final (redis permanece para os testes). |
| 2026-10-07 | M5 | **M5 entregue** (`apps/web`), TDD em 4 lotes vermelho→verde. **Lote A `lib` + `i18n`** (5 suítes sem módulo): `lib/api` (cliente tipado pelos contratos do shared, bearer, `ApiError` com código do servidor e `network`), `lib/token` (`?token=` → `/api/auth/enter`), `lib/ws` (valida `WsEventSchema`, reconexão com backoff, fila até o primeiro ouvinte), `lib/theme` (localStorage + `prefers-color-scheme`, classe `dark`), `i18n` (`t()` tipado sobre `createTranslator` do shared, dicionário `pt-BR.ts`, **teste que varre `src/**/*.tsx` em busca de literais pt-BR fora do dicionário**; ele pegou o `App.tsx` do M1 e depois comentários `biome-ignore`, refinado para ignorar linhas de comentário). **Lote B shell** (3 suítes): `AppProvider` (api, ws, fuso), hooks `useJobs` (lista + WS + cancel/retry), `useProviderStatus` (WS `provider.status`), `useProfiles`, `useWsStatus`, `useTheme`; `Shell` L0 (perfil ativo/“sem perfil”, `ProviderIndicator`, `ActivityTray` com contador/progresso/reprocessando/erro, `ThemeToggle`, `SideNav` com `NavLink` que cai para âncora fora do router, rodapé com fuso e estado da conexão); `ProviderCard` + `LoginInstructions` (dois caminhos: `./start.sh login` em destaque e `claude setup-token` + `.env`). **Lote C componentes do wizard** (6 suítes): `PhoneInput` + `validatePhoneParts` (lista de 25 países com DDI/dígitos de área), `FileDropzone` (extensão/tamanho, arrastar), `FreeTextEditor` (200–50k, rascunho em localStorage), `ExtractionOptions`, `EstimateBadge` (por chamada e modelo), `ReadingOriginBadge`, `ProposalList`/`ProposalRow` (agrupamento por tipo, aceitar/editar em diálogo/rejeitar/desfazer, lote, contador), `SalaryRangeInput` (rascunho local dos campos), `SalaryReferenceAlert` + `isBelowReference` (mesma regra do core), `ContractTypes`, `LocationsInput`, `DontKnow`. **Lote D páginas** (4 suítes): `IdentityForm` (`identityFromProposal` com parse de telefone bruto, `validateIdentity`, `toUserUpsertRequest`, selos “do currículo”/“não estava no currículo”), `ProgressPanel` (etapas, “Etapa N de M”, erro com tentar de novo/pular, concluído), `FileDigestCard`, `ProfileForm` (sugestão, bloco Carreira obrigatório com “não sei” por campo, alerta DIEESE), `Dashboard` (cartão, contadores, uso, pendências, datas via `formatInUserTz`), `Wizard` de 5 passos (`StepProvider`, `StepSource`, `StepExtraction`, `StepReview`, `StepProfile`) retomável por `onboarding/state`, `router.tsx` (TanStack Router code-based: `/` redireciona pelo estado, `/onboarding/$step`, `/dashboard`, `errorComponent` com `ErrorState`), `main.tsx` (token → cookie, tema, WS com cookie/token, `TimezoneSync`). |
| 2026-10-07 | M5 | **Verificação**: `./start.sh lint` → `Checked 267 files. No fixes applied.`; `typecheck` → 9/9; `test --force` → 9/9 (**57 testes no web**, 247 no monorepo: shared 50, providers 22, core 73+1 opcional, worker 11, api 34, web 57); cobertura do web 67% linhas / 61% ramos (sem limiar: o critério de 80% vale para `core` e `shared`); `build` → 6/6 (bundle do web 740 KB, 233 KB gzip; aviso de chunk > 500 KB, ver F01-56). **Smoke no navegador headless** (Chromium do container `mcr.microsoft.com/playwright:v1.58.0-noble`, host network, contra `./start.sh dev` com mock, OCR e `pdftoppm` reais): provider logado → upload `cv_text.pdf` → estimativa “~7.2k tokens no total” → extração com 6 etapas e digest → revisão com 15 pendentes → aceitar todos + telefone → perfil sugerido “Engenheira de Software Sênior” → salário 6000 BRL dispara o alerta DIEESE → dashboard “10k tokens até agora”. Script em scratchpad; vira suíte Playwright em M7. |
| 2026-10-07 | M5 | **Decisões de implementação (F01-53+):** F01-53 **TanStack Router code-based** (sem geração de arquivos), contexto do router com `services` + `queryClient`; `/` usa `beforeLoad` + `redirect`. F01-54 **mocks de `fetch` próprios** nos testes (`createFakeApi` com Proxy que falha em método não mockado) em vez de MSW 3.x (API nova, risco de versão). F01-55 **`<select>` nativo** em vez de Radix Select (acessível e previsível no jsdom); Radix só para Dialog, Tooltip (com Provider embutido), Switch, Tabs; `@radix-ui/react-select` removido. F01-56 bundle 740 KB por causa de `moment-timezone` (build de 10 anos) + Radix: aceito em M5; otimizar (lazy do dicionário de fusos ou troca via `shared/time.ts`) fica registrado para M7/F10. F01-57 **rota `GET /api/salary-reference?country=`** adicionada na api (2 testes) para a UI mostrar o alerta antes de salvar. F01-58 Biome não parseia diretivas do Tailwind v4 (`@custom-variant`, `@theme`, `@apply`): `**/*.css` excluído do Biome. F01-59 identidade no passo 4: as propostas `identity` não entram na lista; são aceitas automaticamente na revisão e o `PUT /api/user` do formulário prevalece. F01-60 avanço do passo 4 exige **todas as propostas decididas** (mensagem “N pendentes”), além dos obrigatórios de identidade. F01-61 estado do wizard: `go()` grava `onboarding/state` antes de navegar; `finish()` marca `completed` e vai ao dashboard. **Exceções de TDD registradas**: rota `salary-reference` escrita junto com o teste (trivial); ajustes de teste após vermelho por motivo de infraestrutura (cleanup do RTL sem `globals`, `findBy` para carregamento assíncrono, locator estrito no smoke). |
| 2026-10-07 | M6 | **M6 entregue** (produção). `docker/Dockerfile` com estágios `dev` (+ `bats`, `procps`), `build`, `deps-prod` (`pnpm install --prod --filter api... --filter worker...`) e `runtime` (node:22-bookworm-slim + git + poppler-utils + tessdata copiado do `dev` + CLI do Claude embutido no SDK; usuário `node`; `/data` e `/home/node/.claude` pré-criados com dono `node`); `docker/web.Dockerfile` (build da SPA + `nginx:1.29-alpine`) com `docker/nginx.conf` (SPA fallback, proxy `/api`, `/ws` com upgrade, `/mcp`, `client_max_body_size 12m`, cache de `/assets`); `docker/entrypoint.sh` (pasta de dados, token de boot persistido em `/data/.token` 0600, `umask 077`); `docker/narnia-jobs` (shim da CLI no PATH); `docker-compose.yml` (web, api com healthcheck via `fetch`, worker, redis `appendonly`; volumes `./data`, `claude-auth`, `redis-data`; `CLAUDE_CODE_OAUTH_TOKEN` repassado; só `127.0.0.1:${NARNIA_PORT}:80` e `8089` publicadas); `docker-compose.e2e.yml` (mock, `e2e-token`, `./.e2e-data`, sem restart, serviço `playwright` perfil `e2e` com `apps/e2e` montado); `start.sh` e `start.ps1` completos (`up`, `down [--purge]`, `login`, `doctor`, `logs`, `status` + dev); README com a seção "Uso". **Testes (teste antes: sim)**: `scripts/test/start.bats` +6 (`choose_port` ×4, `app_url`, `env_has_value`; vermelho confirmado: 6 × código 127) e `scripts/test/start.Tests.ps1` (Pester, 13 testes espelhando o bats; escritos antes de `Choose-Port`/`Get-AppUrl`/`Test-EnvHasValue`). O bats expôs um **bug real** em `port_in_use` (fechava o fd 3 do chamador; corrigido: socket só no subshell, fd 9). Exceções de TDD registradas: Dockerfiles, nginx.conf, compose e entrypoint (configuração sem lógica, verificados pela prova). |
| 2026-10-07 | M6 | **Prova executada** (`.env` com `NARNIA_PROVIDER=mock`): `./start.sh up` → porta 3100 escolhida e gravada, api saudável, URL com token impressa; `GET /api/health` via nginx `{"ok":true,"version":"0.1.0-dev"}`; SPA servida (`<title>narnia-jobs</title>`); rota protegida sem token → 401; `./start.sh status` 4 containers (api e redis `healthy`); `./start.sh doctor` → `ok: true`, auth `volume` (mock), Redis, `/data` gravável, worker vivo. Persistência: `PUT /api/user` + `POST /api/profiles` (6000 BRL → `salaryBelowReference: true`) → `down` → `./data` no host com `narnia.sqlite`, `.token` 0600, `logs/` → `up` → mesmo token, dashboard e usuário intactos. Porta dinâmica: nginx descartável em 3100 → `up` escolheu **3101**, health e dados ok em 3101. `docker compose … -f docker-compose.e2e.yml config` válido (mock, `e2e-token`, `.e2e-data`). Ao final: `down -v`, `./data` (só dados fictícios da prova e fixtures de dev), `.env` e `.e2e-data` removidos. **Tamanhos**: `narnia-jobs/app` **739 MB** (node_modules 397 MB, dos quais 240 MB é o binário do CLI embutido no SDK; git + perl ≈ 80 MB; base ≈ 75 MB), `narnia-jobs/web` 63 MB, `redis:7-alpine` 39 MB. Verificação final: `lint` 267 arquivos ok; `typecheck` 9/9; `test --force` 9/9 (247 testes); `build` 6/6; bats 13/13; Pester 13/13. |
| 2026-10-07 | M6 | **Decisões de implementação (F01-62+):** F01-62 apps rodam a **fonte TS com `tsx` em runtime** (`tsx` virou dependência de produção de api e worker); sem bundler, porque os pacotes exportam fonte (F01-28) e os prompts `.md` do provider são lidos por `import.meta.url` (F01-42). F01-63 **token de boot persistido** em `/data/.token` (0600): a URL fica estável entre reinícios; `NARNIA_TOKEN` no ambiente prevalece. F01-64 **porta salva é reutilizada** quando livre e no intervalo (`choose_port`/`Choose-Port`); senão a primeira livre. F01-65 **bats no estágio `dev`** da imagem (Debian) e listener de teste em Node, porque o `nc` do BusyBox da imagem `bats/bats` aceita uma única conexão; Pester roda em `mcr.microsoft.com/powershell:7.4-ubuntu-22.04` com `Install-Module` (rede). F01-66 `umask 077` no entrypoint: tudo que a api/worker criam em `/data` nasce restrito ao dono. F01-67 imagem da app **739 MB**, acima da meta de ~700 MB por causa do CLI embutido (240 MB); `git` (~80 MB) mantido porque F03 precisa de clone, mas pode sair do runtime até lá. F01-68 `.dockerignore` excluía `*.md` e deixava os prompts do provider fora do contexto: adicionado `!packages/providers/src/**/*.md`. F01-69 `start.sh up` cria `./data` antes do Docker (bind mount criado pelo daemon pertenceria ao root). F01-70 compose: `environment` do serviço `api` repete o bloco da âncora `x-app` porque a chave explícita substitui a herdada (YAML merge). F01-71 `docker compose run --rm api narnia-jobs <cmd>` funciona porque a imagem não define `ENTRYPOINT`; o entrypoint da api é o `command` do serviço. F01-72 CI: job `images` (build + smoke `up`/health/`down` com mock) e `launcher-smoke` nos 3 SOs (funções puras, sem Docker); `shell-scripts` roda bats via compose de dev + Pester. Pendente para M7: suíte Playwright em `apps/e2e`, E2E-01…17, README público final, smoke `start.ps1 up` em Windows real. |
| 2026-10-07 | — | **Bloco técnico decidido pelo dono** (F01-1 a F01-25): Turborepo; tudo dockerizado inclusive dev; TDD; Hono; SQL puro; múltiplos containers (web, api, worker, redis); BullMQ + Redis; PDF por três leituras consolidadas (texto, OCR, modelo); Tailwind claro/escuro; passo 6 omitido. Reescritos §1, §2, §3, §4, §6 e §7. |
| 2026-10-07 | — | **Global 4 decidida pelo dono**: sem corte fixo de MVP; release quando as features estiverem redondas; cada task é um entregável publicável (critério em `tasks/README.md`), refletido em §6.5. |
| 2026-10-07 | — | **F01-5 decidida pelo dono**: extração em duas chamadas, fatos com Haiku e digest com Sonnet, configuráveis por tarefa; estágios `extracting_facts`/`building_digest`; estimativa e uso por chamada. |
| 2026-10-07 | — | **Global 11 decidida pelo dono**: os dois mecanismos de login, volume como padrão e `CLAUDE_CODE_OAUTH_TOKEN` do `.env` como alternativa automática; `detect()` expõe `authMethod`; passo 1 mostra os dois caminhos; E2E-04 ampliado. |
| 2026-10-07 | — | **F01-15 decidida pelo dono**: provisório + `needs_research`; piso de referência DIEESE (salário mínimo necessário) para usuários no Brasil com alerta informativo; o usuário decide o valor. Adicionadas tabela `salary_reference`, coluna `salary_below_reference`, componente `SalaryReferenceAlert`, E2E-16. |
