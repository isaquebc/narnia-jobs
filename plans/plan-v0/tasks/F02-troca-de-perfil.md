# F02 · Troca de perfil

Entregável 2 do plan-v0. Cobre o fluxo **F2** de `../02-fluxos-do-usuario.md`: o usuário base ganha vários perfis (lentes), troca entre eles no shell, e cada perfil carrega ênfases, narrativa, dados de carreira obrigatórios e a configuração do recrutador. É pré-requisito direto de F04 (o cartão do perfil é o único contexto implícito do agente) e de F05 (o CV é gerado a partir das ênfases). Depende de F01 (tabela `profile`, dashboard, shell).

Status: **em escopo** (2026-10-07). Nada implementado. Decisões em fechamento com o dono desde 2026-10-08 (§5, §8).

---

## 1 · Objetivo e resultado esperado

Uma pessoa que concluiu o onboarding (F01) consegue:

1. criar um segundo perfil (ex.: "Project Manager") do zero ou clonando as ênfases de um perfil existente, com os dados de carreira obrigatórios preenchidos (faixa salarial, contratos, localidades, disponibilidade);
2. trocar o perfil ativo pelo seletor no topo do shell e ver dashboard, contadores e sessões mudarem imediatamente;
3. editar as ênfases do perfil: destacar, ocultar e reordenar experiências, projetos e skills, sem alterar os fatos do usuário base;
4. escrever e refinar a narrativa ("pitch") do perfil;
5. ver e ajustar a persona do recrutador derivada do perfil (área, nível, mercado, tom, rigor);
6. ver o cartão do perfil (~300 tokens) renderizado, com data de atualização, e confirmar que ele muda ao editar qualquer dado relevante;
7. aceitar ou recusar uma sugestão automática de perfil gerada a partir dos fatos já existentes (ex.: "seus 3 anos liderando squads sugerem um perfil de Engineering Manager").

### Dentro do escopo
- CRUD de perfis (criar, clonar, renomear, arquivar; sem apagar perfil ativo).
- `settings.active_profile` + seletor no shell + evento WS `profile.switched` para todas as abas abertas.
- Ênfases por perfil (`profile_emphasis`) sobre experiências, projetos, skills, formação; ordem manual.
- Narrativa/pitch editável; persona do recrutador derivada e sobrescrevível.
- Cartão do perfil: função pura de geração (`buildProfileCard`), cache em `profile.card_json`, invalidação em qualquer escrita em `user`, fatos, ênfases ou perfil.
- Sugestão heurística de perfil (`profile.suggest`, já existe em F01 para o primeiro perfil; aqui ganha "a partir de fatos existentes" e múltiplas sugestões).
- Escopo por perfil: dashboard, sessões (apenas a estrutura `chat_session.profile_id`, o chat é F04), documentos (F05), candidaturas (F07).
- **Definição** das tools MCP `profile.*` em `packages/shared` (schemas de entrada/saída) e implementação como funções puras em `packages/core`. A exposição via servidor MCP HTTP é **F04**.

### Fora do escopo (e para onde vai)
- Chat com o recrutador e hook `SessionStart` que injeta o cartão → F04.
- Geração de CV a partir das ênfases → F05.
- Edição livre dos fatos do usuário base (fora de ênfases) → F10.
- Pesquisa na internet para preencher "não sei" nos dados de carreira → F04. Aqui o campo continua aceitando `needs_research`.
- Exportar/importar perfis entre instalações → F10.

---

## 2 · Arquitetura deste entregável

### 2.1 Modelo de "lente"
```
user (fatos verificados) ──┬── profile A: emphasis(A) + pitch(A) + persona(A) + carreira(A) ──► card(A)
                           └── profile B: emphasis(B) + pitch(B) + persona(B) + carreira(B) ──► card(B)
```
- Fatos nunca são duplicados por perfil. `profile_emphasis` é uma tabela de ligação `(profile_id, fact_kind, fact_id)` com `mode` (highlight/normal/hidden) e `position`.
- Fato sem linha em `profile_emphasis` = `normal`, posição por data decrescente.
- Clonar perfil copia `profile_emphasis`, pitch e persona; dados de carreira são pedidos de novo (podem diferir: salário de PM ≠ salário de engenheiro).

### 2.2 Cartão do perfil (`buildProfileCard`)
Função pura em `packages/core/src/profile/card.ts`: `(user, profile, facts, emphasis) → { text: string; tokens_est: number; hash: string }`.

