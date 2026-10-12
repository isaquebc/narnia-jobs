# F04 · Chat com o recrutador

Entregável 4 do plan-v0, o mais estrutural. Cobre o fluxo **F4** de `../02-fluxos-do-usuario.md` e entrega as duas peças que todos os fluxos seguintes usam: o **servidor MCP** (`/mcp`, streamable HTTP) com as tools de `../03-arquitetura.md §5`, e a pasta **`plugin/`** (persona, skills, hooks, `.mcp.json`), fonte única de prompts para os modos A (chat na web via Agent SDK) e B (Claude Code no host). Inclui a ingestão pela conversa, a clarificação pós-ingestão (agora possível: a F03 já foi entregue), a pesquisa na internet para dados obrigatórios, sessões múltiplas por perfil, o medidor por sessão e a observabilidade local com Arize Phoenix. Depende de F01, F02 e F03 (todas entregues).

Status: **refinada contra o código em 2026-10-11** (decisões F04-1 a F04-9 fechadas pelo dono; F04-10 a F04-15 aguardam o dono, §5). Implementação ainda não iniciada; marcos em §6.1.

---

## 1 · Objetivo e resultado esperado

Uma pessoa com perfil e dados ingeridos consegue:

1. abrir o Chat na web, ver o recrutador se apresentar como especialista no cargo/área/nível do perfil ativo e responder com franqueza sobre os dados, citando de onde cada afirmação veio;
2. ver, em chips discretos, quais tools o agente chamou e quanto a sessão já consumiu;
3. manter até 5 conversas vivas (configurável) por instalação, organizadas por perfil e categoria; ao atingir o teto, escolher qual encerrar; fechar o navegador e retomar (hibernação após 1 h, retomada transparente);
4. colar um texto de carreira, anexar um PDF/currículo ou mandar um link do GitHub no chat e ver o recrutador abrir a ingestão correspondente (mesmos pipelines da F01/F03), com estimativa e confirmação; as propostas vão para a revisão;
5. responder "não sei" para um dado obrigatório e ver o recrutador pesquisar só em domínios confiáveis, citar a fonte e propor um valor para confirmação;
6. depois de uma ingestão, clicar em "Clarificar com o recrutador" (hoje desabilitado na F03) e ter uma sessão que faz perguntas objetivas e devolve propostas para a revisão da mesma execução;
7. no modo B, rodar `./start.sh install-plugin` (ou `narnia-jobs install-plugin claude`), abrir o Claude Code no terminal e ter o mesmo recrutador, com o mesmo cartão e as mesmas tools.

### Dentro do escopo
- **Servidor MCP** em `/mcp` (Hono + transporte streamable HTTP padrão web do `@modelcontextprotocol/sdk`), autenticado pelo token de boot no header (F04-7), com registro de tools e `scopes` por categoria de sessão (F04-2).
- **Tools** com handler puro no `core` e schema no `shared`: as existentes (`profile.*`, `file.*`, `ingest.status`, `ingest.propose`) e as novas (`evidence.*`, `fact.search/get/timeline` com FTS5, `research.save/list`, `job.status/list`, `session.set_category/get`, `usage.log`, `ingest.text/file/github`).
- **`plugin/`** na raiz: `.claude-plugin/plugin.json`, `.mcp.json.template`, `agents/recrutador.md` (template da persona, fonte única, F04-1), `skills/{recrutador,perfil,clarificar}/SKILL.md`, `hooks/hooks.json` + `hooks/session-start.sh`.
- **Modo A (web):** sessões longas no `api` com o Agent SDK (`query` com entrada em streaming, `systemPrompt` montado do template, `plugins`, `mcpServers` http, `resume`), gerenciador de sessões (teto 5 com escolha, hibernação 1 h), eventos de chat no WebSocket, persistência de mensagens, nota de cartão atualizado por turno (F04-1), modelo por sessão (F04-9).
- **Modo B (terminal):** `install-plugin` (gera `.mcp.json` com porta e token da instância, registra o servidor com `claude mcp add --transport http`), `doctor` checando a conexão, nas duas instâncias.
- **Pesquisa web** só por `WebSearch`/`WebFetch` para dados `needs_research` ou pedido explícito; lista de domínios confiáveis com máscara e `trust_tag` (F04-5); registro em `research_source`; valor proposto vira sugestão para confirmar.
- **Clarificação pós-ingestão**: skill `clarificar`, rota que cria sessão ligada à execução, botão da F03 habilitado.
- **Medidor por sessão**: `usage_event` com `session_id`; chips de uso; total por sessão.
- **Observabilidade local (Arize Phoenix)**: perfil `observability` do compose, desligado por padrão, só em `127.0.0.1`; rastros OpenTelemetry das sessões e tools; avaliações sob demanda com datasets em `evals/chat/`.
- **Só texto** (F04-6): nada de botões ou formulários montados pelo agente; o recrutador pergunta, o usuário responde, o recrutador executa pelas tools.

### Fora do escopo (e para onde vai)
- Botões de ação (`ui.suggest_action`) e geração de CV → F05. Análise de vaga e perfil mais indicado → F06. Candidaturas, contatos e cadeia de pessoas (`contact.*`) → F07.
- Entrevista por voz → F08 (reutiliza o gerenciador de sessões daqui).
- Medidor completo, coletor de logs do Claude Code, "limpar cache" → F10.
- Provider Codex → F11.

