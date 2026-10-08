# F04 · Chat com o recrutador

Entregável 4 do plan-v0, o mais estrutural. Cobre o fluxo **F4** de `../02-fluxos-do-usuario.md` e entrega as duas peças que todos os fluxos seguintes usam: o **servidor MCP** (`/mcp`, streamable HTTP) com todas as tools de `../03-arquitetura.md §5`, e a pasta **`plugin/`** (persona, skills, hooks, `.mcp.json`), fonte única de prompts para os modos A (chat na web via Agent SDK) e B (Claude Code no host). Inclui a sessão de clarificação pós-ingestão, a pesquisa na internet para dados obrigatórios, sessões múltiplas por perfil e o medidor por sessão. Depende de F01 (SDK, jobs, `usage_event`), F02 (cartão do perfil, tools `profile.*`) e F03 (tools `ingest.*`/`file.*`).

Status: **em escopo** (2026-10-07). Nada implementado.

---

## 1 · Objetivo e resultado esperado

Uma pessoa com perfil e dados ingeridos consegue:

1. abrir o Chat na web, ver o recrutador se apresentar como especialista no cargo/área/nível do perfil ativo e responder com franqueza sobre os dados, citando de onde cada afirmação veio;
2. ver, em chips discretos, quais tools o agente chamou (ex.: `experience.list`) e quanto a sessão já consumiu;
3. manter várias conversas abertas por perfil (abas), cada uma com categoria, trocar de perfil sem perder as conversas, fechar o navegador e retomar;
4. responder "não sei" para um dado obrigatório e ver o recrutador pesquisar em fontes confiáveis, citar a fonte e propor um valor para confirmação;
5. depois de uma ingestão, clicar em "Clarificar" e ter uma sessão que faz perguntas objetivas e devolve propostas para a tela de revisão;
6. clicar em ações sugeridas pelo agente ("Gerar CV para esta vaga") que abrem a feature correspondente (ou, antes de F05, mostram "em breve");
7. no modo B, rodar `narnia-jobs install-plugin claude`, abrir o Claude Code no terminal e ter a mesma conversa, com o mesmo cartão de perfil e as mesmas tools.

### Dentro do escopo
- `apps/api/src/mcp/`: servidor MCP streamable HTTP em `/mcp` com todas as tools de `../03 §5` (profile.*, evidence.*, fact.*, file.*, ingest.*, research.*, job.*, session.*, usage.log), protegido pelo token de boot.
- `plugin/`: `.claude-plugin/plugin.json`, `.mcp.json` (URL com porta atual), `agents/recrutador.md` (persona + honestidade total + `tools:` restrito), `skills/recrutador`, `skills/perfil`, `skills/clarificar`, `hooks/hooks.json` (`SessionStart` injeta cartão do perfil via chamada HTTP ao `api`).
- Modo A: `ClaudeCodeProvider.openSession()` com `plugins: [{type:"local", path}]`, `systemPrompt` mínimo + persona, `tools: ["WebSearch"]`, streaming input, `resume`, `maxTurns` por mensagem; normalização de eventos para WS; abas e categorias; limite de sessões vivas; hibernação/retomada.
- Modo B: `narnia-jobs install-plugin claude` (copia/aponta `plugin/`, gera `.mcp.json` com a porta do `.env`, registra o servidor MCP HTTP no escopo user via `claude mcp add --transport http`), `narnia-jobs doctor` checa a conexão; smoke test com `claude -p`.
- Pesquisa na internet: só por `WebSearch`, só para dados obrigatórios marcados `needs_research` ou pedidos explícitos; registro em `research_source` via `research.save`; o valor proposto vira sugestão para o usuário confirmar (nunca grava direto).
- Sessão de clarificação: skill `clarificar` recebe digest + propostas pendentes de uma `ingestion_run`, pergunta, e chama `ingest.propose` com correções; a revisão continua na tela de F03.
- Ações sugeridas: convenção `[[action:feature?params]]` no texto do agente → botão no modo A, link `http://127.0.0.1:<porta>/...` no modo B.
- Medidor por sessão: `usage_event` com `session_id` e `category`; chips de uso no chat; leitura dos logs do Claude Code fica para F10.

