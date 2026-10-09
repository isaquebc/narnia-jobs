# F03 · Ingestão de dados

Entregável 3 do plan-v0. Cobre o fluxo **F3** de `../02-fluxos-do-usuario.md` além do que o F01 já entregou (CV e texto livre no primeiro uso): **GitHub** em análise pública ou privada, com coleta pelo `gh`, métricas quantitativas, orçamento de tokens ligado ao plano do usuário, análise incremental por commit e relatórios salvos; **segundo CV** e **texto livre adicional** ("Conte a sua história de carreira/vida") com detecção de "já lido"; **reconciliação** com os fatos existentes (novo / existente / conflito); **revisão anti-alucinação**; **área de notificações** para tudo que fica pendente com o usuário. Depende de F01 (cadeia de ingestão, revisão, provider, jobs) e F02 (perfis para tags, tarefas genéricas `enqueueTask`/`processTask`, `project`). A sessão de clarificação continua na F04 (aqui o botão existe desabilitado). LinkedIn foi adiado (§1, F03-7).

Status: **refinada em 2026-10-09** contra o código entregue até a F02 (decisões F03-1 a F03-3 fechadas pelo dono; F03-4 e F03-10+ aguardam o dono, §5). Implementação não iniciada; marcos em §6.1.

---

## 1 · Objetivo e resultado esperado

Uma pessoa com o onboarding feito consegue:

1. conectar o GitHub sem fricção: o app reaproveita o `gh` logado no computador ou, na falta dele, faz o login pelo fluxo de dispositivo numa nova aba (F03-1);
2. escolher **análise pública** (só repositórios públicos, sem login obrigatório) ou **privada** (inclui privados), selecionar repositórios agrupados por Pessoais e organizações com pré-seleção dos 10 mais recentes por grupo (F03-2);
3. antes de rodar, escolher **profundidade**, **modelo** e **orçamento**, vendo o diagnóstico do plano (tipo de assinatura, uso das janelas de 5 h e semanal, quando renovam), o orçamento recomendado e a estimativa real (F03-3);
4. acompanhar a execução na bandeja e na página da execução; se o orçamento estourar, decidir entre continuar, encerrar com o que já foi feito ou deixar para depois (fica nas pendências);
5. ver as **métricas quantitativas** do GitHub (commits, PRs, issues, contribuições, repositórios open source) e o **relatório** de cada repositório e da execução;
6. reanalisar um repositório e ter a análise **incremental** (só o diff desde o commit analisado) ou, sem mudanças, escolher uma **segunda rodada** (aprofundar o já visto ou cobrir o que ficou de fora);
7. enviar um segundo CV ou um texto livre e ser avisado quando aquele conteúdo **já foi lido** (com link para a execução anterior);
8. revisar as propostas numa tela de diff (novo / existente / conflito), resolver conflitos campo a campo, ver o selo da revisão anti-alucinação, aceitar em lote e marcar para quais perfis cada fato é relevante;
9. ver no **sino de notificações** tudo que espera por ele (revisões pendentes, conflitos, execuções aguardando decisão, execuções concluídas, sugestões de perfil), e ir direto ao lugar de resolver;
10. abrir o **digest** de um arquivo ou repositório (resumo de 200–400 tokens, pontos principais, índice) em vez do original, e editá-lo.

### Dentro do escopo
- **Fontes**: GitHub (pública e privada), CV adicional, texto livre adicional.
- **`gh` no container** (imagem com `gh`), credencial do host (`gh auth token` repassado pelo lançador) ou login próprio por fluxo de dispositivo, volume `gh-auth`, escolha em Configurações › Integrações (F03-1).
- **Coleta sem tokens** (`packages/core/src/ingest/sources/github/*`): repositórios por grupo, metadados, linguagens, tópicos, README, manifestos/configs/CI, commits do usuário, árvore, métricas quantitativas (REST + GraphQL `contributionsCollection`).
- **Orçamento** com diagnóstico do plano, divisão igual por repositório, freio com decisão do usuário, relatório da execução (F03-3).
- **Extração por repositório** (uma chamada sem tools → propostas + relatório do repositório), escolha de arquivos pelo modelo na profunda, **síntese final** sobre os relatórios.
- **Incremental por commit** e **segunda rodada** com mapa de cobertura.
- **Dedupe por hash** de CV e texto com aviso de "já lido".
- **Reconciliação** com fatos existentes, conflitos campo a campo, tags por perfil.
- **Revisão anti-alucinação** em duas camadas (literal sem tokens; Haiku em lote, desligável).
- **Notificações** (tabela, API, WS, sino no cabeçalho, página), com geradores desta task e os da F02 plugados (F03-10).
- **Digest de repositório** e edição de digest.
- **Snapshots** com teto configurável (F03-9).
- Tools `file.*` e `ingest.*` definidas em `shared` com handlers em `core` (exposição MCP na F04).

### Fora do escopo (e para onde vai)
- **LinkedIn** (ZIP de export, F03-7) → adiado; desenho preservado em §9 deste documento e item adiado em `tasks/README.md`.
- Sessão de clarificação → F04 (botão desabilitado com tooltip).
- Revisão do perfil público do GitHub com orientação de atualizações → skill `github-publico` do recrutador (F04), que consome os relatórios desta task.
- Configuração de concorrência dos workers e histórico/limpeza da página de processos → F10 (aqui só F03-8: ingestão com 2 em paralelo).
- Edição livre de fatos fora da revisão → F10.
- Sites pessoais/portfólio por URL, vagas → fora do plan-v0 / F06.

---

## 2 · Arquitetura deste entregável

### 2.1 Pipeline por fonte
```
CV / texto adicional ──► mesma cadeia de etapas do F01 (planStages/processStage), com:
                         dedupe por sha → aviso "já lido" → modelo escolhido → extract.facts → reconcile → review_check → review

GitHub ──► POST /api/ingestions {source:"github", mode, repos[], depth, model, budget}
  └─ tarefa ingest.github.prepare (0 tokens): coleta + métricas + snapshot + plano por repositório + estimativa
        └─ run.status = awaiting_confirmation (UI confirma orçamento; auto abaixo do limiar configurado)
  └─ tarefa ingest.github.repo × N (1 por repositório, chave = run+repo): [profunda: escolha de arquivos] → extração
        → propostas + relatório do repositório + cobertura + uso real → freio (§2.6)
  └─ tarefa ingest.github.synthesis (1 chamada): lê só os relatórios → propostas cruzadas + relatório da execução
  └─ tarefa ingest.reconcile (0 tokens): novo/existente/conflito, tags por perfil
  └─ tarefa ingest.review_check (camada 1 sem tokens; camada 2 Haiku em lote, opcional)
        └─ run.status = review → notificação "revisão pendente" (+ "conflitos" se houver)
UI revisão ─► POST /api/ingestions/:id/review ─► fatos + fact_source + profile_emphasis (tags) ─► run.status = done
```
CV e texto reaproveitam a cadeia do F01 inteira e ganham duas etapas no fim (`ingest.reconcile`, `ingest.review_check`) antes de `review`. O GitHub usa **tarefas genéricas** da F02 (`enqueueTask`/`processTask`), porque é por repositório, pausa e retoma (§2.9-1).

