# F03 · Ingestão de dados

Entregável 3 do plan-v0. Cobre o fluxo **F3** de `../02-fluxos-do-usuario.md` além do que F01 já entregou (CV e texto livre em profundidade rápida): GitHub (usuário, organização ou repositórios), export do LinkedIn, CVs e textos adicionais com re-ingestão, três níveis de profundidade com estimativa real, pré-processamento determinístico, snapshots, digest por arquivo, revisão com conflitos e tags por perfil, tudo como jobs em segundo plano e com várias ingestões simultâneas. Depende de F01 (jobs, `ingestion_run`, revisão) e F02 (tags por perfil). A sessão de clarificação é F04; aqui só existe o botão que a abre.

Status: **em escopo** (2026-10-07). Nada implementado. Decisões em fechamento com o dono desde 2026-10-09 (§5, §8).

---

## 1 · Objetivo e resultado esperado

Uma pessoa com o onboarding feito consegue:

1. apontar um usuário ou organização do GitHub (token opcional), escolher repositórios (excluir forks/arquivados), escolher a profundidade e ver a **estimativa real** de tokens e chamadas antes de rodar;
2. enviar o ZIP de export do LinkedIn e ver cargos, formação, skills e certificações virarem propostas quase sem tokens;
3. enviar um segundo CV ou outro texto livre e ver a **re-ingestão** detectar o que já existe, o que é novo e o que conflita;
4. acompanhar duas ingestões ao mesmo tempo na bandeja de atividades enquanto usa o resto do sistema;
5. revisar as propostas em uma tela de diff (novo / conflito / já existente), resolver conflitos campo a campo, aceitar em lote, e marcar para quais perfis cada fato é relevante;
6. abrir o digest de cada arquivo ou repositório em vez do original;
7. clicar em "Clarificar com o recrutador" ao final (abre F04; em F03 o botão fica ativo só se F04 estiver entregue).

### Dentro do escopo
- Fontes: GitHub (REST API via Octokit; clone raso só na profundidade profunda), LinkedIn export (CSVs do ZIP), CV adicional, texto livre adicional.
- Profundidades rápida / equilibrada / profunda conforme `../03-arquitetura.md §6`, com `ingest.prepare` devolvendo estimativa por chunk.
- Pré-processamento sem tokens em `packages/core/src/ingest/*`: metadados, READMEs, linguagens, estatísticas de commits, árvore de arquivos, amostragem de código (profunda), CSVs do LinkedIn → propostas diretas.
- Snapshots em `/data/snapshots/<source>/<hash>/` para re-rodar sem rede.
- Loop de extração por chunk com o provider (`extractChunk`), propostas com confiança e fonte, digest por arquivo/repositório.
- Revisão com detecção de duplicidade e conflito (normalização de nomes, sobreposição de datas), resolução campo a campo, tags de perfil sugeridas por heurística.
- Múltiplos jobs de ingestão simultâneos (worker `ingest` com concorrência 2), cancelamento e retomada por chunk.
- Tools `ingest.*` e `file.*` (definição em `shared`, handlers em `core`; exposição via MCP em F04).

### Fora do escopo (e para onde vai)
- Sessão de clarificação → F04.
- OCR de PDFs escaneados → fora do plan-v0 (aviso "este PDF parece ser imagem").
- Ingestão de sites pessoais/portfólio por URL → fora do plan-v0.
- Edição livre de fatos fora da revisão → F10.
- Ingestão de vagas (descrição de vaga) → F06.
- Provedores além do Claude Code → F11.

---

## 2 · Arquitetura deste entregável

### 2.1 Pipeline por fonte
```
UI ─► POST /api/ingestions {source, params, depth, profile_tags?}
      └─► job(type=ingest) ─► worker
            1. prepare   (core, 0 tokens): coleta → snapshot → chunks + estimativa → run.status=estimating → WS
            2. confirm   (UI confirma a estimativa; ou auto se abaixo do limiar configurado)
            3. extract   (provider, por chunk): proposals + digest parcial → run.progress → WS
            4. digest    (provider, 1 chamada): consolida digest do arquivo/repositório
            5. reconcile (core, 0 tokens): dedupe, conflitos, tags por perfil → run.status=review → WS
UI revisão ─► POST /api/ingestions/:id/review ─► fatos + fact_source + profile_emphasis(tags) ─► run.status=done
```
Cada etapa persiste `job.stage` e o índice do chunk; retomar continua do chunk seguinte; cancelar para antes do próximo chunk.