Conteúdo, nesta ordem e com limite de ~300 tokens (estimado por `chars/4`, teto rígido de 1.600 chars):
1. Identidade curta: nome, cidade/país, remoto, idiomas com nível.
2. Alvo: cargo, senioridade, área, mercado, idioma dos documentos.
3. Carreira: faixa salarial, contratos, localidades, disponibilidade (ou "a pesquisar" quando `needs_research`).
4. Pitch (até 3 linhas).
5. Top 3 experiências destacadas (empresa · cargo · período · 1 conquista com métrica).
6. Top 8 skills destacadas.
7. Lacunas conhecidas: fatos não verificados, campos `needs_research`.

Cache: `profile.card_json = { text, tokens_est, hash, built_at }`. Invalidação por trigger de aplicação: todo repo que escreve em `user`, `experience`, `achievement`, `project`, `skill`, `education`, `language`, `profile`, `profile_emphasis` chama `cards.invalidate(user_id)` (marca `card_updated_at = NULL` em todos os perfis do usuário). Reconstrução preguiçosa no próximo `profile.get_card`.

### 2.3 Persona do recrutador (derivada)
`buildPersona(profile) → { specialty, level, market, tone, rigor, language }` em `packages/core/src/profile/persona.ts`. Derivação padrão: `specialty = area + target_title`, `level = seniority`, `market`, `tone = "direto"`, `rigor = "alto"`. O usuário pode sobrescrever campos em `profile.persona_overrides_json`. O texto final do system prompt do agente é montado em F04 a partir deste objeto; aqui só existe o objeto e sua prévia na UI.

### 2.4 Troca de perfil
```
PUT /api/profiles/:id/activate ─► settings.active_profile = id ─► WS broadcast profile.switched {id}
web: TanStack Query invalida tudo com chave ["profile", *]; rotas de features recarregam
```
Nenhuma sessão de chat é encerrada ao trocar (F04 decide o que fazer com sessões do perfil anterior: continuam vivas, só saem da aba visível).

### 2.5 API
| Método e rota | Função |
|---------------|--------|
| `GET /api/profiles` · `POST /api/profiles` · `PATCH /api/profiles/:id` · `POST /api/profiles/:id/archive` | CRUD |
| `POST /api/profiles/:id/clone` | clona ênfases, pitch, persona |
| `PUT /api/profiles/:id/activate` | define ativo |
| `GET /api/profiles/:id/card` · `POST /api/profiles/:id/card/rebuild` | cartão (cache) e reconstrução forçada |
| `GET /api/profiles/:id/emphasis` · `PUT /api/profiles/:id/emphasis` | lista e substituição em lote (modo + posição) |
| `GET /api/profiles/:id/persona` · `PUT /api/profiles/:id/persona` | derivada + overrides |
| `GET /api/profiles/suggestions` | sugestões heurísticas a partir dos fatos existentes |
| `WS` | `profile.switched`, `profile.card_invalidated` |

### 2.6 Tools MCP `profile.*` (definição; exposição em F04)
| Tool | Entrada → Saída | Notas |
|------|-----------------|-------|
| `profile.list` | — → `[{id, name, target_title, is_active}]` | |
| `profile.get_card` | `{profile_id?}` → `{text, tokens_est, built_at}` | reconstrói se invalidado |
| `profile.switch` | `{profile_id}` → `{ok}` | mesmo efeito de `activate` |
| `profile.update_emphasis` | `{profile_id, items: [{kind, id, mode, position?}]}` → `{updated}` | invalida cartão |
| `profile.update_pitch` | `{profile_id, pitch}` → `{ok}` | |
| `profile.create` | `{name, target_title, seniority, area, market, doc_locale, clone_from?}` → `{id}` | carreira obrigatória fica pendente com `needs_research` até o usuário preencher |
Schemas zod em `packages/shared/src/mcp/profile.ts`; handlers puros em `packages/core/src/profile/tools.ts` recebendo o `db`.

---

## 3 · Dados deste entregável

| Tabela | Colunas (novas ou completadas) |
|--------|--------------------------------|
| `profile` (completar) | `persona_overrides_json?`, `archived_at?` (UTC), `cloned_from?`, `card_json?` passa a ter `{text, tokens_est, hash, built_at}`; `card_updated_at` NULL = inválido |
| `profile_emphasis` (nova) | `id`, `profile_id`, `fact_kind` (experience/project/skill/education/achievement), `fact_id`, `mode` (highlight/normal/hidden), `position?`, `updated_at`; único `(profile_id, fact_kind, fact_id)` |
| `settings` | chave `active_profile` → id |
| `profile_suggestion` (nova) | `id`, `user_id`, `payload_json` (cargo, senioridade, área, justificativa, fatos de apoio), `status` (new/accepted/dismissed), `created_at` |