### 2.2 GitHub: credencial, modos e seletor (F03-1, F03-2)
- **Credencial**: `settings.github.auth = host | app` (padrão `host`). `host`: em `up`/`dev`, o lançador roda `gh auth token` no host (quando o `gh` existe e está logado) e grava o token em `gh-auth/host-token` (0600) no volume; o container exporta `GH_TOKEN` só no processo do `gh`. `app`: `gh auth login --web` em segundo plano na api (verificado sem TTY: imprime código e URL), código e "Abrir GitHub" na UI, detecção por WS, credencial em `gh-auth/` (`~/.config/gh`). `host` sem `gh` no computador cai no fluxo `app`. Estado e escopos em `GET /api/github/auth`.
- **Modos**: `public` (lista só públicos; funciona sem login, com aviso do limite anônimo) e `private` (exige login; inclui privados com cadeado).
- **Seletor**: grupos Pessoais (expandido) e organizações (recolhidas, expandem); pré-seleção por grupo dos 10 com push mais recente; contador "N de M" e "marcar todos"; aviso quando o total passa de 10; forks e arquivados desmarcados, selecionáveis e destacados.

### 2.3 Coleta e métricas (0 tokens, `packages/core/src/ingest/sources/github/`)
- `gh.ts`: wrapper com `exec` injetável (`gh api --paginate`, `gh api graphql`), tratamento de 401/403/rate limit (`retry_after`), nunca loga o token; `GH_API_BASE`/`GH_HOST` para o mock HTTP nos e2e.
- `collect.ts`: por repositório: metadados, linguagens, tópicos, estrelas, `pushed_at`, `default_branch`, `head_sha`, README, árvore (`git/trees?recursive=1`, truncada), manifestos/configs/CI, mensagens dos commits do usuário (autor = login), contagem de commits do usuário.
- `metrics.ts`: por repositório e total: commits do usuário, PRs abertos/mergeados/fechados sem merge, revisões aprovadas, issues criadas/resolvidas; globais via GraphQL `contributionsCollection` (por ano: commits, PRs, issues, revisões, repositórios contribuídos), nº de repositórios open source próprios e contribuições em terceiros. Gravado em `github_metric` e passado ao modelo como tabela compacta.
- `highlights.ts`: heurística de destaques dentro da fatia do repositório, nesta ordem: metadados → README → manifestos/configs/CI → mensagens dos commits do usuário → pontos de entrada → testes → amostras de código; cada arquivo cortado num máximo de chars.

### 2.4 Orçamento e diagnóstico do plano (F03-3)
- `providers/src/claude-code/plan-usage.ts`: adaptador `getPlanUsage() → { subscription, windows: { fiveHour, sevenDay, perModel[] } (utilization %, resetsAt) } | null` sobre `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true })`, com fallback no último `SDKRateLimitEvent` recebido no stream (o provider passa a capturá-lo em toda `query`, hoje ignorado) e `null` para API key/terceiros. Mock com fixture.
- `core/src/budget/*`: `recommendBudget({ depthDefault, planUsage, pctToTokens })` = min(padrão da profundidade, 70% do restante da janela de 5 h convertido em tokens); `learnPctToTokens(model, usageBefore, usageAfter, tokens)` grava a conversão % → tokens por modelo em `settings.budget.pct_to_tokens` (média móvel); sem histórico, a UI marca "aproximado". Padrões: rápida 15 mil, equilibrada 50 mil, profunda 150 mil. Unidade de exibição: mil, milhão ou % da janela (`settings.budget.unit`).
- Divisão: fatia = (orçamento − reserva da síntese − reserva do revisor) / nº de repositórios; sobra **não** é redistribuída.
- Estimativa (`estimateRepo`, `estimateRun`): usa `estimateCall` da F02 por chamada (seleção de arquivos, extração, síntese, revisor) com o tamanho real do conteúdo coletado.

### 2.5 Extração, cobertura e síntese
- Por repositório, sem tools, `maxTurns: 1`, `outputFormat` JSON: entrada = destaques dentro da fatia + tabela de métricas + (incremental) relatório anterior + diff; saída = `{ proposals[] (cada uma com `evidence: { ref, quote }`), report { summary, stack, highlights, risks, suggestedProjects }, coverage { files[], topics[] } }`.
- Profunda: antes da extração, chamada barata (modelo mais barato) vê a árvore + candidatos e escolhe até 8 arquivos, dentro da fatia.
- Síntese: uma chamada lê só os relatórios dos repositórios + métricas globais → propostas transversais (skills, senioridade aparente) e o texto do relatório da execução.
- Digest do repositório = relatório resumido gravado em `file_digest` com `subject_kind = repo` (F03-11).

### 2.6 Freio, pendências e retomada
Após cada chamada o worker soma o uso real ao run. Se passar de **125% do orçamento**, o run vai para `awaiting_decision` antes do próximo repositório, gera notificação e para. A tela mostra gasto × estimado, restante da janela e renovação (do adaptador), custo estimado para terminar. Ações: **continuar** (`POST …/decision {action:"continue", extraBudget}` reenfileira os repositórios restantes), **encerrar com o feito** (`finish` → síntese sobre o que existe → reconcile → review), **deixar para depois** (`later` → `paused`, notificação persiste; aparece em Pendências até finalizar). Repositórios não analisados ficam marcados `skipped_budget` no relatório.

### 2.7 Incremental e segunda rodada
- `repo_analysis` guarda, por repositório: `head_sha` analisado, profundidade, relatório, cobertura, uso, data.
- Reanálise com `head_sha` novo: diff via `gh api repos/{o}/{r}/compare/{base}...{head}` (arquivos alterados, patches truncados, mensagens) + relatório anterior; a heurística escolhe dentro do diff.
- Mesmo `head_sha`: a UI pergunta "segunda rodada?" com **aprofundar o já analisado** (mesmos arquivos, mais conteúdo por arquivo e perguntas sobre os temas) ou **cobrir o que ficou de fora** (candidatos fora da cobertura). Cada rodada cria nova linha em `repo_analysis` com `parent_id`.

### 2.8 Reconciliação, revisão anti-alucinação e notificações
- **Reconciliação** (`core/src/ingest/reconcile.ts`): normalização de empresa (minúsculas, sem Ltda/Inc/S.A.), título, skill (`normalizeSkillName` do F01 + sinônimos ReactJS→React), projeto por `url`/`full_name`; experiência igual (empresa + sobreposição de datas ≥ 50%) → `existing` (aceitar = novo `fact_source`); campo divergente → `conflict` com valor atual, novo e origens; resto `new`. Tags por perfil sugeridas por área/cargo-alvo/termos (`profile/relevance.ts` da F02).
- **Revisão anti-alucinação** (`core/src/ingest/review-check.ts`): camada 1 sem tokens confere que `evidence.quote` existe literalmente (normalizando espaços) no conteúdo enviado em `evidence.ref`; sem trecho válido → `unsupported`. Camada 2: uma chamada em lote no modelo mais barato com `{ proposta, trecho }` → `supported | partial | unsupported`; selo na revisão; nada é apagado; `settings.ingest.review_check_model_enabled` (padrão ligado).
- **Notificações** (F03-10): tabela `notification`, `GET /api/notifications?status=`, `POST …/:id/read|dismiss`, WS `notification.created/updated`, sino no cabeçalho com contagem de não resolvidas, página `/pendencias`. Cada notificação tem `kind`, `subject` (run, proposta, sugestão…), `action_url` e `resolved_at`; é resolvida pelo próprio fluxo (revisão salva, decisão tomada) e não por clique. Geradores nesta task: `review.pending`, `review.conflicts`, `ingestion.awaiting_decision`, `ingestion.done`, `ingestion.error`; da F02: `profile.suggestion` (sugestão nova) e `profile.analysis_done`. Tasks futuras chamam `notifications.upsert(kind, subject, …)` do `core`.