### 2.2 Coletores (`packages/core/src/ingest/sources/`)
| Fonte | Coleta (0 tokens) | O que vai para o modelo por profundidade |
|-------|-------------------|------------------------------------------|
| `github` | Octokit: repos do usuário/org (paginação), `languages`, `topics`, estrelas, datas, README (raw), `stats/contributors`, árvore (`git/trees?recursive=1`, limitada); profunda: `git clone --depth 1` em `/data/snapshots/github/<repo>/` e amostragem (arquivos de entrada, configs, testes, até N KB por repo) | rápida: tabela de repos + 60 linhas de README (≤ 20 repos) · equilibrada: + README completo dos 10 mais relevantes, commits/mês, árvore resumida · profunda: + amostra de código, resumo por repo e síntese cruzada |
| `linkedin` | descompacta ZIP; parse de `Positions.csv`, `Education.csv`, `Skills.csv`, `Certifications.csv`, `Languages.csv`, `Profile.csv`; normaliza datas | rápida/equilibrada: nada (propostas diretas) · profunda: 1 chamada para reescrever descrições em conquistas |
| `cv` / `text` | igual a F01 (`extract.text`) | igual a F01, com `depth` controlando o tamanho máximo do texto e o nº de passadas |
Relevância de repositório (para "10 mais relevantes"): estrelas, commits do usuário, recência, não-fork, README presente.

### 2.3 Chunks e estimativa
`ingest.prepare` gera `chunks[]` com `{id, kind, source_ref, chars, tokens_est}`; `estimate = Σ tokens_est + overhead(prompt) × nº de chamadas`. Limiares: rápida ≤ 15k, equilibrada ≤ 50k, profunda ≤ 150k tokens; acima disso a UI exige confirmação explícita e sugere reduzir repositórios. Modelo por profundidade: rápida/equilibrada Haiku, profunda Sonnet (configurável).

### 2.4 Reconciliação (`packages/core/src/ingest/reconcile.ts`)
- Normalização: empresa (`lowercase`, sem sufixos Ltda/Inc), título, skill (`name_normalized` com dicionário de sinônimos: ReactJS→React).
- Duplicata: mesma empresa normalizada + sobreposição de datas ≥ 50% → `existing` (adiciona `fact_source`).
- Conflito: mesma entidade com campo divergente (datas, título) → `conflict` com os dois valores e origem de cada.
- Novo: sem correspondência → `new`.
- Tags por perfil: heurística por skills/área do perfil (`profile.area`, `target_title`) contra tecnologias e títulos do fato; sugestão, nunca automática.

### 2.5 Provider (estender)
`extractChunk({chunk, context, schema}) → {proposals, usage}` e `buildDigest({chunksSummary}) → {digest, usage}` em `ClaudeCodeProvider`, ambos com `tools: []`, `maxTurns: 1`, `outputFormat` json_schema. `MockProvider` ganha fixtures por fonte.

### 2.6 API
| Método e rota | Função |
|---------------|--------|
| `POST /api/sources/github/preview` | lista repos com metadados para seleção (sem job) |
| `POST /api/sources/linkedin` (multipart ZIP) | valida e cria `source_file(kind=linkedin)` |
| `POST /api/ingestions` · `GET /api/ingestions` · `GET /api/ingestions/:id` | criar e acompanhar |
| `POST /api/ingestions/:id/confirm` · `/cancel` · `/retry` | controle |
| `GET /api/ingestions/:id/proposals` · `POST /api/ingestions/:id/review` | revisão |
| `GET /api/files/:id/digest` · `PUT /api/files/:id/digest` | ler/editar digest |
| `GET /api/snapshots` · `DELETE /api/snapshots/:id` | gestão de espaço |
| `PUT /api/settings/github-token` | grava em `config.json` (0600); nunca sai em GET |

