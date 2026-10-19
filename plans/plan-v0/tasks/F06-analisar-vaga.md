# F06 · Analisar vaga

Entregável 6 do plan-v0. Cobre a feature **#2** de `../02-fluxos-do-usuario.md §F5`: a pessoa cola a descrição de uma vaga (ou a URL) e recebe uma análise honesta de aderência ao perfil ativo, com lacunas sem evidência, riscos, palavras-chave ausentes e perguntas prováveis, pronta para virar candidatura, CV direcionado (F05) ou simulação de entrevista (F08).

Status: **em escopo, replanejada pelo dono em 2026-10-14** (a F06 vem antes da F05). Decisões F06-1 a F06-17 fechadas (§5); F06-16 e F06-17 fechadas depois da revisão do código; requisitos novos em §1.1 a §1.4; marcos em §6.0. **Fechada pelo dono em 2026-10-15** (M1 a M7 e as correções dos testes do dono, §8). O roteiro formal do §6.4 (10 vagas) foi substituído pelos testes do dono com vagas reais. Nada pendente nesta task.

---

## 1 · Objetivo e resultado esperado

> O texto original desta seção (até "Fora do escopo") é de 2026-10-07. Onde ele fala em candidatura criada pela análise, cache por perfil ou tools `job_posting.*`, valem §1.1 a §1.4, §2 e §5 (replanejamento e revisão de 2026-10-14).

Com F01 e F04 prontos, a pessoa consegue:

1. abrir "Analisar vaga", colar a descrição **ou** uma URL (o servidor busca e extrai o texto; se falhar, pede para colar);
2. escolher se a análise cria uma candidatura nova ou se liga a uma existente (F07) e ver a estimativa de tokens;
3. disparar a análise como job em segundo plano e acompanhá-la na bandeja;
4. ler o resultado: fit geral (%), o que atende com evidência, lacunas (nenhuma evidência), riscos (ex.: senioridade pedida acima da declarada, localidade/contrato incompatíveis com as preferências obrigatórias), palavras-chave ATS ausentes, perguntas prováveis;
5. clicar em "Gerar CV para esta vaga" (F05) ou "Simular entrevista" (F08) já parametrizados;
6. no modo B, pedir `/narnia-jobs:analisar-vaga` colando o texto e receber o resumo + link da UI.

### Dentro do escopo
- Captura da vaga: colar texto; buscar URL com extração de texto no servidor (sem executar JS), com fallback para colar.
- Heurística **local, sem tokens**: extração de palavras-chave/tecnologias da vaga e cruzamento com as skills e experiências do usuário (normalização de nomes já existente em `core`).
- Skill `plugin/skills/analisar-vaga` + tools `job_posting.*` e `analysis.*` no MCP (F04).
- Resultado estruturado (`JobAnalysis`, schema em `packages/shared`) salvo e ligado a uma candidatura.
- Cache: mesma vaga (hash do texto normalizado) + mesmo perfil + mesma versão dos fatos → reaproveita a análise sem tokens.
- Página L6 de `../05-layouts.md`; ações para F05/F08.
- Job `job_posting.analyze` com etapas persistidas.
- **Perfil mais indicado (requisito do dono, 2026-10-11):** a análise compara a vaga com **todos os perfis não arquivados** (cartões e relevância da F02), devolve o fit de cada um e recomenda o melhor com justificativa; oferece trocar o perfil ativo ou criar um perfil sugerido; disponível pela tela e pelo chat (F04).
- A vaga analisada fica salva e é a entrada do CV com vaga alvo (F05) e da candidatura (F07).

### Fora do escopo (e para onde vai)
- Kanban, etapas e agenda da candidatura → F07 (F06 só cria/vincula a candidatura mínima: empresa, cargo, vaga).
- Geração do CV direcionado → F05; simulação → F08; carta → F09.
- Busca ativa de vagas em job boards, scraping em massa, login em sites → fora do projeto (risco legal e de bloqueio).
- Pesquisa salarial na internet pelo recrutador → já coberta em F04 (WebSearch); F06 apenas usa o que o perfil tem.
- Comparação entre várias vagas (ranking) → fase posterior, fora do plan-v0.

### 1.1 · Requisitos do dono (2026-10-14)

**Mudança de planos: recrutador global.** O agente recrutador deixa de ser de um perfil específico e passa a ser **global**. Ele pode chamar um **recrutador especializado** (subagente, com o contexto de um perfil ou área), que faz análises dirigidas: aderência a uma vaga, recomendação de estudos, o que melhorar no currículo.

**Sessão da análise.** Quando o usuário pede a análise de uma vaga, o chat abre uma **sessão nova** com o título `<empresa contratante>/<empresa cliente, se houver> - <role da vaga>` (ex.: `Accenture/Itaú - Backend Engineer`; sem cliente, `Nubank - Backend Engineer`).

**Dados extraídos de cada vaga (além dos já descritos):**

| Campo | Observação |
|-------|------------|
| Empresa contratante | quem contrata |
| Empresa cliente | onde a pessoa vai trabalhar (consultoria, terceirização); opcional |
| Cargo e senioridade | ex.: "Desenvolvedor Sênior" |
| Role | a função da vaga (ex.: Backend, Engineering Manager) |
| Local | cidade e estado |
| Tipo de contratação | CLT, PJ, cooperado, estágio, temporário… |
| Moeda | da faixa salarial citada |
| Benefícios | lista |
| Responsabilidades | lista |
| Skills obrigatórias | lista |
| Skills diferenciais | lista |
| Resumo da empresa contratante | texto curto |
| Link da vaga | URL |
| Link do site da empresa | URL |
| Job description | texto integral, editável pelo usuário |
| Data de publicação | data |
| Contatos | lista: nome, origem (LinkedIn, WhatsApp, e-mail), e-mail (opcional), telefone (opcional); todas as pessoas com quem o usuário falou |

### 1.2 · Comportamento

- **Candidaturas anteriores:** a análise procura se o usuário já se candidatou à mesma empresa e lista essas candidaturas. Se já se candidatou à **mesma role na mesma empresa**, mostra um **alerta de bloqueio**.
- **Dados aos poucos:** nem tudo chega junto. Tudo o que chegar é salvo no banco, e os campos obrigatórios são mínimos; a vaga é completada ao longo das conversas.
- **Keywords: heurística + modelo.** A heurística sem tokens extrai palavras-chave e é comparada com a extração do modelo; **outro agente faz o merge**. A UI mostra a origem de cada dado (heurística, modelo ou os dois) e destaca quando a heurística foi confirmada pelo modelo.
- **Análise com o usuário inteiro:** considera **todas** as skills e habilidades do usuário, não um recorte. Pode buscar as palavras-chave da JD dentro dos dados do usuário para economizar tokens e tempo.
- **Salvar a JD** ao fim da análise (sempre; ver F06-7).
- **Botão na mensagem do agente:** "Criar CV para esta vaga" (em breve, desabilitado até a F05).
- **Prompts no Phoenix:** todo prompt da F06 é versionado no Phoenix e vive lá, com avaliações e **bloqueadores de regressão**. Toda criação ou alteração de prompt passa por avaliação no Phoenix, de forma persistente: o usuário vê o rastreio com entradas, saídas e o valor que a requisição custaria pela API.