---

## 2 · Arquitetura deste entregável

### 2.1 Visão
```
modo A: navegador ─WS /ws (eventos chat.*)─► api ─SDK query(stream)─► claude CLI (processo filho do api)
                                                        └─MCP http 127.0.0.1:3100/mcp─► api /mcp ─► core ─► SQLite
modo B: Claude Code (host) ─MCP http 127.0.0.1:<porta>/mcp─► api ─► core ─► SQLite
ambos: plugin/ (persona, skills, hooks) é a fonte única de texto de prompt
```

### 2.2 Servidor MCP (`apps/api/src/mcp/`)
- `@modelcontextprotocol/sdk` 1.32.1 já está no lockfile (dependência transitiva do Agent SDK): vira dependência direta do `api`, versão fixada. Transporte `WebStandardStreamableHTTPServerTransport` (Request/Response padrão web), montado em `app.all("/mcp", …)` do Hono, sem Express.
- Autenticação: `Authorization: Bearer <token de boot>` checado antes do transporte (o mesmo `auth.ts`); 401 sem token.
- `registry.ts`: `TOOL_REGISTRY = [{ name, input, output, handler, scopes }]` montado a partir de `createProfileTools`, `createIngestTools` e dos novos handlers; cada handler recebe `Repos` (+ `dataDir`, fila e provider quando precisa enfileirar ingestão) e valida entrada e saída pelos schemas do `shared` (sem `$schema`, F01 `e06eeda`).
- `scopes` por categoria (F04-2): `career` (profile, evidence, fact, research, file, usage), `clarify` (ingest.status/propose, file.*, fact.*), `ingest` (ingest.text/file/github/status), `interview` (reservado F08). O escopo vem da sessão: no modo A o `api` cria um `mcpServers.narnia` com header extra `X-Narnia-Session: <id>` e o servidor filtra `tools/list` e `tools/call`; no modo B (sem header) vale o escopo `career` + `ingest`.
- Respostas compactas: `*.list` uma linha por item, `*.get` detalhe, paginação `limit/cursor`, erro tipado `{ code, message }` mapeado pelo `friendlyError` (C5 da comunicação) para `isError` com texto em pt-BR.

### 2.3 Tools: o que existe e o que falta
| Tool | Estado no código | Trabalho |
|------|------------------|----------|
| `profile.list/get_card/switch/update_emphasis/update_pitch/create` | handler puro em `core/profile/tools.ts`, schema em `shared/mcp/profile.ts` | só registrar |
| `file.list/get_digest/get_text`, `ingest.status/propose` | `core/ingest/tools.ts`, `shared/mcp/ingest.ts` | registrar; `ingest.propose` com `run` da sessão de clarificação |
| `evidence.experience/project/skill/education.list` + `.get` | não existe | handlers sobre `facts.*` com relevância do perfil ativo (F02) |
| `fact.search/get/timeline` | não existe; FTS5 ausente | migration FTS5 (§3) + handlers; ordena por `profile_fact_relevance` |
| `fact.unverified` | não existe | lista fatos com `verified = 0` |
| `research.save/list` | não existe (`research` só como `source` de `salary_reference`) | tabela nova + handlers; `save` exige `used_for` e normaliza URL |
| `job.status/list` | não existe | sobre `jobs` + `taskOfJob` (só da instância) |
| `session.get/set_category` | não existe | sobre `chat_session` |
| `usage.log` | não existe | grava `usage_event` com `origin = claude-log` no modo B; ignorado se o `result` do SDK já registrou (dedupe por `provider_session_id` + `turn_index`) |
| `ingest.text/file/github` | não existe; os pipelines existem (`ingestionRuns.create`, `enqueueStage`, `createGithub` + `prepareTask`) | handlers que só **criam** a execução e devolvem `{ runId, estimate, needsConfirmation, url }`; nada é gravado em fatos |

### 2.4 Plugin (`plugin/`, ainda não existe na raiz)
| Arquivo | Conteúdo |
|---------|----------|
| `.claude-plugin/plugin.json` | nome `narnia-jobs`, versão, descrição |
| `.mcp.json.template` (versionado) → `.mcp.json` (gerado, gitignored) | `{"narnia-jobs":{"type":"http","url":"http://127.0.0.1:${PORTA}/mcp","headers":{"Authorization":"Bearer ${TOKEN}"}}}` |
| `agents/recrutador.md` | frontmatter (`name`, `description`, `model`, `tools:` só `mcp__narnia-jobs__*` + `WebSearch`/`WebFetch`) e corpo com placeholders `{{persona.*}}`, `{{card}}`, `{{trusted_domains}}`; regras de honestidade, pesquisa e "só texto" (F04-6) |
| `skills/recrutador/SKILL.md` · `skills/perfil/SKILL.md` · `skills/clarificar/SKILL.md` | como no plano original; `clarificar` recebe `run` e usa `ingest.status`, `file.get_digest`, `ingest.propose` |
| `hooks/hooks.json` + `hooks/session-start.sh` | `SessionStart`: se `NARNIA_SESSION_HAS_CARD=1` (modo A) não faz nada; senão chama `GET /api/profiles/active/persona-card` com o token e imprime persona + cartão; com a API fora imprime o aviso visível (F04-1) |
- `packages/core/src/chat/persona-prompt.ts`: `renderRecruiterPrompt(template, persona, card, domains)` lê `plugin/agents/recrutador.md` e preenche os placeholders; usado pelo `api` no modo A e pela rota do hook no modo B (fonte única).
- Teste que varre `apps/` e `packages/` atrás de texto de persona/instrução fora de `plugin/` (§6.5).