### 2.7 Tools MCP (definição; exposição em F04)
| Tool | Notas |
|------|-------|
| `ingest.prepare(source, depth)` · `ingest.next_chunk(run)` · `ingest.propose(run, facts[])` · `ingest.set_digest(run, file, digest)` · `ingest.finish(run)` | permitem que o agente conduza uma ingestão no modo B |
| `file.list` · `file.get_digest(id)` · `file.get_text(id, from, to)` | nunca devolvem o arquivo inteiro |

---

## 3 · Dados deste entregável

| Tabela | Colunas (novas ou completadas) |
|--------|--------------------------------|
| `ingestion_run` (completar) | `source` (cv/text/github/linkedin), `depth` (quick/balanced/deep), `params_json` (repos, filtros), `chunks_total`, `chunks_done`, `estimate_json`, `model`, `confirmed_at?` |
| `ingestion_chunk` (nova) | `id`, `run_id`, `idx`, `kind`, `source_ref`, `chars`, `tokens_est`, `status`, `usage_json?` |
| `ingestion_proposal` (completar) | `match` (new/existing/conflict), `match_target_id?`, `conflict_json?` (campo, valor novo, valor atual, origem), `suggested_profiles_json` |
| `snapshot` (nova) | `id`, `source`, `ref` (repo/arquivo), `path`, `sha256`, `size`, `taken_at` (UTC) |
| `repo` (nova) | `id`, `provider` (github), `full_name`, `url`, `description?`, `languages_json`, `topics_json`, `stars`, `is_fork`, `is_archived`, `pushed_at`, `user_commits?`, `relevance`, `snapshot_id?`, `digest_id?` |
| `project` (completar) | `repo_id?` |
| `source_file` (completar) | `kind` ganha `linkedin` |
| `file_digest` (reuso) | também para repositórios (`file_id` → `source_file` ou `repo` via `subject_kind`, `subject_id`) |
| `fact_source` (completar) | `repo_id?`, `chunk_id?` |

Regras:
- Token do GitHub só em `config.json` (0600), nunca em tabela nem em log.
- Snapshots têm teto configurável (padrão 2 GB) com limpeza LRU manual pela UI.
- Toda proposta aceita em re-ingestão de entidade existente gera **novo** `fact_source`, não substitui o anterior.

---

## 4 · Layouts deste entregável

| Tela | Componentes | Estados a cobrir |
|------|-------------|------------------|
| Ingestão › Fonte | `SourceTabs` (CV, Texto livre, GitHub, LinkedIn) | cada aba |
| GitHub | `GithubForm` (usuário/org, token), `RepoPicker` (tabela: nome, linguagem, estrelas, último push, fork/arquivado, relevância; filtros; selecionar todos), `DepthSlider` com descrição e limiares, `EstimateCard` | carregando repos · rate limit · sem repos · seleção parcial · estimativa acima do limiar |
| LinkedIn | `ZipDropzone` + lista de CSVs reconhecidos | ZIP inválido · CSVs faltando (parcial) · ok |
| Progresso | `IngestionProgress` (etapa, chunk x/y, tokens até agora) + mesmo job na `ActivityTray` | estimando · aguardando confirmação · extraindo · reconciliando · revisão · erro · interrompido · cancelado |
| Revisão | `ReviewTable` agrupada por tipo com filtros (novo/conflito/existente/pendente), `ProposalRow`, `ConflictResolver` (campo a campo: manter atual / usar novo / editar), `ProfileTagPicker` por linha e em lote, ações em lote, `DigestCard` por arquivo/repo, botão "Clarificar com o recrutador" | sem conflitos · com conflitos não resolvidos (bloqueia salvar) · tudo decidido |
| Evidências › Repositórios | `RepoList` com digest, relevância, snapshot (tamanho, data), re-ingerir | vazio · com snapshots · sem snapshot |
| Configurações › Integrações | `GithubTokenField` (mascarado, testar) · `SnapshotsUsage` (espaço, limpar) | sem token · token inválido · ok |

Regras de UI: a revisão é retomável; o usuário pode sair e voltar pela bandeja; datas em UTC convertidas pelo fuso do usuário; textos via `t()`.