### 1.3 · Acesso

- Item **Vagas** no menu esquerdo → página com todas as vagas analisadas em cards: empresa contratante, cliente (se houver), cargo e senioridade, role e data de criação no sistema.
- Clique no card → **página da vaga**, com toda a extração; todos os campos preenchidos e **editáveis**, com tratamento prévio quando necessário (normalização de datas, moeda, links).
- A **job description** também é editável pelo usuário e salva.
- **Notas da vaga:** usuário e recrutador adicionam e editam notas. Quando o recrutador altera uma nota escrita por um humano, a alteração só vale depois de **confirmada na bandeja**.

### 1.4 · Efeito nas regras anteriores

- "Candidatura automática" (antigo F06-7) sai: salvar a vaga **não** é candidatar-se. Candidatar-se é aplicar na vaga, provavelmente depois de ter um CV (F05/F07).
- A regra "`job_posting` é imutável" (§3) cai: a vaga é editável e cresce aos poucos. A análise continua com histórico (reanálise cria novo registro).
- O "perfil mais indicado" (2026-10-11) passa a ser feito pelo recrutador global, que compara os perfis e chama o especializado.

---

## 2 · Arquitetura deste entregável

> Reescrita em 2026-10-14 depois da revisão contra o código (§2.0). Onde o texto antigo divergia do código ou das decisões F06-1 a F06-15, vale este.

### 2.0 · Revisão contra o código (2026-10-14)

| Premissa do plano antigo | O que o código mostra | Consequência |
|---|---|---|
| Dicionário de tecnologias "já usado para normalizar skills em F01/F03" | não existe; `normalizeSkillName` só faz trim, minúsculas e espaços (`packages/core/src/db/repos/facts.ts:88`); o mais próximo é `targetTerms` da relevância da F02 (`packages/core/src/profile/relevance.ts:95`) | dicionário com aliases e n-gramas é trabalho novo (M3) |
| `settings.facts_version` a criar | já existe, com ponto único de incremento `settingsRepo.bumpFactsVersion` (`packages/core/src/db/repos/settings.ts:30`), chamado em toda escrita de fato | só `job_analysis.facts_version` é novo |
| `fact_ids[]` como evidência | não há tabela genérica de fato; o id só é único junto com o tipo (`experience`, `skill`, `project`, `education`, `language`, `achievement`), como em `profile_fact_relevance` | evidência vira `{kind, id}[]` |
| Tools `skill.list`, `experience.list/get` | os nomes reais são `evidence.skill.list`, `evidence.experience.list/get` (`packages/core/src/chat/tools.ts:81`); `fact.search` e `profile.get_card` existem | §2.4 usa os nomes reais |
| "Preferências obrigatórias" do perfil (F01) | não há esse conceito; as preferências estão em `user` (`remote_pref`, `relocation_json`, `work_auth_json`) e em `profile` (salário, `contract_types_json`, `locations_json`, `seniority`) | conflitos viram **riscos** calculados dessas colunas, sem bloqueio |
| `@mozilla/readability`, `linkedom`, `undici` disponíveis | nenhum está em `package.json`; o `fetch` do Node 22 já é undici | adicionar `@mozilla/readability` e `linkedom` ao `api`; usar o `fetch` nativo |
| Módulo `packages/core/jobs/` | `packages/core/src/jobs/tasks.ts` já é a fila (BullMQ) e a tabela `job` é o espelho da fila | o domínio da vaga vai para `packages/core/src/postings/`; tools `posting.*` (não `job_posting.*`, para não confundir com `job.status`/`job.list`) |
| Job com "etapas persistidas" genéricas | não há mecanismo genérico; tarefas encadeadas com `enqueueTask` e progresso por `ctx.progress` até a bandeja (`ActivityTray`) | a análise é uma tarefa nova na fila `extract`, com `progress` por etapa e rótulos em `STAGE_ORDER` |
| Sessões por perfil | `chat_session.profile_id` é `NOT NULL` com `on delete cascade` (`0006_chat_discovery.sql`); repo, rotas, `useChatSessions`, `ChatNav`, `ChatPage`, painel de contexto, tools MCP, `TurnTrace` e o hook do modo B dependem dele | M1 reconstrói a tabela (`profile_id` opcional, `on delete set null`) e troca todos esses pontos |
| Subagente | não há opção `agents` no `query` do modo A (`packages/providers/src/claude-code/claude-code-provider.ts:292`); a tool Agent está bloqueada por `tools`/`allowedTools`/`canUseTool`; `plugin/agents/recrutador.md` é só template do system prompt | subagente novo em `plugin/agents/` (o modo B lê nativo) e, no modo A, a opção `agents` montada do mesmo arquivo, com a tool Agent liberada só para ele |
| Teto conta só sessões vivas (F06-15) | já implementado (`ensureCapacity`, `apps/api/src/chat/session-manager.ts:227`) | nada a fazer |
| Título da sessão | sessão criada com `title` explícito não passa pelo nome do Haiku (`session-manager.ts:426`) | a sessão da análise já nasce com `empresa/cliente - role` |
| Botão na mensagem | `ChatMessage` não tem campo de ação; a única ação é `runId` em `toolCalls`; a regra 7 da persona proíbe "marcadores nem botões" | o botão é **derivado da tool** `analysis.save` na mensagem (como `RunLinks`), sem o modelo escrever botão; regra 7 intacta |
| Confirmação na bandeja | a bandeja só mostra jobs e ingestões paradas; aprovação de mudança proposta hoje é Pendências (notificações) ou a revisão da ingestão | mecanismo novo; ver F06-17 |
| Prompts "vivem no Phoenix" | AV-4 (F04-avaliações): o repositório é a fonte e o app nunca lê prompt do Phoenix; a sincronização versiona por hash | ver F06-16 |
| Bloqueador de regressão | `evals --strict` só falha abaixo de 100 %; não compara com a rodada anterior; a CI não roda evals | mecanismo novo de linha de base (M1) |
| Custo "como se fosse API" | já vai ao span como `narnia.cost_usd` (o `total_cost_usd` do SDK); o mock reporta 0 | conferir se o Phoenix mostra o custo nativo; senão, mapear para os atributos de custo do OpenInference |
| Modelo por tarefa | `resolveModel(settings, key)` existe (`packages/core/src/models.ts`), mas não há tela; só o modelo do chat, com lista fixa | seção "Modelos" em Configurações e lista de modelos compartilhada |
| Diff entre vagas | não há componente de diff; o `Dialog` tem 560 px | variante larga do `Dialog` e componente de diff novos |
| Candidatura mínima (`application.create_minimal`) | não existe tabela `application` | sai da F06 (F06-7, F06-11); a F07 cria |

