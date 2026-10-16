# F09 · Carta de apresentação e otimização de LinkedIn

Entregável 9 do plan-v0. Cobre as features **5** (carta de apresentação / mensagem a recrutador) e **6** (otimização de LinkedIn) da tabela em `../02-fluxos-do-usuario.md §F5`. São duas features pequenas que seguem o padrão "skill + tools MCP + página web" e reaproveitam a infraestrutura de documentos criada em F05 (gerar CV). Dependem de F04 (chat, `plugin/`, MCP), F05 (`document`/`document_version`, prévia editável) e F07 (candidaturas, para a carta). A otimização de LinkedIn usa o export ingerido em F03 quando existir, ou texto colado.

Status: **em escopo** (2026-10-07). Nada implementado.

> **2026-10-16 (dono):** a carta de apresentação / cover letter foi para a F05 (F05-21), junto do CV da vaga. Esta task fica com a otimização de LinkedIn e a mensagem curta a recrutador (e-mail curto, InMail); onde o texto abaixo fala da carta formal, vale a F05.

---

## 1 · Objetivo e resultado esperado

**Carta / mensagem.** A partir de uma candidatura, o usuário consegue:
1. abrir "Carta de apresentação" já com a vaga e o perfil carregados;
2. escolher formato (carta formal, e-mail curto, mensagem de LinkedIn/InMail), tom, tamanho e idioma (padrão: idioma do perfil);
3. ver a estimativa de tokens, gerar como job em segundo plano, e receber o texto na prévia editável;
4. ver sinalizados os trechos que usam fatos não verificados;
5. salvar como versão ligada à candidatura, copiar para a área de transferência, exportar `.txt`/`.md`/PDF (template simples do F05).

**LinkedIn.** O usuário consegue:
1. abrir "Otimizar LinkedIn" e escolher a fonte: export já ingerido (F03) ou colar o texto atual do perfil (headline, sobre, experiências);
2. gerar, em segundo plano, propostas de headline (3 opções), "sobre", cada experiência reescrita com conquistas e métricas, skills ordenadas por relevância para o perfil ativo, e um checklist de completude (foto, banner, URL personalizada, recomendações, certificações);
3. revisar lado a lado (atual × proposto), editar, aceitar por seção;
4. salvar como documento tipo `linkedin` versionado, copiar seção a seção.

### Dentro do escopo
- Skills `carta` e `linkedin` em `plugin/skills/`, com instruções de honestidade (nada que não esteja nos fatos; fatos não verificados marcados).
- Tools MCP: reutiliza `profile.get_card`, `experience.*`, `skill.list`, `application.get`, `document.save/list/get`, `file.get_digest`; adiciona `linkedin.get_current(source)` (lê o export ingerido ou o texto colado) e `document.annotate(unverified_refs)`.
- Páginas `/carta` e `/linkedin` no padrão L5 (parâmetros à esquerda, prévia à direita).
- Tipos de documento `cover_letter` e `linkedin` em `document`, com `content_json` estruturado por seção.
- Export simples: `.txt`, `.md`, PDF via template "Carta" (um template adicional ao motor do F05) e cópia por seção.
- Diferença atual × proposto para o LinkedIn.

### Fora do escopo (e para onde vai)
- Publicar no LinkedIn via API → não planejado (sem API pública adequada; o usuário cola manualmente).
- Envio de e-mail → não planejado em plan-v0.
- Ingestão do export do LinkedIn → F03 (F09 só consome).
- Templates visuais elaborados para carta → F05 cobre o motor; F09 adiciona um template simples.
- Rastreamento de "carta enviada" como etapa da candidatura → F07 (`application_event`); F09 apenas liga o documento à candidatura.
- Modo B: as skills funcionam no terminal (texto) e salvam via tools; a prévia editável e o diff são só da UI web.

---

## 2 · Arquitetura deste entregável

### 2.1 Fluxo da carta
```
UI /carta?applicationId= ─► GET /api/applications/:id + GET /api/profiles/active ─► formulário
POST /api/documents/generate {type:"cover_letter", applicationId, params} ─► job(type=document) ─► worker:
   SDK query() com plugin/ (skill carta), tools: profile.get_card, application.get, experience.get, skill.list, document.annotate
   outputFormat json_schema = CoverLetterContent {greeting, paragraphs[], closing, signature, unverified_refs[]}
   ─► document(type=cover_letter) + document_version(content_json, markdown) ─► WS job.done
UI prévia editável ─► PUT /api/documents/:id/versions (edição manual gera nova versão) ─► export
```
- O modelo produz **conteúdo estruturado**, nunca formatação. O Markdown exibido é derivado do JSON por `packages/core/documents/render.ts`.
- `unverified_refs[]` lista ids de fatos não verificados usados; a UI destaca os trechos e oferece "verificar fato" (abre o fato em Meus dados, F10) ou "remover trecho".

