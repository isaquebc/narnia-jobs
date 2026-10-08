# F02 · Troca de perfil

Entregável 2 do plan-v0. Cobre o fluxo **F2** de `../02-fluxos-do-usuario.md`: o usuário base ganha vários perfis (lentes), troca entre eles no shell, e cada perfil carrega ênfases, narrativa, dados de carreira obrigatórios e a persona do recrutador. É pré-requisito direto de F04 (o cartão do perfil é o único contexto implícito do agente) e de F05 (o CV é gerado a partir das ênfases). Depende de F01 (tabela `profile`, fatos, dashboard, shell, jobs, provider).

Status: **refinada em 2026-10-08** sobre o F01 entregue (decisões de §5 fechadas pelo dono; gaps do cruzamento com o código em §8). Implementação ainda não iniciada; marcos em §6.1.

---

## 1 · Objetivo e resultado esperado

Uma pessoa que concluiu o onboarding (F01) consegue:

1. criar um segundo perfil (ex.: "Project Manager") do zero ou clonando ênfases, narrativa e persona de um perfil existente, com os dados de carreira obrigatórios preenchidos (faixa salarial, contratos, localidades, disponibilidade) ou marcados "não sei";
2. trocar o perfil ativo pelo seletor no topo do shell e ver dashboard e contadores de ênfase mudarem imediatamente, em todas as abas abertas;
3. editar as ênfases do perfil: destacar, ocultar e reordenar experiências, skills, formação e idiomas, sem alterar os fatos do usuário base;
4. escrever e refinar a narrativa ("pitch") do perfil;
5. ver e ajustar a persona do recrutador derivada do perfil (especialidade, nível-alvo, mercado, idioma, tom, honestidade, rigor, senioridade do recrutador), com restaurar padrão por campo;
6. ver o cartão do perfil (~300 tokens) renderizado na página do perfil, com "atualizado em" no seu fuso, estado válido/desatualizado e botão **Atualizar cartão**;
7. aceitar ou dispensar sugestões de perfil: as heurísticas, automáticas no dashboard, e as do modelo, pedidas de propósito pelo botão **Analisar possíveis perfis**, que avisa o custo antes;
8. arquivar um perfil que não usa mais (nunca o ativo) e voltar a vê-lo com "mostrar arquivados".

### Dentro do escopo
- CRUD de perfis: criar, editar (incluindo carreira), clonar, arquivar, desarquivar, ativar. Sem apagar (F10, só para arquivados).
- Perfil ativo em `profile.is_active` (já existe no F01) + seletor no shell + evento WS `profile.switched`.
- Ênfases por perfil (`profile_emphasis`) sobre experiências, projetos, skills, formação e idiomas; ordem manual por tipo. A tabela `project` nasce vazia aqui (F02-9) e é preenchida por F03; conquistas entram na UI em F05 (F02-3), o schema já aceita.
- Narrativa/pitch editável; persona derivada com padrões fixos e overrides por enum (F02-7).
- Cartão do perfil: `buildProfileCard` puro, com **Resumo objetivo** heurístico, cache em `profile.card_json`, invalidação por `facts_version` + hooks (F02-1), reconstrução preguiçosa na leitura e forçada pelo botão.
- Relevância por fato e perfil (`profile/relevance.ts`), calculada junto com o cartão e gravada em `profile_fact_relevance` para o cartão e para a busca do F04 (F02-2).
- Sugestões: heurística estendida (múltiplas, a partir dos fatos existentes, sem repetir dispensadas) e análise pelo modelo como job com estimativa e confirmação (F02-5).
- **Definição** das tools MCP `profile.*` (schemas em `packages/shared/src/mcp/profile.ts`, handlers puros em `packages/core/src/profile/tools.ts`). Exposição via servidor MCP é **F04**.
- Dashboard por perfil: cartão resumido do ativo, contadores de ênfase, pendências de pesquisa do perfil, banner de sugestões. Contadores de fatos continuam do usuário (a lente não muda fatos).