### 2.1 Pipeline
```
chat ("analisa esta vaga") ou página Vagas
  └─► recrutador geral ─► sessão nova (categoria `job`, título empresa/cliente - role)
texto colado ──────────────────────────────┐
URL ─► fetch (api, sem JS, anti-SSRF, robots) ─► Readability ─┴─► posting (rascunho)
posting ─► heurística local (0 tokens): keywords + aliases, n-gramas, senioridade, seções, contrato, moeda, benefícios
        ─► extração (Haiku): campos de §1.1
        ─► merge (agente; Haiku por padrão): heurística × modelo, com a origem de cada campo
        ─► hash de identidade (F06-2) ─► coincidiu? ─► comparação (Haiku) ─► % de duplicata ─► modal de diff (F06-9)
        ─► vaga salva (sempre, F06-7)
vaga + todos os perfis ─► busca local das keywords nos fatos do usuário (FTS `fact_fts`, 0 tokens)
                      ─► recrutador especializado (subagente, Sonnet), um perfil por vez: fit, atende {kind,id}, lacunas, riscos, perguntas
                      ─► recrutador geral: perfil recomendado ─► analysis.save ─► mensagem com "Criar CV para esta vaga (em breve)"
```
- **O que vai ao modelo (F06-4):** todas as skills e habilidades do usuário (completas), o resumo de cada experiência, a vaga por seções e a pré-análise local (keywords que já casaram com fatos). Os detalhes de uma experiência vêm sob demanda pelas tools `evidence.*`.
- **Honestidade:** "atende" exige `evidence: {kind, id}[]` existentes; "lacuna" exige `evidence_checked: true` depois de `fact.search` sem resultado. O schema e `analysis.save` validam.

### 2.2 Captura de URL (no `api`)
| Regra | Valor |
|-------|-------|
| Métodos | `fetch` nativo (undici), `GET` único, até 3 redirects verificados um a um, só `http(s)`; bloqueia IPs privados, loopback e link-local após a resolução de DNS (anti-SSRF) |
| User-agent | `narnia-jobs/<versão> (+repo URL)`; respeita `robots.txt` (se `Disallow`, não busca e pede para colar) |
| Limites | 2 MB de HTML, timeout 15 s, 1 tentativa |
| Extração | JSON-LD `JobPosting` da página quando existe (cargo, empresa, local, contrato e descrição em linhas); senão `@mozilla/readability` + `linkedom` → texto principal, título, `og:`; página de bloqueio/captcha não vira vaga (`blocked_page`) |
| Navegador (2026-10-15) | fetch simples falhou (site recusou, timeout, página só-JS ou bloqueio) → Chromium headless no serviço `browser` (rede só com o api; `playwright-core` 1.58.0 nos dois lados, `NARNIA_BROWSER_WS`); toda requisição da página passa pelo anti-SSRF; sem imagens, mídia, fontes, service workers e WebSocket; clica uma vez num "aceitar cookies" visível; se apresenta como Chrome comum (sem "HeadlessChrome", que CDNs anti-robô derrubam); com navegador disponível o fetch simples desiste em 8 s. robots.txt e endereço interno nunca chegam ao navegador |
| Texto da página | HTML do artigo em linhas (blocos, títulos e itens); vaga dividida em blocos (o Readability fica com um só) usa o `<main>` inteiro, sem menu, scripts e formulários, quando o Readability perde a seção de requisitos ou cobre menos da metade; título pelo `og:title` ou `<h1>` |
| Resultado | nada funcionou → "não consegui extrair, cole o texto" |
| Privacidade | HTML bruto em `/data/snapshots/postings/<id>.html`; não vai ao modelo |

### 2.3 Heurística local (`packages/core/src/postings/`)
- **Dicionário novo** (`postings/dictionary/`): termos canônicos com aliases (pt-BR e en-US: "ReactJS" → "React", "Node" → "Node.js"), categoria (linguagem, framework, nuvem, prática, idioma, soft skill) e arquivo versionado fácil de ampliar; mais n-gramas da vaga com lista de ruído ("equipe dinâmica").
- O casamento com o usuário usa o dicionário sobre `skill.name_normalized`, `experience.tech_json` e projetos, e o FTS (`fact_fts`) para o resto. A normalização de `normalizeSkillName` não muda.
- Senioridade, seções (obrigatórias × diferenciais), tipo de contratação, moeda, benefícios e local por regex e cabeçalhos.
- **Role normalizada (F06-12):** lista curada de funções (Backend, Frontend, Full Stack, Mobile, Dados, DevOps/SRE, QA, Segurança, Produto, Design, Engineering Manager, Tech Lead…), a mesma usada pela extração do modelo.
- Riscos a partir das preferências reais (`user.remote_pref`, `relocation_json`, `profile.contract_types_json`, `locations_json`, faixa salarial): presencial × remoto, cidade, contrato, salário citado × pretendido.
- Saída: `PreAnalysis` com cada keyword marcada `heuristic`; o merge acrescenta `model` ou `both` (F06-6).

### 2.4 Tools MCP e agentes
| Tool | Função |
|------|--------|
| `posting.create({text?, url?, fields?})` | cria a vaga (rascunho), roda a heurística, devolve `posting_id`, `pre_analysis` e `duplicate_candidates[]` |
| `posting.update({id, fields})` | completa campos aos poucos (§1.2); o usuário e o recrutador usam |
| `posting.get(id)` · `posting.list()` · `posting.search({company?, role?})` | reabrir; achar a vaga ao falar dela no chat |
| `posting.contact_add/update` | contatos (nome, origem, e-mail, telefone) |
| `posting.note_add/update` | notas; o recrutador alterando nota humana gera **pedido de confirmação** (F06-17) |
| `profile.list`, `profile.get_card`, `evidence.*`, `fact.search` (existentes) | evidências |
| `analysis.save(posting_id, JobAnalysis)` · `analysis.get` · `analysis.list(posting_id)` | grava (valida `{kind,id}`), histórico |

- **Recrutador geral** (`plugin/agents/recrutador.md`, reescrito): persona global; recebe a lista de perfis (cartões curtos) em vez de um `{{card}}` só.
- **Recrutador especializado** (`plugin/agents/recrutador-especializado.md`, novo): subagente chamado com `profile_id`; lê o cartão pela tool `profile.get_card` (subagente não recebe placeholders). No modo B o Claude Code carrega nativo; no modo A o `api` monta a opção `agents` do SDK a partir do mesmo arquivo e libera a tool Agent só para esse subagente.
- **Skill `analisar-vaga`** do especializado; prompts estruturados novos no provider: `postingExtract`, `postingMerge`, `postingDuplicate`.