### 2.5 Sessões no modo A (`apps/api/src/chat/`)
- **Onde vivem:** no processo do `api` (o CLI do Claude é processo filho do `api`, como as chamadas estruturadas de hoje), ver F04-10. Um reinício do `api` (hot reload na instância `claude`, `promote` na do dono) encerra os processos; as sessões ficam `hibernated` com `provider_session_id` e a próxima mensagem retoma com `resume`. O `init: true` do compose (CM1) recolhe os processos órfãos.
- **`SessionManager`:** mapa `sessionId → { query, inputQueue, abort, lastActivity }`. Abrir: `query({ prompt: asyncIterable, options: { systemPrompt: renderRecruiterPrompt(...), plugins: [{ type: "local", path: PLUGIN_DIR }], mcpServers: { "narnia-jobs": { type: "http", url, headers } }, tools: ["WebSearch", "WebFetch"], model: session.model, resume?, includePartialMessages: true, env: { NARNIA_SESSION_HAS_CARD: "1" }, settingSources: [] } })`.
- **Teto de 5 (F04-3):** abrir a 6ª devolve 409 `session_limit` com a lista das vivas; a UI pergunta qual encerrar (hibernar) e repete.
- **Hibernação 1 h (F04-4):** varredura a cada minuto; sessão sem atividade há `chat.hibernate_after_min` (60) é encerrada (`interrupt` + fechamento da fila) e marcada `hibernated`; nova mensagem → `resume`.
- **Turnos:** cada mensagem do usuário entra na fila de entrada; `maxTurns` por mensagem (`chat.max_turns`, padrão 8); `result` fecha o turno: grava `chat_message` (usuário e assistente, tool calls resumidas) e `usage_event` com `session_id`; estouro → evento `chat.limit` com "continuar".
- **Nota de cartão atualizado (F04-1):** antes de enviar a mensagem, compara o `hash` do cartão do perfil da sessão com o da abertura; se mudou, antepõe "(cartão do perfil atualizado: …)" e grava o novo `hash` na sessão.
- **Eventos:** no `/ws` existente (F04-13), novos `chat.delta`, `chat.tool`, `chat.turn_end`, `chat.error`, `chat.limit`, `chat.session_updated`, todos com `sessionId`; o cliente filtra pela sessão aberta.
- **Persistência:** mensagens em Markdown, tool calls só com nome, argumentos resumidos e duração.

### 2.6 Modo B
- `apps/api/src/cli.ts install-plugin claude` (hoje só a mensagem "disponível em F04") + subcomando `./start.sh install-plugin` / `.\start.ps1 install-plugin` que roda no host (o plugin vai para o Claude Code do **host**): gera `plugin/.mcp.json` com a porta e o token da instância corrente (dono: porta do `.env`/5173-3100 em dev; Claude: 3200 e `claude-token`), registra `claude mcp add --transport http narnia-jobs <url> --header "Authorization: Bearer <token>"` no escopo do usuário e aponta o plugin local (`--plugin-dir` nos testes; instalação persistente pelo mecanismo vigente, ver F04-14). Idempotente; reescreve quando a porta muda.
- `doctor` ganha `mcp`: `initialize` + `tools/list` autenticados contra a URL da instância.

### 2.7 Pesquisa web (F04-5)
- `trusted_domain` (§3) com padrão semeado (órgãos oficiais `*.gov.br`, `ibge.gov.br`, pesquisas salariais conhecidas, grandes plataformas de vagas) e edição em Configurações; máscara `*` só no início ou como rótulo inteiro (`*.gov.br`, `glassdoor.*`); `trust_tag` official/survey/jobboard/other.
- O template injeta a lista; `research.save` rejeita URL fora da lista com `untrusted_domain` e o recrutador pede confirmação ao usuário antes de usar; tudo auditado em `research_source`.

### 2.8 Clarificação pós-ingestão
- `POST /api/ingestions/:id/clarify` cria sessão `category = clarify` com `ingestion_run_id`; o escopo `clarify` libera `ingest.propose` só para essa execução (o handler confere `runId`).
- A F03 (`ReviewPanel`) habilita "Clarificar com o recrutador" (remove o tooltip "disponível com o chat") e abre o chat nessa sessão; propostas novas aparecem na revisão pelo `ingestion.updated` existente.

### 2.9 Observabilidade local (Arize Phoenix)
- Serviço `phoenix` (imagem oficial `arizephoenix/phoenix`, versão fixada) no `docker-compose.dev.yml` e no `docker-compose.yml` com `profiles: ["observability"]`, porta da UI só em `127.0.0.1` (dono 6006; instância `claude` 6106 via `.env.claude`), dados em volume próprio.
- `api` e `worker` exportam rastros OTLP (`@opentelemetry/sdk-node` + exportador http) **só** quando `NARNIA_OTEL_ENDPOINT` está definido; spans por turno de chat, por tool MCP e por chamada estruturada (F01–F03); atributos sem conteúdo sensível por padrão (`NARNIA_OTEL_CONTENT=1` inclui prompts e respostas, desligado).
- Avaliações: `evals/chat/*.jsonl` (conversas de referência) + script `scripts/evals-chat.ts` rodado por `scripts/claude-env.sh evals` com o provider real, registrando experimentos no Phoenix; nunca na CI.