### Fora do escopo (e para onde vai)
- Chat com o recrutador, hook que injeta o cartão, busca FTS5 e tools `fact.search/get/timeline`, resumo do perfil escrito pelo modelo → F04.
- Geração de CV, ênfase por conquista na UI, fila com coalescência e página de processos → F05.
- Cadastro e ingestão de projetos (GitHub) → F03; aqui só a tabela vazia e a aba com estado vazio.
- Edição livre dos fatos do usuário base, apagar perfil arquivado, configuração de concorrência dos workers → F10.
- Pesquisa na internet para "não sei" → F04. Aqui o campo continua aceitando `needsResearch`.
- Reordenação assistida pelo modelo → issue [#1](https://github.com/isaquebc/narnia-jobs-helpper/issues/1).

---

## 2 · Arquitetura deste entregável

### 2.1 Modelo de "lente"
```
user (fatos verificados) ──┬── profile A: emphasis(A) + pitch(A) + persona(A) + carreira(A) ──► relevance(A) ──► card(A)
                           └── profile B: emphasis(B) + pitch(B) + persona(B) + carreira(B) ──► relevance(B) ──► card(B)
```
- Fatos nunca são duplicados por perfil. `profile_emphasis` é uma tabela de ligação `(profile_id, fact_kind, fact_id)` com `mode` (highlight/normal/hidden) e `position`.
- Fato sem linha em `profile_emphasis` = `normal`, depois dos posicionados, por data decrescente (experiência e formação) ou por nome (skill, idioma).
- `fact_kind` é o enum `EmphasisFactKindSchema = experience | project | skill | education | language | achievement`; a UI do F02 oferece os cinco primeiros (projetos com estado vazio); o repo valida que o `fact_id` pertence ao usuário.
- Clonar copia `profile_emphasis`, pitch e `persona_overrides_json`; dados de carreira são pedidos de novo (salário de PM ≠ salário de engenheiro).

### 2.2 Cartão do perfil (`buildProfileCard`)
Função pura em `packages/core/src/profile/card.ts`: `(user, profile, facts, emphasis, relevance) → { text, tokensEst, hash }`.

Conteúdo, nesta ordem e com limite de ~300 tokens (estimado por `chars/4`, teto rígido de 1.600 chars):
1. Identidade curta: nome, cidade/país, preferência de remoto, idiomas com nível.
2. **Resumo objetivo** (2–3 linhas, `profile/summary.ts`, heurístico, **nunca cortado**): anos totais de carreira (experiências com data; as sem data viram "N experiências sem data"), nº de empresas, áreas percorridas, arco de cargos em ordem cronológica (ex.: "dev → tech lead → engineering manager"), nível atual, domínios recorrentes (tecnologias/skills mais frequentes nas experiências).
3. Alvo: cargo, senioridade, área, objetivo (`goal`), mercado, idioma dos documentos.
4. Carreira: faixa salarial, contratos, localidades, disponibilidade (ou "a pesquisar" para cada campo em `needsResearch`).
5. Pitch (até 3 linhas).
6. Top 3 experiências por relevância (empresa · cargo · período · 1 conquista com métrica, a de maior relevância).
7. Top 8 skills por relevância.
8. Lacunas conhecidas: fatos não verificados, campos `needsResearch`.

Corte quando não cabe (F02-2): primeiro 8 (lacunas), depois 7 (skills além das 3 primeiras), depois 6 (experiências além da 1ª). Seções 1–5 nunca são cortadas; se mesmo assim passar de 1.600 chars, o pitch é truncado em 3 linhas e o resumo objetivo em 2.

**Cache e validade.** `profile.card_json = { text, tokensEst, hash, factsVersion, builtAt }` + colunas `card_updated_at` e `card_facts_version`. O cartão é **inválido** quando `card_updated_at IS NULL` ou `card_facts_version < settings.facts_version`. Invalidação (F02-1):
- fatos: coberta por `facts_version` (toda escrita em `experience`, `achievement`, `education`, `skill`, `language` já incrementa; nenhum hook novo);
- usuário, perfil, ênfases: hook explícito `cards.invalidate(userId)` ao final de `users.update/complete`, `profiles.create/update/clone/archive/unarchive`, `emphasis.replace` (marca `card_updated_at = NULL` em todos os perfis do usuário; `profiles.update` de pitch/alvo/carreira/persona invalida só o próprio).
- Reconstrução preguiçosa em `profile.get_card`/`GET …/card` (grava o cache; leitura com efeito colateral documentado) e forçada em `POST …/card/rebuild`.
- WS `profile.card_invalidated {profileIds}` é emitido **só quando o estado muda de válido para inválido** (uma revisão que aceita 16 propostas gera um evento, não 16).

### 2.3 Relevância (`profile/relevance.ts`)
`scoreFacts(profile, facts, emphasis) → ProfileFactRelevance[]` em `packages/core/src/profile/relevance.ts`: nota 0–1 por fato e perfil, com `reasons` (lista de rótulos) para a UI explicar. Componentes, ponderados: recência (fim da experiência; skills herdam a experiência mais recente em que aparecem), modo de ênfase (highlight +, hidden = excluído com nota 0 e `hidden: true`), métrica presente na conquista, verificado, aderência ao alvo (termos de `targetTitle`/`altTitles`/`area` no título, resumo, tech ou nome da skill). Determinística: mesmo input → mesma saída.

Calculada **junto com a reconstrução do cartão** (não a cada escrita) e gravada em `profile_fact_relevance` com a mesma validade do cartão; F04 lê a tabela para ordenar `fact.search`. Sem tabela de relevância por escrita evita O(fatos × perfis) em cada aceite de proposta.

### 2.4 Persona do recrutador (derivada, F02-7)
`buildPersona(profile, overrides) → Persona` em `packages/core/src/profile/persona.ts`:
```
Persona = { specialty, targetLevel, market, language, tone, honesty, rigor, recruiterSeniority }
derivados: specialty = `${area} · ${targetTitle}`, targetLevel = seniority, market, language = docLocale
padrões:  tone = "direto" | "cordial"            → direto
          honesty = "maxima" | "diplomatica"     → maxima
          rigor = "alto" | "medio"               → alto
          recruiterSeniority = "senior" | "pleno" → senior (sempre sênior por padrão, seja qual for o nível do perfil)
```
`profile.persona_overrides_json` guarda só os campos sobrescritos (validados pelo `PersonaOverridesSchema`, todos opcionais, enums); `null` em um campo = restaurar padrão. Sem texto livre no prompt. O texto final do system prompt é montado em F04 a partir deste objeto; aqui existe o objeto e sua prévia.

### 2.5 Troca de perfil
```
PUT /api/profiles/:id/activate ─► profiles.setActive(id) (transação: zera os outros) ─► WS profile.switched {profileId}
web: invalida ["profiles"], ["dashboard"], ["profile", id, *]; rotas de perfil recarregam; outras abas idem pelo WS
```
Perfil arquivado não pode ser ativado (409 `profile_archived`); o ativo não pode ser arquivado (409 `profile_active`). Formulário com alterações não salvas: o `AppProvider` guarda um estado `dirty` e o seletor pede confirmação antes de trocar (o `beforeunload` do navegador não cobre a troca interna).

### 2.6 Sugestões de perfil (F02-5)
- **Heurística** (`profile/suggest.ts`, estende a do F01): regras sobre os fatos (títulos com lead/manager/head/principal, anos por área, skills de gestão/arquitetura/dados), gera até 3 candidatas com justificativa e `supportingFactIds`; descarta candidata igual a perfil existente (mesmo `targetTitle` normalizado) ou já dispensada (`profile_suggestion.status = dismissed`, comparação por `targetTitle` normalizado). Roda em `GET /api/profiles/suggestions` (zero tokens) e grava as novas com `source = heuristic`.
- **Modelo**: `POST /api/profiles/analyze` enfileira o job `profile.analyze` (fila `extract` do worker, espelho em `job`, bandeja do F01). Entrada compacta montada no `core` (`profile/analyze-input.ts`): identidade curta, todas as experiências com conquistas (uma linha cada), formação, skills agrupadas, idiomas, resumo de cada digest de arquivo, perfis existentes (nome, alvo) e sugestões já dispensadas; sem itens ocultos. `GET /api/profiles/analyze/estimate` devolve tokens estimados com o tamanho real da entrada (`estimate.ts`) e o modelo (`settings.models.analyze`, padrão Sonnet). O worker chama `provider.analyzeProfiles(input)` com `outputFormat` no schema `AnalyzeProfilesOutputSchema = { suggestions: [{ title, seniority, area, market, rationale, supportingFactIds }] }`, grava cada sugestão com `source = model` e `model`, registra `usage_event` (`profile.analyze`), e o `job.done` faz a UI recarregar. Mock: fixture com 2 sugestões.

### 2.7 API
| Método e rota | Função |
|---------------|--------|
| `GET /api/profiles?archived=1` · `POST /api/profiles` · `PATCH /api/profiles/:id` | lista (arquivados só com o parâmetro), cria, edita (todos os campos, carreira incluída; mudar alvo/pitch/persona invalida o cartão) |
| `POST /api/profiles/:id/archive` · `POST /api/profiles/:id/unarchive` | 409 se ativo / já no estado |
| `POST /api/profiles/:id/clone` | corpo = dados do novo perfil (nome, alvo, carreira…); copia ênfases, pitch e persona do origem; `clonedFrom` |
| `PUT /api/profiles/:id/activate` | define ativo; 409 se arquivado |
| `GET /api/profiles/:id/card` · `POST /api/profiles/:id/card/rebuild` | cartão (reconstrói se inválido) · reconstrução forçada |
| `GET /api/profiles/:id/emphasis` · `PUT /api/profiles/:id/emphasis` | lista (com os fatos resolvidos, uma linha cada, e a relevância) · substituição em lote `{ items: [{kind, id, mode, position?}] }` |
| `GET /api/profiles/:id/persona` · `PUT /api/profiles/:id/persona` | derivada + overrides · grava overrides (`null` restaura) |
| `GET /api/profiles/suggestions` · `POST /api/profiles/suggestions/:id/dismiss` | sugestões (heurísticas recalculadas + do modelo), com `source` · dispensar |
| `GET /api/profiles/analyze/estimate` · `POST /api/profiles/analyze` | estimativa · enfileira `profile.analyze` (409 se já há um na fila) |
| `GET /api/profiles/suggestion` (F01) | mantida para o onboarding |
| `GET /api/dashboard` (F01, estendida) | + `card: { text, builtAt, valid }`, `emphasis: { highlighted, hidden }`, `suggestions: n` |
| WS | `profile.switched {profileId}`, `profile.card_invalidated {profileIds}` (entram em `WsEventSchema`) |
| só com provider mock | `POST /api/_test/seed { fixture: "engineer" \| "leader" \| "long" }` semeia usuário + fatos + perfil ativo sem passar pelo wizard; `PATCH /api/_test/facts/:kind/:id` altera um fato (E2E-04) |

Ordem de registro no Hono: rotas literais (`/suggestions`, `/analyze…`, `/suggestion`) **antes** de `/:id`.

### 2.8 Tools MCP `profile.*` (definição; exposição em F04)
| Tool | Entrada → Saída | Notas |
|------|-----------------|-------|
| `profile.list` | `{ includeArchived? }` → `[{ id, name, targetTitle, isActive, archived }]` | |
| `profile.get_card` | `{ profileId? }` → `{ text, tokensEst, hash, builtAt }` | reconstrói se inválido; padrão = ativo |
| `profile.switch` | `{ profileId }` → `{ ok }` | erro tipado se arquivado |
| `profile.update_emphasis` | `{ profileId, items: [{ kind, id, mode, position? }] }` → `{ updated }` | invalida cartão |
| `profile.update_pitch` | `{ profileId, pitch }` → `{ ok }` | |
| `profile.create` | `{ name, targetTitle, seniority, area, goal, market, docLocale, cloneFrom? }` → `{ id }` | sem UI: carreira fica toda em `needsResearch` até o usuário preencher |
Schemas zod em `packages/shared/src/mcp/profile.ts` (entrada e saída, com `toJsonSchema` sem `$schema`, F01 fix `e06eeda`); handlers puros em `packages/core/src/profile/tools.ts` recebendo `Repos`.

### 2.9 Encaixe no código do F01 (revisão 2, 2026-10-08)
Pontos em que o plano precisa se curvar ao que já existe, verificados no código:

1. **Jobs fora da cadeia de ingestão não existem.** O worker só conhece `StageJobData` (`runId` + `stage`), `planStages`, `stageJobId(runId, stage)` e `processStage`; o `BullQueueAdapter` da api só expõe `enqueueStage`. O job `profile.analyze` precisa de um segundo caminho, genérico: em `core/jobs/tasks.ts`, `enqueueTask({ queue, type, payload, profileId })` com id `task__${type}__${chave}` (sem `:`), espelho `queued` em `job` (`type` = `profile.analyze`, `stage` = `type`, `parentId` null) e `DEFAULT_JOB_OPTIONS`; no worker, `processTask` com registro `{ "profile.analyze": handler }` e o `Worker` de cada fila despacha por `job.data.kind === "task"` ou `"stage"`. Eventos de progresso/erro reaproveitam `handleQueueEvent` (nada muda na bandeja). Filas continuam `ingest | ocr | extract`; `profile.analyze` roda em `extract`. A tela de processos e a concorrência configurável ficam para F05/F10.
2. **Emitir `profile.card_invalidated` não pode ser responsabilidade do `core`** (síncrono, sem bus). O `core` expõe `cards.validProfileIds()` e `cards.trackInvalidation(fn) → { result, flipped }` (compara válidos antes e depois de `fn`); as rotas da api que escrevem (review de ingestão, user, profiles, emphasis, persona, `_test/facts`) envolvem a escrita com `trackInvalidation` e emitem o evento se `flipped` não estiver vazio. Escritas de fatos não marcam nada: a validade é derivada de `card_facts_version < facts_version`, e o `flipped` captura a transição.
3. **`POST /api/profiles` do F01 ativa o primeiro perfil automaticamente** (`isActive = lista vazia`) e grava o provisório DIEESE quando `salary ∈ needsResearch`. Em F02 a criação do segundo perfil **não** ativa (corpo aceita `activate: true` para a sugestão aceita); a regra do DIEESE se mantém. `PATCH` usa `ProfilePatchRequestSchema = ProfileBaseSchema.omit({ id, userId, isActive, salaryBelowReference, cardJson, cardUpdatedAt, cardFactsVersion, archivedAt, clonedFrom }).partial()`; a regra de carreira é reaplicada pelo `profiles.update`, que já faz `ProfileSchema.parse` do resultado mesclado.
4. **`ProfileBaseSchema` ganha campos** (`personaOverrides`, `archivedAt`, `clonedFrom`, `cardFactsVersion`), todos opcionais/nulos, e `ProfileCreateRequestSchema` passa a omiti-los. `DashboardResponseSchema` estende com `card`, `emphasis` e `suggestions`.
5. **Tabela `project` pela fábrica `makeRepo`** de `facts.ts` (tabela, colunas, `toRow/fromRow`, `extraOrder`), com `ProjectDataSchema` em `fact-proposal.ts`, `project` em `FACT_KINDS` e na união (sem extrator até F03), `facts.projects` e `counts().projects`. A fábrica recebe um hook opcional `onRemove(kind, id)` para `facts.remove` limpar ênfase e relevância (hoje `remove` é genérico e cego).
6. **Fixtures compartilhadas entre testes, mock e seed** em `packages/core/src/testing/profile-fixtures.ts` (`engineer`, `leader`, `long`, dados fictícios no padrão "Ana Maria Exemplo" do mock), exportadas pelo pacote: os testes de `core`, o `MockProvider.analyzeProfiles` e `POST /api/_test/seed` usam a mesma fonte; o seed grava pelos repos (`users.complete`, `facts.*.insert`, `profiles.create`, `emphasis.replace`), nunca por SQL.
7. **Estimativa**: `estimate.ts` só tem `estimateExtraction` por arquivo. Entra `estimateCall({ inputChars, overhead, model })` genérico, com `PROMPT_OVERHEAD.analyzeProfiles` e saída no mesmo `CallEstimate`; `GET /api/profiles/analyze/estimate` mede o tamanho real da entrada montada por `analyze-input.ts`.
8. **Modelo da análise**: `settings.models` é um objeto (`{ extraction: {...} }`); a chave vira `models.analyze` dentro dele, lida por `resolveModel(settings, "analyze", "sonnet")` ao lado de `resolveExtractionModels`.
9. **`suggestProfile` do F01 continua** (onboarding, uma sugestão); entra `suggestProfiles(input, { existingTitles, dismissedTitles }) → ProfileSuggestion[]` com `supportingFactIds` e `market`; `SuggestInput` ganha `education` e ids nos itens.
10. **Cliente WS descarta quadros fora do `WsEventSchema`** (`safeParse` em `lib/ws.ts`): os eventos novos entram no schema antes de qualquer teste de web; `useProfiles` assina `profile.switched` e invalida `["profiles"]`/`["dashboard"]`; `useProfileCard` assina `profile.card_invalidated`.
11. **Formulário sujo**: `AppServices` é estático (api, ws, fuso); o estado `dirty` entra num `FormGuardProvider` novo em `app/`, com `useFormGuard()` para formulários registrarem e o `ProfileSwitcher` consultar.
12. **Rotas web** são code-based (`createRoute` em `router.tsx`); `/perfis/$id` com rotas filhas por aba; o `EmphasisBoard` carrega por `lazyRouteComponent(() => import(...))` para o `@dnd-kit` ficar fora do bundle inicial (F01-56).
13. **Shell**: `ProfileSwitcher` entra no `<header>` à esquerda de `ProviderIndicator`; `SideNav` ganha `nav.profiles`. Dicionário `pt-BR.ts` ganha as seções `profiles`, `emphasis`, `persona`, `card`, `suggestions`; o teste de literais cobre tudo.
14. **`resetDatabase` preserva `settings`** mas zera `facts_version`: `_test/seed` roda após `reset` e deixa `card_updated_at` NULL (reconstrução na primeira leitura).
15. **Cobertura por pasta**: `coverage.thresholds` do Vitest aceita chave glob (`"src/profile/**": { lines: 80, … }`) ao lado do global de 80% já existente.

---

## 3 · Dados deste entregável

Migration `0002_profiles.sql` (só para frente, como `0001`):

| Tabela | Colunas (novas ou completadas) |
|--------|--------------------------------|
| `profile` (completar) | `persona_overrides_json text not null default '{}'`, `archived_at text`, `cloned_from text references profile(id)`, `card_facts_version integer`; `card_json` passa a guardar `{text, tokensEst, hash, factsVersion, builtAt}`; `is_active` continua a fonte do ativo (F01) |
| `profile_emphasis` (nova) | `id`, `profile_id` (fk, cascade), `fact_kind`, `fact_id`, `mode` (highlight/normal/hidden), `position integer`, `updated_at`; único `(profile_id, fact_kind, fact_id)`; índice `(profile_id, fact_kind, position)` |
| `profile_fact_relevance` (nova) | `profile_id` (fk, cascade), `fact_kind`, `fact_id`, `score real`, `reasons_json`, `computed_at`; pk `(profile_id, fact_kind, fact_id)` |
| `profile_suggestion` (nova) | `id`, `user_id`, `source` (heuristic/model), `model text`, `payload_json` (title, seniority, area, market, rationale, supportingFactIds), `status` (new/accepted/dismissed), `created_at`, `decided_at` |
| `project` (nova, vazia, F02-9) | `id`, `user_id`, `name`, `description`, `url`, `role`, `start_date`, `end_date`, `tech_json`, `source_id`, `confidence`, `verified`, `created_at`, `updated_at`; repo `facts.projects` com a fábrica genérica (insert/get/list/update/remove, bump de `facts_version`); kind `project` entra em `FACT_KINDS` e `FactProposalSchema` (sem extrator até F03) |
| `settings` | chave `models.analyze` (padrão `sonnet`) |

Regras:
- `fact_id` referenciado só pode pertencer ao `user_id` do perfil (validação no repo; usuário único em F01, mas a regra fica).
- Fato apagado remove ênfase e relevância (`facts.remove` chama `emphasis.removeFact(kind, id)`; sem FK física porque os fatos vivem em tabelas distintas).
- `position` é renumerada sem buracos dentro de `(profile_id, fact_kind)` a cada `replace`.
- Perfis existentes antes da migration: `card_updated_at` já é NULL → reconstrução na primeira leitura; o perfil do F01 já é `is_active`.
- Dados de carreira obrigatórios por perfil com `needsResearch` para "não sei" (regra de F01-15, `requireCareerFields`).

---

## 4 · Layouts deste entregável

Rotas web novas: `/perfis` (lista), `/perfis/novo` (criar/clonar), `/perfis/$id` com abas `enfases | narrativa | recrutador | cartao`. `SideNav` ganha "Perfis".

| Tela | Componentes | Estados a cobrir |
|------|-------------|------------------|
| Shell: `ProfileSwitcher` (topo) | lista de perfis não arquivados com cargo-alvo, check no ativo, "+ novo perfil", "gerenciar perfis"; confirmação se há formulário sujo | 1 perfil · N perfis · trocando (spinner) · confirmação de descarte |
| `/perfis` · `ProfileList` | cartões (nome, alvo, destacadas/ocultas, cartão atualizado em…), ações ativar/renomear/clonar/arquivar/desarquivar; filtro "mostrar arquivados"; botão **Analisar possíveis perfis** → `AnalyzeProfilesDialog` (alerta de custo com estimativa e modelo, confirmar) ; `SuggestionList` (heurísticas e do modelo, com justificativa e fatos de apoio, aceitar/dispensar) | com arquivados · analisando (job na bandeja) · sem sugestões · erro do provider · 409 ao arquivar o ativo |
| `/perfis/novo` · `ProfileForm` | reaproveita o formulário do passo 5 do F01 (`ProfileForm` + carreira + "não sei" + alerta DIEESE) com `CloneFromSelect`; ao clonar, pré-preenche tudo menos carreira; vindo de sugestão, pré-preenche alvo/senioridade/área | do zero · clonando · a partir de sugestão · validação |
| `/perfis/$id/enfases` · `EmphasisBoard` | abas Experiências / Projetos (vazia até F03, com explicação) / Skills / Formação / Idiomas; cada item com destacar/normal/ocultar, arrastar (`@dnd-kit`, `React.lazy` só aqui) e botões subir/descer; chip de relevância com motivos; salvar em lote; prévia lateral do cartão (reconstruída após salvar) | sem ênfases · com ocultos · reordenando · salvando · erro |
| `/perfis/$id/narrativa` · `PitchEditor` | textarea 3–5 linhas com contador; mostra como o pitch aparece no cartão | vazio · editado · salvo |
| `/perfis/$id/recrutador` · `PersonaPreview` + `PersonaOverrides` | seletores: especialidade, mercado, idioma, tom, honestidade, rigor, senioridade do recrutador; "restaurar padrão" por campo | padrão · com overrides · restaurado |
| `/perfis/$id/cartao` · `ProfileCardView` | texto, tokens estimados, "atualizado em" (fuso do usuário), estado válido/desatualizado, botão **Atualizar cartão**, resumo objetivo destacado | válido · desatualizado (aviso) · reconstruindo |
| Dashboard (F01, estendido) | `ProfileCardSummary` (3 primeiras linhas do cartão + link), contadores de ênfase, `SuggestionBanner` ("Detectamos um possível perfil de …", aceitar abre `/perfis/novo` pré-preenchido, dispensar persiste) | sem sugestão · 1+ · cartão desatualizado |

Regras de UI: trocar perfil nunca perde formulário não salvo (confirmação); datas via `formatInUserTz`; todos os textos via `t()` (o teste de literais do F01 cobre os componentes novos).

---

## 5 · Decisões deste entregável (fechadas em 2026-10-08 pelo dono)

| # | Decisão | Opções | Decidido |
|---|---------|--------|----------|
| F02-1 | Invalidação do cartão | hooks nos repos · triggers SQLite · recalcular sempre · fila com merge | **hooks nos repos** + `facts_version` para fatos + reconstrução preguiçosa; cartão visível na página do perfil com **Atualizar cartão**. Fila com merge descartada para o cartão (dado derivado barato, sem conflito); a ideia foi guardada em F05 §2.5 e F10 §2.5. |
| F02-2 | Limite do cartão | ~300 tokens · sem limite | **~300 tokens** (teto 1.600 chars) com corte por prioridade; **Resumo objetivo** heurístico nunca cortado; relevância pré-calculada com o cartão; busca FTS5 e tools compactas em F04; sem embeddings nesta escala. |
| F02-3 | Ênfase em conquistas | por conquista · só por experiência | **por experiência em F02**; por conquista **obrigatória em F05** (schema e repo já aceitam `achievement`). |
| F02-4 | Reordenação | `@dnd-kit` · botões | **`@dnd-kit`** com botões subir/descer, importação dinâmica só na página de ênfases. "Reordenar com <modelo>" → issue #1. |
| F02-5 | Sugestões de perfil | só heurística · heurística + modelo | **as duas, separadas**: heurística automática (zero tokens) + botão **Analisar possíveis perfis** (job com alerta de custo, estimativa e confirmação; todo o histórico vai ao modelo; modelo configurável, Sonnet por padrão). |
| F02-6 | Arquivar vs apagar | arquivar · apagar com cascata | **arquivar** (ativo bloqueado, 409); **apagar só perfil arquivado**, em F10, com cascata listada. |
| F02-7 | Persona | enum fixo · texto livre | **enums com padrão e configuráveis pela interface**: tom direto, honestidade máxima, rigor alto, recrutador sênior; seletores com restaurar padrão; sem texto livre. |
| F02-8 | Clonar sem carreira | gravar com `needsResearch` · formulário antes de gravar | **formulário antes de gravar** (nada meio-pronto no banco); a tool `profile.create` com `cloneFrom`, que não tem UI, grava com carreira toda em `needsResearch`. |
| F02-9 | Projetos nas ênfases | agora (tabela nova) · quando F03 criar `project` | **Decidida pelo dono: criar a tabela `project` vazia já em `0002`** (`id`, `user_id`, `name`, `description`, `url`, `role`, `start_date`, `end_date`, `tech_json`, `source_id`, `confidence`, `verified`, `created_at`, `updated_at`; sem UI de cadastro até F03, que a preenche pelo GitHub). Ênfases aceitam `project`; o quadro mostra a aba Projetos com estado vazio ("chega com a ingestão do GitHub"). |
| F02-10 | Semeadura dos e2e | passar pelo wizard do F01 · endpoint de teste só-mock | **`POST /api/_test/seed`** com fixtures nomeadas (rápido e determinístico); os cenários do F01 continuam passando pelo wizard. O E2E-04 aqui usa `_test/facts`; a versão completa, editando o fato pela interface real, está registrada em F10 §6.3 (E2E "editar fato invalida cartões"). |

---

## 6 · O que precisa estar coberto para o F02 funcionar

### 6.1 Marcos de implementação (ordem obrigatória; cada marco termina com seus testes verdes, TDD como em `../09-metodologia-tdd.md`)

| Marco | Entrega | Verificação |
|-------|---------|-------------|
| **M1 Shared + banco** | `packages/shared`: `EmphasisFactKindSchema`, `EmphasisModeSchema`, `ProfileEmphasisSchema`, `ProfileFactRelevanceSchema`, `PersonaSchema` + `PersonaOverridesSchema` (enums de F02-7), `ProfileCardSchema` (`tokensEst` inteiro ≥ 0), `ProfileSuggestionSchema` (`source`, `model`), `AnalyzeProfilesInput/OutputSchema`, contratos das rotas de §2.7, `WsEventSchema` + `profile.switched`/`profile.card_invalidated`, `packages/shared/src/mcp/profile.ts` com snapshot do JSON Schema; `packages/core`: `0002_profiles.sql` (inclui `project` vazia, F02-9), `jobs/tasks.ts` (`enqueueTask`, §2.9-1), fábrica de fatos com `onRemove` e repo `projects`, repos `emphasis` (replace em lote, validação de dono e de tipo, renumeração, `removeFact`), `relevance` (upsert em lote por perfil), `suggestions` (criar, listar, dispensar, aceitar, dedupe por título normalizado), `profiles` (+ `archive/unarchive/clone`, `list({ archived })`, `setActive` com 409 lógico, `invalidateCards`), `facts.remove` chamando `emphasis.removeFact`; fixtures `engineer` (6 experiências com conquistas e métricas, 2 projetos, 20 skills, 2 formações, 2 idiomas), `leader` (fatos de liderança) e `long` (20 experiências, 60 skills) em `packages/core/src/testing/profile-fixtures.ts` (§2.9-6) | testes de §6.2 de `shared` e dos repos; `./start.sh test` verde |
| **M2 Core: cartão, relevância, persona, sugestões, tools** | `profile/summary.ts` (resumo objetivo), `profile/relevance.ts`, `profile/card.ts` (seções, corte, hash, `tokensEst`), `profile/cards.ts` (validade por `card_updated_at`/`card_facts_version`, reconstrução que grava cartão + relevância, `invalidate`, `validProfileIds`, `trackInvalidation`, §2.9-2), `profile/persona.ts`, `profile/suggest.ts` estendido, `profile/analyze-input.ts` (entrada compacta) + `estimateCall` e `PROMPT_OVERHEAD.analyzeProfiles` em `estimate.ts` + `resolveModel` em `models.ts` (§2.9-7/8), `suggestProfiles` ao lado de `suggestProfile` (§2.9-9), `profile/tools.ts` (handlers `profile.*`) | testes de §6.2 `packages/core`; cobertura ≥ 80% em `src/profile/**` (threshold por glob no `vitest.config.ts`); cartão ≤ 1.600 chars na fixture `long` |
| **M3 Provider + worker + API** | `Provider.analyzeProfiles` (`ClaudeCodeProvider` com `prompts/analyze-profiles.md` e `outputFormat`; `MockProvider` com fixture e modos de erro); worker: `processTask` com registro de handlers e despacho `stage | task` (§2.9-1), handler `profile.analyze` na fila `extract` com espelho, `usage_event` e gravação das sugestões; api: `enqueueTask` no `QueueAdapter`, rotas de §2.7 com `trackInvalidation` + broadcast WS (§2.9-2), `PATCH` com `ProfilePatchRequestSchema`, criação sem ativar (§2.9-3), dashboard estendido, `_test/seed` e `_test/facts` só com mock; `settings.models.analyze` | testes de §6.2 `providers`, `worker`, `api`; fluxo `curl` completo com mock (criar, clonar, ênfases, cartão, ativar, arquivar, analisar) registrado em §8 |
| **M4 Web** | `ProfileSwitcher` no shell (+ `FormGuardProvider`, §2.9-11), rotas `/perfis`, `/perfis/novo`, `/perfis/$id/*`, `ProfileList` + `AnalyzeProfilesDialog` + `SuggestionList`, `ProfileForm` reaproveitado com `CloneFromSelect` e pré-preenchimento por sugestão, `EmphasisBoard` (`@dnd-kit` por `lazyRouteComponent`, botões, chips de relevância, prévia do cartão), `PitchEditor`, `PersonaPreview`/`PersonaOverrides`, `ProfileCardView`, dashboard com `ProfileCardSummary` e `SuggestionBanner`; hooks `useProfiles` (ativar, arquivar, clonar), `useProfileCard`, `useEmphasis`, `useSuggestions`; WS `profile.switched` → invalidação de queries; dicionário pt-BR | testes de §6.2 `apps/web`; smoke manual com mock em `./start.sh dev` |
| **M5 E2E + fechamento** | cenários E2E-01…E2E-09 de §6.3 em `apps/e2e/tests/` (prefixo `f02-`); `_test/seed` usado por todos; CI verde; documentos `../02` (fluxo F2), `../03 §4–5` (tools `profile.*`, relevância), `../04 §B` (tabelas novas) atualizados; §6.4 executado com o histórico real do dono; §8 completo | `./start.sh e2e` verde; §6.5 completo |

Regras durante a implementação: as mesmas do F01 (teste antes do código, nada no host, nenhum teste automatizado com a assinatura real, fixtures fictícias, commits por lote quando o dono pedir, §8 por marco).

### 6.2 Testes unitários (Vitest) · obrigatórios
**`packages/shared`**
- Schemas novos: válidos/inválidos por fixture; `PersonaOverridesSchema` rejeita valor fora do enum e aceita `null` por campo; `ProfileCard.tokensEst` inteiro ≥ 0; `WsEventSchema` aceita os dois eventos novos; snapshot do JSON Schema das tools `profile.*` e de `AnalyzeProfilesOutputSchema` (sem `$schema`).

**`packages/core`**
- `summary`: anos totais com sobreposição descontada; experiências sem data contadas à parte; arco de cargos em ordem cronológica; nunca passa de 3 linhas; determinístico.
- `relevance`: `hidden` → excluído; `highlight` > `normal` com o resto igual; recência e métrica aumentam a nota; termos do alvo aumentam; `reasons` explica cada componente; mesmo input → mesma saída.
- `buildProfileCard`: ordem das seções; resumo objetivo sempre presente; nunca passa de 1.600 chars na fixture `long`; corte na prioridade de F02-2; "a pesquisar" para cada `needsResearch`; mesmo input → mesmo `hash`; `hidden` não aparece; top-3/top-8 seguem a relevância.
- `cards` (validade e invalidação): escrever em cada tabela de fatos (via repos) torna o cartão inválido por `facts_version`; `users.update`, `profiles.update` (pitch/alvo/carreira/persona), `emphasis.replace`, `clone`, `archive` invalidam; `get` reconstrói e grava `builtAt` em UTC, `card_facts_version` e a relevância; evento de invalidação só na transição válido → inválido (16 aceites = 1 evento).
- `emphasis`: `replace` substitui o conjunto; rejeita `fact_id` de outro usuário ou inexistente; aceita `project` (fixture com 2 projetos inseridos pelo repo); `position` renumerada sem buracos; `facts.remove` apaga a ênfase e a relevância.
- `profiles`: `clone` copia ênfases, pitch e overrides, não copia carreira, preenche `clonedFrom`; `archive` do ativo → erro tipado `profile_active`; `setActive` de arquivado → `profile_archived`; `unarchive`; `list` padrão exclui arquivados.
- `persona`: derivação padrão para 3 fixtures (tom direto, honestidade máxima, rigor alto, sênior); overrides só nos campos informados e só valores do enum; `null` restaura.
- `suggest` (heurística): fixture `leader` sugere EM/PM com `supportingFactIds`; não repete dispensada; não sugere perfil já existente; `engineer` sem liderança → nenhuma.
- `analyze-input`: entrada compacta sem itens ocultos e sem fatos duplicados; inclui digests e perfis existentes; estimativa cresce com o volume.
- `jobs/tasks`: `enqueueTask` gera id sem `:` e espelha `queued` com `type`/`profileId`; enfileirar a mesma chave com job pendente é idempotente (409 na api).
- `cards.trackInvalidation`: devolve só os perfis que estavam válidos antes e ficaram inválidos; escrita que não muda nada → `flipped = []`.
- Fábrica de fatos com `onRemove`: remover qualquer tipo chama o hook com `(kind, id)`; `projects` passa pelos mesmos testes genéricos dos demais tipos.
- Tools `profile.*`: cada handler valida entrada e saída pelo schema; `profile.switch` em arquivado → erro tipado; `profile.create` com `cloneFrom` grava carreira em `needsResearch`.

**`packages/providers`**
- `analyzeProfiles`: `ClaudeCodeProvider` monta `query` com o prompt e o `outputFormat` certo (query injetado) e valida a saída; `MockProvider` devolve a fixture e respeita `errors.analyzeProfiles`.

**`apps/worker`**
- Despacho `stage | task`: job de etapa continua em `processStage`; job de tarefa vai ao handler registrado; tipo desconhecido → `error` tipado.
- Job `profile.analyze`: grava sugestões `source = model`, registra `usage_event`, espelha estado; erro do provider → `error` com mensagem para a UI.

**`apps/api`**
- Rotas: criar, editar, clonar (pré-requisitos de carreira), ativar (409 arquivado), arquivar (409 ativo), desarquivar, ênfases em lote (400 em dono errado), persona (`null` restaura), cartão (cache hit/miss por validade; `rebuild` força), sugestões (heurísticas + modelo, dispensar), `analyze` (estimate; 409 com job na fila), dashboard estendido, `_test/seed` e `_test/facts` ausentes sem mock; ordem das rotas literais antes de `/:id`.
- WS: `activate` emite `profile.switched` uma vez; escrita em fato emite `profile.card_invalidated` uma vez por transição.

**`apps/web`**
- `ProfileSwitcher`: lista sem arquivados, ativa, spinner, invalida queries, confirmação com formulário sujo.
- `EmphasisBoard`: toggle de modo, reordenação por teclado e por botões, salvar em lote, prévia do cartão atualiza após salvar, chip de relevância.
- `ProfileForm` (novo/clonar/sugestão): obrigatórios de carreira, "não sei", pré-preenchimentos.
- `PersonaOverrides`: seletores, restaurar padrão por campo.
- `ProfileCardView`: estados válido/desatualizado, botão reconstruir, "atualizado em" no fuso.
- `AnalyzeProfilesDialog`: estimativa visível antes, confirmar enfileira, erro do provider.
- `SuggestionBanner`/`SuggestionList`: aceitar abre formulário pré-preenchido; dispensar some e não volta após recarregar.
- i18n: teste de literais cobre os componentes novos.

### 6.3 Testes e2e (Playwright, Chromium) · obrigatórios
Rodam no compose e2e (mock) com `POST /api/_test/seed` (F02-10). Arquivos `apps/e2e/tests/f02-NN-*.spec.ts`, títulos `F02/E2E-NN`.
- **E2E-01 criar e trocar**: seed `engineer` → criar "Project Manager" do zero com carreira → seletor mostra 2 → ativar PM → dashboard muda (cartão e contadores de ênfase) → recarregar mantém PM ativo.
- **E2E-02 clonar**: clonar o perfil do engenheiro para "Staff Engineer" → formulário pré-preenchido sem carreira → não salva sem carreira → "não sei" em salário → salva; ênfases iguais às do origem.
- **E2E-03 ênfases**: no perfil PM ocultar uma experiência e destacar outra, reordenar por botões → salvar → cartão do PM reflete; cartão do engenheiro não muda. Um único arraste (`@dnd-kit`) neste cenário.
- **E2E-04 invalidação**: `PATCH /api/_test/facts/experience/:id` → ambos os cartões ficam "desatualizados" (WS) → abrir cada um reconstrói com nova data.
- **E2E-05 arquivar**: arquivar o ativo → bloqueado com mensagem; trocar e arquivar → some do seletor; "mostrar arquivados" lista; desarquivar volta.
- **E2E-06 sugestão heurística**: seed `leader` → banner no dashboard → aceitar → formulário pré-preenchido → criar → banner some; dispensar outra → não volta após recarregar.
- **E2E-07 análise pelo modelo (mock)**: "Analisar possíveis perfis" → alerta com estimativa e modelo → confirmar → job na bandeja → sugestões do modelo com justificativa → dispensar uma, aceitar outra.
- **E2E-08 duas abas**: trocar perfil na aba A → aba B recebe `profile.switched` e atualiza o seletor e o dashboard.
- **E2E-09 fuso e persona**: "atualizado em" coerente com `America/Sao_Paulo` a partir do `builtAt` da API; persona mostra os padrões e um override de tom persiste após recarregar.

### 6.4 Teste manual com provider real (antes de fechar F02)
Única chamada ao modelo em F02: "Analisar possíveis perfis". Com o histórico real do dono: registrar tokens reais × estimativa, se as sugestões fazem sentido e se a justificativa cita os fatos certos. Também: ler o cartão de 3 perfis reais e avaliar se um recrutador entende o alvo em 20 segundos; anotar `tokensEst` (chars/4) para comparar com a contagem real do SDK em F04.

### 6.5 Definição de pronto
- Testes de 6.2 e 6.3 verdes na CI; cobertura ≥ 80% em `core/src/profile/**`.
- Cartão de qualquer perfil ≤ 1.600 chars em todas as fixtures, com resumo objetivo sempre presente.
- Nenhuma escrita em fatos, usuário, perfil ou ênfases deixa cartão válido desatualizado (testes de invalidação por tabela e por repo).
- `../02`, `../03 §4–5`, `../04 §B` atualizados com o que mudou.
- Critério de entregável publicável de `README.md` (tasks): README de uso com a seção de perfis, estados de erro, i18n completo.

---

## 7 · Riscos específicos
| Risco | Mitigação |
|-------|-----------|
| Cartão genérico demais com 300 tokens | resumo objetivo fixo + relevância; teste manual 6.4; F04 busca detalhes por tool |
| Invalidação esquecida em repo novo | fatos cobertos por `facts_version` (sem hook); lista de hooks de §2.2 é a fonte dos testes; teste "escrever em cada repo invalida" |
| Relevância cara em usuários com muitos fatos | calculada só na reconstrução do cartão; fixture `long` mede o tempo (< 50 ms) |
| Heurística do resumo errar anos com datas ausentes | regra explícita de "sem data" e teste dedicado |
| Análise pelo modelo cara ou ruim | estimativa + confirmação; entrada compacta; modelo configurável; medição em 6.4 |
| Muitos perfis tornam o seletor confuso | arquivamento; ordenação por último uso (`updated_at`) |
| Drag-and-drop frágil em e2e | reordenação por botões e teclado na maioria dos cenários; um único arraste |
| Rotas `/suggestions` capturadas por `/:id` | registro das literais antes; teste de api dedicado |

## 8 · Registro de execução
| Data | Marco | O que aconteceu |
|------|-------|-----------------|
| 2026-10-08 | — | **F02-1 decidida pelo dono**: hooks nos repositórios, reconstrução na leitura, página do perfil com estado do cartão e botão de atualizar. Fila com merge, página de processos e escala de workers registradas em F05 e F10. |
| 2026-10-08 | — | **F02-2 decidida pelo dono**: 300 tokens; preocupação registrada: busca e gasto de tokens são a maior fraqueza potencial do projeto. Respostas: resumo objetivo fixo, relevância pré-calculada, FTS5 e tools compactas em F04, regra de buscar antes de listar no prompt, uso por tool no medidor (F10). |
| 2026-10-08 | — | **F02-3 decidida pelo dono**: por experiência em F02; por conquista obrigatória em F05. |
| 2026-10-08 | — | **F02-4 decidida pelo dono**: `@dnd-kit` + botões, importação dinâmica; "Reordenar com <modelo>" vira a issue #1. |
| 2026-10-08 | — | **F02-5 decidida pelo dono**: heurística automática + botão "Analisar possíveis perfis" com alerta de custo e confirmação. F02 passa a ter uma chamada ao modelo. |
| 2026-10-08 | — | **F02-6 decidida pelo dono**: arquivar aqui; apagar só perfil arquivado, em F10. |
| 2026-10-08 | — | **F02-7 decidida pelo dono**: padrões tom direto, honestidade máxima, rigor alto, recrutador sênior; todos configuráveis pela interface por enums, com restaurar padrão; sem texto livre. |
| 2026-10-08 | — | **Refinamento completo sobre o F01 entregue.** Gaps encontrados e como foram fechados: (1) o plano criava `settings.active_profile`, mas o F01 já tem `profile.is_active` + `profiles.setActive` → mantido o do F01; (2) não existe tabela nem kind `project` (os kinds do F01 são identity, experience, achievement, education, skill, language, link) → o dono decidiu criar a tabela vazia já em `0002` (F02-9), com aba de projetos em estado vazio até F03; (3) clonar "sem carreira" violaria `requireCareerFields` → formulário antes de gravar (F02-8); (4) `profile.switched` e `profile.card_invalidated` precisam entrar em `WsEventSchema`, porque o cliente valida os quadros; evento de invalidação só na transição para não gerar 16 eventos numa revisão; (5) invalidação de fatos já é coberta por `facts_version` (bump em insert/update/remove de `facts.ts`) → hooks explícitos só em usuário, perfil e ênfases; (6) relevância por escrita seria O(fatos × perfis) a cada aceite → calculada com o cartão e gravada com a mesma validade; (7) F01 tem `GET /api/profiles/suggestion` (singular) para o onboarding → mantida; plural para a lista; rotas literais antes de `/:id` no Hono; (8) o dashboard do F01 conta fatos do usuário → em F02 ganha cartão, ênfases e sugestões do perfil ativo, sem trocar os contadores de fatos; (9) E2E-04 pedia "editar uma conquista via tela de revisão" que não existe (edição é F10) → endpoint só-mock `_test/facts` e `_test/seed` (F02-10); (10) fixture de §6.1 pedia projetos → trocada por conquistas com métrica, idiomas e uma fixture longa para o teto do cartão; (11) `tokensEst` = chars/4 é impreciso para pt-BR → mantido e calibrado em F04; (12) desarquivar não existia → adicionado; (13) experiências sem data quebrariam o resumo objetivo → regra "N sem data"; (14) formulário sujo na troca de perfil → estado `dirty` no `AppProvider`; (15) `honesty` e `recruiterSeniority` não existiam no objeto da persona → adicionados com enums. |
| 2026-10-08 | — | **F02-8, F02-9 e F02-10 decididas pelo dono**: clone com formulário antes de gravar; tabela `project` vazia já em `0002`; semeadura por `_test/seed`, com o teste completo de edição de fato pela interface registrado em F10 §6.3. |
| 2026-10-08 | — | **Revisão 2 contra o código** (§2.9): dois gaps estruturais: o worker e o `QueueAdapter` só conhecem jobs de etapa de ingestão (entra `enqueueTask`/`processTask` genéricos), e o `core` não tem como emitir o evento de cartão invalidado (entra `trackInvalidation` usado pelas rotas). Demais: `POST /api/profiles` ativa o primeiro perfil sozinho; `PATCH` precisa de schema parcial com a regra de carreira reaplicada no repo; `project` pela fábrica de fatos com hook `onRemove`; fixtures compartilhadas em `core/src/testing`; `estimateCall` e `resolveModel` genéricos; `suggestProfiles` plural; cliente WS descarta eventos fora do schema; `FormGuardProvider`; `lazyRouteComponent`; `resetDatabase` zera `facts_version`; threshold de cobertura por glob. |
| 2026-10-08 | M1 | **Lote A `packages/shared` entregue** (TDD, vermelho confirmado: 2 suítes sem módulo). `schemas/emphasis.ts` (`EmphasisFactKind` nos 6 tipos na ordem da UI, `EmphasisMode`, `ProfileEmphasis`, `EmphasisItem`, `ProfileFactRelevance`), `schemas/persona.ts` (enums de F02-7 + `PERSONA_DEFAULTS`, `PersonaOverrides` com `null` = restaurar), `schemas/profile-card.ts` (`ProfileCard`, `PROFILE_CARD_MAX_CHARS`), `schemas/profile-suggestion.ts` (`ProfileSuggestion`, `AnalyzeProfilesInput/Output` com máximo de 5), `ProjectDataSchema` + `project` em `FACT_KINDS` e na união, `ProfileBase` com `cardFactsVersion`/`personaOverrides`/`archivedAt`/`clonedFrom`, contratos (`ProfileCreateRequest` + `activate`, `ProfilePatchRequest` sem os `.default([])`, clone, lista com `?archived`, cartão, ênfases, persona, sugestões, análise), `mcp/profile.ts` com as 6 tools e `PROFILE_TOOL_JSON_SCHEMAS` (snapshot, sem `$schema`). Testes: `f02-schemas.test.ts` (16) e `mcp-profile.test.ts` (3); shared em 70 testes. Teste antes: sim. **Desvios:** (1) `SenioritySchema` mudou para `common.ts` (re-exportado por `profile.ts`) para `persona.ts` e `profile-suggestion.ts` não importarem `profile.ts` em ciclo; (2) os eventos `profile.switched`/`profile.card_invalidated` ficaram em `ProfileWsEventSchema`, fora da união `WsEventSchema`, porque `useJobs`/`useIngestion` da web leem `jobId` sem discriminar o tipo e o typecheck quebraria (apps/* fora do escopo do M1): **M4 funde na união** ao adaptar os hooks; (3) `card`, `emphasis`, `suggestions` e `counts.projects` do dashboard entraram como opcionais: **M3 os torna obrigatórios** junto com a rota; (4) o snapshot de `EXTRACTION_JSON_SCHEMAS` **não mudou** (a união de propostas não entra nas saídas da extração). **F02-11:** `ProfilePatchRequestSchema` remove os `.default([])` de `contractTypes`/`locations`/`needsResearch` (num PATCH, ausente = não mexer; com o padrão, o repo esvaziaria as listas). |
| 2026-10-08 | M1 | **Lote B `packages/core` entregue** (TDD, vermelho confirmado em 5 suítes: 3 sem módulo + migrate + reset). `0002_profiles.sql` (4 colunas em `profile`; `profile_emphasis` com único e índice `profile_emphasis_order`; `profile_fact_relevance` com pk composta; `profile_suggestion` com `title_normalized` e índice único por usuário; `project` vazia); `profile/errors.ts` (`ProfileError` com códigos `profile_not_found|profile_active|profile_archived|fact_not_found|fact_foreign|unsupported_kind|suggestion_not_found`); repos `emphasis` (`list`, `replace` em transação com validação de dono por tipo, conquista via experiência, renumeração por `(perfil, tipo)` estável pela posição pedida e depois pela ordem de chegada, invalida o cartão do perfil; `removeFact`, `countByMode`, `copy`), `relevance` (`replaceForProfile`, `listByProfile`, `clearProfile`, `removeFact`), `suggestions` (`create` com dedupe por título normalizado em qualquer status via índice único, `list`/`get`, `dismiss`/`accept` com `decidedAt`, `hasTitle`, `dismissedTitles`), `profiles` estendido (`list({ includeArchived })`, `archive`/`unarchive`, `clone` copiando pitch/overrides/ênfases sem carreira e com `clonedFrom`, `setActive` recusando arquivado, `updatePersonaOverrides` com `null` = apagar chave, `setCard`, `invalidateCard`, `invalidateCards` devolvendo os que estavam válidos; `update` sempre invalida o próprio cartão), fábrica de fatos com `hooks.onRemove(kind, id)` e repo `projects` (+ `counts().projects`), `jobs/tasks.ts` (`taskJobId`, `enqueueTask` idempotente com pendente e reenfileirando após terminal via `jobs.requeue`), `testing/profile-fixtures.ts` (`engineer`, `leader`, `long` + `seedFixture` pelos repos). Testes: `db/f02-repos.test.ts` (13), `jobs-tasks.test.ts` (3), `testing-fixtures.test.ts` (4), `migrate` +1 e tabelas novas, `reset` cobrindo as tabelas novas, `repos.test.ts` com `projects: 0`; core em 95 testes + 1 opcional; cobertura 97,3% linhas / 89,6% ramos. Teste antes: sim. **Desvios:** `clone` não envolve `create` numa transação externa (o `create` já abre a sua e o SQLite não aninha `begin`); a cópia das ênfases vem logo após. `ProfilePatch` do repo passou a excluir campos internos (cartão por `setCard`, persona por `updatePersonaOverrides`, ativo/arquivo por métodos próprios). **Para o M2:** `Repos` ganha `emphasis`, `relevance`, `suggestions`; `profiles.setCard(id, card)` + `invalidateCard(s)` são a base de `cards.ts`; `relevance.replaceForProfile(profileId, rows)` recebe `{ factKind, factId, score, reasons }`; `seedFixture(repos, name)` devolve todos os ids. |
| 2026-10-08 | M2 | **Lote A `packages/core/profile` entregue** (TDD, vermelho confirmado: 3 suítes sem módulo). `summary.ts` (`buildObjectiveSummary`: anos com sobreposição descontada via `yearsOfExperience`, "N sem data" à parte, nº de empresas, áreas por `detectArea`, arco de cargos cronológico com no máximo 5 paradas, nível atual pelo título corrente (`seniorityFromTitle`) ou pelas faixas de anos (`inferSeniority`, extraído de `suggestProfile`), domínios = tecnologias mais frequentes no `tech`), `relevance.ts` (`scoreFacts` com pesos base 0,2 · recência 0,25 · alvo 0,2 · métrica 0,1 · verificado 0,1 · destaque 0,15; `hidden` → nota 0; skill herda a recência da experiência mais recente em que aparece; `collectFactSets(repos)`; `byScore` determinístico), `card.ts` (`buildProfileCard` com as 8 seções, plano de corte lacunas → skills 8→3 → experiências 3→1 → pitch 3 linhas → resumo 2 linhas, `hash` sha256, `tokensEst = chars/4`, `maxChars` injetável para testar o corte). Testes: `test/profile/{summary,relevance,card}.test.ts` (19). Tamanhos: engineer 1.097 chars / 275 tokens; leader 1.023 / 256; long 1.034 / 259 (cortado: cabe no teto de 1.600). **Decisões:** F02-12 texto do cartão em pt-BR fixo (F04 decide localizar pelo `docLocale`); F02-13 "Lacunas: nenhuma conhecida" é sempre renderizada (o agente sabe que não há pendência), e é a primeira seção a cair no corte; F02-14 nível atual vem do título do cargo corrente quando ele traz a pista (sênior/pleno/júnior/staff/manager/diretor), senão das faixas por anos — para a fixture engineer os 13 anos dariam "staff" e o cargo diz "sênior". |
| 2026-10-08 | M2 | **Lote B `packages/core` entregue** (TDD, vermelho confirmado: 3 suítes sem módulo + 6 testes de funções inexistentes). `cards.ts` (`parseCard`, `isCardValid` por `card_updated_at` + `card_facts_version` ≥ `facts_version`, `rebuildCard` lê a versão antes de montar e grava cartão + relevância, `getCard` preguiçoso, `validProfileIds`, `trackInvalidation`, `invalidateUserCards`); hook de invalidação em `users.upsert` (só quando há campo alterado; `ensureId` não invalida); `persona.ts` (`buildPersona` com derivados, padrões de F02-7, overrides do perfil + extra, `null` restaura); `suggest.ts` (`suggestProfiles`: EM por títulos de liderança, PM por ≥ 2 skills de gestão ou título de PM, Tech Lead quando há liderança sem gestão formal; filtro por existentes/dispensados normalizados; `refreshHeuristicSuggestions(repos)`); `analyze-input.ts` (`buildAnalyzeInput`: ocultos de qualquer perfil fora, conquistas da experiência oculta fora, digests via `sourceFiles` + `digests`, perfis existentes, dispensados; `estimateAnalyze`); `estimate.ts` (`estimateCall`, `PROMPT_OVERHEAD.analyzeProfiles = 800`); `models.ts` (`resolveModel`). Testes: `test/profile/{cards,persona,suggest-profiles,analyze-input,estimate-models}.test.ts` (18). **Decisões:** F02-15 a validade do cartão é derivada (versão do cartão × `facts_version`), então escritas de fato não tocam a tabela `profile`; `trackInvalidation` captura a transição comparando os válidos antes e depois. F02-16 relevância gravada só na reconstrução do cartão (`rebuildCard`), nunca por escrita. F02-17 área da sugestão de EM/Tech Lead = área técnica detectada nos cargos não-liderança (padrão software); PM usa área `management`. |
| 2026-10-08 | M2 | **Lote C `packages/core` entregue** (TDD, vermelho confirmado: suíte sem módulo). `profile/tools.ts` (`createProfileTools(repos)` com os seis handlers `profile.*`, cada um validando entrada e saída pelos schemas de `shared/mcp/profile.ts`; `profile.create` sem UI grava a carreira toda em `needsResearch`, com `cloneFrom` usa `profiles.clone`; `profile.get_card` usa o ativo por padrão e lança `profile_not_found` sem ativo), exportado em `index.ts`; `PROFILE_TOOL_NAMES`. Piso de cobertura por pasta em `vitest.config.ts` (`"src/profile/**"`: 80% em linhas, funções, ramos e statements). Testes: `test/profile/tools.test.ts` (6) + **lote de cobertura** `test/profile/coverage-branches.test.ts` (9, teste depois: cobertura) para fallbacks de rótulo do cartão, cortes profundos, usuário vazio, campos opcionais da entrada da análise, cache corrompido, PM por título e Tech Lead sem gestão, resumo sem áreas, tools sem ativo. 1º run de cobertura de `src/profile/**`: 74,7% de ramos; final **99,0% linhas · 92,2% ramos · 99,3% funções**; core inteiro 97,8% / 91,4%. **M2 concluído**: `./start.sh lint` 330 arquivos, `typecheck` 10/10, `test` 9/9. Verificação manual (§6.4) de `tokensEst` × real fica para F04. |
| 2026-10-08 | M3 | **Lote A `packages/providers`** (vermelho confirmado: 3 falhas, `analyzeProfiles` inexistente): `Provider.analyzeProfiles(AnalyzeProfilesInput & { model })`; `ClaudeCodeProvider` com `prompts/analyze-profiles.md` (recrutador sênior, honesto e direto; ids de apoio só do histórico; lista vazia quando nada novo), `tools: []`, `maxTurns: 1`, `ANALYZE_PROFILES_JSON_SCHEMA` (sem `$schema`); `MockProvider` com `MOCK_ANALYZE_PROFILES` (Engineering Manager e Staff Engineer) preenchendo `supportingFactIds` com as duas primeiras experiências da entrada, e modo `errors.analyzeProfiles`. Fakes de provider dos testes do worker ganharam o método. Testes `f02-analyze.test.ts` (3); providers 28. Teste antes: sim. |
| 2026-10-08 | M3 | **Lote B `apps/worker`** (vermelho confirmado: módulo `tasks` inexistente): `tasks.ts` com `isTaskJob`, `TASK_HANDLERS`, `processTask` (tipo desconhecido → `TaskError("unknown_task")`, progresso 100 ao fim) e `processors/analyze-profiles.ts` (modelo do payload ou `resolveModel(settings, "analyze", "sonnet")`, `buildAnalyzeInput`, `provider.analyzeProfiles`, `suggestions.create` com `source = model` contando `created`/`skipped`, `usage_event` `profile.analyze`, result `{ created, skipped, model }`); `worker.ts` despacha por `data.kind` (`Worker<StageJobData \| TaskJobData>`), rótulo de etapa dos eventos = `type` para tarefas, `onStageFailed` só para etapas. Testes `tasks.test.ts` (4); worker 15. Teste antes: sim. Decisão **F02-18**: o `result` do job de análise inclui `model` para a UI mostrar qual modelo rodou. |
| 2026-10-08 | M3 | **Lote C `apps/api`** (vermelho confirmado: 10 falhas em `f02-profiles.test.ts`): `QueueAdapter.enqueueTask` (Bull e fake), `profileErrorResponse` (404/409/400 por `ProfileError.code`), `EventBus` sobre `AnyWsEvent` (= `WsEventSchema ∪ ProfileWsEventSchema`, novo no shared), rotas de §2.7 em `routes/profiles.ts` (literais `suggestion`/`suggestions`/`analyze…` antes de `/:id`; `GET /:id` adicionado; `POST` sem ativar o segundo perfil salvo `activate: true`; `PATCH` com `ProfilePatchRequestSchema` recalculando o provisório DIEESE quando salário/needsResearch mudam; `clone` honra `activate`; `card` reconstrói se inválido e devolve `valid`; `emphasis` GET resolve os fatos em uma linha com relevância e ordena por tipo/posição/data; `persona` GET/PUT; `suggestions` GET roda a heurística; `analyze/estimate` e `analyze` 202/409 `analyze_pending`), `trackInvalidation` + `profile.card_invalidated` em PATCH perfil, ênfases, persona, `PUT /api/user`, review da ingestão e `_test/facts`; dashboard com `card` (3 primeiras linhas, cache + `valid`, reconstrói só sem cache), `emphasis`, `suggestions`, `counts.projects`; `_test/seed` (fixture + onboarding concluído) e `_test/facts/:kind/:id` só com mock. Testes: `f02-profiles.test.ts` (10) + ajustes em `dashboard.test.ts`; api 46. Monorepo: lint 335 arquivos, typecheck 10/10, test 9/9. Teste antes: sim. |
| 2026-10-08 | M3 | **Prova `curl` no compose de dev com mock** (`NARNIA_PROVIDER=mock ./start.sh dev -d api worker`): reset → seed `engineer` → criar PM (inativo) → clonar para Staff (`clonedFrom`, provisório DIEESE 7300) → ênfases no PM (`updated: 2`; lista com 32 itens, 2 projetos) → cartões (engenheira 1.097 chars / 275 tokens; PM 267 tokens) → ativar PM → arquivar o ativo → `profile_active` → arquivar Staff (2 listados, 3 com arquivados) → persona `tone = cordial` → sugestões heurísticas 0 (engineer sem liderança) → estimativa `{ sonnet, 2.092 tokens, 5.165 chars }` → `POST analyze` → job `task__profile.analyze__<user>` `done` em 1 s com `{ created: 2, skipped: 0 }` (o segundo `POST` não deu 409 porque o mock conclui em milissegundos; a repetição correu e deu `{ created: 0, skipped: 2 }`, provando a idempotência por título) → 2 sugestões `source = model` (Engineering Manager, Staff Engineer) → dashboard: perfil PM, cartão `valid = false` (invalidado pela persona), ênfases `{1, 1}`, 2 sugestões, 2 projetos, uso `profile.analyze` 3.700 tokens. Stack de dev devolvida ao provider `claude-code`. |
| 2026-10-08 | M3 | **Desvios e decisões (F02-19+):** F02-19 os campos novos do dashboard (`card`, `emphasis`, `suggestions`, `counts.projects`) ficam **opcionais no contrato** até M4 adaptar os fixtures dos testes da web (a api já os devolve sempre; `apps/web` fora do escopo do M3). F02-20 `AnyWsEvent` no shared: o barramento da api aceita os eventos de perfil sem mudar `WsEventSchema` (que o cliente web e o relay do Redis validam); M4 funde na união. F02-21 `GET /api/profiles/:id` existe (não estava em §2.7). F02-22 `PATCH` com `salary: null` exige `needsResearch` com `salary`; o repo reaplica a regra (400 `validation`). F02-23 `_test/facts` cobre experience/project/skill/education/language; `achievement` fica para F10. |
| 2026-10-08 | M4 | **Lote A, base da web** (TDD; o agente anterior caiu no limite da sessão depois de escrever os testes, que foram aproveitados). Shared: `profile.switched` e `profile.card_invalidated` entram na união `WsEventSchema` (F02-20 fechada; `AnyWsEventSchema` vira alias) e `card`/`emphasis`/`suggestions`/`counts.projects` do dashboard passam a obrigatórios (F02-19 fechada). Web: `lib/api` com as 16 rotas de perfil tipadas pelos contratos (`ProfileRecord` com `createdAt`/`updatedAt`), `useJobs`/`useIngestion` discriminam por `jobId` antes de ler, hooks `useProfiles` (lista com/sem arquivados, ativo, ativar/arquivar/desarquivar/criar/clonar/renomear; `profile.switched` invalida perfis, dashboard e `["profile", id]`), `useProfileCard` (reconstruir, `profile.card_invalidated`), `useEmphasis`, `usePersona`, `useSuggestions` (recarrega ao `job.done` de `task__profile.analyze__*`) e `useAnalyzeProfiles`; `FormGuardProvider`/`useFormGuard` (fora do provider = nunca sujo); dicionário com as seções `profiles`, `suggestions`, `emphasis`, `pitch`, `persona`, `card`, `nav.profiles`, `stages.profile_analyze`, `dashboard.stats.projects`. Testes: `lib/api` (+1), `lib/ws` (+1), `app/FormGuard` (3), `hooks/useProfiles` (4; `gcTime` > 0 no setup porque a query semeada sem observador era coletada antes da asserção), `shared/f02-schemas` ajustado. Teste antes: sim. Commit `f49478b`. |
| 2026-10-08 | M4 | **Lote B, shell e lista** (TDD, vermelho confirmado em 3 arquivos). `ProfileSwitcher` no `<header>` (menu `menuitemradio` com check no ativo, só não arquivados, "+ Novo perfil" e "Gerenciar perfis", spinner "Trocando…", consulta `useFormGuard().canLeave()` antes de ativar); `FormGuardProvider` no root do router; `SideNav` com "Perfis"; `NavLink` ganhou `search` (query tipada, com fallback de `<a href>` fora do router); rotas `/perfis` (`ProfilesPage`) e `/perfis/novo` (`validateSearch` para `cloneFrom`, `suggestionId`, `title`, `seniority`, `area`, `market`; página mínima até o lote C); `ProfileList` (cartões com alvo, senioridade/área/mercado, "Cartão atualizado em" no fuso ou "ainda não gerado", badges ativo/arquivado, ações Abrir/Ativar/Renomear inline/Clonar/Arquivar/Desarquivar; filtro "Mostrar arquivados" com `placeholderData` para não piscar); `AnalyzeProfilesDialog` (estimativa ao abrir, seletor de modelo haiku/sonnet/opus com o padrão da API, confirmar → 202 e aviso "Análise iniciada"; 409 vira "Já existe uma análise em andamento"); `SuggestionList` (origem heurística/modelo com o modelo, justificativa, nº de fatos de apoio, Aceitar → `/perfis/novo?suggestionId…`, Dispensar); erros tipados mapeados em `profile-errors.ts`. **F02-24**: a lista não mostra contagem de ênfases por perfil (exigiria uma chamada por cartão); a contagem fica no dashboard (perfil ativo) e na aba Ênfases. Testes: `ProfileSwitcher` (3), `ProfilesPage` (5), `ProfilesRoutes` (2). Teste antes: sim. |
(Preencher durante a implementação: datas por marco, decisões F02-12+, diferença `tokensEst` × real.)