### 2.5 `JobAnalysis` (`packages/shared/src/schemas/analysis.ts`)
| Bloco | Conteúdo |
|-------|----------|
| `profiles[]` | por perfil: `profile_id`, `fit` 0–100, justificativa, `confidence` |
| `recommended_profile_id` | com justificativa |
| `matches[]` | requisito, `evidence: {kind, id}[]` (≥ 1), força (forte/parcial), `source` (heuristic/model/both) |
| `gaps[]` | requisito, `severity`, `evidence_checked: true`, sugestão |
| `risks[]` | tipo (senioridade, localidade, contrato, salário, idioma, setor), descrição, `source` |
| `ats_keywords_missing[]` | termo, onde caberia |
| `likely_questions[]` | pergunta, por quê, evidência que ajuda |
| `seniority` | pedida × declarada |
| `meta` | modelos, tokens, custo equivalente, `posting_hash`, `posting_updated_at`, `facts_version`, `created_at` (UTC) |

### 2.6 Tarefas e validade
| Tarefa (fila `extract`) | Etapas (`ctx.progress`) |
|-----|--------|
| `posting.extract` | `fetching?` → `heuristics` → `extracting` → `merging` → `dedupe` → `saved` |
| `posting.analyze` | `searching` → `analyzing` (um perfil por vez) → `saving` |
- **Validade (F06-10):** a análise guarda `facts_version` e `posting_updated_at`; se algum mudou, aparece "seus dados mudaram desde a análise de <data>" com **reanalisar**. Nada reanalisa sozinho.

### 2.7 API
| Método e rota | Função |
|---------------|--------|
| `POST /api/postings` `{text?, url?, fields?}` | cria e enfileira `posting.extract` |
| `GET /api/postings` · `GET /api/postings/:id` · `PATCH /api/postings/:id` | lista, detalhe, edição (incluindo a JD) |
| `POST /api/postings/:id/duplicate-decision` `{action: update|new|cancel, target_id?}` | resposta do modal da F06-9 |
| `POST|PATCH /api/postings/:id/contacts` · `…/notes` | contatos e notas |
| `POST /api/postings/:id/analyze` | enfileira `posting.analyze` (também a reanálise) |
| `GET /api/postings/:id/analyses` | histórico de análises |
| `GET|PUT /api/settings/models` | modelo por tarefa (F06-5, F06-13) |

---

## 3 · Dados deste entregável

Migrações novas a partir de `0011`.

| Tabela | Colunas principais |
|--------|--------------------|
| `chat_session` (reconstruída, M1) | `profile_id` passa a opcional com `on delete set null`; categoria nova `job`; `posting_id` (fk, nulo) |
| `posting` | `id`, `company` (único obrigatório junto com `role` ou `title`), `client?`, `title?` (cargo), `role?` (normalizada), `seniority?`, `city?`, `state?`, `contract_type?`, `currency?`, `salary_min?`, `salary_max?`, `benefits_json`, `responsibilities_json`, `skills_required_json`, `skills_nice_json`, `company_summary?`, `posting_url?`, `company_url?`, `jd_text?`, `published_at?`, `identity_hash`, `field_sources_json` (heurística/modelo/ambos/usuário por campo), `pre_analysis_json`, `raw_path?`, `created_at`, `updated_at` |
| `posting_contact` | `id`, `posting_id`, `name`, `origin` (linkedin/whatsapp/email/outro), `email?`, `phone?`, `created_at` |
| `posting_note` | `id`, `posting_id`, `author` (user/recruiter), `body`, `pending_body?` (edição do recrutador aguardando confirmação), `created_at`, `updated_at` |
| `job_analysis` | `id`, `posting_id`, `analysis_json`, `recommended_profile_id?`, `facts_version`, `posting_updated_at`, `models_json`, `usage_json`, `chat_session_id?`, `created_at` |
| `settings` | chaves novas `models.posting_extract`, `models.posting_merge`, `models.posting_duplicate`, `models.posting_analyze` |

Regras:
- A vaga é editável e cresce aos poucos; `identity_hash` é recalculado quando empresa, cliente, cargo ou role mudam.
- Reanálise cria um `job_analysis` novo; a mais recente é a atual.
- `facts_version` já existe (`settings`), não é migração nova.

---

## 4 · Layouts deste entregável

| Tela | Componentes | Estados a cobrir |
|------|-------------|------------------|
| Menu | item **Vagas** no grupo "Geral" do `SideNav`; o chip "em breve" de vagas no Dashboard vira link | — |
| Lista `/vagas` | cards (empresa, cliente, cargo e senioridade, role, data de criação) | vazio · com itens |
| Vaga `/vagas/$id` | formulário com todos os campos (react-hook-form + zod, `FormGuard`), selo de origem por campo (heurística · modelo · ambos · usuário), JD editável, `ContactList`, `NoteList`, análises (fit por perfil, recomendado, atende, lacunas, riscos, keywords ATS, perguntas), alerta de candidatura "em breve" (F06-11), botão "Criar CV para esta vaga" (em breve) | rascunho incompleto · extraindo · analisada · "seus dados mudaram" (reanalisar) · nota aguardando confirmação |
| Entrada | colar texto ou URL (na página Vagas e pelo chat) | URL inválida · buscando · fetch falhou (pede colar) · robots bloqueou · texto curto |
| Duplicata | `Dialog` largo com diff lado a lado e o % de certeza; atualizar salva · seguir como nova · cancelar | — |
| Chat | sessão nova com o título da vaga; mensagem com `analysis.save` mostra o botão "Criar CV para esta vaga" (em breve); menu de conversas agrupado por categoria | — |
| Configurações | seção **Modelos** (modelo por tarefa, só Claude) | — |
| Modo B | resposta textual: fit por perfil, recomendado, 3 lacunas, 2 riscos, link `…/vagas/<id>` | — |

---

## 5 · Decisões