### 2.2 Fluxo do LinkedIn
```
UI /linkedin ─► escolher fonte: export (file_digest kind=linkedin, de F03) | texto colado (POST /api/texts kind=linkedin_paste)
POST /api/documents/generate {type:"linkedin", sourceFileId, params} ─► job(type=document) ─► worker:
   tools: linkedin.get_current(file_id), profile.get_card, experience.list/get, skill.list, document.annotate
   outputFormat = LinkedInContent {headlines[3], about, experiences[{experience_id, current, proposed}], skills_ordered[], checklist[]}
   ─► document(type=linkedin) + document_version ─► WS job.done
UI diff por seção (atual × proposto) ─► aceitar/editar por seção ─► PUT versão ─► copiar seção
```
- `linkedin.get_current` normaliza as duas fontes para o mesmo shape `{headline, about, experiences[], skills[]}`; para texto colado, usa heurística de seções (linhas em caixa alta, "Sobre", "Experiência") e, se falhar, trata tudo como `about`.
- Texto colado muito grande (> 30k chars) é truncado com aviso; o export do F03 já vem estruturado e não passa por heurística.

### 2.3 Skills
| Skill | Entradas | Regras principais |
|-------|----------|-------------------|
| `plugin/skills/carta/SKILL.md` | candidatura, perfil, formato, tom, tamanho, idioma | 1 carta por chamada; usar só fatos das tools; citar 2–3 conquistas com métrica quando existirem; sem clichês listados na skill; respeitar limite de palavras por formato (carta ≤ 350, e-mail ≤ 180, InMail ≤ 120); devolver `unverified_refs` |
| `plugin/skills/linkedin/SKILL.md` | fonte atual, perfil ativo | manter a voz do usuário; headline ≤ 220 chars; "sobre" ≤ 2.600 chars; cada experiência com 3–5 bullets, verbo de ação + métrica; não inventar métricas (se faltar, marcar `needs_metric`); skills ordenadas pela relevância ao `target_title` |

### 2.4 API
| Rota | Função |
|------|--------|
| `POST /api/documents/generate` | já existe em F05; aceita `type: cover_letter | linkedin` |
| `GET /api/documents?type=&applicationId=` · `GET /api/documents/:id` · `PUT /api/documents/:id/versions` | listar, abrir, versionar (F05, reutilizadas) |
| `GET /api/documents/:id/export?format=txt|md|pdf` | F05 estendida com `txt` |
| `GET /api/linkedin/sources` | exports ingeridos disponíveis (F03) |
| `POST /api/texts {kind: "linkedin_paste"}` | F01 estendida com `kind` |

Modelo padrão: Sonnet para ambas (qualidade de escrita), configurável em Configurações (F10). Cada geração grava `usage_event` com categoria `documentos`.

---

## 3 · Dados deste entregável

| Tabela | Alterações / colunas usadas |
|--------|-----------------------------|
| `document` (F05) | `type` ganha valores `cover_letter` e `linkedin`; `application_id?` (carta), `source_file_id?` (linkedin); `params_json` (formato, tom, tamanho, idioma) |
| `document_version` (F05) | `content_json` (schema por tipo), `markdown`, `unverified_refs_json`, `created_by` (model/user), `usage_event_id?` |
| `source_file` (F01) | `kind` ganha `linkedin_paste` |
| `linkedin_section_decision` (nova) | `id`, `document_version_id`, `section` (headline/about/experience:<id>/skills/checklist), `decision` (accepted/edited/rejected), `final_text`, `decided_at` (UTC) |

Schemas em `packages/shared/schemas/documents.ts`:
- `CoverLetterContent`: `format` (letter/email/inmail), `lang`, `greeting`, `paragraphs: string[]` (2–4), `closing`, `signature`, `word_count`, `unverified_refs: FactRef[]`.
- `LinkedInContent`: `headlines: string[3]`, `about`, `experiences: {experience_id, current?, proposed: {title, bullets[]}, needs_metric: bool}[]`, `skills_ordered: {name, reason}[]`, `checklist: {item, status: ok|missing|unknown, tip}[]`, `unverified_refs`.
- `FactRef`: `{kind, id, label}`.

Regras: documentos seguem o idioma do perfil salvo em `params_json.lang`; toda versão é imutável (edição cria nova); exclusão de documento é lógica (`deleted_at`) e some da exportação só em F10 "apagar tudo".

---

## 4 · Layouts deste entregável

