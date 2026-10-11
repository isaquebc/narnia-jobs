# F03 · Comunicação do andamento das ingestões (2026-10-11)

Plano para que o usuário entenda, a qualquer momento, **em que ponto a ingestão está, o que falta, se está viva e o que fazer quando algo dá errado**. Motivado pelo uso real do dono em 2026-10-11: repositórios aparecendo como "Concluído" enquanto a execução seguia em "Analisando", uma execução presa sem sinal na tela, "Tentar de novo" que não dizia o que refazia, "Reanalisar" que criava outra execução sem avisar e erros com texto técnico em inglês.

Status: **plano refinado contra o código** (2026-10-11), aguardando o dono (decisões em §5). TDD em todos os itens; só na instância `claude` (`scripts/claude-env.sh`); nenhuma migration nova.

---

## 1 · O que o usuário viu e por que confunde

| # | Situação real | Por que parece bug |
|---|---------------|--------------------|
| P1 | Lista de repositórios com "Concluído" e o topo da execução em "Analisando" | "Concluído" do repositório e "Analisando" da execução usam o mesmo vocabulário para coisas diferentes; nada diz que faltam síntese, reconciliação e conferência |
| P2 | Execução em "Analisando" por 10+ minutos sem mudança | não há indicação da etapa atual, de progresso nem de última atividade; impossível distinguir "trabalhando" de "parado" |
| P3 | Execução presa de verdade (tarefa morta num reinício do worker; o espelho do job continuou "rodando") | a tela diz "Analisando" para sempre e não oferece saída |
| P4 | "Tentar de novo" voltou a "Analisando", mas os repositórios com erro continuaram com erro | o botão não diz o que vai refazer (só a síntese) nem o que não vai |
| P5 | "Reanalisar" num repositório criou uma ingestão nova | nada avisou que seria outra execução, nem ligou a nova à anterior |
| P6 | Erro "Claude Code returned an error result: Reached maximum number of turns (1)" | mensagem técnica, em inglês, sem o que fazer |
| P7 | Sino com 6 pendências que não somem ao visitar | contagem não acompanha o que o usuário já viu (decisão pendente desde 2026-10-10) |
| P8 | Uma edição de código no meio da execução reiniciou o worker do dono e matou a tarefa | infraestrutura de dev, não da UI, mas o efeito aparece como P3 |

## 2 · Encaixe no código (o que existe hoje)