| # | Decisão | Fechada pelo dono (2026-10-14) |
|---|---------|--------------------------------|
| F06-1 | Heurística local de keywords | **dicionário curado + n-gramas** (0 tokens), revisada e comparada com a extração do modelo |
| F06-2 | Identidade e cache da análise | **hash por empresa + cargo + cliente (se houver) + role** (a data de publicação saiu do hash por ajuste do dono, ver F06-9) |
| F06-3 | Fetch de URL | **undici + Readability**, respeitando robots; Chromium como opção futura |
| F06-4 | O que vai ao modelo | **resumo por experiência**; skills e habilidades vão **completas** |
| F06-5 | Modelo | **Sonnet (análise) + Haiku (extração) por padrão**, configurável por tarefa em Configurações (só modelos do Claude por enquanto, F06-13) |
| F06-6 | Fit e keywords | **modelo + heurística**, mostrando de onde vem cada dado e destacando quando a heurística foi confirmada pelo modelo |
| F06-7 | Salvar × candidatar | **sempre salvar a vaga**; salvar não é candidatar-se (candidatura é na F07, depois do CV) |
| F06-8 | Alcance do recrutador global | **o chat inteiro é global**: um recrutador geral conhece todos os perfis; o recrutador especializado é um **subagente** do geral, chamado com um perfil. As sessões deixam de pertencer a um perfil (mexe na persona, nas sessões e no menu da F04, e nos prompts no Phoenix) |
| F06-9 | Vaga duplicada com dados incompletos | **a data de publicação não é obrigatória e não entra no hash**. Hash coincidente aciona um **fallback com modelo barato (Haiku)**, que compara a JD salva com a nova e devolve um **% de certeza de duplicata**, baseado no hash e em campos como JD, role, empresa, cliente e senioridade. A UI abre um **modal com o diff das duas vagas**, e o usuário escolhe **atualizar a vaga salva**, **seguir como vaga nova** ou **cancelar** |
| F06-10 | Validade da análise | **sem reanálise automática**. Cada análise guarda a `facts_version`; se os fatos do usuário ou a vaga (JD, campos) mudarem depois, a página da vaga e o recrutador avisam "seus dados mudaram desde a análise de <data>" e oferecem **reanalisar**; a reanálise cria uma análise nova e mantém o histórico. Abrir uma vaga analisada nunca gasta tokens |
| F06-11 | Alerta de candidatura repetida | **"em breve" na F06**: o espaço do alerta aparece na análise e na página da vaga como "em breve"; a F07 implementa com as candidaturas reais |
| F06-12 | Cargo, role e senioridade | **cargo** = título publicado; **role** = função normalizada (lista curada); **senioridade/nível** = campo próprio |
| F06-13 | Modelos configuráveis | **só modelos do Claude** por enquanto (configuração por tarefa em Configurações); outros provedores com a F11 |
| F06-14 | Avaliação de prompt no Phoenix | **gate de qualidade com o Claude real** a cada prompt novo ou alterado, rodando na assinatura (custo de construção aceito pelo dono); o mock segue como smoke no dia a dia |
| F06-15 | Teto de conversas vivas | a sessão da análise **conta no teto**; **sessões hibernadas não contam** |
| F06-16 | Onde os prompts vivem | **o repositório é a fonte** (AV-4 mantida); o Phoenix guarda cada versão, as rodadas de avaliação (entradas, saídas, custo) e a linha de base do gate. **Quem clona o projeto abre o Phoenix e roda os testes por lá**: cada prompt novo da F06 entra com dataset, avaliadores sincronizados e a versão de produção pronta para rodar no Playground pela ponte da assinatura. Prompts com tools (skill `analisar-vaga`) não rodam no Playground; ficam no `evals chat` (sandbox), com os resultados no Phoenix |
| F06-17 | Confirmação da nota alterada pelo recrutador | **bandeja com seção nova "Aguardando você"**, com o mesmo item também em Pendências; o clique abre a página da vaga com o diff da nota (antes × depois) e confirmar/recusar; até confirmar, a nota mantém o texto antigo |

## 6 · O que precisa estar coberto para o F06 funcionar

### 6.0 Marcos

Cada marco fecha com lint, typecheck, testes e e2e verdes na instância `claude`, commit local e aviso ao dono para `promote`. Todo prompt novo ou alterado passa pelo gate de avaliação real (F06-14) antes do commit do marco.

1. **M1 · Recrutador global e gate de prompts.** Migração `0011` (`chat_session.profile_id` opcional, `on delete set null`, categoria `job`, `posting_id`); repo, rotas, `useChatSessions`, `ChatNav` (agrupado por categoria), `ChatPage` (sem redirecionar na troca de perfil), painel de contexto, resolução de perfil nas tools MCP, `TurnTrace` e o hook `session-start.sh` do modo B; persona global; subagente `recrutador-especializado` nos dois modos (opção `agents` no modo A, tool Agent liberada só para ele). Gate de regressão: `evals --gate` compara cada avaliador com a linha de base da versão anterior no Phoenix e falha se cair. Conferir o custo equivalente no Phoenix.
2. **M2 · Dados da vaga.** Migrações de `posting`, `posting_contact`, `posting_note`, `job_analysis`; schemas zod em `packages/shared`; repos; API de §2.7 (sem análise); campos obrigatórios mínimos; `identity_hash`.
3. **M3 · Heurística sem tokens.** `packages/core/src/postings/`: dicionário com aliases, n-gramas e ruído, senioridade, seções, contrato, moeda, benefícios, local, role normalizada, riscos a partir das preferências reais; busca local das keywords nos fatos (dicionário + `fact_fts`).
4. **M4 · Captura e extração.** Fetch de URL (anti-SSRF, robots, Readability + linkedom); prompts `postingExtract`, `postingMerge`, `postingDuplicate` (provider, mock, datasets, avaliadores, juiz); tarefa `posting.extract`; origem por campo; % de duplicata (F06-9).
5. **M5 · Análise.** Skill `analisar-vaga`, tools `posting.*` e `analysis.*`, tarefa `posting.analyze`, fit por perfil e recomendado, sessão nova com o título da vaga, botão "Criar CV" (em breve) derivado de `analysis.save`, alerta de candidatura "em breve", validade por `facts_version`/`posting_updated_at`. Avaliação da skill pelo caminho de sandbox do `evals chat`.
6. **M6 · Páginas.** Vagas no menu, lista, página da vaga editável, contatos, notas com confirmação (F06-17), modal de diff largo, "seus dados mudaram", seção Modelos em Configurações (lista compartilhada de modelos do Claude).
7. **M7 · Fechamento.** e2e `f06-NN-*`, modo B (`/narnia-jobs:analisar-vaga`), README, CLAUDE.md, `../02`–`../05`.

### 6.1 Pré-requisitos e dependências
1. **F01–F04** entregues: fila e bandeja, `facts_version`, tools `profile.*`, `evidence.*`, `fact.search`, sessões, sincronização e avaliações no Phoenix.
2. **Dependências novas:** `@mozilla/readability` e `linkedom` no `api` (a imagem muda: avisar o dono para `make dev-down && make dev` após o `promote`).
3. **F05, F07, F08** não são pré-requisito: "Criar CV" e o alerta de candidatura ficam "em breve".

### 6.2 Testes unitários (Vitest) · obrigatórios
**`packages/core` (`postings/`, chat)**
- Keywords: fixtures pt-BR e en-US extraem as tecnologias esperadas; aliases ("ReactJS" = "React"); ruído não entra; casamento com `skill.name_normalized` e `tech_json`.
- Senioridade, seções (4 formatos de cabeçalho; sem cabeçalho → tudo obrigatório com flag), contrato, moeda, benefícios, role normalizada.
- Riscos: remoto-only × presencial em outra cidade → `localidade`; PJ × só CLT → `contrato`; salário citado abaixo do mínimo → `salário`.
- `identity_hash`: caixa, acentos e espaços não mudam o hash; mudar empresa, cliente, cargo ou role muda; data de publicação não entra.
- Sessões: criar sem perfil; apagar perfil não apaga a sessão (`set null`); teto continua contando só vivas.