| Tela | Componentes | Estados a cobrir |
|------|-------------|------------------|
| `/carta` (padrão L5) | esquerda: `ApplicationHeader`, `FormatSelect` (carta/e-mail/InMail), `ToneSelect`, `LengthSelect`, `LangSelect`, `EstimateBadge`, Gerar; direita: `DocumentPreview` editável (Markdown), `UnverifiedHighlights`, `VersionTabs`, ações copiar / exportar txt-md-pdf / salvar versão | sem candidatura selecionada · gerando (job na bandeja) · gerado · com fatos não verificados · versão editada não salva · erro |
| `/linkedin` | esquerda: `SourcePicker` (export ingerido / colar texto), `PasteEditor`, `EstimateBadge`, Gerar; direita: `SectionDiff` por seção (atual × proposto, aceitar/editar/rejeitar), `HeadlineOptions` (3 cartões), `SkillsOrdered`, `Checklist`, ações copiar seção / salvar versão | sem fonte · texto colado curto · gerando · gerado · seção aceita/editada · todas decididas |
| Candidatura → aba Documentos (F07) | lista cartas ligadas com versão e data no fuso do usuário | vazio · com cartas |
| Chat (F04) | botão de ação sugerido "Escrever carta para esta vaga" abre `/carta?applicationId=` preenchido | — |

Regras de UI: textos via `t()`; trechos não verificados com sublinhado pontilhado e tooltip "baseado em fato não verificado: <label>"; contador de palavras/caracteres com limite por formato/campo.

---

## 5 · Decisões em aberto deste entregável

| # | Decisão | Opções | Padrão proposto |
|---|---------|--------|-----------------|
| F09-1 | Quantidade de headlines | 3 · 5 | **3** |
| F09-2 | Carta: uma variante por geração ou duas (formal + curta) | 1 · 2 | **1** (o usuário regenera com outros parâmetros; economiza tokens) |
| F09-3 | Heurística de seções do texto colado | regex simples · modelo faz a divisão | **regex**; modelo só se falhar (custo extra avisado) |
| F09-4 | Export PDF da carta | template "Carta" no motor F05 · só txt/md | **template "Carta"** (reuso barato do motor) |
| F09-5 | Decisões por seção do LinkedIn persistidas | sim (`linkedin_section_decision`) · só na versão final | **sim**, para retomar a revisão |
| F09-6 | Modelo padrão | Sonnet · Haiku | **Sonnet** |

---

## 6 · O que precisa estar coberto para o F09 funcionar

### 6.1 Pré-requisitos e dependências
1. **F04**: chat, `plugin/`, MCP HTTP, sessões com categoria, botões de ação sugeridos.
2. **F05**: tabelas `document`/`document_version`, `POST /api/documents/generate` com job, `DocumentPreview` editável, motor de export e ao menos um template; F09 adiciona o template "Carta".
3. **F07**: `application` e aba Documentos da candidatura.
4. **F03**: ingestão do export do LinkedIn produzindo `file_digest` com `kind=linkedin` e dados estruturados; sem F03, a página aceita apenas texto colado (degradação prevista).
5. **F01**: `POST /api/texts` com `kind`, jobs, `usage_event`, i18n, `time.ts`.

### 6.2 Testes unitários (Vitest) · obrigatórios
**`packages/shared`**
- `CoverLetterContent` e `LinkedInContent`: aceitam fixtures válidas, rejeitam parágrafos fora de 2–4, headline > 220 chars, "sobre" > 2.600 chars, experiência sem bullets; JSON Schema estável (snapshot).
- Limites por formato (`wordLimits`): carta 350, e-mail 180, InMail 120; função `countWords` com pt-BR/en-US (acentos, hifens).

**`packages/core`**
- `documents/render.ts`: JSON → Markdown determinístico para os dois tipos (snapshot); trechos não verificados viram marcação `[[unverified:<id>]]` que a UI converte em destaque.
- `linkedin/normalize.ts`: export do F03 → shape comum; texto colado com seções detectadas; texto sem seções → tudo em `about`; truncamento em 30k chars com flag.
- Repos: salvar `document(type=cover_letter)` ligado à candidatura; versão nova por edição; `linkedin_section_decision` upsert por seção.

**`apps/api`**
- `POST /api/documents/generate` com `MockProvider`: carta → job → versão com `content_json` válido; linkedin → idem; parâmetros inválidos (formato desconhecido) → 400; candidatura inexistente → 404.
- Worker: valida que o `query()` (mockado) recebe `plugins`, tools restritas à lista da skill, `outputFormat` correto, `model` da configuração; `structured_output` inválido → job `error` com mensagem e retry permitido.
- `document.annotate`: ids inexistentes são ignorados com aviso; ids de fatos verificados não entram em `unverified_refs`.
- `GET /api/linkedin/sources` lista só exports do usuário com `kind=linkedin`.
- Export `txt`/`md`/`pdf`: conteúdo e content-type corretos; PDF usa o template "Carta".
- `usage_event` com categoria `documentos` por geração.