### Fora do escopo (e para onde vai)
- Features (gerar CV, analisar vaga, candidaturas) → F05–F07; aqui só a convenção de ação.
- Entrevista por voz → F08 (reutiliza o canal de sessão daqui).
- Medidor completo, coletor de logs do Claude Code, "limpar cache" → F10.
- Provider Codex e gerador de `AGENTS.md` → F11.
- Gerador de `config.toml` do Codex → F11.

---

## 2 · Arquitetura deste entregável

### 2.1 Visão
```
modo A: navegador ─WS─► apps/api ─SDK─► claude CLI (container) ─MCP HTTP─► apps/api /mcp ─► core ─► SQLite
modo B: Claude Code (host) ─MCP HTTP (127.0.0.1:<porta>/mcp)─► apps/api ─► core ─► SQLite
ambos: plugin/ (persona, skills, hooks) é lido pelo CLI; nada de prompt fora dele
```

### 2.2 Servidor MCP (`apps/api/src/mcp/server.ts`)
- `@modelcontextprotocol/sdk` com transporte streamable HTTP montado em `/mcp` (Hono). Uma sessão MCP por conexão; stateless quanto ao domínio (tudo no SQLite).
- Autenticação: header `Authorization: Bearer <token de boot>`; no modo B o token vai no `.mcp.json` gerado (`headers`), no modo A o SDK recebe o mesmo via `.mcp.json` do plugin.
- Registro de tools a partir de `packages/core/src/*/tools.ts` + schemas de `packages/shared/src/mcp/*`: uma tabela `TOOL_REGISTRY` com `{name, schema, handler, scopes}`; `scopes` permite restringir o conjunto por sessão (`session.set_category` ↔ skill) para manter o lazy load.
- Respostas: resumo de uma linha por item em `*.list`; detalhe em `*.get`; paginação `limit/cursor`; erro tipado `{code, message}`.
- **Busca sem ler tudo (decisão F02-2, 2026-10-08)**: índice FTS5 sobre experiências, conquistas, projetos, skills, formação e digests, mantido pelos hooks de escrita do `core`; `fact.search {q, kinds?, from?, to?, limit=10}` devolve linhas de 30–40 tokens (id, tipo, título, período, uma linha, nota de relevância de `profile/relevance.ts`), `fact.get {ids}` o detalhe, `fact.timeline {from, to}` por período; o prompt do recrutador manda buscar antes de listar e nunca pedir a lista completa. Resumo objetivo do perfil escrito pelo modelo (opcional, cache em `profile`, custo mostrado antes) entra aqui.
- `usage.log` aceita o `usage` que o próprio agente informa (modo B) e é ignorado quando o `result` do SDK já registrou (modo A, dedupe por `provider_session_id`).