---

## 5 · Decisões em aberto deste entregável

| # | Decisão | Opções | Padrão proposto |
|---|---------|--------|-----------------|
| F03-1 | Cliente GitHub | `octokit` · `fetch` manual · `gh` | **Decidida 2026-10-09 (dono): `gh` dentro do container**, com duas origens de credencial escolhidas em Configurações › Integrações (`settings.github.auth = host | app`, padrão `host`): (a) **reusar o `gh` do computador**: o lançador (`start.sh`/`start.ps1` em `up`/`dev`) roda `gh auth token` no host quando o `gh` existe e está logado e entrega o token ao container (arquivo 0600 no volume `gh-auth`, nunca em `.env`, banco ou log), renovado a cada subida; (b) **login próprio do app** pelo fluxo de dispositivo, sem terminal visível: botão "Conectar GitHub" → a API roda `gh auth login --web` em segundo plano (verificado: funciona sem TTY), mostra o código com copiar e o botão "Abrir GitHub" (`github.com/login/device`, nova aba), detecta a autorização e avisa por WS ("Conectado como @usuario", escopos), contagem dos 15 min e "gerar outro código"; credencial no volume `gh-auth`. Se `host` estiver escolhido e o `gh` do computador não existir ou não estiver logado, a UI cai no fluxo (b). "Desconectar" apaga a credencial do app. Análise pública funciona sem login (limite anônimo); privada exige escopo `repo` (explicado antes de autorizar; o app só lê). Coletor usa `gh api` (paginação, rate limit) e `gh repo clone` quando precisar de código. |
| F03-2 | Seletor de repositórios (o limite anônimo perdeu peso com o `gh`, F03-1) | — | **Decidida 2026-10-09 (dono):** primeiro campo é o modo, **análise pública** ou **privada**; na pública o formulário mostra só a lista de repositórios públicos (sem login obrigatório), na privada o formulário completo (inclui privados com cadeado, exige `gh` logado). Lista agrupada: **Pessoais** (expandido) e uma linha por **organização** (recolhida, expande para mostrar os repositórios com link). Pré-seleção por grupo: até 10 com push mais recente; com menos de 10, todos; contador "N de M" e "marcar todos" por grupo. **Aviso quando o total selecionado passa de 10** (pode demorar bastante e custar mais), sem bloquear. **Forks e arquivados** aparecem desmarcados, selecionáveis, visualmente destacados (selo e estilo próprio). Estimativa de tokens no rodapé atualiza a cada marcação. |
| F03-3 | Amostragem de código na profunda | heurística fixa (entrypoints, configs, testes, ≤ 8 arquivos, ≤ 12 KB cada) · deixar o modelo pedir arquivos por tool | **heurística fixa** (custo previsível) |
| F03-4 | Clone raso | `git clone --depth 1` no container · baixar tarball da API | **tarball da API** (sem `git`, sem credencial SSH; `git` fica para repos privados com token) |
| F03-5 | Modelo na profunda | Sonnet · Haiku | **Sonnet** só na síntese cruzada; chunks por repo em Haiku |
| F03-6 | Conflito de datas | bloquear salvar até resolver · aceitar com marcação | **bloquear** (dado verificado é a base da honestidade) |
| F03-7 | LinkedIn em profundidade profunda | reescrever descrições em conquistas com o modelo · nunca | **reescrever**, 1 chamada, propostas marcadas como "reescrita" |
| F03-8 | Concorrência de ingestão | 2 jobs · configurável | **2**, configurável em Configurações |
| F03-9 | Teto de snapshots | 2 GB LRU manual · automático | **manual** com aviso |

---

## 6 · O que precisa estar coberto para o F03 funcionar

