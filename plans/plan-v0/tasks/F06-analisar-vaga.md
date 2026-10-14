# F06 · Analisar vaga

Entregável 6 do plan-v0. Cobre a feature **#2** de `../02-fluxos-do-usuario.md §F5`: a pessoa cola a descrição de uma vaga (ou a URL) e recebe uma análise honesta de aderência ao perfil ativo, com lacunas sem evidência, riscos, palavras-chave ausentes e perguntas prováveis, pronta para virar candidatura, CV direcionado (F05) ou simulação de entrevista (F08).

Status: **em escopo, replanejada pelo dono em 2026-10-14** (a F06 vem antes da F05). Decisões F06-1 a F06-15 fechadas (§5); requisitos novos em §1.1 a §1.4. Nada implementado.

---

## 1 · Objetivo e resultado esperado

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

### 2.1 Pipeline
```
texto colado ─────────────────────────────┐
URL ─► fetch (api, sem JS) ─► extração ───┴─► job_posting (texto normalizado, hash, metadados)
        └─ falhou? ─► UI pede para colar
job_posting + perfil ─► heurística local (0 tokens): keywords, tech, senioridade pedida, localidade/contrato, salário citado
                     ─► pré-análise (atende/ausente por skill, conflitos com preferências obrigatórias)
                     ─► skill analisar-vaga (modelo, Sonnet): fit, lacunas com justificativa, riscos, perguntas prováveis
                     ─► analysis.save(JobAnalysis) ─► ligada à candidatura
```
- A heurística reduz o que vai ao modelo: o agente recebe a vaga **resumida** (seções relevantes, até ~6k chars), a lista de keywords e a pré-análise, mais o cartão do perfil; detalha experiências sob demanda via tools.
- Honestidade: "lacuna" só pode ser afirmada quando `fact.search` não encontra evidência; "atende" exige `fact_ids`. O schema obriga.

### 2.2 Captura de URL (no `api`)
| Regra | Valor |
|-------|-------|
| Métodos | `GET` único, sem seguir mais de 3 redirects, só `http(s)`; bloqueia IPs privados/loopback (anti-SSRF) |
| User-agent | `narnia-jobs/<versão> (+repo URL)`; respeita `robots.txt` para o path (se `Disallow`, não busca e pede para colar) |
| Limites | 2 MB de HTML, timeout 15 s, 1 tentativa |
| Extração | `@mozilla/readability` + `linkedom` → texto principal; título da página; metadados `og:` quando houver (empresa, cargo) |
| Resultado | nunca executa JS; páginas renderizadas só por JS resultam em "não consegui extrair, cole o texto" |
| Privacidade | a URL e o HTML bruto ficam em `/data/snapshots/jobs/<hash>.html` para auditoria; não são enviados ao modelo |

### 2.3 Heurística local (`packages/core/jobs/`)
- Dicionário de tecnologias/competências (o mesmo usado para normalizar skills em F01/F03) + extração de n-gramas frequentes da vaga.
- Senioridade pedida: regex multilíngue (júnior/pleno/sênior/staff/lead/manager, "5+ years").
- Requisitos obrigatórios vs desejáveis: separação por cabeçalhos comuns ("Requisitos", "Diferenciais", "Nice to have").
- Conflitos com preferências obrigatórias do perfil (F01): presencial × remoto, cidade/país, tipo de contrato, faixa salarial citada × pretendida.
- Saída: `PreAnalysis` (keywords com `matched_skill_id?`, seniority, conflicts[], sections), também exibida na UI enquanto o modelo roda.

### 2.4 Skill `analisar-vaga` e tools MCP
| Tool | Função |
|------|--------|
| `job_posting.create({text|url, application_id?})` | normaliza, hasheia, extrai, roda heurística; devolve `posting_id`, `pre_analysis`, `cache_hit?` |
| `job_posting.get(id)` | texto resumido + pré-análise |
| `profile.get_card`, `skill.list`, `experience.list/get`, `fact.search` (F04) | evidências |
| `analysis.save(posting_id, JobAnalysis)` | valida schema (fact_ids obrigatórios em "atende"), grava, liga à candidatura |
| `analysis.get(id)`, `analysis.list(profile)` | reabrir |
| `application.create_minimal({company, title, posting_id})` (F07; stub em F06) | cria a candidatura mínima quando o usuário escolhe "nova" |