1. **Etapas de CV/texto** estão em `STAGES` (`packages/core/src/ingest/chain.ts`): 8 etapas com `order` e `label`, e `planStages` decide quais entram (OCR e leitura pelo modelo são opcionais). Os jobs dessas etapas têm `parentId = runId` no espelho, e `GET /api/ingestions/:id` já devolve `run.jobs` com eles.
2. **Etapas do GitHub** são tarefas (`INGEST_TASKS` em `packages/core/src/ingest/github-run.ts`: `ingest.github.prepare`, `ingest.github.repo` × N, `ingest.github.synthesis`, `ingest.reconcile`, `ingest.review_check`). O espelho delas tem `parentId = null` e guarda a `TaskJobData` inteira em `payload` (o `runId` fica em `payload.payload.runId`; ler com `taskOfJob`). Por isso `run.jobs` da página vem **vazio** para o GitHub, e a página só mostra a lista de repositórios do relatório.
3. **Rótulos que geram P1** (`apps/web/src/i18n/pt-BR.ts`): `report.repoStatus.done = "Concluído"` (linhas do repositório em `RunPage.tsx:43` e `RunReportView.tsx:40`), `activity.status.done = "Concluído"` (jobs em `RunPage.tsx:52` e na bandeja), `run.status.running = "Analisando"` (topo em `RunPage.tsx:103`, `PendingRuns.tsx:68`, bandeja `ActivityTray.tsx:144`), `run.status.review = "Em revisão"`, `run.status.done = "Concluída"`.
4. **Espelho `job`**: a tabela tem `updated_at` (atualizada a cada evento aplicado), mas `JobSchema` não expõe o campo. Os eventos vêm de `worker.on("active" | "progress" | "completed" | "failed" | "stalled")` em `apps/worker/src/worker.ts`. As tarefas só chamam `ctx.progress` em marcos (início, fim de coleta); **durante uma chamada longa ao modelo não há nenhum evento**.
5. **Por que `01a12a97` ficou presa**: o `tsx watch` reiniciou o worker (mata em 5 s); a trava do job expirou; o worker novo detectou o job parado e, depois de `maxStalledCount`, a BullMQ o moveu para `failed` com "job stalled more than allowable limit". Esse `failed` é emitido pelo verificador de travados da fila, **não** pelo `worker.on("failed")` de quem processava, então o espelho nunca recebeu o evento e ficou `active/retrying`. `healStuckRun` (`apps/api/src/routes/ingestions.ts`) confia no espelho e não faz nada.
6. **Estado real na fila**: o `BullQueueAdapter` (`apps/api/src/queue.ts`) já usa `Job.fromId(queue, id)` e `job.getState()` em `cancel` e `retry`; falta expor um `state(jobId)` no `QueueAdapter`.
7. **Batimento existente** é do **worker** inteiro (`heartbeatKey`, a cada 10 s, usado pelo `doctor`), não por job.
8. **Processos `claude` órfãos** (`[claude] <defunct>` no worker do dono): o PID 1 dos containers é o `pnpm`, que não recolhe processos filhos mortos; quando o `tsx` mata o worker à força, os processos do CLI viram zumbis.
9. **Erros**: nascem em quatro lugares com textos próprios: `githubErrorMessage` (`apps/worker/src/ingest/github.ts`), `ProviderError` (`packages/providers`, mensagem "Falha ao consultar o modelo: …"), `GhError` (`packages/core/src/ingest/sources/github/gh.ts`) e `onStageFailed` (`apps/worker/src/pipeline.ts`). A web mostra `run.error` cru.
10. **Retry**: `POST /api/ingestions/:id/retry` usa `params.failedTask` (refaz só a tarefa) ou volta à preparação; o botão da página (`RunPage.tsx:171`) é sempre `app.retry` ("Tentar de novo"). Não existe retry de um repositório só.
11. **Síntese fechada**: `finishReport` grava `report.finishedAt`, e `githubSynthesis` sai cedo se `finishedAt` existe ("já sintetizada"). `pendingRepos` só olha `status === "pending"`.
12. **Reanálise**: `POST /api/repos/:id/reanalyze` (`apps/api/src/routes/repos.ts:86`) já grava `parentRunId` com a execução da última análise; a resposta de `GET /api/ingestions/:id` e `runSummary` não usam o campo, e a UI não mostra a ligação.
13. **Sino**: `countUnresolved` conta `resolved_at is null and dismissed_at is null` fora dos informativos; `read_at` existe e é ignorado pela contagem; cada sugestão de perfil é uma notificação `profile.suggestion`.
14. **Desligamento do worker**: `main.ts` trata SIGTERM chamando `started.close()`, que chama `worker.close()` da BullMQ; ela espera o job ativo terminar, mas o `tsx watch` força a morte em 5 s. API e worker do dev rodam `tsx watch` direto (`docker-compose.dev.yml`).

## 3 · Propostas (o que muda, onde, e o teste antes)

### C1 · Linha do tempo da execução (P1, P2)
- **Core** `packages/core/src/ingest/timeline.ts` (novo, puro): `buildTimeline(run, jobs, now) → { steps: TimelineStep[], current: number | null, total: number, headline: { key, params } }`.
  - `TimelineStep = { key, label, state: "pending" | "running" | "done" | "skipped" | "error" | "stuck", progress?: { done, total }, startedAt?, finishedAt?, durationMs?, lastActivityAt?, error?: FriendlyError, action?: StepAction }`.
  - GitHub: `prepare` (job `ingest.github.prepare`) → `repos` (agregado dos jobs `ingest.github.repo` + `report.repos`: "x de y" = analisados+pulados+falhos / total; estado `running` se algum ativo) → `synthesis` → `reconcile` → `review_check` (`skipped` quando `reviewCheckModelEnabled = false` e a camada 1 rodou sozinha) → `review`.
  - CV/texto: `planStages(run)` define as etapas (as não planejadas não aparecem); cada uma casa com o job de mesmo `stage` (`parentId = runId`) → `review`.
  - Jobs do GitHub são lidos com `taskOfJob` (§2-2); duração = `finishedAt - startedAt`; etapa atual = primeira não terminada.
  - `headline`: `running` → `run.headline.running` ("Analisando · etapa {current} de {total}: {step}"), `review` → "Pronta para revisão", etc. (C2).