### 2.10 Encaixe no código (o que existe e o que muda)
1. **Provider sem sessão longa.** `Provider` só tem chamadas de um tiro (`run<T>` com prompt string). Entra `openChat(opts) → ChatHandle { send(text), events: AsyncIterable<ChatEvent>, interrupt(), close() }` no `ClaudeCodeProvider` (SDK `query` com `AsyncIterable<SDKUserMessage>`, `streamInput`, `interrupt`, `setModel`) e no `MockProvider` (roteiros). Os eventos do SDK são normalizados num `ChatEvent` do `shared`.
2. **SDK 0.3.292 confirma as opções** usadas: `plugins: [{ type: "local", path }]`, `mcpServers` com `type: "http"`, `headers` e `timeout`, `systemPrompt` string, `resume`, `forkSession`, `includePartialMessages`, `env`, `maxTurns`, `maxBudgetUsd`, `hooks`, `settingSources`. O `maxBudgetUsd` por sessão substitui o "maxBudget" do plano original.
3. **WebSocket é um só e transmite a todos** (`ws.ts`), validado por `WsEventSchema`; os eventos `chat.*` entram na união (como `profile.*` na F02) com `sessionId`; ver F04-13.
4. **`usage_event` já tem `session_id`**; faltam `provider_session_id` e `turn_index` para o dedupe com `usage.log` (§3).
5. **FTS5 funciona no `node:sqlite` 22.23** com `tokenize = "unicode61 remove_diacritics 2"` (verificado: `computacao*` acha "Computação"). Manutenção por gatilhos SQL nas tabelas de fatos (F04-12), porque toda escrita de fato já passa pelos repos mas o índice precisa ficar consistente mesmo em migrations e reset.
6. **`plugin/` não existe**; `install-plugin` é só uma mensagem no `cli.ts`; o `/mcp` já tem proxy no `docker/nginx.conf` (produção).
7. **Settings:** nenhuma chave de chat; entram `chat.max_live_sessions` (5), `chat.hibernate_after_min` (60), `chat.max_turns` (8), `chat.default_model` (`sonnet`), `chat.max_budget_usd` (nulo = sem teto), `research.require_trusted` (true).
8. **Erros e i18n:** o chat usa o `friendlyError` (C5) para erros do provider e das tools; textos via `t()`; o teste de literais cobre `features/chat`.
9. **Rotas web:** não há `/chat`; entram `/chat` e `/chat/$sessionId`, item "Chat" no grupo do **perfil atual** do menu (tem viés de perfil), e Configurações › Chat / Modo plugin / Pesquisa.
10. **Instâncias:** o `api` da instância `claude` atende o `/mcp` em 3200; `install-plugin` precisa receber a instância (`NARNIA_INSTANCE=claude` → porta 3200, token `claude-token`) para o Claude nunca registrar o servidor do dono por engano.

---

## 3 · Dados deste entregável

Migration `0004_chat.sql` (só para frente; teste de upgrade a partir de um banco 0003 com dados, como na F03):

| Tabela | Colunas |
|--------|---------|
| `chat_session` (nova) | `id`, `profile_id` (fk), `category` (career/clarify/ingest/interview), `title`, `provider`, `provider_session_id`, `model`, `state` (live/hibernated/archived/error), `ingestion_run_id` (fk, nulo), `card_hash`, `tokens_in`, `tokens_out`, `cost_usd_est`, `created_at`, `last_activity_at` |
| `chat_message` (nova) | `id`, `session_id` (fk, cascade), `turn_index`, `role` (user/assistant/system_note), `content_md`, `tool_calls_json`, `usage_json`, `created_at` |
| `research_source` (nova) | `id`, `profile_id`, `session_id`, `url`, `domain`, `title`, `accessed_at`, `excerpt`, `used_for`, `trust_tag`, `accepted` (nulo/0/1) |
| `trusted_domain` (nova) | `id`, `pattern` (único), `trust_tag`, `builtin` (0/1), `enabled`, `created_at`; semeada com a lista padrão |
| `fact_fts` (nova, virtual FTS5) | `kind`, `fact_id` (UNINDEXED), `title`, `body`; `tokenize = "unicode61 remove_diacritics 2"`; gatilhos `after insert/update/delete` em `experience`, `achievement`, `project`, `skill`, `education`, `language` e em `file_digest`/`repo_digest`; preenchida na migration com os dados existentes |
| `usage_event` (completar) | `provider_session_id`, `turn_index` |
| `settings` | chaves de §2.10-7 |

Regras: `research_source` é só registro (valor entra em perfil/fatos só após confirmação, com `source.kind = pesquisa`); apagar sessão (F10) remove mensagens e uso da sessão e nunca toca fatos.

---

## 4 · Layouts deste entregável