**`apps/web`**
- `/carta`: formulário bloqueia Gerar sem candidatura; estimativa atualiza ao mudar tamanho; prévia editável cria estado "não salvo"; `UnverifiedHighlights` renderiza destaques a partir da marcação; copiar usa `navigator.clipboard` (mockado).
- `/linkedin`: `SourcePicker` alterna export/colar; `PasteEditor` mínimo 100 chars; `SectionDiff` aceitar/editar/rejeitar persiste via API (mockada); `HeadlineOptions` seleção única; contador de chars por campo com limite.
- Botão de ação do chat navega com `applicationId` preenchido.
- i18n: nenhuma string literal fora do dicionário (teste de varredura do F01 estendido às novas pastas).

### 6.3 Testes e2e (Playwright, Chromium) · obrigatórios
Com `NARNIA_PROVIDER=mock` e fixtures determinísticas de carta e LinkedIn.
- **E2E-01 carta completa**: candidatura fixture → `/carta` → formato e-mail, en-US → gerar → job na bandeja → prévia com ≤ 180 palavras → salvar → aparece na aba Documentos da candidatura com data no fuso do usuário.
- **E2E-02 fato não verificado**: fixture com uma experiência não verificada → carta gerada destaca o trecho → "remover trecho" → nova versão sem o destaque.
- **E2E-03 edição e versões**: editar a prévia → salvar → v2; abrir v1 → conteúdo original intacto.
- **E2E-04 export**: txt, md e pdf baixam com conteúdo esperado (pdf: tamanho > 0 e texto extraído contém a saudação).
- **E2E-05 LinkedIn por texto colado**: colar fixture de perfil → gerar → 3 headlines, "sobre", 2 experiências com bullets, checklist → aceitar headline 2, editar "sobre", rejeitar uma experiência → salvar → recarregar → decisões mantidas.
- **E2E-06 LinkedIn por export ingerido**: com fixture de F03 ingerida → fonte "export" listada → gerar → diff mostra "atual" preenchido a partir do export.
- **E2E-07 sem fonte**: `/linkedin` sem export e sem texto → Gerar desabilitado com orientação.
- **E2E-08 erro de geração**: mock devolve saída inválida → job com erro na bandeja → "tentar de novo" conclui.
- **E2E-09 uso contabilizado**: duas gerações → `GET /api/usage/summary` mostra categoria `documentos` com 2 eventos.

### 6.4 Teste manual com provider real (antes de fechar F09)
Com Sonnet: 3 cartas (carta formal pt-BR, e-mail en-US, InMail pt-BR) para 3 vagas reais e 1 otimização de LinkedIn com o perfil real do autor. Avaliar: aderência aos limites, ausência de fatos inventados (cruzar com Meus dados), qualidade do tom, utilidade do checklist, tokens reais × estimativa. Registrar em §8; decide F09-2 e F09-6.

### 6.5 Definição de pronto
- Testes de 6.2 e 6.3 verdes na CI; cobertura ≥ 80% em `packages/core/documents` e `packages/core/linkedin`.
- Checklist de 6.4 preenchido sem nenhuma ocorrência de fato inventado.
- Skills `carta` e `linkedin` funcionam também no modo B (`/narnia-jobs:carta` no terminal salva documento via tools; verificado manualmente).
- `../02 §F5`, `../03 §5` (tools novas), `../04 §C` e `../05` atualizados.

---

## 7 · Riscos específicos
| Risco | Mitigação |
|-------|-----------|
| Modelo inventar métricas na carta/LinkedIn | skill proíbe; `needs_metric` em vez de número; teste manual cruza com fatos; destaque de não verificados |
| Texto colado do LinkedIn em formatos imprevisíveis | heurística tolerante + fallback "tudo em sobre"; usuário pode editar antes de gerar |
| Limites de caracteres do LinkedIn mudarem | limites em `packages/shared` como constantes versionadas, não na skill |
| Carta genérica/clichê | lista de clichês proibidos na skill; teste manual avalia; parâmetro de tom |
| Dependência de F05 atrasar F09 | se F05 atrasar, F09 pode entrar com export só txt/md e `DocumentPreview` mínimo, e ganhar PDF depois |

## 8 · Registro de execução
(Preencher durante a implementação: datas, resultados do teste manual, decisões tomadas.)