- **Shared**: `TimelineStepSchema`, `FriendlyErrorSchema` (C5), e `IngestionResponseSchema` ganha `timeline` e `parentRunId`; `RunSummarySchema` ganha `headline` (para lista, bandeja e pendências usarem a mesma frase).
- **API**: `GET /api/ingestions/:id` monta `timeline` com `repos.jobs` filtrados por `parentId` **ou** `taskOfJob(j)?.runId` (corrige `run.jobs` vazio no GitHub); `GET /api/ingestions` devolve `headline` por execução.
- **Web**: `RunTimeline.tsx` (novo) no topo de `RunPage`; a lista de repositórios vira o detalhe expandido da etapa "Analisar repositórios"; `PendingRuns`, `ActivityTray` (execuções paradas e em andamento) e o card de execução do dashboard usam `headline`.
- **Testes antes**: core `timeline.test.ts` (GitHub em cada fase, com 1 repo falho e 1 vazio; CV com e sem OCR; conferência desligada → `skipped`; frase "etapa 5 de 6"); api (timeline presente, jobs de tarefa incluídos); web (`RunTimeline` renderiza estados, `PendingRuns` e bandeja mostram a mesma frase).

### C2 · Vocabulário sem ambiguidade (P1)
| Chave | Hoje | Proposto |
|-------|------|----------|
| `report.repoStatus.done` | Concluído | **Analisado** |
| `report.repoStatus.error` | Erro | **Falhou** (motivo curto ao lado, via C5) |
| `report.repoStatus.running` | Analisando | **Em análise** |
| `activity.status.done` | Concluído | **Concluída** (é a etapa/tarefa, não a execução; some da página da execução, que passa a usar a timeline) |
| `run.status.running` | Analisando | **Analisando** + etapa via `headline` (nunca sozinho) |
| `run.status.review` | Em revisão | **Pronta para revisão** (badge de destaque + botão "Revisar") |
| `run.status.done` | Concluída | **Finalizada** |
- **Impacto em testes**: `apps/web/test/f03/run.test.tsx` e `github.test.tsx` e o e2e `e2e-11-job-em-segundo-plano.spec.ts` procuram esses textos; os cenários `f03-01…f03-13` que esperam "Em revisão"/"Concluído" (helpers `waitReview` em `apps/e2e/helpers/ingest.ts`) mudam junto. **Teste antes**: web (rótulos novos nas linhas e no topo); o e2e é ajustado no mesmo lote.