### 2.9 Encaixe no código (verificado em 2026-10-09)
1. **Cadeia de etapas × tarefas.** A cadeia do F01 (`planStages`, `stageJobId(runId, stage)`, `processStage`) é por arquivo e linear; continua para CV e texto, com duas etapas novas no fim (`ingest.reconcile`, `ingest.review_check`, fila `ingest`, 0 tokens na camada 1). GitHub usa `enqueueTask`/`processTask` da F02 com chaves `run__repo`, porque precisa de N jobs por run, pausa e retomada; o `enqueueTask` já remove job falho antes de reenfileirar (auditoria F02), o que dá a retomada de graça.
2. **`ingestion_run.file_id` é `NOT NULL`** e o `status` tem `CHECK` fixo (`estimating|queued|running|review|done|error`). GitHub não tem arquivo e precisa de estados novos (`awaiting_confirmation`, `awaiting_decision`, `paused`, `cancelled`). SQLite não altera `CHECK`/`NOT NULL`: `0003_ingest.sql` reconstrói `ingestion_run` (create new → copy → drop → rename, dentro de transação, com `foreign_keys` desligado durante a cópia) e adiciona `source`, `mode`, `params_json`, `budget_json`, `model`, `report_json`. Teste de upgrade com banco da F02.
3. **`source_file.kind` tem `CHECK (cv, text)`** e `fact_source.kind` já aceita `github`. GitHub não cria `source_file`; o vínculo é `fact_source.repo_id` (coluna nova).
4. **`file_digest` tem `file_id` como chave primária.** Para repositório: nova tabela `repo_digest` com o mesmo formato (mais simples e seguro que generalizar a PK numa reconstrução); `file.get_digest` e a UI tratam os dois (F03-11).
5. **Dedupe por hash já existe para arquivo e texto** (`storeUpload`/`storeText` → `sourceFiles.findBySha256`, 200 em vez de 201), mas a resposta não diz se já houve ingestão. Falta: `GET /api/files/:id` e a resposta do upload incluírem `previousRuns` (`ingestionRuns.listByFile`) e a UI avisar "já lido em DD/MM, ver execução" com opções "abrir execução anterior" ou "ler de novo".
6. **A revisão do F01 sempre insere fatos novos** (`proposals.review` → `insert`); não existe `existing`/`conflict`. `ingestion_proposal` ganha `match`, `match_target_id`, `conflict_json`, `evidence_json`, `check_status`, `suggested_profiles_json`; `review` passa a: `existing` aceito → só `fact_sources.link` (novo `fact_source`); `conflict` exige `resolution` por campo (`keep|use_new|edit`) senão 422; `new` como hoje. A tela de revisão do F01 (`StepReview`/`ProposalList`) é estendida, não duplicada: componente `ReviewTable` usado pelo wizard e pela página de execução.
7. **Provider** só tem `readDocument`/`extractFacts`/`buildDigest`/`analyzeProfiles`. Entram `pickFiles`, `analyzeRepo`, `synthesizeRun`, `checkProposals`, cada um com prompt em `prompts/*.md`, `outputFormat` via `toJsonSchema` (sem `$schema`) e mock com fixture; e a captura de `rate_limit_event` no laço de `query`.
8. **`extractFacts` do F01 não pede evidência.** O schema de saída ganha `evidence { ref, quote }` opcional por proposta (obrigatório nas fontes novas; CV/texto do F01 passam a pedir também, com o prompt atualizado).
9. **Uso**: `usage_event` tem `jobId` e `category`; categorias novas `ingest.github.pick`, `ingest.github.repo`, `ingest.github.synthesis`, `ingest.review_check`. O run soma o uso real em `usage_json` (já existe `addUsage` por chamada nomeada; vira mapa livre).
10. **Worker**: `DEFAULT_CONCURRENCY.ingest = 2` já atende F03-8 para a fila `ingest`; as tarefas de repositório rodam na fila `extract` (concorrência 2) para não bloquear a camada de texto de CVs.
11. **Bandeja** (`ActivityTray.stageLabel`) mapeia etapas por nome; entram rótulos para as tarefas novas e para `awaiting_decision`/`paused`, que aparecem como "Aguardando você" com link para a execução.
12. **WS** (`WsEventSchema`, união discriminada): entram `ingestion.updated {runId, status}` e `notification.created/updated`.
13. **Imagem**: `gh` não está no Dockerfile; entra pelo repositório oficial do GitHub CLI nos estágios `dev` e `runtime` (~40 MB). `git` já está.
14. **Lançadores e volumes**: volume `gh-auth` montado em `/home/node/.config/gh` nos dois composes (por projeto Docker, então cada instância tem o seu); `start.sh`/`start.ps1` gravam o token do host antes do `up`/`dev` (`docker compose run --rm --no-deps api sh -c 'umask 077; cat > …'` lendo da entrada padrão, nunca por argumento nem `.env`). O token do host vale para as duas instâncias (dono e Claude).
15. **Settings**: não existe `config.json`; o plano antigo citava token em `config.json`. Credencial só no volume `gh-auth`; preferências em `settings` (`github.auth`, `budget.*`, `ingest.review_check_model_enabled`, `snapshots.max_bytes`).
16. **Instâncias** (`CLAUDE.md`): mock HTTP do GitHub (`apps/e2e/mock-github`) sobe só no compose e2e; a instância do Claude usa provider mock e `GH_API_BASE` do mock quando testar sem rede.

### 2.10 API
| Método e rota | Função |
|---------------|--------|
| `GET /api/github/auth` · `PUT /api/github/auth {source: host\|app}` · `POST /api/github/auth/device` · `DELETE /api/github/auth` | estado (origem, login, escopos, nunca o token), escolha da origem, inicia o fluxo de dispositivo (devolve código, URL, expiração; conclusão por WS), desconectar |
| `POST /api/sources/github/preview {mode}` | grupos (Pessoais, organizações) com repositórios, selos e pré-seleção, sem job |
| `GET /api/plan/usage` | diagnóstico do plano (assinatura, janelas, renovação) pelo adaptador; `null` quando indisponível |
| `POST /api/ingestions/estimate` | estimativa e orçamento recomendado para uma seleção (GitHub) ou arquivo/texto |
| `POST /api/ingestions` · `GET /api/ingestions?status=` · `GET /api/ingestions/:id` | criar (`source`, `mode`, `repos`, `depth`, `model`, `budget`) e acompanhar; `GET` traz relatório, métricas e análises |
| `POST /api/ingestions/:id/confirm` · `/decision {action: continue\|finish\|later, extraBudget?}` · `/cancel` · `/retry` | controle |
| `POST /api/repos/:id/reanalyze {kind?: incremental\|deepen\|cover}` · `GET /api/repos` · `GET /api/repos/:id` | reanálise e evidências |
| `GET /api/ingestions/:id/proposals` · `POST /api/ingestions/:id/review` | revisão (com `resolution` por conflito; 422 sem) |
| `GET\|PUT /api/files/:id/digest` · `GET\|PUT /api/repos/:id/digest` | ler/editar digest |
| `GET /api/notifications?status=` · `POST /api/notifications/:id/read` · `/dismiss` | pendências |
| `GET /api/snapshots` · `DELETE /api/snapshots/:id` | gestão de espaço |
| `POST /api/files`, `POST /api/texts` (F01, estendidas) | respostas incluem `previousRuns` |

---

## 3 · Dados deste entregável

Migration `0003_ingest.sql` (só para frente; reconstrói `ingestion_run`, §2.9-2):