### 2.5 `JobAnalysis` (schema em `packages/shared/analysis-schema`)
| Bloco | Conteúdo |
|-------|----------|
| `fit` | 0–100 + justificativa curta + `confidence` |
| `matches[]` | requisito, `fact_ids[]`, força (forte/parcial) |
| `gaps[]` | requisito, `severity` (bloqueante/importante/menor), `evidence_checked: true`, sugestão (como compensar) |
| `risks[]` | tipo (senioridade, localidade, contrato, salário, idioma, setor), descrição, `source` (heurística/modelo) |
| `ats_keywords_missing[]` | termo, onde caberia (seção) |
| `likely_questions[]` | pergunta, por quê, fato que ajuda a responder |
| `seniority` | pedida × declarada no perfil |
| `meta` | modelo, tokens, `posting_hash`, `facts_version`, `created_at` (UTC) |

### 2.6 Jobs e cache
| Job | Etapas |
|-----|--------|
| `job_posting.analyze` | `fetching?` → `extracting` → `heuristics` → `analyzing` (modelo) → `saving` → `done` |
Cache: chave = `sha256(texto normalizado) + profile_id + facts_version` (contador incrementado a cada fato aceito/editado). Hit → devolve a análise existente sem job de modelo, com aviso "análise de <data>" e botão "reanalisar".

### 2.7 API
| Método e rota | Função |
|---------------|--------|
| `POST /api/job-postings` `{text|url, application_id?, create_application?}` | cria posting + job (ou cache hit) |
| `GET /api/job-postings/:id` | texto, pré-análise, snapshot info |
| `GET /api/analyses/:id` · `GET /api/analyses?profile=` | resultado |
| `POST /api/analyses/:id/reanalyze` | ignora cache |
| `GET /api/job-postings/estimate` | estimativa de tokens dado o tamanho do texto |

---

## 3 · Dados deste entregável

| Tabela | Colunas principais |
|--------|--------------------|
| `job_posting` | `id`, `source` (paste/url), `url?`, `fetched_at?` (UTC), `title?`, `company?`, `location?`, `raw_path` (snapshot), `text`, `text_hash`, `lang`, `sections_json`, `pre_analysis_json`, `created_at` |
| `job_analysis` | `id`, `posting_id`, `profile_id`, `application_id?`, `analysis_json` (JobAnalysis), `fit`, `facts_version`, `cache_key`, `model`, `usage_json`, `job_id`, `created_at` |
| `application` (F07; mínimo em F06) | `id`, `profile_id`, `company`, `title`, `posting_id?`, `status` (= interesse), `created_at` |
| `settings` | `facts_version` (inteiro incrementado por escrita em fatos) |

Regras:
- `job_posting` é imutável; reanálise cria novo `job_analysis`.
- Uma candidatura tem no máximo uma análise "atual" (a mais recente); as anteriores ficam no histórico.
- Texto da vaga nunca é enviado inteiro ao modelo quando > 6k chars: vai o resumo por seções.

---

## 4 · Layouts deste entregável

Referência: `../05-layouts.md` L6. Componentes a construir:

| Tela | Componentes | Estados a cobrir |
|------|-------------|------------------|
| Entrada | `PostingInput` (abas Colar / URL), `ApplicationLink` (nova · existente ▼), `EstimateBadge`, "Analisar" | vazio · URL inválida · buscando · fetch falhou (pede colar) · robots bloqueou · texto curto (< 300 chars) |
| Pré-análise instantânea | `KeywordChips` (atende ● / ausente ○), `SeniorityBadge`, `ConflictList` (preferências obrigatórias) | sem conflitos · com conflitos · sem skills no perfil |
| Resultado | `FitGauge`, `MatchList` (com fatos linkados), `GapList` (severidade, sugestão), `RiskList`, `AtsKeywords`, `LikelyQuestions`, `AnalysisMeta` (modelo, tokens, data no fuso) | cache hit (com aviso e "reanalisar") · fresco · erro |
| Ações | `ActionBar`: "Gerar CV para esta vaga" (F05), "Simular entrevista" (F08), "Abrir candidatura" (F07) | ações desabilitadas quando a task dependente não existe |
| Histórico | `AnalysisList` por perfil, com empresa/cargo/fit/data | vazio · com itens |
| Modo B | resposta textual: fit, 3 maiores lacunas, 2 riscos, link `…/vagas/<analysis_id>` | — |

---

## 5 · Decisões