### C3 · Sinal de vida e detecção de travamento (P2, P3)
- **Batimento por job**: o provider ganha `onActivity?: () => void` em cada chamada (`ClaudeCodeProvider.run` chama a cada mensagem recebida do stream do SDK; o SDK envia mensagens durante a chamada, e com `includePartialMessages` também os fragmentos de texto). O worker passa um `onActivity` que chama `job.updateProgress` com o mesmo `pct` e `beat: true`, no máximo a cada 15 s. Isso gera evento `progress` → `applyEvent` → `updated_at` do espelho.
- **Shared**: `JobSchema` expõe `updatedAt` (coluna já existe); o `buildTimeline` usa como `lastActivityAt`.
- **Estado real na fila**: `QueueAdapter.state(jobId) → "waiting" | "active" | "completed" | "failed" | "delayed" | "missing"` no `BullQueueAdapter` (`Job.fromId` + `getState`, já usados em `cancel`/`retry`); o `FakeQueueAdapter` dos testes ganha o mesmo.
- **Recuperação** (`healStuckRun` vira async e passa para `apps/api/src/services/runs.ts`): para cada job vivo no espelho da execução, consulta `state`; `failed` ou `missing` → aplica `failed` no espelho (com `failedReason` da fila), marca a execução como erro e guarda `failedTask`; `active` sem `updatedAt` há mais de **2 min** → etapa `stuck` na timeline (a execução continua `running`, a UI oferece "Refazer esta etapa" e "Cancelar").
- **Fonte de verdade dos eventos**: o worker passa a escutar `QueueEvents` (stream global da BullMQ) para `failed` e `stalled`, além dos eventos do `Worker`; assim o `failed` emitido pelo verificador de travados também chega ao espelho e a `onTaskFailed`/`onStageFailed`.
- **Verificador periódico** no worker (`apps/worker/src/sweeper.ts`, a cada 60 s): roda a mesma reconciliação para execuções em andamento que ninguém abriu; trava por chave Redis `SET <prefix>:sweeper NX EX 55` para dois workers não rodarem juntos; gera a notificação `ingestion.stuck` ("Ingestão parada: <nome>"), resolvida quando a execução sai do estado.
- **Zumbis**: `init: true` nos serviços `api` e `worker` dos dois composes (tini como PID 1 recolhe os processos do CLI).
- **Testes antes**: api (espelho `active` + fila `failed` → execução erro com `failedTask`; fila `missing` idem; `active` com `updatedAt` velho → `stuck` na timeline sem mudar status); worker (`QueueEvents` `failed` aplica no espelho e chama `onTaskFailed`; sweeper com trava não roda duas vezes; `onActivity` limita a 1 evento por 15 s com relógio fake); providers (`onActivity` chamado por mensagem); compose (bats: `init: true` em api e worker).

### C4 · Ações que dizem o que fazem (P4, P5)
- **Rótulo pelo que será refeito**: `RunPage` lê `run.params.failedTask?.type` (vem na resposta) e mostra `runPage.redo.<tipo>`: "Refazer a preparação", "Refazer a análise de <repo>", "Refazer a síntese", "Refazer a comparação com os seus dados", "Refazer a conferência"; abaixo, `runPage.redoKeeps`: "Os repositórios já analisados não serão refeitos."
- **Repositório falho na mesma execução**: `POST /api/ingestions/:id/repos/:fullName/retry` (novo). Core `reopenRepo(report, fullName)` volta a linha para `pending` e limpa `report.finishedAt`/`synthesis` (reabre a síntese, §2-11); enfileira `ingest.github.repo` dessa execução; a síntese, a reconciliação e a conferência rodam de novo ao fim. Só permitido com a execução em `running`, `error` ou `review` **sem revisão salva**; em `review` volta para `running` e as decisões já tomadas na revisão são mantidas (propostas com `decision != pending` não são tocadas pela reconciliação, que já filtra `pending`). Botão na linha do repositório: "Tentar este repositório de novo".
- **Reanálise ligada à origem**: `GET /api/ingestions/:id` e `runSummary` devolvem `parentRunId` e `childRunIds` (consulta por `parent_run_id`); a página mostra "Reanálise de <repo> · origem: <link>" ou "Reanálises: <links>". `RepoDetailPage` abre confirmação antes do `reanalyze`: "Isto cria uma nova análise só deste repositório. A execução anterior não muda."
- **Testes antes**: core (`reopenRepo` reabre linha e síntese); api (retry de repositório: 409 após revisão salva, enfileira só o repo, síntese roda de novo; `parentRunId`/`childRunIds`); web (rótulo por tarefa, botão na linha, confirmação do Reanalisar, links entre execuções).