| Tabela | Colunas (novas ou completadas) |
|--------|--------------------------------|
| `ingestion_run` (reconstruída) | `file_id` passa a nulo; `source` (cv/text/github), `mode` (public/private, só GitHub), `params_json` (repos, filtros), `budget_json` ({ amount, unit, perRepo, reserve }), `model`, `report_json` (relatório da execução), `parent_run_id` (retomada/segunda rodada); `status` + `awaiting_confirmation`, `awaiting_decision`, `paused`, `cancelled` |
| `ingestion_proposal` (completar) | `match` (new/existing/conflict), `match_target_id`, `conflict_json`, `resolution_json`, `evidence_json` ({ref, quote}), `check_status` (supported/partial/unsupported/unchecked), `suggested_profiles_json` |
| `repo` (nova) | `id`, `full_name` (único), `owner`, `url`, `description`, `is_private`, `is_fork`, `is_archived`, `languages_json`, `topics_json`, `stars`, `pushed_at`, `default_branch`, `head_sha`, `relevance`, `last_analysis_id` |
| `repo_analysis` (nova) | `id`, `repo_id`, `run_id`, `parent_id`, `head_sha`, `base_sha`, `depth`, `kind` (full/incremental/deepen/cover), `report_json`, `coverage_json`, `usage_json`, `status` (done/skipped_budget/error), `created_at` |
| `repo_digest` (nova) | `repo_id` (pk), `summary`, `key_points_json`, `sections_json`, `meta_json`, `edited_by_user`, `updated_at` |
| `github_metric` (nova) | `id`, `scope` (repo/global/year), `repo_id`, `year`, `metrics_json` (commits, prs_opened/merged/closed, reviews_approved, issues_opened/closed, oss_repos, external_contributions), `collected_at` |
| `snapshot` (nova) | `id`, `source`, `ref`, `head_sha`, `path`, `sha256`, `size`, `taken_at`, `last_used_at` |
| `notification` (nova) | `id`, `kind`, `subject_kind`, `subject_id`, `title`, `body`, `action_url`, `severity`, `created_at`, `read_at`, `resolved_at`; único `(kind, subject_kind, subject_id)` não resolvido (upsert) |
| `project` (completar) | `repo_id` |
| `fact_source` (completar) | `repo_id`, `analysis_id` |
| `settings` | `github.auth`, `budget.default.{quick,balanced,deep}`, `budget.unit`, `budget.pct_to_tokens`, `ingest.review_check_model_enabled`, `ingest.auto_confirm_below`, `snapshots.max_bytes` (padrão 2 GB), `models.ingest.{pick,repo,synthesis,check}` |

Regras:
- Credencial do GitHub só no volume `gh-auth`; nunca em tabela, `.env`, log ou resposta da API (teste que varre `/data/logs` e as respostas).
- Toda proposta aceita sobre entidade existente gera **novo** `fact_source`; nada é substituído.
- Snapshots: teto em `settings.snapshots.max_bytes`, limpeza LRU manual com aviso ao passar do teto.
- `notification` é resolvida pelo fluxo dono do assunto; dispensar só esconde (não resolve).

---

## 4 · Layouts deste entregável

Rotas web novas: `/ingestao` (nova ingestão), `/ingestao/$runId` (progresso, decisão, revisão, relatório), `/evidencias/repositorios` (lista e digest), `/pendencias` (notificações). `SideNav` ganha "Ingestão" e "Evidências"; o cabeçalho ganha o sino.

| Tela | Componentes | Estados a cobrir |
|------|-------------|------------------|
| Nova ingestão | `SourceTabs` (GitHub, CV, Texto livre) | cada aba |
| GitHub › conexão | `GithubConnectCard` (origem host/app, "Conectar GitHub", código + copiar + "Abrir GitHub", contagem 15 min, "Conectado como @x", escopos, desconectar) | sem `gh` no host · conectando · conectado · expirado · erro |
| GitHub › seleção | `ModeSwitch` (pública/privada), `RepoGroups` (Pessoais expandido, organizações recolhidas, link do repo, selos fork/arquivado/privado, "N de M", marcar todos), aviso > 10 | carregando · sem repositórios · rate limit anônimo · privada sem login |
| GitHub › plano e orçamento | `DepthPicker`, `ModelPicker`, `PlanUsageCard` (assinatura, janelas, renovação), `BudgetInput` (unidade mil/milhão/% janela, recomendado, "aproximado"), `EstimateCard` (por repositório e total) | sem dados do plano · acima do recomendado · acima da janela |
| CV / texto adicional | dropzone/editor do F01 + `AlreadyReadNotice` ("já lido em …", abrir execução, ler de novo) + `ModelPicker` | novo · já lido |
| Execução | `RunProgress` (repositório x/y, uso real × orçamento), `BudgetDecisionDialog` (gasto × estimado, janela, custo para terminar, continuar/encerrar/depois), `MetricsTable`, `RunReport`, `RepoReportCard` | preparando · aguardando confirmação · analisando · aguardando decisão · pausado · síntese · revisão · concluído · erro · cancelado |
| Revisão | `ReviewTable` (do F01, estendida: agrupada por tipo, filtros novo/existente/conflito/pendente/sem suporte), `ConflictResolver` (manter atual / usar novo / editar por campo), `CheckBadge` (sustentada/parcial/sem suporte com o trecho), `ProfileTagPicker` (linha e lote), "Clarificar com o recrutador" desabilitado (F04) | sem conflitos · conflitos pendentes (bloqueia salvar) · tudo decidido |
| Reanálise | `ReanalyzeDialog` (há diff: incremental com resumo do diff; sem diff: aprofundar / cobrir o que ficou de fora) | com diff · sem diff |
| Evidências › Repositórios | `RepoList` (relevância, última análise, commit, métricas), `RepoDigestView` (ler/editar), histórico de análises | vazio · com análises · digest editado |
| Pendências | `NotificationBell` (contagem), `NotificationList` (agrupada por tipo, ir para resolver, dispensar) | vazio · com itens · resolvidas ocultas |
| Configurações › Integrações | origem da credencial do GitHub, revisor anti-alucinação liga/desliga, unidade do orçamento, padrões por profundidade, teto de snapshots com uso atual e limpar | — |

Regras de UI: tudo retomável pela bandeja e pelas pendências; datas UTC exibidas no fuso do usuário; textos via `t()`.

---

## 5 · Decisões deste entregável