| # | Decisão | Fechada pelo dono (2026-10-14) |
|---|---------|--------------------------------|
| F06-1 | Heurística local de keywords | **dicionário curado + n-gramas** (0 tokens), revisada e comparada com a extração do modelo |
| F06-2 | Identidade e cache da análise | **hash por empresa + cargo + cliente (se houver) + role** (a data de publicação saiu do hash por ajuste do dono, ver F06-9) |
| F06-3 | Fetch de URL | **undici + Readability**, respeitando robots; Chromium como opção futura |
| F06-4 | O que vai ao modelo | **resumo por experiência**; skills e habilidades vão **completas** |
| F06-5 | Modelo | **Sonnet (análise) + Haiku (extração) por padrão**, configurável em Configurações; aceita outro modelo configurado antes (ex.: Fable, ou um modelo da OpenAI) |
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

## 6 · O que precisa estar coberto para o F06 funcionar

### 6.1 Pré-requisitos e dependências
1. **F01**: jobs, bandeja, preferências obrigatórias do perfil, `facts_version`.
2. **F04**: MCP, `plugin/`, sessões, tools `profile.*`, `skill.*`, `experience.*`, `fact.search`.
3. **F07** opcional: ligação completa com candidatura; F06 entrega `application.create_minimal` como stub que F07 substitui.
4. **F05** e **F08** opcionais: botões de ação ficam desabilitados até existirem.
5. Ordem interna: heurística local + schema → captura de URL → tools/skill → página L6 → cache.

### 6.2 Testes unitários (Vitest) · obrigatórios
**`packages/core` (jobs/)**
- Keywords: fixtures de vagas pt-BR e en-US extraem as tecnologias esperadas; normalização ("ReactJS" = "React"); n-gramas de ruído ("equipe dinâmica") não entram.
- Senioridade: "Sênior", "Senior", "5+ years", "Pleno/Sênior" → valores corretos; ausência → `unknown`.
- Seções: separa obrigatórios/desejáveis em 4 formatos de cabeçalho; vaga sem cabeçalhos → tudo "obrigatório" com flag.
- Conflitos: presencial em outra cidade × perfil remoto-only → conflito `localidade`; PJ × só CLT → `contrato`; salário citado abaixo do mínimo → `salário`.
- Hash: texto com espaços/acentos/caixa diferentes gera o mesmo hash; textos diferentes, hashes diferentes.

**`packages/shared`**
- `analysis-schema`: rejeita `matches[]` sem `fact_ids`, `gaps[]` sem `evidence_checked`, `fit` fora de 0–100; snapshot do JSON Schema.

**`apps/api`**
- Fetch: segue até 3 redirects; bloqueia `127.0.0.1`, `10.x`, `169.254.x`, `localhost`; respeita `robots.txt` `Disallow`; corta em 2 MB; timeout; HTML só-JS → erro `extract_failed`.
- Readability: fixtures de 3 job boards (HTML salvo) → texto principal sem menu/rodapé; `og:title`/`og:site_name` preenchem título/empresa.
- Job `job_posting.analyze` com provider mock: etapas em ordem; cache hit não cria job de modelo; `facts_version` alterado invalida o cache; `reanalyze` ignora cache.
- `analysis.save`: rejeita análise com "atende" sem fato existente (fact_id inexistente → 400).
- Rotas: 400 URL inválida; 422 texto curto; 404 análise inexistente; `create_application` cria candidatura mínima com empresa/cargo da heurística.

**`apps/web`**
- `PostingInput`: alterna abas, valida URL, mostra fallback de colar quando o fetch falha.
- `KeywordChips`/`ConflictList`: renderizam a pré-análise antes do resultado do modelo.
- `GapList`: ordena por severidade; cada lacuna mostra "nenhuma evidência encontrada" e a sugestão.
- `ActionBar`: botões desabilitados quando a feature dependente está indisponível (flag da API).
- `AnalysisMeta`: data no fuso do usuário; aviso de cache com botão reanalisar.

### 6.3 Testes e2e (Playwright, Chromium) · obrigatórios
Compose com `NARNIA_PROVIDER=mock` (o mock devolve um `JobAnalysis` fixo coerente com o perfil de fixture) e um servidor HTTP de fixtures para as URLs.
- **E2E-01 colar e analisar**: colar vaga pt-BR → pré-análise aparece em < 1 s → job na bandeja → resultado com fit, 2 lacunas, 1 risco → candidatura nova criada em "Interesse".
- **E2E-02 URL com sucesso**: URL do servidor de fixtures → título/empresa preenchidos → análise igual à de E2E-01 (mesmo hash → cache hit com aviso).
- **E2E-03 URL que falha**: página só-JS → mensagem "não consegui extrair" → aba Colar aberta com a URL guardada como referência.
- **E2E-04 robots bloqueia**: fixture com `Disallow` → não busca → orienta colar.
- **E2E-05 conflito de preferência**: perfil remoto-only × vaga presencial em outra cidade → risco `localidade` visível já na pré-análise.
- **E2E-06 reanalisar após novo fato**: aceitar um fato novo (endpoint de teste) → abrir análise → aviso "fatos mudaram" → reanalisar → nova análise com `facts_version` maior.
- **E2E-07 ligar a candidatura existente**: escolher candidatura existente → análise aparece no cartão dela.
- **E2E-08 ações**: "Gerar CV para esta vaga" abre L5 com a candidatura pré-selecionada (com F05) · desabilitado sem F05.
- **E2E-09 modo B**: `claude -p "/narnia-jobs:analisar-vaga <texto>" --plugin-dir plugin/` → resposta com fit e link → link abre o resultado.
- **E2E-10 persistência**: `down/up` → análises e snapshots continuam.