### 2.3 Plugin (`plugin/`)
| Arquivo | Conteúdo |
|---------|----------|
| `.claude-plugin/plugin.json` | nome `narnia-jobs`, versão, descrição |
| `.mcp.json` | `{"narnia-jobs": {"type":"http","url":"http://127.0.0.1:${NARNIA_PORT}/mcp","headers":{"Authorization":"Bearer ${NARNIA_TOKEN}"}}}` (gerado pelo instalador com valores reais) |
| `agents/recrutador.md` | frontmatter: `name`, `description`, `model: sonnet`, `tools:` só MCP `narnia-jobs` + `WebSearch`; corpo: persona derivada (placeholders preenchidos pelo hook), regras de honestidade (citar fonte, marcar inferência, não inventar, apontar lacunas e exageros), regra de pesquisa (só dados obrigatórios, fontes confiáveis: pesquisas salariais, órgãos oficiais, grandes job boards; sempre `research.save`), convenção de ações |
| `skills/recrutador/SKILL.md` | `/narnia-jobs:recrutador`: abre a conversa de carreira com o cartão; instrui a usar `fact.unverified` e `profile.get_card` |
| `skills/perfil/SKILL.md` | `/narnia-jobs:perfil <nome>`: `profile.list` → `profile.switch` → `profile.get_card` |
| `skills/clarificar/SKILL.md` | `/narnia-jobs:clarificar <run>`: `file.get_digest`, propostas pendentes, perguntas objetivas uma de cada vez, `ingest.propose` por resposta, encerra com resumo |
| `hooks/hooks.json` | `SessionStart`: comando que chama `GET /api/profiles/active/card` (com token) e imprime o cartão + 1 linha de persona; falha silenciosa com aviso se o `api` estiver fora |
Regra de ouro: nenhum texto de persona, instrução ou tool fora de `plugin/` e `packages/{shared,core}`. O modo A só escolhe modelo, perfil, tools e categoria.

### 2.4 Modo A: sessões (`apps/api/src/chat/`)
```
POST /api/sessions {profile_id, category} ─► chat_session ─► provider.openSession({plugins:[plugin/], model, systemPrompt: persona+card, tools:["WebSearch"], resume?})
WS /ws/sessions/:id  ◄─► {user_message} / {text_delta|tool_use|tool_result|action|turn_end{usage}|error}
```
- `SessionManager`: mapa `session_id → processo do CLI` (streaming input). Limite de sessões vivas (padrão 3); além disso `queued`. Inatividade > 10 min → hibernar (encerrar processo, guardar `provider_session_id`); próxima mensagem → `resume`.
- Troca de perfil não encerra sessões; a UI só mostra as do perfil ativo.
- `maxTurns` por mensagem (padrão 8) e `maxBudget` por sessão configurável; estouro → evento `limit` com opção de continuar.
- Cada `turn_end` grava `chat_message` (ambos os lados, tool calls resumidas) e `usage_event` (`session_id`, `category`, modelo, tokens).
- Parser de ações: regex sobre o texto final; evento `action` separado para a UI.

### 2.5 Modo B: instalador
`narnia-jobs install-plugin claude`:
1. lê `NARNIA_PORT` e o token de `.env`/`./data/config.json`;
2. gera `plugin/.mcp.json` com valores reais (arquivo gitignored; o versionado é `.mcp.json.template`);
3. registra o plugin no Claude Code do host pelo mecanismo de plugins locais documentado (`--plugin-dir` para testes; instalação persistente conforme a documentação de plugins vigente na implementação) e, em paralelo, `claude mcp add --transport http narnia-jobs http://127.0.0.1:<porta>/mcp --header "Authorization: Bearer <token>"` no escopo user, para que as tools existam mesmo fora do plugin;
4. `narnia-jobs doctor` faz `GET /mcp` autenticado e lista tools.
Mudança de porta entre execuções → `install-plugin` é idempotente e reescreve.

### 2.6 API
| Método e rota | Função |
|---------------|--------|
| `POST /api/sessions` · `GET /api/sessions?profile=` · `PATCH /api/sessions/:id` (título, categoria, arquivar) · `DELETE /api/sessions/:id` | sessões |
| `GET /api/sessions/:id/messages?cursor=` | histórico |
| `POST /api/sessions/:id/hibernate` · `/wake` | controle manual |
| `POST /api/ingestions/:id/clarify` | cria sessão `category=clarify` ligada ao run |
| `GET /api/research?profile=` | fontes pesquisadas |
| `GET /api/profiles/active/card` | usado pelo hook `SessionStart` |
| `ALL /mcp` | servidor MCP |
| `WS /ws/sessions/:id` | stream da sessão |

---

## 3 · Dados deste entregável