### 6.1 Pré-requisitos e dependências
1. F01 (jobs, `ingestion_run`, revisão, provider, `extract.text`) e F02 (perfis para tags).
2. Migration `0003_ingest.sql` (§3).
3. `packages/shared`: schemas de `IngestionParams` por fonte, `Chunk`, `Estimate`, `Proposal` (com `match`/`conflict`), `Digest` para repositório, tools `ingest.*`/`file.*`.
4. `packages/core`: `ingest/sources/{github,linkedin,cv,text}.ts`, `ingest/chunker.ts`, `ingest/estimate.ts`, `ingest/reconcile.ts`, `ingest/snapshots.ts`, `ingest/tools.ts`.
5. `apps/api`: rotas §2.6, worker `ingest` com concorrência (F03-8), provider `extractChunk`/`buildDigest`, mock por fonte.
6. `apps/web`: telas §4.
7. Fixtures: mock da API do GitHub (respostas gravadas de um usuário com 12 repos, 2 forks, 1 arquivado), ZIP de LinkedIn sintético, 2 CVs com conflito de datas.

### 6.2 Testes unitários (Vitest) · obrigatórios
**`packages/core`**
- `sources/github`: pagina repos; filtra forks/arquivados; calcula relevância determinística; trata 403 de rate limit com `retry_after`; README ausente; tarball extraído em snapshot com hash; amostragem escolhe entrypoints/configs/testes e respeita limites (F03-3).
- `sources/linkedin`: parse dos 6 CSVs; datas parciais (`Jan 2020`, `2020`); ZIP sem `Positions.csv` → parcial com aviso; CSV com BOM/aspas.
- `chunker`/`estimate`: chunks respeitam tamanho; estimativa soma overhead × chamadas; limiares por profundidade.
- `reconcile`: duplicata por empresa normalizada + datas; conflito campo a campo; skill com sinônimo vira `existing`; tags sugeridas por perfil; não marca conflito para fato rejeitado antes.
- `snapshots`: teto e LRU; re-rodar usa snapshot sem rede (coletor com `fetch` desativado).
- Tools `ingest.*`/`file.*`: `file.get_text` recusa intervalo > 8k chars; `ingest.propose` valida schema por `kind`.

**`packages/shared`**
- Schemas por fonte e JSON Schema de `extractChunk` (snapshot).

**`apps/api`**
- Worker: 2 jobs rodam em paralelo, o terceiro espera; cancelar entre chunks; retomar do chunk seguinte; estimativa acima do limiar exige `confirm`.
- Rotas: preview do GitHub com mock HTTP; token nunca aparece em GET; review com conflito não resolvido → 422.
- Provider: `extractChunk` e `buildDigest` usam `tools: []`, `maxTurns: 1`, `outputFormat`; `usage` vai para `usage_event` com `category=ingest` e `job_id`.

**`apps/web`**
- `RepoPicker`: filtros, seleção, relevância ordenada, aviso de rate limit.
- `DepthSlider` + `EstimateCard`: muda estimativa; acima do limiar mostra confirmação.
- `ConflictResolver`: três opções por campo; salvar bloqueado com conflito pendente.
- `ProfileTagPicker`: sugestões pré-marcadas; em lote.

### 6.3 Testes e2e (Playwright, Chromium) · obrigatórios
Compose com `NARNIA_PROVIDER=mock` e `GITHUB_API_BASE` apontando para um mock HTTP no mesmo compose.
- **E2E-01 GitHub rápida**: informar usuário → 12 repos → excluir forks → rápida → estimativa → rodar → revisão com ≥ 5 projetos e skills → aceitar → Evidências mostra repos com digest.
- **E2E-02 GitHub equilibrada com confirmação**: selecionar todos → equilibrada acima do limiar → confirmação explícita → conclui.
- **E2E-03 LinkedIn**: enviar ZIP → propostas sem chamada ao modelo (contador de tokens = 0) → aceitar.
- **E2E-04 re-ingestão com conflito**: enviar 2º CV com datas diferentes → revisão mostra conflito → salvar bloqueado → resolver "manter atual" → salvar → fato mantém data e ganha 2ª fonte.
- **E2E-05 duas ingestões simultâneas**: iniciar GitHub e LinkedIn → bandeja mostra ambas → concluir → ambas em revisão.
- **E2E-06 cancelar e retomar**: iniciar profunda (mock lento) → cancelar no chunk 2 → retomar → conclui com chunks restantes.
- **E2E-07 tags por perfil**: com 2 perfis, aceitar projeto marcando só "PM" → ênfase criada só nesse perfil.
- **E2E-08 digest**: abrir Evidências › repositório → digest visível sem abrir arquivo; editar resumo → persiste.
- **E2E-09 rate limit**: mock devolve 403 → mensagem orienta token → salvar token → preview funciona.
- **E2E-10 snapshot sem rede**: re-ingerir repo com mock HTTP desligado → usa snapshot → conclui.
- **E2E-11 botão clarificar**: aparece desabilitado com tooltip "disponível após F04" (ou ativo, se F04 já entregue).