| Tela | Componentes | Estados a cobrir |
|------|-------------|------------------|
| Chat (`/chat`, `/chat/$sessionId`) | `SessionTabs` (do perfil ativo, categoria, "+ nova"), `MessageList` (Markdown, `ToolCallChip` expansível), `Composer` (texto, anexar arquivo → `ingest.file`, enviar, parar), `SessionUsage` (tokens, custo equivalente, teto) | vazia · digitando · aguardando tool · hibernada (retoma ao enviar) · teto de sessões (escolher qual encerrar) · limite de turnos (continuar) · erro do provider (mensagem amigável) · provider deslogado |
| Painel "Contexto" | cartão do perfil, o que foi carregado por tool nesta sessão, fontes pesquisadas, ingestões abertas pela conversa (link para a execução) | vazio · com itens |
| Clarificação | mesma tela com cabeçalho "Clarificando: <execução>", contador de propostas geradas, "Ir para a revisão" | em andamento · concluída |
| Pesquisa | `ResearchCard` na mensagem (fonte, domínio, selo de confiança, trecho, data, "usar este valor" / "ignorar") | proposta · aceita · ignorada · domínio fora da lista (pede confirmação) |
| Configurações › Chat | modelo padrão, sessões vivas, turnos por mensagem, hibernação, teto de custo por sessão | — |
| Configurações › Pesquisa | lista de domínios (máscara, selo, ligar/desligar, adicionar, restaurar padrão) | padrão · editada |
| Configurações › Modo plugin | status (via `doctor`), comando `install-plugin`, URL do MCP da instância | não instalado · instalado · porta mudou |
| Menu | "Chat" no grupo do perfil atual | — |

Regras: só texto (F04-6); horários no fuso do usuário; textos via `t()`; erros pelo `friendlyError`.

---

## 5 · Decisões deste entregável

| # | Decisão | Opções | Decidido / recomendação |
|---|---------|--------|-------------------------|
| F04-1 | Persona no modo A | só hook `SessionStart` · hook + `systemPrompt` mínimo com persona | **Decidida (dono, 2026-10-11): hook + system prompt**. Modo A: o servidor monta persona (F02 `buildPersona`) + cartão a partir do template `plugin/agents/recrutador.md` (fonte única, sem segundo texto) e passa como `systemPrompt` na abertura da sessão; marca a sessão (`NARNIA_SESSION_HAS_CARD=1`) para o hook `SessionStart` não reinjetar. Modo B: só o hook, que busca persona + cartão na API; com a API fora, imprime aviso visível e o modelo informa o usuário. Cartão alterado no meio da conversa: a cada turno o servidor compara o `hash` do cartão e, se mudou, antepõe uma nota curta à mensagem do usuário. Sessão pertence a um perfil. Custo: centenas de tokens no 1º turno, reaproveitados pelo cache de prompt. |
| F04-2 | Restrição de tools por categoria | `scopes` no registro MCP · expor tudo sempre | **Decidida (dono, 2026-10-11): `scopes`** (lazy load real) |
| F04-3 | Limite de sessões vivas | 3 · 2 · configurável | **Decidida (dono, 2026-10-11): 5, configurável**; ao atingir o teto, a UI pergunta qual sessão encerrar (em vez de enfileirar) |
| F04-4 | Hibernação | 10 min · 30 min | **Decidida (dono, 2026-10-11): 1 h**, configurável |
| F04-5 | Fontes confiáveis para pesquisa | lista de domínios permitidos · critério no prompt | **Decidida (dono, 2026-10-11): lista padrão de domínios confiáveis** editável em Configurações, cadastro por domínio com máscara (`*.gov.br`, `glassdoor.*`); `trust_tag` por entrada; fora da lista, o agente avisa e não usa a fonte sem confirmação |
| F04-6 | Convenção de ação | `[[action:...]]` no texto · tool `ui.suggest_action` | **Decidida (dono, 2026-10-11): só texto na F04**; o recrutador pergunta e executa pelas tools após a resposta do usuário; botões via `ui.suggest_action` passam para a F05; formulário montado pelo agente fora do plano |
| F04-7 | Autenticação do `/mcp` | token de boot no header · sem auth em loopback | **Decidida (dono, 2026-10-11): token no header** |
| F04-8 | Instalação do plugin no host | mecanismo de plugin local documentado · só `claude mcp add` + skills copiadas | **Decidida (dono, 2026-10-11): ambos** (plugin para skills/persona, `mcp add` para as tools) |
| F04-9 | Modelo padrão do chat | Sonnet · Haiku | **Decidida (dono, 2026-10-11): Sonnet padrão, configurável por sessão** |
| F04-10 | Onde vivem as sessões vivas | no processo do `api` · serviço `chat` dedicado no compose | **Decidida (dono, 2026-10-11): no `api`.** Os processos do CLI já são filhos do `api` nas chamadas de hoje e o `/mcp` está no mesmo processo; um reinício hiberna as sessões e o `resume` as retoma, e com `.owner-src` a instância do dono só reinicia no `promote`. Um serviço dedicado isolaria reinícios, mas exige um segundo canal entre api e chat (Redis) e duplica a autenticação. |
| F04-11 | Dependência do servidor MCP | `@modelcontextprotocol/sdk` 1.32.1 direto, transporte web padrão · implementar o protocolo à mão | **Decidida (dono, 2026-10-11): SDK oficial 1.32.1 fixado** (já está no lockfile pelo Agent SDK), transporte `WebStandardStreamableHTTPServerTransport`, que encaixa no Hono sem Express. |
| F04-12 | Manutenção do índice FTS5 | gatilhos SQL na migration · hooks nos repos (como o cartão) | **Decidida (dono, 2026-10-11): gatilhos SQL.** O índice fica consistente em qualquer escrita (inclusive migrations e reset), e o FTS5 do `node:sqlite` com `remove_diacritics` foi verificado; os hooks nos repos esqueceriam escritas feitas por SQL direto. |
| F04-13 | Canal dos eventos de chat | o `/ws` atual com eventos `chat.*` + `sessionId` · `/ws/sessions/:id` por sessão | **Decidida (dono, 2026-10-11): o `/ws` atual.** Já autentica, reconecta e valida pelo schema; com um usuário só, mandar os deltas a todas as abas custa pouco, e evita um segundo tipo de conexão. |
| F04-14 | Instalação persistente do plugin no host | `claude plugin` (mecanismo de plugins locais vigente) · `--plugin-dir` a cada uso · só `claude mcp add` + skills copiadas para `~/.claude` | **Aguarda o dono. Recomendação: `claude mcp add` (garante as tools, F04-8) + plugin pelo mecanismo vigente na data da implementação**, conferido na documentação antes de codar; `--plugin-dir` só nos testes. |
| F04-15 | Phoenix também no compose de produção | só no dev · dev e produção (perfil desligado) | **Aguarda o dono. Recomendação: nos dois, sempre desligado por padrão**; quem usa a versão de produção também pode querer inspecionar as conversas localmente, e o perfil não sobe nada sem `--profile observability`. |