| Tabela | Colunas |
|--------|---------|
| `chat_session` (nova) | `id`, `profile_id`, `category` (career/clarify/feature:<nome>/interview), `title`, `provider` (claude-code), `provider_session_id?`, `model`, `state` (live/queued/hibernated/archived), `ingestion_run_id?`, `tokens_in`, `tokens_out`, `created_at`, `last_activity_at` (UTC) |
| `chat_message` (nova) | `id`, `session_id`, `role` (user/assistant/system), `content_md`, `tool_calls_json?` (nome, args resumidos, duração), `actions_json?`, `usage_json?`, `created_at` |
| `research_source` (nova) | `id`, `profile_id`, `session_id?`, `url`, `title`, `accessed_at`, `excerpt`, `used_for` (campo/fato), `trust_tag` (official/survey/jobboard/other), `accepted?` |
| `usage_event` (completar) | `session_id?`, `provider_session_id?`, `turn_index?` |
| `settings` | `chat.max_live_sessions`, `chat.max_turns`, `chat.hibernate_after_min`, `chat.default_model` |

Regras:
- `research_source` é só registro; o valor sugerido entra em `profile`/fatos apenas após confirmação do usuário (via tool `profile.*`/`fact.*` com `source.kind = pesquisa`).
- Mensagens guardam Markdown; tool calls resumidas (sem payload completo) para não inflar o banco.
- Apagar sessão (F10 "limpar cache") remove `chat_message`, `usage_event` da sessão e pede ao CLI para esquecer a sessão; nunca toca fatos.

---

## 4 · Layouts deste entregável

| Tela | Componentes | Estados a cobrir |
|------|-------------|------------------|
| Chat (L2) | `SessionTabs` (por perfil, categoria, "+ nova"), `MessageList` (Markdown, chips `ToolCallChip` expansíveis, `ActionButton`), `Composer` (texto, anexar arquivo → F03, enviar, parar), `SessionUsage` (tokens, custo equivalente, limite) | vazia · streaming · aguardando tool · hibernada (acordar) · na fila · limite atingido · erro do provider · provider deslogado |
| Painel direito "Contexto" | cartão do perfil atual, lista do que foi carregado por tool nesta sessão, fontes pesquisadas | vazio · com itens |
| Clarificação | mesma L2 com cabeçalho "Clarificando ingestão X", contador de propostas geradas, botão "ir para revisão" | em andamento · concluída |
| Pesquisa | `ResearchCard` inline na mensagem (fonte, trecho, data, "usar este valor" / "ignorar") | proposta · aceita · ignorada |
| Configurações › Chat | modelo padrão, sessões simultâneas, turnos por mensagem, hibernação | — |
| Configurações › Modo plugin | status do plugin no host (via `doctor`), comando `install-plugin`, porta/URL do MCP | não instalado · instalado · porta mudou (reinstalar) |

Regras de UI: ações viram botões; no modo B o mesmo texto traz links. Horários no fuso do usuário. Textos via `t()`.

---

## 5 · Decisões em aberto deste entregável

| # | Decisão | Opções | Padrão proposto |
|---|---------|--------|-----------------|
| F04-1 | Persona no modo A | só hook `SessionStart` · hook + `systemPrompt` mínimo com persona | **hook + systemPrompt mínimo** (não depender do hook para o essencial) |
| F04-2 | Restrição de tools por categoria | `scopes` no registro MCP · expor tudo sempre | **`scopes`** (lazy load real) |
| F04-3 | Limite de sessões vivas | 3 · 2 · configurável | **3, configurável** |
| F04-4 | Hibernação | 10 min · 30 min | **10 min** (memória do CLI) |
| F04-5 | Fontes confiáveis para pesquisa | lista de domínios permitidos · critério no prompt | **critério no prompt + `trust_tag`**; lista opcional em Configurações |
| F04-6 | Convenção de ação | `[[action:...]]` no texto · tool `ui.suggest_action` | **tool `ui.suggest_action`** (estruturado, sem parse frágil); fallback regex |
| F04-7 | Autenticação do `/mcp` | token de boot no header · sem auth em loopback | **token no header** |
| F04-8 | Instalação do plugin no host | mecanismo de plugin local documentado · só `claude mcp add` + skills copiadas | **ambos** (plugin para skills/persona, `mcp add` para garantir tools) |
| F04-9 | Modelo padrão do chat | Sonnet · Haiku | **Sonnet**; Haiku na clarificação |