**`packages/shared`**
- `JobAnalysis`: rejeita `matches[]` sem `evidence`, `evidence` com `kind` inválido, `gaps[]` sem `evidence_checked`, `fit` fora de 0–100; snapshot do JSON Schema.

**`apps/api`**
- Fetch: até 3 redirects; bloqueia `127.0.0.1`, `10.x`, `169.254.x`, `localhost` e DNS que resolve para IP privado; robots `Disallow`; 2 MB; timeout; só-JS → `extract_failed`.
- Readability: fixtures de 3 job boards → texto principal; `og:` preenche título e empresa.
- Tarefas com o mock: etapas em ordem; duplicata com hash igual chama `postingDuplicate`; `analysis.save` rejeita `{kind,id}` inexistente; análise marcada desatualizada quando `facts_version` ou a vaga mudam.
- Notas: recrutador editando nota de usuário grava `pending_body` e cria o pedido de confirmação; confirmar aplica; recusar descarta.
- Modo A: opção `agents` montada de `plugin/agents/recrutador-especializado.md`; tool Agent permitida só para ele.

**`apps/web`** (`apps/web/test/f06/`)
- Lista e página da vaga, selos de origem, `FormGuard`, contatos, notas pendentes, modal de diff com as três ações, aviso "seus dados mudaram", botão "Criar CV" em breve na mensagem, `ChatNav` agrupado, seção Modelos.

### 6.3 Testes e2e (Playwright, Chromium) · obrigatórios
Arquivos `apps/e2e/tests/f06-NN-<slug>.spec.ts`, títulos `F06/E2E-NN …`; mock com fixtures de extração, merge, duplicata e análise; servidor HTTP de fixtures para as URLs.
- **E2E-01 colar e analisar pelo chat:** "analisa esta vaga" + texto → sessão nova com o título `empresa/cliente - role` → bandeja → resultado com fit por perfil, recomendado, lacunas e riscos → botão "Criar CV" (em breve) → vaga aparece em Vagas.
- **E2E-02 URL com sucesso:** URL de fixture → campos preenchidos com selo de origem.
- **E2E-03 URL que falha:** página só-JS → "não consegui extrair" → pede colar.
- **E2E-04 robots bloqueia.**
- **E2E-05 duplicata:** mesma empresa/role de novo → modal com diff e % → "atualizar salva" mantém um registro; "seguir como nova" cria outro; "cancelar" não cria.
- **E2E-06 reanalisar após novo fato:** `PATCH /api/_test/facts/...` → aviso "seus dados mudaram" → reanalisar → análise nova no histórico.
- **E2E-07 edição:** editar campos e a JD → salvar → recarregar → valores persistem; a análise fica marcada desatualizada.
- **E2E-08 notas:** usuário cria nota → recrutador altera → item de confirmação → confirmar aplica.
- **E2E-09 modo B:** `/narnia-jobs:analisar-vaga` → resposta com link → link abre a vaga.
- **E2E-10 persistência:** `down/up` → vagas, notas e análises continuam.
- **E2E-11 recrutador global:** conversa sem perfil ativo funciona; trocar de perfil não fecha a conversa; especializado chamado com o perfil certo.

**Como ficou (2026-10-15):** `f06-01-analisar-pelo-chat` (E2E-01 e E2E-11), `f06-02-vaga-pela-pagina` (E2E-07 e a extração com a origem dos campos), `f06-03-duplicata` (E2E-05), `f06-04-notas-pendentes` (E2E-08) e `f06-05-reanalisar` (E2E-06); os e2e da F04 foram ajustados para o chat global (E2E-01, 02 e 04). A busca por URL (E2E-02 a 04 do plano) ficou nos testes da api com `fetch` falso (`f06-m4-fetch.test.ts`): o servidor de fixtures do e2e mora na rede interna do Docker e o anti-SSRF o bloqueia de propósito. O E2E-09 (modo B real) usa a assinatura de quem roda: só com o dono (`scripts/smoke-plugin.sh --yes`). A persistência (E2E-10) é a mesma do F01/E2E-06.

### 6.4 Teste manual com provider real (antes de fechar F06)
10 vagas reais (5 pt-BR, 5 en-US, 3 job boards, 2 por URL) contra os perfis reais: tokens e custo, lacuna falsa, "atende" sem evidência, utilidade das perguntas, sucesso do fetch, acerto do % de duplicata, concordância heurística × modelo.

### 6.5 Definição de pronto
- Testes de 6.2 e 6.3 verdes; cobertura ≥ 80 % em `core/src/postings` e no schema da análise.
- Gate de avaliação verde para todos os prompts novos e alterados, com as rodadas visíveis no Phoenix.
- Zero "atende" sem evidência e zero "lacuna" com evidência no teste manual.
- Fetch com robots e anti-SSRF testados.
- `../02`, `../03`, `../04`, `../05`, README e CLAUDE.md atualizados.

---

## 7 · Riscos específicos
| Risco | Mitigação |
|-------|-----------|
| M1 mexe em toda a F04 (sessões, persona, MCP, modo B) | marco próprio, primeiro; e2e da F04 inteiros rodando no fechamento do M1 |
| Subagente no modo A depende da opção `agents` do SDK | testar no M1 com o mock e uma rodada real antes de construir a análise em cima |
| Job boards bloqueiam fetch ou mudam HTML | colar sempre disponível; snapshots como fixtures |
| Modelo "inventa" aderência | `evidence {kind,id}` obrigatória, `evidence_checked`, validação no `analysis.save` |
| Fit % passa falsa precisão | justificativa, origem e rótulo "estimativa" |
| SSRF via URL | bloqueio após DNS, redirects verificados um a um |
| Custo do gate real a cada prompt | só roda quando o hash do prompt muda; datasets pequenos |
| Dicionário desatualizado | arquivo versionado e n-gramas |