---

## 6 · O que precisa estar coberto para o F04 funcionar

### 6.1 Marcos de implementação (ordem obrigatória; TDD como em `../09-metodologia-tdd.md`; só na instância `claude`; a do dono recebe por `promote`)

| Marco | Entrega | Verificação |
|-------|---------|-------------|
| **M1 Dados e tools** | `0004_chat.sql` (sessões, mensagens, pesquisa, domínios semeados, `fact_fts` com gatilhos e carga inicial, colunas de `usage_event`) com teste de upgrade; schemas `shared/mcp/{evidence,fact,research,job,session,usage,ingest-chat}.ts` e eventos `chat.*`; handlers puros no `core` (`evidence.*`, `fact.*`, `research.*`, `job.*`, `session.*`, `usage.log`, `ingest.text/file/github` que só criam execuções); `renderRecruiterPrompt` | unitários de `shared` e `core`; busca FTS com acento e prefixo; teste de upgrade |
| **M2 Servidor MCP e plugin** | `apps/api/src/mcp/` (transporte, auth, registro, `scopes` pelo header da sessão, `friendlyError`); `plugin/` completo; rota `GET /api/profiles/active/persona-card` para o hook; `session-start.sh`; teste de prompt fora do plugin | cliente MCP de teste: `initialize`, `tools/list` por escopo, `tools/call` de cada tool, 401 sem token, erro tipado como `isError` |
| **M3 Sessões no api** | `openChat` no provider (Claude Code e mock com roteiros que chamam o `/mcp` real), `SessionManager` (teto 5 com 409 e escolha, hibernação 1 h, `resume`, nota de cartão, `maxTurns`, `maxBudgetUsd`, modelo por sessão), rotas de sessão e mensagens, clarificação, eventos `chat.*`, medidor e dedupe com `usage.log` | unitários de api e providers; prova com mock: abrir 6 sessões, hibernar, retomar, ingestão pela conversa abre execução com confirmação |
| **M4 Web** | `/chat` com abas, mensagens, chips, composer com anexo, uso, painel Contexto, `ResearchCard`, Configurações › Chat/Pesquisa/Modo plugin, "Chat" no menu do perfil atual, botão "Clarificar" habilitado na revisão da F03 | unitários web; smoke no navegador contra a instância `claude` |
| **M5 Modo B e Phoenix** | `install-plugin` e `doctor` (`start.sh`/`start.ps1`, nas duas instâncias), Phoenix no perfil `observability`, OTel no api/worker, `evals/chat/` + `scripts/claude-env.sh evals` | bats/Pester; `claude -p` com `--plugin-dir plugin/` contra a instância `claude` devolve o cartão (manual com credencial real); rastro aparece no Phoenix local |
| **M6 E2E e fechamento** | cenários de §6.3, documentos `../02`, `../03 §4–5, §10, §13`, `../07`, README; §8 | `scripts/claude-env.sh e2e` verde; §6.5 |

### 6.2 Testes unitários (Vitest) · obrigatórios
**`packages/shared`:** schemas de todas as tools novas com snapshot do JSON Schema (sem `$schema`); eventos `chat.*` na união do `WsEventSchema`.

**`packages/core`:**
- Migration 0004: upgrade a partir de 0003 com dados preserva tudo; `fact_fts` carregada com os fatos existentes; gatilhos mantêm o índice em insert/update/delete de cada tabela de fato e de digests.
- `fact.search`: acento (`computacao` acha "Computação"), prefixo, filtro por tipo e período, ordenação pela relevância do perfil; linhas de 30–40 tokens.
- `evidence.*.list` uma linha por item e paginação; `get` detalhe.
- `research.save`: normaliza URL, exige `used_for`, rejeita domínio fora da lista (`untrusted_domain`), aceita máscara `*.gov.br`; `research.list` por perfil.
- `ingest.text/file/github`: criam execução pelo mesmo caminho da UI (`ingestionRuns.create` + etapas; `createGithub` + `prepareTask`), devolvem estimativa e `needsConfirmation`; nunca gravam fatos; GitHub sempre pede confirmação (F03-13).
- `usage.log`: grava com `origin = claude-log`; ignora duplicata do mesmo `provider_session_id` + `turn_index`.
- `renderRecruiterPrompt`: preenche todos os placeholders; falha se sobrar algum; persona configurável da F02 refletida.
- Montar os dados dos testes pelo mesmo caminho da produção (lição registrada na F03 §8).