Regras:
- Arquivar perfil ativo é bloqueado (409); o usuário troca antes.
- `profile_emphasis` órfã (fato apagado) é removida por `ON DELETE CASCADE` lógico nos repos.
- `fact_id` referenciado só pode pertencer ao `user_id` do perfil (validação no repo).
- Dados de carreira (`salary_*`, `contract_types_json`, `locations_json`, `available_from`) obrigatórios por perfil, com `needs_research_json` para "não sei" (mesma regra de F01).

---

## 4 · Layouts deste entregável

| Tela | Componentes | Estados a cobrir |
|------|-------------|------------------|
| Shell: `ProfileSwitcher` (topo) | lista de perfis com cargo-alvo, check no ativo, "+ novo perfil", "gerenciar perfis" | 1 perfil · N perfis · trocando (spinner) · perfil arquivado oculto |
| Perfis (lista) | `ProfileList` com cartões (nome, alvo, nº de ênfases, última atualização do cartão), ações renomear/clonar/arquivar/ativar | vazio (impossível após F01) · com arquivados (filtro) |
| Novo perfil (modal/página) | `ProfileForm` (igual F01 passo 5) + `CloneFromSelect` + bloco Carreira obrigatório com "não sei" | do zero · clonando · validação |
| Perfil › Ênfases | `EmphasisBoard`: três colunas ou abas (Experiências, Projetos, Skills), cada item com toggle destacar/normal/ocultar e drag para reordenar; prévia lateral do cartão atualizando | sem ênfases · com ocultos · reordenando · salvando |
| Perfil › Narrativa | `PitchEditor` (textarea 3–5 linhas, contador) + sugestões do cartão | vazio · editado |
| Perfil › Recrutador | `PersonaPreview` (derivada) + `PersonaOverrides` (especialidade, nível, mercado, tom, rigor, idioma) | padrão · com overrides |
| Perfil › Cartão | `ProfileCardView` (texto, tokens estimados, "atualizado há X", botão reconstruir) | válido · invalidado (aviso) · reconstruindo |
| Sugestões | `SuggestionBanner` no dashboard ("Detectamos um possível perfil de ...") com aceitar (abre Novo perfil pré-preenchido) ou dispensar | nenhuma · 1+ |

Regras de UI: trocar perfil nunca perde formulário não salvo (confirmação); cartão mostra o fuso do usuário em "atualizado há"; todos os textos via `t()`.

---

## 5 · Decisões em aberto deste entregável