---

## 6 · O que precisa estar coberto para o F04 funcionar

### 6.1 Pré-requisitos e dependências
1. F01, F02, F03 concluídos (tools `profile.*`, `ingest.*`, `file.*` já com handlers em `core`).
2. Migration `0004_chat.sql` (§3).
3. `packages/shared`: schemas de todas as tools (`evidence.*`, `fact.*`, `research.*`, `job.*`, `session.*`, `usage.log`, `ui.suggest_action`), eventos WS da sessão.
4. `packages/core`: handlers restantes (`evidence/tools.ts`, `facts/tools.ts`, `research/tools.ts`, `jobs/tools.ts`), FTS5 para `fact.search`.
5. `apps/api`: `mcp/server.ts` + registro + auth; `chat/SessionManager`; provider `openSession`; rotas §2.6; `MockProvider` com roteiro de tool calls.
6. `plugin/` completo; `narnia-jobs install-plugin`, `doctor`.
7. `apps/web`: Chat, painel Contexto, Configurações › Chat/Modo plugin.
8. Fixtures: roteiros do mock (carreira, clarificação, pesquisa com fonte), perfil com `needs_research`.

### 6.2 Testes unitários (Vitest) · obrigatórios
**`packages/core`**
- Handlers de tools: cada um valida entrada/saída pelo schema; `evidence.*.list` devolve 1 linha por item e pagina; `fact.search` com FTS5 (acentos, prefixo); `research.save` normaliza URL e exige `used_for`; `job.status` para job de outro perfil → erro tipado.
- `scopes`: registro filtra por categoria; tool fora do escopo → erro `tool_not_in_scope`.

**`apps/api`**
- Servidor MCP com cliente MCP de teste (`@modelcontextprotocol/sdk` client sobre HTTP em memória): `initialize`, `tools/list` reflete scopes, `tools/call` para cada tool com fixtures, 401 sem token, erros tipados chegam como `isError`.
- `SessionManager`: abre até N sessões, enfileira a N+1, hiberna por inatividade (timer fake), acorda com `resume`, encerra no `DELETE`, sobrevive a erro do processo (estado `error`, sem vazar processo).
- Provider `openSession` (SDK mockado): opções exatas (`plugins`, `systemPrompt`, `tools: ["WebSearch"]`, `model`, `resume`); normaliza `text_delta`, `tool_use`, `tool_result`, `result` → eventos WS; `usage` do `result` vira `usage_event` com `session_id`/`category`; dedupe com `usage.log`.
- Parser/handler de ações: `ui.suggest_action` gera evento; regex fallback.
- Hook `SessionStart`: script devolve cartão com `api` no ar; aviso sem derrubar com `api` fora.
- Clarificação: `POST /ingestions/:id/clarify` cria sessão com categoria e `ingestion_run_id`; propostas geradas via tool entram no run certo.

**`apps/web`**
- `SessionTabs`: cria, troca, arquiva; filtra por perfil ativo; `profile.switched` troca o conjunto.
- `MessageList`: renderiza stream incremental, chips de tool, botão de ação dispara navegação; `ResearchCard` aceitar/ignorar chama API.
- `Composer`: envia, desabilita durante streaming, "parar" envia abort.
- `SessionUsage`: atualiza em `turn_end`; mostra limite atingido.