**`apps/api`:**
- `/mcp` com cliente MCP de teste sobre o `app.fetch`: `initialize`, `tools/list` respeita o escopo do header da sessão, `tools/call` de cada tool, 401 sem token, erro tipado → `isError` com texto amigável.
- `SessionManager` com provider fake: 5 vivas, a 6ª → 409 `session_limit` com a lista; hibernação por relógio fake; `resume` na mensagem seguinte; erro do processo → `error` sem processo órfão; nota de cartão quando o `hash` muda; modelo por sessão.
- Clarificação: `POST /ingestions/:id/clarify` cria sessão `clarify`; `ingest.propose` só aceita o `runId` da sessão.
- Rota do hook devolve persona + cartão; 401 sem token.

**`packages/providers`:** `openChat` monta as opções exatas (`plugins`, `mcpServers` http com header de sessão, `systemPrompt`, `tools`, `model`, `resume`, `includePartialMessages`, `env.NARNIA_SESSION_HAS_CARD`); normaliza `stream_event`, `assistant`, tool use/result e `result` em `ChatEvent`; mock executa roteiros chamando o `/mcp` real.

**`apps/web`:** abas por perfil e troca por `profile.switched`; stream incremental; chips de tool; composer desabilita durante o turno e "parar" interrompe; teto de sessões com escolha; `ResearchCard` aceitar/ignorar; Configurações › Pesquisa edita a lista; botão "Clarificar" habilitado abre a sessão; i18n e `friendlyError`.

### 6.3 Testes e2e (Playwright, Chromium)
Compose e2e com `NARNIA_PROVIDER=mock`; os roteiros do mock chamam o `/mcp` real (tools reais, modelo falso).
- **E2E-01 conversa de carreira**: abrir Chat → recrutador se apresenta com cargo/área do perfil → "o que está fraco?" → chip `fact.search` → resposta cita fonte → uso da sessão > 0.
- **E2E-02 abas e perfis**: 2 sessões no perfil A → trocar para B → abas de A somem → voltar → reaparecem com histórico.
- **E2E-03 retomada**: sessão hibernada (relógio de teste) → enviar mensagem → retoma com `resume`.
- **E2E-04 teto de sessões**: abrir a 6ª → diálogo pede qual encerrar → escolher → a nova abre.
- **E2E-05 pesquisa**: `needs_research` em salário → mock chama `WebSearch` simulado e `research.save` → `ResearchCard` → "usar este valor" → perfil atualizado com fonte; domínio fora da lista pede confirmação.
- **E2E-06 clarificação**: ingestão de texto concluída → "Clarificar com o recrutador" → pergunta → resposta → proposta nova na revisão da mesma execução.
- **E2E-07 ingestão pela conversa**: colar texto → `ingest.text` → execução criada → pendência de revisão; anexar PDF → `ingest.file`; link do GitHub → `ingest.github` → confirmação exigida antes de rodar.
- **E2E-08 provider deslogado**: mock `loggedOut` → chat mostra instrução de login e não abre sessão.
- **E2E-09 modo B** (manual/CI opcional com credencial): `claude -p "/narnia-jobs:perfil" --plugin-dir plugin/ --max-turns 2` contra a instância `claude` devolve o cartão.
- **E2E-10 porta mudou**: `install-plugin` reescreve `.mcp.json`; `doctor` lista as tools.
- **Avaliações do chat (Phoenix, sob demanda, assinatura real)**: `evals/chat/` com conversas de referência e avaliadores (cita fonte, não inventa data/empresa, pede confirmação antes de gravar, respeita orçamento e lista de domínios); resultados no Phoenix local.

### 6.4 Teste manual com provider real (antes de fechar)
(1) conversa de 20 turnos no modo A medindo tokens por turno contra `usage_event` e o efeito do cache de prompt; (2) a mesma conversa no modo B no terminal; (3) pesquisa salarial real pt-BR e en-US, avaliando fontes e a lista de domínios; (4) clarificação de um texto livre real; (5) ingestão pela conversa (texto, PDF, GitHub) com o dono; (6) troca de perfil no meio e nota de cartão atualizado; registrar tokens do cartão (F02 §6.4) e a diferença A × B por turno.

### 6.5 Definição de pronto
- §6.2 e §6.3 verdes (E2E-09 executado localmente com credencial real); cobertura ≥ 80% em `core/src/{chat,research,facts}/**`.
- Nenhum texto de persona/instrução fora de `plugin/` (teste de varredura).
- Todas as tools de §2.3 expostas e cobertas por `tools/call`.
- `tokensEst` do cartão (F02) calibrado contra o real.
- Phoenix desligado por padrão e nenhum dado sai da máquina (teste que confere a ausência de exportador sem `NARNIA_OTEL_ENDPOINT`).
- `../02`, `../03 §4, §5, §10, §13`, `../07` e README atualizados; `promote` avisado ao dono ao fechar cada marco.