| # | Decisão | Opções | Padrão proposto |
|---|---------|--------|-----------------|
| F02-1 | Invalidação do cartão | hooks nos repos (aplicação) · triggers SQLite · recalcular sempre · fila com merge | **Decidida 2026-10-08 (dono): hooks nos repos** + reconstrução preguiçosa na leitura, aproveitando `facts_version` para fatos (só usuário, perfil e ênfases precisam de hook explícito). A página do perfil atual mostra o estado do cartão ("atualizado em …" ou "desatualizado") com botão **Atualizar cartão** (`POST /api/profiles/:id/card/rebuild`). Fila com merge descartada para o cartão (função pura de milissegundos, sem conflito possível); a ideia foi guardada em F05 §2.5 e F10 §2.5. |
| F02-2 | Limite do cartão | ~300 tokens com corte por prioridade · sem limite | **Decidida 2026-10-08 (dono): ~300 tokens** (teto 1.600 chars), cortando lacunas → skills além das 8 → experiências além das 3. Acréscimos: (a) seção **Resumo objetivo** (2–3 linhas, heurística: anos totais, empresas, áreas, arco de cargos, nível, domínios) logo após a identidade e **nunca cortada**; versão escrita pelo modelo fica para F04 (cache no perfil, refeita pelo botão de atualizar, custo mostrado antes); (b) `profile/relevance.ts`: nota por fato e por perfil (recência, ênfase, métrica, verificação, aderência ao cargo-alvo), gravada em tabela auxiliar pelos mesmos hooks de F02-1; escolhe top-3/top-8 do cartão e ordena a busca; (c) busca que não lê tudo: FTS5 + `fact.search`/`fact.get`/`fact.timeline` com linhas de 30–40 tokens entram em **F04**; sem embeddings nesta escala. |
| F02-3 | Ênfase em conquistas | granularidade por conquista · só por experiência | **Decidida 2026-10-08 (dono): por experiência em F02**; a ênfase por conquista é **obrigatória em F05** (registrada lá). Preparação aqui: `profile_emphasis.fact_kind` já aceita `achievement` no schema e na validação do repo, e `buildProfileCard` escolhe a conquista exibida pela relevância; só a UI do quadro de ênfases fica por experiência. |
| F02-4 | Reordenação | drag-and-drop (`@dnd-kit`) · botões subir/descer | **Decidida 2026-10-08 (dono): `@dnd-kit`** com botões subir/descer como apoio (teclado e testes), carregado por importação dinâmica só na página de ênfases (bundle, F01-56). Reordenação assistida pelo modelo ("Reordenar com <modelo>": Haiku/Sonnet/Opus/Fable, estimativa antes, prévia, aceitar/desfazer) registrada na issue [#1](https://github.com/isaquebc/narnia-jobs-helpper/issues/1). |
| F02-5 | Sugestões de perfil | só heurística local · heurística + modelo | **só heurística** (zero tokens); o recrutador pode sugerir no chat em F04 |
| F02-6 | Arquivar vs apagar | arquivar apenas · apagar com cascata de documentos/candidaturas | **arquivar**; apagar vai para F10 com a gestão de dados |
| F02-7 | Persona: tom e rigor | enum fixo (direto/cordial × alto/médio) · texto livre | **enum fixo** (previsível para o prompt em F04) |

---

## 6 · O que precisa estar coberto para o F02 funcionar

### 6.1 Pré-requisitos e dependências
1. F01 concluído: `user`, `profile`, fatos, shell, dashboard, i18n, `time.ts`, WS.
2. Migration `0002_profiles.sql`: completar `profile`, criar `profile_emphasis`, `profile_suggestion`.
3. `packages/shared`: schemas de `ProfileEmphasis`, `Persona`, `ProfileCard`, `ProfileSuggestion`, tools `profile.*`.
4. `packages/core`: `profile/card.ts`, `profile/persona.ts`, `profile/suggest.ts` (estender), `profile/tools.ts`, repos com `cards.invalidate`.
5. `apps/api`: rotas de §2.5, broadcast WS.
6. `apps/web`: `ProfileSwitcher`, páginas de perfil, `EmphasisBoard`, `SuggestionBanner`.
7. Fixtures: usuário com 6 experiências, 4 projetos, 20 skills, 2 formações; dois perfis (engenheiro, PM).

### 6.2 Testes unitários (Vitest) · obrigatórios
**`packages/core`**
- `buildProfileCard`: respeita a ordem das seções; nunca passa de 1.600 chars (fixture com 20 experiências e 60 skills); corta na prioridade definida (F02-2); inclui "a pesquisar" para `needs_research`; mesmo input → mesmo `hash`; experiências `hidden` não aparecem; `highlight` vem antes de `normal`.
- Invalidação: escrever em cada uma das 9 tabelas listadas em §2.2 zera `card_updated_at` de todos os perfis do usuário; `get_card` reconstrói e grava `built_at` em UTC.
- `profile_emphasis`: upsert em lote substitui o conjunto; rejeita `fact_id` de outro usuário; posição é renumerada sem buracos; fato apagado remove ênfase.
- `clone`: copia ênfases, pitch e overrides; não copia carreira; `cloned_from` preenchido.
- `buildPersona`: derivação padrão para 3 perfis fixture; overrides sobrepõem só os campos informados.
- `profile.suggest` (estendido): com fatos de liderança sugere EM/PM; não repete sugestão já dispensada; retorna justificativa com ids de fatos.
- Tools `profile.*`: cada handler valida entrada pelo schema zod e devolve saída no schema; `profile.switch` em perfil arquivado → erro tipado.

**`packages/shared`**
- Schemas de tools: snapshot do JSON Schema; `ProfileCard.tokens_est` é inteiro ≥ 0.

**`apps/api`**
- Rotas: criar, clonar, ativar, arquivar (409 se ativo), ênfases em lote, persona, cartão (cache hit/miss por `card_updated_at`), sugestões.
- WS: `activate` emite `profile.switched` uma vez por cliente; escrita em fato emite `profile.card_invalidated`.

**`apps/web`**
- `ProfileSwitcher`: lista, ativa, mostra spinner, invalida queries `["profile", *]`.
- `EmphasisBoard`: toggle de modo, reordenação por teclado e por drag, salvar em lote, prévia do cartão atualiza após salvar.
- `ProfileForm` (novo perfil): obrigatórios de carreira, "não sei", clonar pré-preenche.
- `SuggestionBanner`: aceitar abre formulário pré-preenchido; dispensar some e não volta.

### 6.3 Testes e2e (Playwright, Chromium) · obrigatórios
Rodam sobre o compose com `NARNIA_PROVIDER=mock` e um banco semeado por F01 (fixture "engenheiro com CV").
- **E2E-01 criar e trocar**: criar perfil "Project Manager" do zero com carreira preenchida → seletor mostra 2 → ativar PM → dashboard muda (cartão e contadores) → recarregar página mantém PM ativo.
- **E2E-02 clonar**: clonar "Eng. Software" para "Staff Engineer" → ênfases iguais → carreira vazia pede preenchimento → salvar.
- **E2E-03 ênfases**: ocultar uma experiência e destacar outra no perfil PM → cartão do PM reflete; cartão do perfil engenheiro não muda.
- **E2E-04 invalidação**: editar uma conquista (via tela de revisão de F01 ou API) → ambos os cartões mostram "atualizado" com nova data após abrir.
- **E2E-05 arquivar**: tentar arquivar o ativo → bloqueado com mensagem; trocar e arquivar → some do seletor; "mostrar arquivados" lista.
- **E2E-06 sugestão**: banco semeado com fatos de liderança → banner aparece → aceitar → formulário pré-preenchido → criar → banner some.
- **E2E-07 duas abas**: trocar perfil na aba A → aba B recebe `profile.switched` e atualiza o seletor.
- **E2E-08 fuso**: "atualizado há" e `built_at` coerentes com `America/Sao_Paulo`.

### 6.4 Teste manual com provider real (antes de fechar F02)
Não há chamada ao modelo em F02. Teste manual: ler o cartão de 3 perfis reais e avaliar se um recrutador entenderia o alvo em 20 segundos; medir `tokens_est` contra contagem real do SDK em F04 (registrar aqui a diferença).

### 6.5 Definição de pronto
- Testes de 6.2 e 6.3 verdes na CI; cobertura ≥ 80% em `core/profile`.
- Cartão de qualquer perfil ≤ 1.600 chars em todas as fixtures.
- Nenhuma escrita em fatos deixa cartão desatualizado (teste de invalidação por tabela).
- `../02`, `../03 §4–5`, `../04 §B` atualizados com o que mudou.

---

## 7 · Riscos específicos
| Risco | Mitigação |
|-------|-----------|
| Cartão ficar genérico demais com o corte de 300 tokens | prioridade de corte explícita (F02-2); teste manual 6.4; F04 pode pedir detalhes por tool |
| Invalidação esquecida em um repo novo | lista de tabelas em §2.2 é a fonte dos testes; lint customizado que exige `cards.invalidate` em repos de fatos |
| Muitos perfis tornam o seletor confuso | arquivamento; ordenação por último uso |
| Drag-and-drop frágil em e2e | testes de reordenação por teclado; drag só em um cenário |

## 8 · Registro de execução
| Data | Marco | O que aconteceu |
|------|-------|-----------------|
| 2026-10-08 | — | **F02-1 decidida pelo dono**: hooks nos repositórios (uma chamada `cards.invalidate` ao final de cada escrita em usuário, perfil e ênfases; fatos cobertos por `facts_version`), reconstrução na leitura, e a página do perfil atual mostra o estado do cartão com botão de atualizar. A alternativa de fila com merge de atualizações, página de processos e escala de workers foi considerada arquitetura demais para um dado derivado barato e foi registrada como infraestrutura para F05 (jobs caros) e F10 (configuração). |
| 2026-10-08 | — | **F02-2 decidida pelo dono**: 300 tokens; preocupação registrada: busca e gasto de tokens são a maior fraqueza potencial do projeto. Respostas: resumo objetivo fixo no cartão, relevância pré-calculada em F02, FTS5 e tools de busca compactas em F04, regra no prompt do recrutador de buscar antes de listar, uso por tool no medidor (F10). |
| 2026-10-08 | — | **F02-3 decidida pelo dono**: por experiência em F02; por conquista entra obrigatoriamente em F05 (dados preparados aqui, interface lá). |
| 2026-10-08 | — | **F02-4 decidida pelo dono**: `@dnd-kit` + botões, importação dinâmica; botão "Reordenar com <modelo>" vira a issue #1 do repositório. |
(Preencher durante a implementação: datas, decisões tomadas, diferença `tokens_est` × real.)