| # | Decisão | Opções | Decidido / recomendação |
|---|---------|--------|-------------------------|
| F03-1 | Cliente GitHub | `octokit` · `fetch` manual · `gh` | **Decidida 2026-10-09 (dono): `gh` dentro do container**, com duas origens de credencial escolhidas em Configurações › Integrações (`settings.github.auth = host | app`, padrão `host`): (a) **reusar o `gh` do computador**: o lançador (`start.sh`/`start.ps1` em `up`/`dev`) roda `gh auth token` no host quando o `gh` existe e está logado e entrega o token ao container (arquivo 0600 no volume `gh-auth`, nunca em `.env`, banco ou log), renovado a cada subida; (b) **login próprio do app** pelo fluxo de dispositivo, sem terminal visível: botão "Conectar GitHub" → a API roda `gh auth login --web` em segundo plano (verificado: funciona sem TTY), mostra o código com copiar e o botão "Abrir GitHub" (`github.com/login/device`, nova aba), detecta a autorização e avisa por WS ("Conectado como @usuario", escopos), contagem dos 15 min e "gerar outro código"; credencial no volume `gh-auth`. Se `host` estiver escolhido e o `gh` do computador não existir ou não estiver logado, a UI cai no fluxo (b). "Desconectar" apaga a credencial do app. Análise pública funciona sem login (limite anônimo); privada exige escopo `repo` (explicado antes de autorizar; o app só lê). Coletor usa `gh api` (paginação, rate limit) e `gh repo clone` quando precisar de código. |
| F03-2 | Seletor de repositórios (o limite anônimo perdeu peso com o `gh`, F03-1) | — | **Decidida 2026-10-09 (dono):** primeiro campo é o modo, **análise pública** ou **privada**; na pública o formulário mostra só a lista de repositórios públicos (sem login obrigatório), na privada o formulário completo (inclui privados com cadeado, exige `gh` logado). Lista agrupada: **Pessoais** (expandido) e uma linha por **organização** (recolhida, expande para mostrar os repositórios com link). Pré-seleção por grupo: até 10 com push mais recente; com menos de 10, todos; contador "N de M" e "marcar todos" por grupo. **Aviso quando o total selecionado passa de 10** (pode demorar bastante e custar mais), sem bloquear. **Forks e arquivados** aparecem desmarcados, selecionáveis, visualmente destacados (selo e estilo próprio). Estimativa de tokens no rodapé atualiza a cada marcação. |
| F03-3 | Orçamento, leitura e custo | heurística fixa · modelo pede arquivos · combinação com orçamento | **Decidida 2026-10-09 (dono):** (1) orçamento com diagnóstico do plano: tipo de assinatura e uso das janelas de 5 h e semanal via `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET` atrás de um adaptador, com fallback no `SDKRateLimitEvent` do stream; recomendado = min(padrão da profundidade, 70% do restante da janela de 5 h); conversão % → tokens aprendida por modelo comparando o uso antes e depois; unidade escolhida: mil, milhão ou % da janela; (2) divisão igual por repositório, sem redistribuir sobra, e **relatório de execução** salvo (estimado × real por repositório, modelo, tempo, paradas, o que ficou de fora); (3) heurística de destaques sem tokens: metadados → README → manifestos/configs/CI → mensagens dos commits do usuário → entrypoints → testes → amostras, mais **métricas quantitativas** pelo `gh` (commits por repositório e total, PRs abertos/mergeados/fechados/revisões aprovadas, issues criadas/resolvidas, nº de repositórios open source, contribuições em terceiros via GraphQL `contributionsCollection`), salvas em tabela e passadas como tabela compacta ao modelo; (4) uma chamada por repositório sem tools → propostas + relatório do repositório salvo; síntese final lê só relatórios; (5) na profunda, chamada barata escolhe até 8 arquivos da árvore e dos candidatos, dentro da fatia; (6) freio: ao passar de 125% do orçamento, pausa em "aguardando decisão" com notificação, mostra gasto × estimado, restante da janela e renovação, custo para terminar; opções continuar / encerrar com o feito / deixar para depois (fica nas pendências até finalizar); (7) incremental por commit salvo (relatório anterior + diff desde o SHA); sem diff, pergunta se quer segunda rodada: aprofundar o já analisado ou cobrir o que ficou de fora, com **mapa de cobertura** salvo; (8) revisão anti-alucinação em duas camadas: sem tokens, toda proposta cita trecho literal e o código confere; com o modelo mais barato (Haiku), lote marca sustentada/parcial/sem suporte; nada é apagado, selo na revisão; segunda camada desligável em Configurações. |
| F03-4 | Como obter o código | `gh repo clone --depth 1` · tarball da API · API (`contents`, `git/trees`, `compare`) | **Decidida 2026-10-09 (dono): API pelo `gh`, sem clone.** O código só é necessário na profunda (amostras e arquivos escolhidos pelo modelo) e na incremental (diff); a API entrega exatamente isso: `git/trees` para a árvore, `contents`/blobs só para os ≤ 8 arquivos escolhidos e `compare/{base}...{head}` para o diff com patches, sem baixar o repositório inteiro, com o mesmo login e sem `git` de credencial. Clone raso fica como fallback para repositórios grandes demais para a API (árvore truncada), com snapshot do que foi lido. |
| F03-5 | Modelo | Sonnet na síntese, Haiku por repositório · escolha do usuário | **Decidida 2026-10-09 (dono): o usuário escolhe antes de rodar**, com padrões por profundidade (rápida/equilibrada: Haiku em tudo; profunda: Haiku por repositório e Sonnet na síntese); escolha de arquivos e revisor anti-alucinação sempre no modelo mais barato disponível. |
| F03-6 | Conflito | bloquear salvar · aceitar com marcação | **Bloquear salvar** até resolver (decisão original mantida) **e gerar notificação** `review.conflicts` que leva à revisão (dono, 2026-10-09). |
| F03-7 | LinkedIn | nesta task · adiar | **Adiado (dono, 2026-10-09)**: sai do escopo; desenho preservado em §9 e item adiado em `tasks/README.md`. |
| F03-8 | Concorrência de ingestão | 2 · configurável | **2 em paralelo** (dono aprovou); configurável na F10. |
| F03-9 | Teto de snapshots | 2 GB manual · automático | **2 GB padrão, configurável** em Configurações (dono, 2026-10-09); limpeza LRU manual com aviso. |
| F03-10 | Escopo das notificações | só ingestão nesta task · infraestrutura geral já com geradores da F02 | **Decidida 2026-10-09 (dono): infraestrutura geral aqui** (tabela, API, WS, sino com contador, página com filtro; pendências se resolvem sozinhas quando a coisa pendente é resolvida, sem exigir "marcar como lida"), com os geradores da ingestão e os dois da F02 (`profile.suggestion`, `profile.analysis_done`), porque o primeiro uso gera muitas pendências e um único lugar evita retrabalho nas tasks seguintes; tasks futuras só chamam `notifications.upsert`. |
| F03-11 | Digest de repositório | generalizar `file_digest` (reconstruir a PK) · tabela `repo_digest` irmã | **Decidida 2026-10-09 (dono): `repo_digest` irmã** com o mesmo formato; evita reconstruir a tabela de digest do F01 e a UI/tool tratam os dois por `subject_kind`. |
| F03-12 | Evidência literal no CV/texto do F01 | só nas fontes novas · também no `extractFacts` do F01 | **Decidida 2026-10-09 (dono): também no F01**, para a revisão anti-alucinação valer para toda ingestão; custo pequeno (o modelo copia um trecho por proposta) e o mock já pode devolver trechos do texto da fixture. |
| F03-13 | Autoconfirmação da estimativa | sempre confirmar · confirmar só acima de um limiar | **Decidida 2026-10-09 (dono): GitHub sempre confirma**; CV e texto livre seguem sozinhos abaixo de `ingest.auto_confirm_below` = **10 mil tokens** (configurável; 0 = sempre confirmar). Novo na F03: o F01 hoje sempre espera o clique em "Extrair" após a estimativa; com a F03 o passo de fonte do wizard e a ingestão adicional seguem sozinhos abaixo do limiar, mostrando a estimativa. |

---

## 6 · O que precisa estar coberto para o F03 funcionar

### 6.1 Marcos de implementação (ordem obrigatória; cada marco termina com seus testes verdes; TDD como em `../09-metodologia-tdd.md`; testes na instância `claude`, `CLAUDE.md`)