---

## 7 · Riscos específicos
| Risco | Mitigação |
|-------|-----------|
| Política da Anthropic sobre login de assinatura em wrappers (modo A) | modo B de primeira classe na mesma task; README explica |
| Processos do CLI consumindo memória | teto de 5 + hibernação 1 h; `init: true` recolhe órfãos; `doctor` mostra sessões vivas |
| Reinício do `api` derruba conversas | hibernação + `resume` transparente; `.owner-src` limita reinícios na instância do dono |
| Mecanismo de plugins locais mudar | `install-plugin` isola o passo; `claude mcp add` garante as tools; conferir a documentação na implementação (F04-14) |
| Agente pesquisar fora do permitido | lista de domínios com máscara, `research.save` recusa fora da lista, prompt restringe, auditoria em `research_source` |
| Hook `SessionStart` falhar no modo B | aviso visível; skill `perfil` recarrega o cartão |
| Formato de eventos do SDK mudar | normalizador com testes por fixture da versão 0.3.292; SDK fixado |
| Ingestão pela conversa gastar demais | estimativa e confirmação dos pipelines da F03 (GitHub sempre confirma; CV/texto até 10 mil seguem) |

## 8 · Registro de execução
| Data | Marco | O que aconteceu |
|------|-------|-----------------|
| 2026-10-11 | — | **F04-1 decidida pelo dono**: hook + system prompt montado a partir do plugin, cartão uma vez só, aviso visível no terminal quando a API está fora, nota de cartão atualizado por turno. **Todas as decisões de §5 fechadas.** |
| 2026-10-11 | — | **Decisões do dono:** observabilidade e avaliações do chat com **Arize Phoenix local** (LangSmith descartado: auto-hospedagem só no Enterprise; Langfuse e promptfoo considerados); F04-6 **só texto** na F04, botões na F05. Escopo ampliado com ingestão pela conversa (`ingest.text/file/github`) e com os testes correspondentes. |
| 2026-10-11 | — | **Requisitos do dono (registro antecipado):** (1) **testes do chat com LangSmith** (datasets e avaliações das conversas do recrutador); envia conversas e dados de carreira a um serviço externo, por isso entra opcional, desligado por padrão, com a chave do próprio usuário e aviso de privacidade; (2) o recrutador **ingere qualquer informação durante a conversa** e atualiza os dados do usuário por tools: texto livre, PDF/currículo enviado no chat e link do GitHub, reaproveitando os pipelines da F01/F03 (as propostas vão para a revisão; nada é gravado direto); (3) análise de vaga, CV com/sem vaga alvo e candidaturas pelo chat (registradas nas tasks F06, F05 e F07). |
| 2026-10-11 | — | **Decisões do dono:** F04-2 lazy load real (`scopes`); F04-3 **5 sessões vivas**, configurável, e ao atingir o teto **perguntar qual sessão encerrar**; F04-4 hibernação após **1 h**, configurável; F04-5 **lista padrão de domínios confiáveis**, editável em Configurações, cadastro por domínio com máscara (ex. `*.gov.br`); F04-7 token no header; F04-8 plugin + `claude mcp add`; F04-9 **Sonnet padrão, configurável por sessão**. F04-1 e F04-6 aguardam explicação ao dono. |
| 2026-10-11 | — | **Refinamento contra o código.** Gaps: (1) `Provider` só tem chamadas de um tiro: falta sessão longa (`openChat` sobre `query` com entrada em streaming, `streamInput`, `interrupt`, `setModel`); (2) `plugin/` não existe e `install-plugin` é só uma mensagem; (3) `@modelcontextprotocol/sdk` 1.32.1 só como dependência transitiva; o transporte web padrão encaixa no Hono; (4) das tools do plano, só `profile.*`, `file.*`, `ingest.status/propose` têm handler; faltam `evidence.*`, `fact.*`, `research.*`, `job.*`, `session.*`, `usage.log` e `ingest.text/file/github`; (5) FTS5 ausente, mas funciona no `node:sqlite` 22.23 com `remove_diacritics` (verificado); (6) o `/ws` transmite tudo a todos, sem canal por sessão; (7) `usage_event` já tem `session_id`, faltam `provider_session_id`/`turn_index`; (8) nenhuma chave de settings do chat; (9) a dependência F03 → F04 do plano antigo se inverteu: a clarificação agora é implementável e o botão da F03 é habilitado aqui; (10) o SDK 0.3.292 tem `maxBudgetUsd` por sessão, que substitui o "maxBudget" do plano; (11) `install-plugin` precisa respeitar a instância para o Claude não registrar o servidor do dono; (12) "Chat" entra no grupo do perfil atual do menu. Decisões novas F04-10 a F04-15 aguardam o dono. |
| 2026-10-11 | — | **F04-10 decidida pelo dono**: sessões de chat no processo do api (reinício hiberna, `resume` retoma). |
| 2026-10-11 | — | **F04-11 decidida pelo dono**: servidor MCP com o SDK oficial `@modelcontextprotocol/sdk` fixado na versão exata. |
| 2026-10-11 | — | **F04-12 decidida pelo dono**: índice FTS5 mantido por gatilhos SQL na migration. |
| 2026-10-11 | — | **F04-13 decidida pelo dono**: eventos de chat pelo `/ws` existente, com `sessionId`. |