## 8 · Registro de execução
| Data | Marco | O que aconteceu |
|------|-------|-----------------|
| 2026-10-11 | — | **Plano incrementado (dono):** comparação com todos os perfis e recomendação do mais indicado; vaga salva como entrada da F05/F07; teste e2e correspondente. |
| 2026-10-11 | — | **Requisitos do dono (registro antecipado):** o agente analisa uma vaga, mostra a compatibilidade com a carreira do usuário e **indica qual perfil é o mais indicado** para ela (comparando todos os perfis, não só o ativo); disponível pela tela e pelo chat (F04). |
| 2026-10-14 | — | **Replanejamento (dono):** F06 antes da F05; recrutador global com recrutador especializado; sessão nova com título empresa/cliente - role; campos novos (§1.1), contatos, notas com confirmação na bandeja, página Vagas, JD editável, alerta de candidatura repetida, prompts versionados e avaliados no Phoenix; F06-1 a F06-7 fechadas. Pontos F06-8 a F06-15 abertos. |
| 2026-10-14 | — | **F06-8 fechada (dono):** chat inteiro global; recrutador especializado como subagente do geral. |
| 2026-10-14 | — | **F06-9 fechada (dono):** data de publicação opcional e fora do hash (ajusta F06-2); hash coincidente → Haiku compara as JDs e devolve % de duplicata → modal com diff (atualizar salva · seguir como nova · cancelar). |
| 2026-10-14 | — | **F06-10 a F06-15 fechadas (dono):** sem reanálise automática; alerta de candidatura repetida "em breve"; cargo/role/senioridade separados; só modelos do Claude; avaliação real de prompt na assinatura como gate; hibernadas fora do teto. Todas as decisões da F06 fechadas. |
| 2026-10-14 | — | **Revisão contra o código:** §2 a §4, §6 e §7 reescritos (§2.0 lista as divergências: dicionário inexistente, `facts_version` já pronto, evidência `{kind,id}`, nomes reais das tools, preferências sem flag de obrigatória, dependências novas, sessões `NOT NULL` por perfil, subagente sem suporte no modo A, botão derivado da tool, gate de regressão inexistente). Marcos M1–M7 em §6.0. Abertos F06-16 e F06-17. |
| 2026-10-14 | — | **F06-16 fechada (dono):** repositório como fonte; o Phoenix como registro, e quem clona roda os testes pelo Phoenix. |
| 2026-10-14 | — | **F06-17 fechada (dono):** seção "Aguardando você" na bandeja, espelhada em Pendências. Todas as decisões fechadas; pronto para o M1. |
| 2026-10-14 | M1 | **Recrutador global entregue.** Migração 0011 (`chat_session.profile_id` opcional, `on delete set null`, categoria `job`); `recruiterContext` com os cartões de todos os perfis (ids e ativo marcado); persona global; subagente `recrutador-especializado` (arquivo único no plugin; modo A pela opção `agents` do SDK, tool Agent liberada só para ele pelo `canUseTool`; modo B carrega nativo, o `install-plugin` troca o nome do servidor). Descobertas na rodada real: o SDK roda subagente **em segundo plano por padrão** (a resposta saía "resumo quando terminar"); o chat agora usa `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1` e `run_in_background: false`; texto parcial do subagente não entra na resposta e as tools dele ficam marcadas (`subagent`). Web: conversas globais, Chat no grupo Geral, menu agrupado por tema, trocar de perfil não fecha a conversa. |
| 2026-10-14 | M1 | **Gate de regressão (F06-14).** `evals/baselines.json` versionado; `--gate` falha quando um avaliador cai além de 5 pontos; `--update-baseline` grava só sem regressão. No chat, avaliadores determinísticos por caso e o juiz pela média dos casos (uma amostra por caso oscila 0/0,5/1). Juiz recebe o system prompt do recrutador como contexto; avaliadores de dados desconhecidos conhecem todos os fatos (`knownFactsText`); extrator de empresas não emenda frases nem conta país, bases públicas e percentis. Caso novo `especializado`. Rodada real final: 4/5 casos sem falha de avaliador, juiz sem "não atende", linha de base gravada. |
| 2026-10-14 | M2 | **Dados da vaga (backend).** Migração 0012 (`posting`, `posting_contact`, `posting_note`, `job_analysis`, `chat_session.posting_id`); schemas em `packages/shared/src/schemas/posting.ts`; repositórios; identidade (F06-2/F06-9) sem data; notas com edição pendente do recrutador (F06-17) e notificação `posting.note_pending`; rotas `/api/postings` (CRUD, contatos, notas, confirmar/recusar, pendentes). |
| 2026-10-14 | M3 | **Heurística (parcial).** Dicionário com ~190 termos e sinônimos; `analyzePostingText`: seções, keywords por seção, n-gramas técnicos fora do dicionário, cargo, senioridade, role, contrato, modo, cidade/UF, moeda, faixa, benefícios, anos. Falta: casamento com os fatos do usuário e riscos por perfil. |
| 2026-10-14 | M3 | **Heurística concluída.** Busca local das keywords nos fatos (`userTermIndex`: skills, tecnologias das experiências e projetos, idiomas; FTS para o resto), cobertura dos obrigatórios e riscos por perfil (modo de trabalho, local, contrato, salário, senioridade, inglês). `PreAnalysisSchema` em `packages/shared`. |
| 2026-10-14 | M4 | **Captura e extração.** Prompts `narnia-posting-extract`, `narnia-posting-merge` e `narnia-posting-duplicate` (Haiku por padrão, chaves `models.posting_*`), com mock, datasets, avaliadores e juízes. Tarefa `posting.extract` no worker (extração → merge → duplicata, uso registrado por chamada, vaga `error` se o modelo falhar). Merge nunca sobrescreve campo do usuário. Duplicata guardada na vaga (migração 0013) com decisão `update`/`new`/`cancel`. Busca por URL (`@mozilla/readability` 0.6.0 e `linkedom` 0.18.13, dependências novas do `api`): anti-SSRF depois do DNS, redirects conferidos, robots.txt, 2 MB, 15 s, snapshot em `snapshots/postings/`. Rotas `POST /api/postings/intake`, `/:id/duplicate-decision`, `/:id/extract`; editar a JD refaz a pré-análise sem tokens. Avaliação real no Phoenix: extract 96–100% nos avaliadores e juiz 83%, merge e duplicata 100%; linha de base gravada. |
| 2026-10-14 | M5 | **Análise.** `JobAnalysisSchema` (resumo, fit por perfil, recomendado, atende com evidência `{kind,id}`, lacunas com `evidenceChecked`, riscos, keywords ATS, perguntas, estudos, melhorias no CV, senioridade). Tools `posting.*` e `analysis.*` no `/mcp` (carreira, vaga e terminal): `analysis.save` recusa evidência inexistente e perfil fora da análise. Conversa própria da análise (`POST /api/postings/:id/analyze` e tool `posting_open_analysis`): categoria `job`, título "contratante/cliente - role", turno do sistema com a skill `analisar-vaga` (fonte única dos modos A e B); dentro da conversa da vaga a tool recusa abrir outra. A mensagem guarda os links da vaga e da conversa nova; "Criar CV para esta vaga" aparece desabilitado (em breve, F05) na mensagem que gravou a análise. Validade por `facts_version` e `posting_updated_at` (`GET /api/postings/:id/analyses`). Avaliação real: casos `vaga-no-chat` e `analise-de-vaga` passam todos os avaliadores (o recrutador salva, delega ao especializado e grava com evidência real). |
| 2026-10-14 | M5 | **Gate do chat pela média da rodada.** Uma amostra por caso oscilava um avaliador entre rodadas iguais; o bloqueio passou para a média de todos os avaliadores (`chat:avaliadores`) e do juiz (`chat:juiz`), com as notas por caso guardadas só para consulta. Caso `especializado` reescrito (vaga colada agora abre a conversa da vaga, como pedido). |
| 2026-10-15 | M6 | **Páginas.** Vagas no grupo Geral do menu e no Dashboard; `/vagas` com cards (contratante, cliente, cargo e senioridade, role, data) e a entrada por texto ou link; `/vagas/$id` com o status da extração, "Extrair de novo", "Criar CV" e alerta de candidatura em breve, modal largo de duplicata (certeza, diff e as três decisões), análise do recrutador (fit por perfil, recomendado, atende com os rótulos das evidências, lacunas por severidade, riscos, ATS, perguntas, estudos, CV, aviso "seus dados mudaram" com reanalisar, teto de conversas perguntando qual encerrar), pré-análise (cobertura, chips com evidência e origem, riscos do perfil ativo, termos fora do dicionário), formulário com todos os campos e o selo de origem, contatos e notas (antes × depois da edição pendente, confirmar ou manter; `?nota=` destaca). Bandeja com "Aguardando você". Configurações › Modelos (Claude por tarefa; a análise usa `models.posting_analyze`). |
| 2026-10-15 | M7 | **Fechamento.** e2e `f06-01` a `f06-05` verdes com o mock; README (seção Vagas, recrutador global, gate), CLAUDE.md (gate de prompts autorizado e notas da F06), `02`–`05` e o índice das tarefas atualizados. **Falta com o dono:** §6.4 (10 vagas reais contra os perfis reais, medir tokens e honestidade), E2E-09 real do modo B, `./start.sh promote` e `make dev-down && make dev` (dependências novas no `api` e migrações 0011 a 0013). Resolvido no fechamento (linha "F06 fechada"). |
| 2026-10-15 | — | **Correções do primeiro teste do dono.** (1) Título do chat só "Recrutador". (2) Link de vaga atrás de banner de cookies ou JS: JSON-LD `JobPosting`, navegador headless no serviço `browser` (§2.2) e a persona manda link para `posting_create` (`url`), nunca WebFetch. (3) A análise não aparecia na bandeja: a bandeja ganhou "Análises de vaga" (conversas `job` com turno em andamento e a notificação informativa `posting.analysis_done`, que some ao abrir pela bandeja). (4) Vaga aparecia desatualizada logo depois da análise: a extração do modelo terminava depois e mexia em `updated_at`; a validade agora usa `content_updated_at` (migração 0014: só edição do usuário ou JD nova). (5) "Alerta de candidatura repetida" era um aviso fixo "em breve": saiu; no lugar, "Vagas parecidas" só quando existe outra vaga da mesma empresa (contratante ou cliente) com o mesmo role. (6) Busca por texto em Vagas (empresa, cliente, cargo, role em pt-BR e nome de contato; `GET /api/postings?q=` e `posting_search`). |
| 2026-10-15 | — | **Vaga da Prisma Consultoria não abria (dono).** O CDN (Akamai) segura o fetch simples até o timeout e derruba o Chromium headless (`ERR_HTTP2_PROTOCOL_ERROR`). Correção: o navegador se apresenta como Chrome comum; fetch simples com 8 s quando há navegador (busca inteira ~22 s); o texto vem do `<main>` inteiro quando o Readability perde a seção de requisitos; título pelo `<h1>`. Conferido no chat real: vaga salva e analisada. |
| 2026-10-15 | — | **Análise ainda fora da bandeja (dono).** Reproduzido com o modelo real: a bandeja mostrava "Analisando" e "Análise pronta", mas a pronta não contava no número (com a bandeja fechada parecia nada) e uma conversa que terminasse sem gravar sumia sem aviso. Correção: pronta e não concluída contam no número; "Analisando" some quando a análise da mesma vaga já está pronta; conversa `job` que termina o turno (ou erra) sem `analysis_save` vira a pendência `posting.analysis_incomplete` com o link da conversa, resolvida quando a análise é gravada. |
| 2026-10-15 | — | **Link para a vaga oficial (dono).** Botão "Ver vaga oficial" na página da vaga, ao lado de "Extrair de novo", "Criar CV" e "Apagar vaga"; abre em aba nova e só aparece com link http(s) (o campo é editável e `z.url()` aceita `javascript:`). |
| 2026-10-15 | — | **F06 fechada (dono).** Lint, typecheck, unitários (shared 138, providers 92, core 474, worker 55, api 301, web 266) e e2e completo (67 mais os de operação) verdes. O teste manual do §6.4 ficou nos testes do dono com vagas reais (um portal de empregos e uma consultoria por link, entre outras), sem o roteiro formal de 10 vagas. Nada fica pendente na F06: o alerta de candidatura repetida (F06-11) é escopo da F07, e o smoke real do modo B (`scripts/smoke-plugin.sh --yes`) é uma checagem geral que roda só a pedido do dono, não uma tarefa desta task. |
| 2026-10-19 | — | **Assets e contatos na página da vaga (pedido do dono).** Na coluna da pré-análise, antes dela: (1) "Currículo e carta" com o CV e a carta da vaga em miniatura (página 1), "Baixar PDF" (ou copiar o texto da carta) e "Regerar com mensagem"; sem o documento, "Gerar CV"/"Gerar carta" abrem o diálogo de sempre. A mensagem é um feedback humano: `POST /api/documents/:id/feedback` abre uma conversa `job` ligada à vaga ("<vaga> · CV"), a mensagem aparece como do usuário e o modelo recebe a nota `plugin/prompts/documento-feedback-contexto.md` (documento, versão, vaga; `cv_get`, depois `cv_edit` para mudança pontual ou `cv_generate` com `instructions` para mudança de foco). (2) Contatos: o fixado (um por vaga, não conta no limite nem se repete) e os dois últimos; "Adicionar contato" numa modal, e um card de adicionar quando a lista está vazia. Contato ganhou o link do LinkedIn (migração 0016, só `linkedin.com`, normalizado) e o fixado; mesmo LinkedIn (qualquer subdomínio) ou e-mail na vaga é duplicata (409; a tool `posting.contact_add` devolve o existente com `duplicate: true`). Avaliação: caso `feedback-do-cv` (`open: document_feedback`; o sandbox semeia uma vaga com CV pronto) e `uses_tool` com alternativas (`cv_edit|cv_generate`). Gate real pendente: o login do Claude Code da instância `claude` expirou. e2e `f06-06`. |
(Preencher durante a implementação: datas, resultados do teste manual, decisões tomadas.)