| Marco | Entrega | Verificação |
|-------|---------|-------------|
| **M1 Shared + banco + notificações (core)** | schemas: `IngestionSource`, `IngestionMode`, `RunStatus` estendido, `Budget`, `PlanUsage`, `RepoSummary`, `RepoAnalysis`, `GithubMetrics`, `Evidence`, `CheckStatus`, `ProposalMatch`/`Conflict`/`Resolution`, `Notification`, saídas `PickFiles`/`AnalyzeRepo`/`SynthesizeRun`/`CheckProposals` (JSON Schema sem `$schema`, snapshot), contratos de §2.9 e rotas novas, WS `ingestion.updated`/`notification.*`, tools `file.*`/`ingest.*` em `shared/src/mcp/ingest.ts`; `0003_ingest.sql` com reconstrução de `ingestion_run` e teste de upgrade sobre banco da F02; repos `repos`, `repoAnalyses`, `repoDigests`, `githubMetrics`, `snapshots`, `notifications` (upsert/resolve/list), `ingestionRuns` estendido (estados novos, `report`, `budget`), `proposals` com `match`/`resolution`/`evidence`/`check_status` | testes de `shared` e dos repos; upgrade F02 → F03 sem perda; `scripts/claude-env.sh test` verde |
| **M2 Core: coleta, métricas, orçamento, reconciliação, revisão** | `ingest/sources/github/{gh,collect,metrics,highlights}.ts` com `exec` injetável e fixtures gravadas (usuário com 12 repositórios, 2 forks, 1 arquivado, 2 organizações), `budget/{recommend,learn,split}.ts`, `ingest/estimate-github.ts` (sobre `estimateCall`), `ingest/reconcile.ts`, `ingest/review-check.ts` (camada 1), `ingest/coverage.ts`, `ingest/tools.ts` (`file.list/get_digest/get_text` com teto de 8k chars, `ingest.*`), dedupe "já lido" (`previousRuns`) | testes de §6.2 `core`; cobertura ≥ 80% em `src/ingest/**` e `src/budget/**` |
| **M3 Provider + worker + API** | provider: `pickFiles`, `analyzeRepo`, `synthesizeRun`, `checkProposals`, captura de `rate_limit_event`, adaptador `getPlanUsage`, prompts, mock com fixtures; worker: tarefas `ingest.github.prepare/repo/synthesis`, etapas `ingest.reconcile`/`ingest.review_check` na cadeia do F01, freio a 125%, decisão continuar/encerrar/depois, incremental e segunda rodada, relatório da execução, notificações; api: rotas de §2.10, `gh` auth (host/app, fluxo de dispositivo em segundo plano), `GET /api/plan/usage`, revisão com `existing`/`conflict` (422 sem resolução); imagem com `gh`, volume `gh-auth`, lançadores com o token do host | testes de §6.2 `providers`, `worker`, `api`; fluxo `curl` com mock do GitHub e provider mock registrado em §8 |
| **M4 Web** | rotas de §4, `GithubConnectCard`, `RepoGroups`, `PlanUsageCard`, `BudgetInput`, `EstimateCard`, `RunProgress`, `BudgetDecisionDialog`, `MetricsTable`, `RunReport`, `ReviewTable` estendida (wizard do F01 continua usando), `ConflictResolver`, `CheckBadge`, `ProfileTagPicker`, `ReanalyzeDialog`, `RepoList`/`RepoDigestView`, `NotificationBell`/`NotificationList`, `AlreadyReadNotice`, Configurações › Integrações; dicionário pt-BR | testes de §6.2 `web`; smoke no navegador na instância `claude` |
| **M5 E2E + fechamento** | cenários de §6.3 (`apps/e2e/tests/f03-*`), mock HTTP do GitHub no compose e2e, docs `../02 §F3`, `../03 §6`, `../04 §A5/§A9`, README (Ingestão, GitHub, Pendências), §6.4 com o dono, §8 | `scripts/claude-env.sh e2e` verde; §6.5 completo |

### 6.2 Testes unitários (Vitest) · obrigatórios
**`packages/shared`**: schemas novos válidos/inválidos; JSON Schema das quatro saídas novas (snapshot, sem `$schema`); WS aceita os eventos novos.

**`packages/core`**
- `0003`: upgrade de um banco da F02 preserva runs, propostas e fatos; `file_id` nulo aceito só para `source = github`; estados novos aceitos.
- `sources/github/gh`: pagina; 401 → `not_authenticated`; 403 com `retry_after`; nunca inclui o token em erro ou log.
- `collect`: agrupa Pessoais/organizações; pré-seleção dos 10 mais recentes por grupo; forks/arquivados desmarcados; README ausente; árvore truncada marcada.
- `metrics`: soma por repositório e total; PRs por estado; issues; `contributionsCollection` por ano; repositórios open source; fixture gravada.
- `highlights`: ordem de prioridade; respeita a fatia e o máximo por arquivo; repositório sem testes/entrypoints.
- `budget`: recomendado = min(padrão, 70% do restante); sem dados do plano → padrão + "aproximado"; aprendizado % → tokens por modelo; divisão igual sem redistribuir; unidades.
- `estimate-github`: soma chamadas (seleção, repositório, síntese, revisor) com overhead; incremental mais barata que completa.
- `reconcile`: duplicata por empresa normalizada + datas; conflito campo a campo; skill por sinônimo vira `existing`; projeto por `url`; não marca conflito com fato rejeitado antes; tags sugeridas.
- `review-check` (camada 1): trecho literal presente → `unchecked` mantido para a camada 2; ausente → `unsupported`; normaliza espaços e quebras.
- `coverage`: segunda rodada "cobrir" só escolhe fora da cobertura; "aprofundar" só dentro.
- `notifications`: upsert não duplica não resolvida; resolve pelo assunto; lista por status.
- `previousRuns`: mesmo sha → lista execuções anteriores.
- Tools `file.*`/`ingest.*`: `file.get_text` recusa > 8k chars; `ingest.propose` valida por `kind`.

**`packages/providers`**: cada operação nova monta `query` com prompt, modelo e `outputFormat` certos (query injetada) e valida a saída; `rate_limit_event` capturado; `getPlanUsage` com a chamada experimental, com fallback e com `null`; mock com fixtures e modos de erro.

**`apps/worker`**: `prepare` cria tarefas por repositório; freio a 125% leva a `awaiting_decision` e notificação; `continue` reenfileira só os restantes; `finish` roda a síntese sobre o feito; `later` → `paused`; incremental usa diff; segunda rodada respeita cobertura; relatório da execução completo; erro de um repositório não derruba os outros; etapas novas na cadeia do F01 para CV/texto.

**`apps/api`**: rotas de §2.10; auth do GitHub (host/app; fluxo de dispositivo com processo fake); token nunca em resposta; revisão com conflito sem resolução → 422; `existing` aceito cria `fact_source` e não duplica fato; notificações por WS; upload repetido devolve `previousRuns`.

**`apps/web`**: `RepoGroups` (grupos, pré-seleção, aviso > 10, selos); `BudgetInput` (unidades, recomendado); `BudgetDecisionDialog` (três ações); `ConflictResolver` (bloqueio); `CheckBadge`; `ReanalyzeDialog`; `NotificationBell` (contagem por WS, navegação); `AlreadyReadNotice`; i18n.

### 6.3 Testes e2e (Playwright, Chromium) · obrigatórios
Compose e2e com `NARNIA_PROVIDER=mock`, mock HTTP do GitHub (`GH_API_BASE`) e credencial fake no volume `gh-auth`. Arquivos `apps/e2e/tests/f03-NN-*.spec.ts`.
- **E2E-01 GitHub pública rápida**: modo público → grupos → pré-seleção → estimativa e orçamento → rodar → métricas e relatórios → revisão com projetos e skills → aceitar → Evidências mostra repositórios com digest.
- **E2E-02 privada com seleção > 10**: login fake → privados com cadeado → marcar 12 → aviso → rodar.
- **E2E-03 freio de orçamento**: orçamento baixo → `awaiting_decision` → notificação no sino → diálogo com gasto × estimado → "deixar para depois" → aparece em Pendências → reabrir → "continuar" → conclui.
- **E2E-04 incremental**: segunda execução com `head_sha` novo no mock → diff → relatório incremental; sem mudança → diálogo de segunda rodada → "cobrir o que ficou de fora".
- **E2E-05 re-ingestão de CV com conflito**: 2º CV com datas diferentes → conflito → notificação → salvar bloqueado → "manter atual" → salva → fato com 2ª fonte.
- **E2E-06 já lido**: reenviar o mesmo CV → aviso com link para a execução anterior.
- **E2E-07 revisão anti-alucinação**: mock devolve uma proposta com trecho inexistente → selo "sem suporte" → aceitar mesmo assim é possível.
- **E2E-08 duas ingestões simultâneas**: GitHub e texto livre → bandeja mostra ambas → ambas em revisão.
- **E2E-09 tags por perfil**: dois perfis; aceitar projeto marcando só um → ênfase só nele.
- **E2E-10 conexão do GitHub**: fluxo de dispositivo com `gh` fake → código, abrir, conectado por WS; desconectar.
- **E2E-11 snapshot sem rede**: re-rodar com mock desligado usa snapshot.
- **E2E-12 botão clarificar**: desabilitado com tooltip "disponível após F04".