- **E2E-x perfil mais indicado**: usuário com perfis "Backend" e "Engineering Manager" → vaga de gestão → análise mostra o fit dos dois e recomenda "Engineering Manager" com justificativa → "Usar este perfil" troca o perfil ativo.

### 6.4 Teste manual com provider real (antes de fechar F06)
10 vagas reais (5 pt-BR, 5 en-US, de 3 job boards, 2 por URL) contra 2 perfis reais: medir tokens × estimativa, se alguma "lacuna" era falsa (havia evidência), se algum "atende" não tinha fato, utilidade das perguntas prováveis, taxa de sucesso do fetch por URL. Decide F06-5 e ajusta heurística/skill.

### 6.5 Definição de pronto
- Testes de 6.2 e 6.3 verdes na CI; cobertura ≥ 80 % em `core/jobs` e `analysis-schema`.
- Zero "atende" sem fato e zero "lacuna" com evidência existente no teste manual (critério de honestidade).
- Fetch respeita robots e anti-SSRF, verificado por testes.
- `../02`, `../03`, `../04`, `../05` atualizados.

---

## 7 · Riscos específicos
| Risco | Mitigação |
|-------|-----------|
| Job boards bloqueiam fetch ou mudam HTML | fallback colar sempre visível; snapshots como fixtures de regressão; sem scraping em massa |
| Modelo "inventa" aderência | schema exige `fact_ids` em matches e `evidence_checked` em gaps; teste manual mede |
| Fit % passa falsa precisão | mostrar justificativa e o % heurístico ao lado; rótulo "estimativa" |
| SSRF via URL | bloqueio de IPs privados, redirects limitados, sem credenciais |
| Vagas longas gastam tokens | resumo por seções; estimativa antes; cache |
| Dicionário de tecnologias desatualizado | arquivo versionado em `core`, fácil de ampliar; n-gramas cobrem termos novos |

## 8 · Registro de execução
| Data | Marco | O que aconteceu |
|------|-------|-----------------|
| 2026-10-11 | — | **Plano incrementado (dono):** comparação com todos os perfis e recomendação do mais indicado; vaga salva como entrada da F05/F07; teste e2e correspondente. |
| 2026-10-11 | — | **Requisitos do dono (registro antecipado):** o agente analisa uma vaga, mostra a compatibilidade com a carreira do usuário e **indica qual perfil é o mais indicado** para ela (comparando todos os perfis, não só o ativo); disponível pela tela e pelo chat (F04). |
| 2026-10-14 | — | **Replanejamento (dono):** F06 antes da F05; recrutador global com recrutador especializado; sessão nova com título empresa/cliente - role; campos novos (§1.1), contatos, notas com confirmação na bandeja, página Vagas, JD editável, alerta de candidatura repetida, prompts versionados e avaliados no Phoenix; F06-1 a F06-7 fechadas. Pontos F06-8 a F06-15 abertos. |
| 2026-10-14 | — | **F06-8 fechada (dono):** chat inteiro global; recrutador especializado como subagente do geral. |
| 2026-10-14 | — | **F06-9 fechada (dono):** data de publicação opcional e fora do hash (ajusta F06-2); hash coincidente → Haiku compara as JDs e devolve % de duplicata → modal com diff (atualizar salva · seguir como nova · cancelar). |
| 2026-10-14 | — | **F06-10 a F06-15 fechadas (dono):** sem reanálise automática; alerta de candidatura repetida "em breve"; cargo/role/senioridade separados; só modelos do Claude; avaliação real de prompt na assinatura como gate; hibernadas fora do teto. Todas as decisões da F06 fechadas. |
(Preencher durante a implementação: datas, resultados do teste manual, decisões tomadas.)