### 6.3 Testes e2e (Playwright, Chromium) · obrigatórios
Compose com `NARNIA_PROVIDER=mock`; o mock executa roteiros que chamam o `/mcp` real (as tools são reais, só o modelo é falso).
- **E2E-01 conversa de carreira**: abrir Chat → recrutador se apresenta com cargo/área do perfil ativo → perguntar "o que está fraco?" → chip `experience.list` aparece → resposta cita fonte do fato → uso da sessão > 0.
- **E2E-02 abas e perfis**: abrir 2 sessões no perfil A → trocar para B → abas de A somem → voltar → abas de A reaparecem com histórico.
- **E2E-03 retomada**: fechar o navegador no meio → reabrir → sessão hibernada → enviar mensagem → acorda e responde (mock responde a `resume`).
- **E2E-04 limite de sessões**: abrir 4 sessões → a 4ª fica "na fila" → fechar uma → a 4ª inicia.
- **E2E-05 pesquisa**: perfil com `needs_research` em salário → perguntar → mock chama `WebSearch` (simulado) e `research.save` → `ResearchCard` com fonte → "usar este valor" → perfil atualizado com `source.kind = pesquisa`.
- **E2E-06 clarificação**: concluir ingestão de texto livre (F03) → "Clarificar" → sessão faz pergunta → responder → proposta nova aparece na revisão.
- **E2E-07 ação sugerida**: mock emite `ui.suggest_action("gerar-cv")` → botão aparece → clique leva à rota (ou "em breve").
- **E2E-08 provider deslogado**: mock em `loggedOut` → chat mostra instrução de login e não cria sessão.
- **E2E-09 modo B smoke** (job de CI separado, com CLI real e `claude -p` + `--plugin-dir plugin/` + `NARNIA_PROVIDER` irrelevante): `claude -p "/narnia-jobs:perfil" --max-turns 2` contra o `api` do compose devolve o cartão do perfil ativo. Marcado como opcional na CI quando não houver credencial; obrigatório antes de fechar F04 localmente.
- **E2E-10 porta mudou**: alterar `NARNIA_PORT` → `install-plugin` reescreve `.mcp.json` → `doctor` lista tools.

### 6.4 Teste manual com provider real (antes de fechar F04)
Com assinatura real: (1) conversa de 20 turnos no modo A medindo tokens por turno e comparando com `usage_event`; (2) a mesma conversa no modo B no terminal e no app desktop; (3) pesquisa salarial real para um cargo em pt-BR e en-US, avaliando fontes e citação; (4) clarificação de um texto livre real; (5) troca de perfil no meio e verificação da persona. Registrar em §8 os tokens do cartão (F02 §6.4) e a diferença entre modos A e B por turno.

### 6.5 Definição de pronto
- Testes 6.2 e 6.3 verdes; E2E-09 executado ao menos localmente com credencial real.
- Nenhuma string de persona/instrução fora de `plugin/` (teste que procura por marcadores de prompt em `apps/`).
- Todas as tools de `../03 §5` expostas e cobertas por teste de `tools/call`.
- `tokens_est` do cartão (F02) calibrado contra o real.
- `../03 §4, §5, §10, §13` e `../07` atualizados.

---

## 7 · Riscos específicos
| Risco | Mitigação |
|-------|-----------|
| Política da Anthropic sobre login de assinatura em wrappers (modo A) | modo B entregue na mesma task e tratado como primeira classe; `README` explica |
| Mecanismo de instalação de plugins locais mudar | instalador isola o passo; `claude mcp add` garante as tools; `--plugin-dir` nos testes |
| Processos do CLI consumirem memória com várias sessões | limite + hibernação (F04-3/4); monitor em `doctor` |
| Agente pesquisar além do permitido | `WebSearch` só com `scopes` de categoria carreira/clarificação; prompt restringe; `research_source` audita |
| Hook `SessionStart` falhar sem `api` | aviso e fallback: skill `perfil` recarrega o cartão |
| Formato de eventos do SDK mudar (0.3.x) | normalizador com testes por fixture de versão; SDK fixado |

## 8 · Registro de execução
(Preencher durante a implementação: datas, medições de 6.4, decisões tomadas.)