### 6.4 Teste manual com provider real (antes de fechar F03)
GitHub real do dono, na instância do dono só quando ele rodar (o Claude usa a sua instância com `NARNIA_PROVIDER=claude-code` se precisar): as três profundidades, pública e privada; registrar estimado × real por chamada, precisão da recomendação de orçamento contra o diagnóstico do plano, tempo, taxa de edição das propostas, proporção de "sem suporte" do revisor e falsos positivos, qualidade dos relatórios e da síntese; uma reanálise incremental e uma segunda rodada.

### 6.5 Definição de pronto
- Testes 6.2 e 6.3 verdes; cobertura ≥ 80% em `core/src/ingest/**` e `core/src/budget/**`.
- Estimativa dentro de ±25% do uso medido em 6.4 (senão recalibrar overhead).
- Nenhuma credencial do GitHub em resposta de API, banco ou `/data/logs` (teste automatizado).
- Upgrade de banco da F02 sem perda (teste).
- `../02 §F3`, `../03 §6`, `../04 §A5/§A9` e README atualizados.
- Critério de entregável publicável de `tasks/README.md`.

---

## 7 · Riscos específicos
| Risco | Mitigação |
|-------|-----------|
| API experimental de uso do plano mudar ou sumir | adaptador isolado; fallback no `rate_limit_event`; sem dados → padrão "aproximado" |
| Conversão % → tokens imprecisa no começo | marcada "aproximado" até ter histórico; freio a 125% protege |
| Token do host com permissões amplas | o app só faz leituras; teste de que nenhuma rota escreve no GitHub; opção `app` com escopos explicados |
| Rate limit do GitHub com muitos repositórios | `gh` logado (5.000/h); paginação e `retry_after`; snapshots |
| Modelo inventar fatos | evidência literal obrigatória + revisor em lote + revisão humana |
| Reconstrução de `ingestion_run` corromper dados | transação, teste de upgrade com banco real da F02, backup antes (`./data` copiado pelo lançador no primeiro boot da 0003) |
| Notificações virarem ruído | upsert por assunto, resolução automática pelo fluxo, agrupamento por tipo |

## 8 · Registro de execução
| Data | Marco | O que aconteceu |
|------|-------|-----------------|
| 2026-10-09 | — | **Observações do dono ao ler o plano** (a incorporar no refinamento): (1) **área de notificações** transversal onde revisões, conflitos e pendências ficam até o usuário resolver, com sinalização no cabeçalho (o primeiro uso gera uma lista longa); (2) **LinkedIn fica para depois** (F03-7 sai do escopo); (3) GitHub em dois modos: **análise pública** (página pública, projetos visíveis, recomendação de projetos novos e de atualizações) e **análise privada** (repositórios privados para confirmar e sugerir skills, relevância, e sugerir versões open source para engajar o perfil); (4) **análise incremental**: salvar o commit analisado por repositório; nova análise olha o diff desde ele; análise mais profunda que a anterior parte do relatório já salvo, não do zero; toda análise gera um **relatório salvo**; (5) **segundo CV** e **texto livre** ("Conte a sua história de carreira/vida") com hash salvo e detecção de "já lido"; (6) **escolher o modelo antes da ingestão**; (7) conflito vira **notificação** que leva à revisão; (8) teto de snapshots **configurável**; (9) F03-2 seletor por organização com expansão e pré-seleção dos 10 mais recentes; F03-3 limitador de custo diluído por repositório (a detalhar); F03-8 aprovada. |
| 2026-10-09 | — | **F03-1 decidida pelo dono**: `gh` no container; preferência por reusar o `gh` do computador (menos fricção), com login próprio do app pelo fluxo de dispositivo como alternativa automática e escolha em Configurações. |
| 2026-10-09 | — | **F03-2 decidida pelo dono**: modo público/privado no topo, grupos Pessoais e por organização, pré-seleção dos 10 mais recentes por grupo, aviso acima de 10 no total, forks/arquivados selecionáveis e destacados. A **revisão do perfil público do GitHub com orientação de atualizações** é skill do recrutador (registrada em F04); F03 faz a ingestão (fatos, projetos, relatórios) que essa skill consome. |
| 2026-10-09 | — | **F03-3 decidida pelo dono** (orçamento com diagnóstico do plano, divisão igual, métricas quantitativas, chamada por repositório e síntese, escolha de arquivos na profunda, freio com decisão, incremental e segunda rodada com cobertura, revisão anti-alucinação em duas camadas); texto completo em §5. Também decididos: F03-5 (modelo escolhido pelo usuário), F03-6 (bloquear + notificação), F03-7 (LinkedIn adiado), F03-8 (2 em paralelo), F03-9 (teto configurável). |
| 2026-10-09 | — | **Refinamento contra o código.** Gaps encontrados e como foram fechados: (1) `ingestion_run.file_id` é `NOT NULL` e `status` tem `CHECK` fixo → `0003` reconstrói a tabela com `file_id` nulo, `source`, `mode`, `budget_json`, `report_json` e estados `awaiting_confirmation/awaiting_decision/paused/cancelled`, com teste de upgrade; (2) `source_file.kind` só aceita cv/text e `file_digest` tem `file_id` como PK → GitHub não cria `source_file`, vínculo por `fact_source.repo_id`, digest em `repo_digest` (F03-11); (3) a revisão do F01 sempre insere fatos (sem `existing`/`conflict`) → `ingestion_proposal` ganha `match`, `conflict_json`, `resolution_json`, `evidence_json`, `check_status`, e `review` passa a ligar fonte em `existing` e exigir resolução em `conflict` (422); (4) dedupe por sha já existe para arquivo e texto, mas sem informar execuções anteriores → `previousRuns` na resposta e aviso na UI; (5) cadeia de etapas é por arquivo e linear → CV/texto continuam nela com `ingest.reconcile` e `ingest.review_check` no fim; GitHub usa `enqueueTask`/`processTask` da F02 por repositório, que já remove job falho e dá retomada; (6) provider não captura `rate_limit_event` nem expõe uso do plano → adaptador `getPlanUsage` e captura no laço da `query`; (7) `extractFacts` não pede evidência → `evidence {ref, quote}` (F03-12); (8) `gh` ausente da imagem, sem volume `gh-auth`, lançadores sem token do host → imagem, volume por projeto (vale nas duas instâncias) e escrita do token pela entrada padrão; (9) o plano antigo citava `config.json` para o token, que não existe → credencial só no volume, preferências em `settings`; (10) `WsEventSchema` sem eventos de ingestão e notificação → `ingestion.updated`, `notification.*`; (11) bandeja sem estados de espera → "Aguardando você"; (12) LinkedIn retirado (desenho em §9); (13) F03-4 reformulada com a análise incremental: API (`trees`, `contents`, `compare`) em vez de clone. |
(Preencher durante a implementação: datas por marco, decisões F03-14+, estimado × real.)

---