### C5 · Erros em linguagem simples (P6)
- **Core** `packages/core/src/errors/friendly.ts` (novo, puro): `friendlyError(raw: string | { code?, message }) → { key, params?, hint?, technical }`, com o mapa abaixo; API, worker e web usam o mesmo.
  | Reconhece | Mensagem | O que fazer |
  |---|---|---|
  | `Reached maximum number of turns`, `structured_output_failed`, `invalid_output` | O modelo não concluiu a resposta no formato esperado. | Tente de novo; se repetir, troque o modelo. |
  | `GitHub instável`, `HTTP 5xx` | O GitHub está instável agora (tentamos 3 vezes). | Tente de novo em alguns minutos. |
  | `stalled more than allowable limit`, tarefa interrompida | A tarefa foi interrompida porque o serviço reiniciou. | Refaça esta etapa. |
  | `not_authenticated` | O GitHub não está conectado. | Conectar o GitHub (link). |
  | `rate_limited` | Limite de requisições do GitHub atingido. | Disponível de novo às {hora}. |
  | `empty` / repositório vazio | Repositório sem nenhum commit; foi pulado. | — |
  | `ENOENT gh` / `gh não está instalado` | O GitHub CLI não está no serviço. | Reconstrua com make dev-down && make dev. |
  | demais | Algo deu errado nesta etapa. | Tente de novo. |
- Worker grava em `run.error` e em `stoppedReason` o texto técnico (como hoje); a API devolve `errorFriendly` ao lado; a web mostra mensagem + o que fazer, com "Detalhes técnicos" recolhido. `githubErrorMessage` deixa de traduzir (passa a só identificar o código).
- **Testes antes**: core (cada linha do mapa); api (`errorFriendly` presente); web (mensagem, dica e detalhes recolhidos).

### C6 · Sino coerente (P7)
- **Contagem**: `countUnresolved` passa a `countUnseen`: `resolved_at is null and dismissed_at is null and read_at is null` (fora dos informativos). Abrir o destino de uma notificação marca como lida (`POST …/read` já existe; a página de pendências chama ao clicar "Ir para resolver"). A pendência continua listada em "Abertas" até resolver.
- **Agrupamento**: `profile.suggestion` vira uma notificação única por usuário (`dedupe_key = "profile.suggestion"`), título "{n} sugestões de perfil", com `n` recalculado a cada criação/decisão; resolvida quando `n = 0`. As existentes são fundidas na primeira execução (código, sem migration).
- **Testes antes**: core (contagem ignora lidas; agrupamento soma, decrementa e resolve em 0; fusão das antigas); web (clicar "Ir para resolver" marca lida e o contador cai).

### C7 · Infraestrutura de dev que não derruba a instância do dono (P8)
- **Desligamento gracioso**: `tsx watch` não aceita tempo de espera maior que 5 s; em vez de depender dele, o worker do dev roda sob `tsx watch --clear-screen=false` **com** `NARNIA_WORKER_DRAIN_MS` (padrão 60 s): ao receber SIGTERM, `main.ts` para de pegar jobs (`worker.pause(true)`), espera o ativo até o limite e só então fecha. Como o `tsx` mata em 5 s mesmo assim, este item só protege a instância do dono junto com a cópia separada abaixo; na instância `claude` ele reduz a perda.
- **Cópia separada para o dono** (decisão CM-4):
  - `git worktree add --detach .owner-src <commit>` (pasta ignorada pelo git e pelo Docker).
  - `docker-compose.dev.yml` monta o código de `${NARNIA_SRC_DIR:-.}` em `/app`, e os dados de caminhos absolutos da raiz (`./data`, `./backups`, `.env` continuam na raiz e não mudam).
  - `make dev` (instância padrão) usa `NARNIA_SRC_DIR=./.owner-src` quando a pasta existe; `.env.claude` não define a variável (o Claude continua no código atual).
  - Atualização: `scripts/claude-env.sh promote` no fim de cada marco verde (lint, typecheck, test, e2e): move `.owner-src` para o commit, registra no §8 e avisa o dono; o hot reload da instância do dono aplica a mudança de uma vez, já testada.
- **Testes antes**: bats (`promote` recusa com árvore suja ou sem os verdes; `make dev` usa `.owner-src` quando existe; instância `claude` nunca usa); worker (SIGTERM pausa e espera o job ativo com relógio fake).