### 6.4 Teste manual com provider real (antes de fechar F03)
GitHub real do autor nas três profundidades: registrar tokens estimados × reais, tempo, qualidade das propostas (taxa de edição), qualidade dos digests, custo da síntese cruzada em Sonnet. LinkedIn real em profunda (F03-7): avaliar as reescritas.

### 6.5 Definição de pronto
- Testes 6.2 e 6.3 verdes; cobertura ≥ 80% em `core/ingest`.
- Estimativa real dentro de ±25% do uso medido em 6.4 nas três profundidades (senão recalibrar `overhead`).
- Nenhum token gasto na ingestão de LinkedIn em rápida/equilibrada (asserção em e2e).
- Token do GitHub ausente de qualquer resposta de API e de logs (teste automatizado que varre `/data/logs`).
- `../02 §F3`, `../03 §6`, `../04 §A5/§A9` atualizados.

---

## 7 · Riscos específicos
| Risco | Mitigação |
|-------|-----------|
| API do GitHub muda ou rate limit mais agressivo | Octokit com retry/throttling; snapshots evitam re-coleta |
| Profunda estourar janela do plano | limiares + confirmação + Haiku por repo (F03-5); estimativa calibrada em 6.4 |
| Reconciliação errar duplicatas (empresa com nome diferente) | conflito/duplicata sempre revisáveis; nunca mescla automaticamente |
| Export do LinkedIn mudar colunas | parser tolerante por nome de coluna com aliases; fixture por versão |
| Snapshots ocuparem disco | teto + tela de limpeza (F03-9) |

## 8 · Registro de execução
| Data | Marco | O que aconteceu |
|------|-------|-----------------|
| 2026-10-09 | — | **Observações do dono ao ler o plano** (a incorporar no refinamento): (1) **área de notificações** transversal onde revisões, conflitos e pendências ficam até o usuário resolver, com sinalização no cabeçalho (o primeiro uso gera uma lista longa); (2) **LinkedIn fica para depois** (F03-7 sai do escopo); (3) GitHub em dois modos: **análise pública** (página pública, projetos visíveis, recomendação de projetos novos e de atualizações) e **análise privada** (repositórios privados para confirmar e sugerir skills, relevância, e sugerir versões open source para engajar o perfil); (4) **análise incremental**: salvar o commit analisado por repositório; nova análise olha o diff desde ele; análise mais profunda que a anterior parte do relatório já salvo, não do zero; toda análise gera um **relatório salvo**; (5) **segundo CV** e **texto livre** ("Conte a sua história de carreira/vida") com hash salvo e detecção de "já lido"; (6) **escolher o modelo antes da ingestão**; (7) conflito vira **notificação** que leva à revisão; (8) teto de snapshots **configurável**; (9) F03-2 seletor por organização com expansão e pré-seleção dos 10 mais recentes; F03-3 limitador de custo diluído por repositório (a detalhar); F03-8 aprovada. |
| 2026-10-09 | — | **F03-1 decidida pelo dono**: `gh` no container; preferência por reusar o `gh` do computador (menos fricção), com login próprio do app pelo fluxo de dispositivo como alternativa automática e escolha em Configurações. |
| 2026-10-09 | — | **F03-2 decidida pelo dono**: modo público/privado no topo, grupos Pessoais e por organização, pré-seleção dos 10 mais recentes por grupo, aviso acima de 10 no total, forks/arquivados selecionáveis e destacados. A **revisão do perfil público do GitHub com orientação de atualizações** é skill do recrutador (registrada em F04); F03 faz a ingestão (fatos, projetos, relatórios) que essa skill consome. |
(Preencher durante a implementação: datas, medições de 6.4, decisões tomadas.)