## 9 · Desenho adiado: LinkedIn (F03-7)
Preservado para a task futura (ver `tasks/README.md`, itens adiados). Coleta sem tokens do ZIP de export: descompactar; ler `Positions.csv`, `Education.csv`, `Skills.csv`, `Certifications.csv`, `Languages.csv`, `Profile.csv`; normalizar datas parciais (`Jan 2020`, `2020`), BOM e aspas; propostas diretas sem modelo nas profundidades rápida/equilibrada; na profunda, uma chamada para reescrever descrições em conquistas, marcadas como "reescrita". `source_file.kind` ganharia `linkedin`. Testes previstos: parse dos 6 CSVs, ZIP sem `Positions.csv` (parcial com aviso), e2e com contador de tokens = 0.
| 2026-10-09 | — | **F03-4 decidida pelo dono**: código via API pelo `gh` (`git/trees`, `contents` só dos arquivos escolhidos, `compare` para o diff incremental); clone raso só como fallback para árvore truncada. |
| 2026-10-09 | — | **F03-10 decidida pelo dono**: notificações como infraestrutura geral já na F03, com os geradores da ingestão e os dois da F02; pendências resolvidas somem sozinhas. |
| 2026-10-09 | — | **F03-11 decidida pelo dono**: digest de repositório em tabela irmã `repo_digest`, mesmo formato do `file_digest`; nada do F01 é reconstruído. |
| 2026-10-09 | — | **F03-12 decidida pelo dono**: evidência literal por proposta também no `extractFacts` do CV e do texto livre do F01; as duas camadas de revisão anti-alucinação valem para toda ingestão. |
| 2026-10-09 | — | **F03-13 decidida pelo dono**: GitHub sempre confirma; CV e texto livre autoconfirmam abaixo de 10 mil tokens (configurável). **Todas as decisões de §5 fechadas.** |
| 2026-10-09 | M1 | **Lote A `packages/shared`** (teste antes: sim; vermelho: 22 falhas em `f03-schemas.test.ts` + `mcp-ingest.test.ts`, módulos inexistentes). `schemas/ingest.ts` (`IngestionSource`, `IngestionMode`, `IngestionDepth`, `RunStatus` com `awaiting_confirmation`/`awaiting_decision`/`paused`/`cancelled`, `BudgetUnit`, `BudgetRequest`, `Budget` com fatia por repositório e reservas, `PlanUsage` com janelas 5 h/semanal/por modelo, `RunReport`, `Evidence` ≤ 600 chars, `CheckStatus`, `ProposalMatch`, `Conflict`, `Resolution`), `schemas/github.ts` (`Repo`, `GithubMetrics`, `Coverage`, `RepoReport`, `RepoAnalysis` com `kind` full/incremental/deepen/cover, `RepoDigest` irmão do digest de arquivo, `RepoPreviewItem`, `RepoGroup`), `schemas/notification.ts` (7 tipos, severidade, `dismissedAt` além de `readAt`/`resolvedAt`), `schemas/ingest-output.ts` (`PickFiles` ≤ 8, `AnalyzeRepo`, `SynthesizeRun`, `CheckProposals`, toda proposta com evidência) + `INGEST_OUTPUT_JSON_SCHEMAS` (snapshot, sem `$schema`); contratos de §2.10 (auth do GitHub sem token, preview, plano, criação GitHub, estimativa, decisão, lista de execuções, repositórios, digest, notificações, snapshots), `FileResponse.previousRuns`, `ProposalWithId` com campos de reconciliação opcionais, `ReviewDecision.resolution`, `IngestionResponse.fileId` nulo + `source`, WS `ingestion.updated` e `notification.created/updated`; `mcp/ingest.ts` com `file.list`, `file.get_digest` (arquivo ou repositório), `file.get_text` (≤ 8k chars), `ingest.status`, `ingest.propose` (proposta + evidência obrigatória). Shared 92 testes; monorepo typecheck 10/10. **Decisões:** F03-14 `notification` ganha `dismissed_at` (o plano exige que dispensar só esconda, sem resolver; sem a coluna não dá para distinguir); F03-15 tools `ingest.*` reduzidas a `ingest.status` e `ingest.propose` (as de conduzir a ingestão pelo agente, `prepare/next_chunk/set_digest/finish`, só fazem sentido no modo B e entram na F04 se forem usadas); F03-16 `IngestionStatusSchema` passa a ser o próprio `RunStatusSchema`. A mudança de `extractFacts` para pedir evidência (F03-12) fica no M3, junto com o prompt. |
| 2026-10-09 | M1 | **Lote B `packages/core`: migration, repositórios e settings** (teste antes: sim; vermelho: `f03-migration.test.ts` 4 falhas e `f03-repos.test.ts` sem módulo). `0003_ingest.sql` reconstrói `ingestion_run` (cria nova → copia com `source` derivado do tipo do arquivo → apaga → renomeia; `file_id` nulo só com `source = github` por `CHECK`; 10 estados; `mode`, `params_json`, `budget_json`, `model`, `report_json`, `parent_run_id`; índices por estado e arquivo), completa `ingestion_proposal` (`match`, `match_target_id`, `conflict_json`, `resolution_json`, `evidence_json`, `check_status`, `suggested_profiles_json`), cria `repo`, `repo_analysis`, `repo_digest`, `github_metric`, `snapshot`, `notification` (índice único parcial da pendência aberta por tipo e assunto) e liga `project.repo_id`, `fact_source.repo_id/analysis_id`. **Teste de upgrade** sobre banco F01/F02 populado por SQL (usuário, arquivo, execução concluída com uso, leitura, segmento, proposta aceita, fonte, experiência): migra só a 0003, preserva tudo, `foreign_key_check` vazio, FKs religadas e valendo, repos da F03 funcionam sobre ele; banco com referência órfã é recusado com rollback. Repos: `ingestionRuns` (`createGithub`, `list` por estado/fonte, `usedTokens`, `setBudget`, `setReport`, `cancelled` terminal, uso como mapa livre), `proposals` (evidência no `insertMany`, `setMatch`, `setResolution`, `setCheckStatus`, `setSuggestedProfiles`), `factSources` (`repoId`, `analysisId`), `facts.projects` (`repoId`), `repos` (upsert por `fullName`), `repoAnalyses` (`create`, `complete` atualiza `last_analysis_id`, `latestDone`, `listByRepo`, `listByRun`), `repoDigests` (preserva edição do usuário), `githubMetrics` (uma linha por escopo), `snapshots` (total, LRU, `touch`), `notifications` (`upsert` sem duplicar, `resolveSubject`, `markRead`, `dismiss`, `list`, `countUnresolved`); `ingest/settings.ts` (`DEFAULT_INGEST_SETTINGS`, `resolveIngestSettings`, `ingestModelsForDepth`). Ajustes mínimos de tipo em api/worker por `fileId` nulo. Verificação: lint 393 arquivos, typecheck 10/10, testes shared 92 · providers 29 · core 178 (+1 opcional) · worker 15 · api 50 · web 95; cobertura do core 97,9% linhas / 89,9% ramos. **Decisões:** F03-17 migrations que reconstroem tabela declaram `-- narnia: foreign-keys-off`; o executor desliga as FKs fora da transação, roda `foreign_key_check` antes do commit e as religa no estado anterior (o banco real do dono passará por ela); `migrate(db, { until })` para testes de upgrade. F03-18 `insertMany` acrescenta propostas a partir do maior `idx` do run (permite `ingest.propose` e a síntese adicionarem propostas sem colidir; no F01 continua começando em 0). F03-19 modelos da ingestão sobrescrevíveis em `settings.models.ingest` (mesmo objeto de `models.extraction`/`models.analyze`); escolha do usuário substitui repositório e síntese, escolha de arquivos e revisor ficam no mais barato. F03-20 `github_metric` usa `scope_key` único (`repo:<id>`, `year:<ano>`, `global`). Lote C (notificações + settings) ficou dentro do B por ser pequeno. |