## 4 · Marcos

| Marco | Itens | Verificação |
|-------|-------|-------------|
| **CM1 · Destravar e explicar** | C3 (fila real, `QueueEvents`, recuperação async, sweeper, `init: true`) + C5 | unitários; prova na instância `claude`: matar o worker no meio da síntese → em até 2 min a etapa aparece parada → execução vira erro com "A tarefa foi interrompida…" → "Refazer a síntese" → "Pronta para revisão" |
| **CM2 · Linha do tempo e vocabulário** | C1 + C2 | unitários; e2e da F03 e E2E-11 ajustados aos rótulos novos; smoke no navegador mostrando a frase "etapa x de y" |
| **CM3 · Ações claras** | C4 | unitários; e2e novo "repositório falho refeito na mesma execução" |
| **CM4 · Sino e instância do dono** | C6 + C7 | unitários, bats, Pester; `promote` executado uma vez com aviso ao dono |

## 5 · Decisões para o dono

| # | Pergunta | Contexto | Recomendação |
|---|----------|----------|--------------|
| CM-1 | Vocabulário | Hoje "Concluído" aparece no repositório e na etapa enquanto a execução segue. A tabela de C2 reserva "Finalizada" para o fim. | adotar a tabela de C2 |
| CM-2 | Limite para "parece parada" | Sem batimento por job, uma chamada longa ao modelo hoje fica muda por minutos; com o batimento de C3, 2 min sem sinal é anomalia. | 2 minutos |
| CM-3 | Sino | Pendências lidas ainda contam, e cada sugestão de perfil é uma notificação. | contar só as não vistas e agrupar as sugestões |
| CM-4 | Cópia separada para a instância do dono | O hot reload leva código em andamento à instância dele e o `tsx` mata o worker em 5 s; foi o que prendeu `01a12a97`. | sim, `.owner-src` atualizada pelo `promote` a cada marco verde |
| CM-5 | Retry de repositório depois da revisão | Refazer um repositório reabre a síntese e a conferência; decisões já tomadas são mantidas, mas a execução sai de "Pronta para revisão" por alguns minutos. | permitir enquanto a revisão não foi salva; depois de salva, só pelo "Reanalisar" |
| CM-6 | Fragmentos do stream como batimento | `includePartialMessages` dá sinal contínuo durante a chamada, mas aumenta o tráfego do stream (sem custo de tokens). | ligar só para o batimento, sem repassar o texto à UI |

## 6 · Registro

| Data | O que aconteceu |
|------|-----------------|
| 2026-10-11 | Plano criado após o uso real do dono (execuções `01a12a6f`, que chegou à revisão depois de "Refazer a síntese", e `01a12a97`, presa). |
| 2026-10-11 | **Refinamento contra o código.** Gaps encontrados: (1) o `failed` emitido pelo verificador de travados da BullMQ não chega ao `worker.on("failed")`, por isso o espelho fica `active` e `healStuckRun` não age (precisa de `QueueEvents` e consulta ao estado real); (2) jobs do GitHub têm `parentId = null` e `run.jobs` da página vem vazio; a timeline precisa de `taskOfJob`; (3) não há nenhum sinal durante uma chamada longa ao modelo, e `updated_at` do espelho existe mas não é exposto; (4) o batimento atual é do worker, não por job; (5) PID 1 dos containers é o `pnpm`, que não recolhe os processos `claude` mortos (zumbis vistos no worker do dono); (6) `finishedAt` do relatório bloqueia refazer a síntese, então o retry de repositório precisa reabrir o relatório; (7) `parentRunId` já é gravado pela reanálise, mas não sai na API nem na UI; (8) mensagens de erro nascem em quatro lugares sem mapa comum; (9) `read_at` existe e é ignorado pela contagem do sino; (10) `tsx watch` mata em 5 s sem opção de espera, então o desligamento gracioso só protege o dono junto com a cópia separada. Decisões novas CM-5 e CM-6. |
