# F10 · Gestão de dados, medidor de uso e configurações

Entregável 10 do plan-v0. Cobre o fluxo **F6** de `../02-fluxos-do-usuario.md` (gestão de dados), o medidor de uso completo e o "limpar cache" definidos em `../03-arquitetura.md §15`, e a tela de Configurações (`../05-layouts.md L9`). Fecha o que F01 deixou como fundação (`usage_event` próprio, dashboard mínimo) e dá ao usuário controle total sobre o que o sistema guarda e gasta. Depende de F01 (banco, jobs, `usage_event`), F04 (sessões de chat com categoria e `provider_session_id`) e, para as seções de integrações/voz/templates, de F03, F07, F08 e F05 (cada seção degrada para "em breve" se a task correspondente não estiver pronta).

Status: **em escopo** (2026-10-07). Nada implementado.

---

## 1 · Objetivo e resultado esperado

O usuário consegue:

1. em **Meus dados**, ver e editar qualquer fato (experiência, conquista, projeto, skill, formação, idioma, preferência) com sua fonte e selo de verificação; filtrar "só não verificados"; abrir o cartão de cada arquivo com o registro de contexto (digest) e editá-lo; excluir um fato;
2. **exportar tudo** (JSON dos dados + arquivos originais + digests + documentos gerados) em um zip, e **apagar tudo** com confirmação dupla;
3. ver o **medidor de uso** completo: tokens e custo equivalente por dia, por janela de 5 h, por semana, por modelo, por categoria e por conversa, combinando os logs do Claude Code e os logs próprios;
4. **limpar cache** por categoria ou por conversa, vendo antes um resumo do que será apagado, sem perder nenhum fato, arquivo ou documento;
5. em **Configurações**, ajustar provider, modelos padrão por tarefa, limite por sessão, pasta de dados, integrações (GitHub, Google), voz, templates, porta/fuso, tema e idioma;
6. rodar `narnia-jobs doctor` e receber um diagnóstico acionável.

### Dentro do escopo
- Página Meus dados completa (L4), com edição inline, histórico de alterações por fato e exclusão.
- Exportar/apagar tudo, com job em segundo plano para a exportação.
- Coletor de logs do Claude Code (`usage-collector`) rodando como job periódico no container + leitura dos logs próprios; tabela `usage_event` completa; `usage_import_cursor`.
- Telas de uso (L9 bloco "Uso do plano" + página `/uso` detalhada).
- "Limpar cache" por categoria e por conversa.
- Configurações completas (L9), com cada seção degradando para "em breve" quando a task dona ainda não existir.
- `narnia-jobs doctor` no lançador e `GET /api/doctor` na API.

### Fora do escopo (e para onde vai)
- Ingestão/re-ingestão de arquivos → F03 (F10 só exibe e edita o que existe).
- Criação/edição de perfis → F02 (F10 mostra o perfil ativo e linka).
- Conteúdo das seções de voz (F08), templates (F05), Google Calendar (F07), GitHub token (F03): F10 cria a moldura e os campos; a lógica pertence às tasks donas.
- Medidor para o Codex → F11.
- Limites exatos do plano Pro/Max → não publicados pela Anthropic; o medidor mostra consumo e, se o usuário informar o plano, uma estimativa marcada como tal.

---

## 2 · Arquitetura deste entregável

### 2.1 Meus dados
```
UI /dados/{identidade|experiencias|projetos|skills|formacao|preferencias|evidencias}
  ─► GET /api/facts?kind=&verified=&q=   (paginado, FTS5)
  ─► PUT /api/facts/:kind/:id  ─► fact_history (antes/depois, UTC) ─► fact.verified = 1 quando editado pelo usuário
  ─► DELETE /api/facts/:kind/:id ─► exclusão lógica (deleted_at); referências em documentos continuam válidas
  ─► GET /api/files/:id (cartão com digest) · PUT /api/files/:id/digest (edited_by_user = 1)
```
Toda escrita invalida `profile.card_json` do(s) perfil(is) afetado(s) (regra de `../03 §5`).

### 2.2 Exportar e apagar
- `POST /api/export` → job `export` → zip em `/data/exports/narnia-jobs-export-<UTC>.zip` com `data.json` (todas as tabelas de fatos, perfis, candidaturas, documentos, uso), `uploads/`, `digests/`, `documents/`, `README.txt` (versão do schema). Nunca inclui `config.json`, chaves, nem logs do Claude Code.
- `POST /api/wipe` com `confirm: "<nome do usuário>"` e segundo passo com token de confirmação enviado pelo WS → apaga tabelas de dados, `/data/uploads`, `/data/digests`, `/data/documents`, `/data/logs`, sessões do CLI criadas pelo Narnia; mantém `config.json` e o volume `claude-auth` (login). Depois, redireciona para o onboarding.

### 2.3 Medidor de uso
```
job periódico usage-collector (a cada 60 s e ao final de cada sessão/turno)
  ├─ fonte claude-log: varre /home/node/.claude/projects/**/*.jsonl (volume claude-auth)
  │     parser tolerante por versão (fixtures); extrai por mensagem: ts, provider_session_id, model,
  │     input/output/cache_read/cache_write tokens ─► usage_event(origin=claude-log)
  │     usage_import_cursor por arquivo (offset em bytes) para leitura incremental
  ├─ fonte narnia: /data/logs/usage-YYYY-MM-DD.jsonl (já gravado desde F01) ─► usage_event(origin=narnia)
  └─ dedupe: chave (provider_session_id, ts arredondado a 1 s, model); quando ambas existem, mantém claude-log
        como "oficial" e preserva categoria/feature/session_id do evento narnia (join por provider_session_id)
GET /api/usage/summary?group=day|window5h|week|model|category|session&from=&to=   (UTC; UI converte)
GET /api/usage/events?session_id=|category=   (detalhe paginado)
```
- Janela de 5 h: alinhada ao primeiro evento da janela corrente (comportamento aproximado do plano; marcado como estimativa na UI).
- Custo equivalente: tabela de preços por modelo em `packages/shared/pricing.ts`, versionada com data; a UI mostra "equivalente em API, estimativa".
- Modo B: logs do Claude Code do host não estão no volume; Configurações aceita um caminho extra montado (`NARNIA_CLAUDE_LOGS_DIR`) ou aceita que só os eventos `narnia` (vindos das tools MCP, parciais) apareçam, com aviso.

### 2.4 Limpar cache
```
POST /api/cache/preview {scope: "category"|"session", id}  ─► resumo: sessões (n), mensagens (n), usage_events (n), logs próprios (bytes), sessões do CLI a apagar (ids)
POST /api/cache/clear   {scope, id, confirm: true}          ─► job cache-clear:
   1. encerra sessões vivas do SDK no escopo (abort + hibernação cancelada)
   2. apaga a sessão do Claude Code correspondente (arquivo JSONL em /home/node/.claude/projects/** e metadados)
   3. apaga chat_message, chat_session, interview_turn (se categoria entrevista), usage_event e linhas dos logs próprios do escopo
   4. NUNCA toca em fatos, arquivos, digests, documentos, candidaturas
```
Para apagar a sessão do CLI, o job remove o arquivo de transcript da sessão no volume. Antes de implementar, verificar na documentação do Claude Code se há comando oficial de remoção de sessão e preferi-lo ao apagamento direto do arquivo (ver F10-4).

### 2.5 Configurações e doctor
- `GET/PUT /api/settings`: valida com schema; cada seção tem `owner_task` e `available: bool` (a UI mostra "em breve" quando falso).
- Modelos padrão por tarefa: `chat`, `ingest`, `documents`, `interview`, `clarify`; limite de tokens por sessão com aviso em 80 %.
- **Seletor de modelo para CV e texto livre** (F03-41, registrado em 2026-10-10 pelas correções da auditoria F03, item 17): `POST /api/ingestions` do F01 passa a aceitar `model` (padrão por profundidade, como no GitHub), e o passo de fonte do onboarding e a aba Currículo/Texto livre da Ingestão ganham o mesmo seletor de modelo da análise do GitHub; a estimativa e a autoconfirmação (F03-13) usam o modelo escolhido.
- **Apagar perfil** (decisão F02-6, 2026-10-08): só para perfil **arquivado** (perfil ativo ou não arquivado → 409); cascata explícita de documentos, candidaturas, ênfases e sugestões, com confirmação que lista o que vai junto e exige digitar o nome do perfil.
- **Jobs em segundo plano** (sugestão do dono, 2026-10-08): concorrência por fila (`jobs.concurrency.<fila>`), aplicada aos workers em tempo de execução sem reiniciar; a página de processos (definida em F05 §2.5) ganha aqui o link em Configurações e o histórico com limpeza.
- `GET /api/doctor` e `narnia-jobs doctor` (lançador): versão do Node/CLI, `claude auth status`, pasta de dados gravável e espaço livre, porta em uso, volume `claude-auth` presente, coletor de uso rodando, última ingestão/sessão, `NARNIA_DATA_DIR` fora de um repositório git, templates e modelos de voz instalados. Saída humana e `--json`.

---

## 3 · Dados deste entregável

| Tabela | Colunas principais |
|--------|--------------------|
| `usage_event` (completa F01) | `id`, `ts` (UTC), `origin` (narnia/claude-log), `provider` (claude-code/codex), `provider_session_id?`, `session_id?` (chat), `category` (carreira/ingestão/documentos/entrevista/clarificação/sistema), `feature?`, `job_id?`, `model`, `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`, `cost_usd_est`, `dedupe_key` (único), `source_file?`, `source_offset?` |
| `usage_import_cursor` | `path` (PK), `offset_bytes`, `inode_or_id`, `last_ts`, `updated_at`, `parser_version` |
| `settings` (completa F01) | `key`, `value_json`, `updated_at`; chaves: `provider.active`, `models.*`, `session.token_limit`, `data.dir`, `integrations.github.has_token`, `integrations.google.connected`, `voice.*` (F08), `templates.default` (F05), `ui.theme`, `ui.locale`, `user.timezone`, `plan.name?` |
| `fact_history` | `id`, `kind`, `fact_id`, `before_json`, `after_json`, `changed_by` (user/agent/ingest), `changed_at` (UTC) |
| `export_run` | `id`, `job_id`, `path`, `size_bytes`, `schema_version`, `created_at` |
| todas as tabelas de fato | ganham `deleted_at?` (exclusão lógica) |

Regras:
- `dedupe_key = sha1(provider_session_id|ts_1s|model|input|output)`; inserção `ON CONFLICT DO NOTHING`.
- Retenção: `usage_event` guardado por 13 meses; logs próprios rotacionados por dia e comprimidos após 30 dias; "limpar cache" não espera a retenção.
- Preços em `pricing.ts` com `valid_from`; eventos usam o preço vigente na data do evento.

---

## 4 · Layouts deste entregável

Referência: `../05-layouts.md` L4 e L9.

| Tela | Componentes | Estados a cobrir |
|------|-------------|------------------|
| Meus dados (L4) | `DataTabs`, `FactList` com `FactCard` (selo ● verificado / ◐ extraído, fonte, editar inline, excluir), `FilterBar` (não verificados, busca, perfil), `FactHistoryDrawer`, `FileCard` com `DigestEditor` | vazio · com fatos · filtro ativo · edição com erro de validação · exclusão (confirmação) · histórico |
| `/uso` | `UsageHeader` (hoje, janela 5 h, semana, com barras), `UsageChart` (por dia), `UsageBreakdown` (modelo / categoria / sessão, alternável), `UsageTable` (eventos, paginada, horários no fuso do usuário), `PlanEstimateBanner` (se plano informado), botão "Limpar cache" | sem eventos · coletor nunca rodou · coletor com erro de parse (aviso + versão) · com dados · modo B sem logs do host |
| Modal Limpar cache | `ScopePicker` (categoria / conversa), `PreviewSummary` (contagens), `ConfirmCheckbox`, botão Limpar | prévia carregando · nada a apagar · confirmando · concluído |
| Configurações (L9) | `SettingsSections`: Provider, Modelos, Limites, Pasta de dados, Dados (exportar/apagar), Integrações, Voz, Templates, Porta/Fuso, Aparência/Idioma, Diagnóstico (`DoctorPanel`) | cada seção disponível / "em breve" · salvo · erro de validação · exportação em andamento (bandeja) · apagar tudo (duas confirmações) · doctor ok / com falhas |
| Shell (L0) | `UsageMini` no painel direito passa a ler o resumo real | — |

Regras de UI: nunca exibir chaves/tokens em claro (`has_token`); horários via `formatInUserTz`; textos via `t()`; o idioma da UI muda sem recarregar.

---

## 5 · Decisões em aberto deste entregável

| # | Decisão | Opções | Padrão proposto |
|---|---------|--------|-----------------|
| F10-1 | Versões do formato de log do CLI suportadas | só a versão fixada na imagem · últimas N versões com fixtures | **versão fixada + 2 anteriores**, fixtures por versão; parser tolerante a campos desconhecidos |
| F10-2 | Retenção de `usage_event` | 13 meses · ilimitada · configurável | **13 meses**, configurável |
| F10-3 | O que "cache" inclui | sessões + logs + histórico de chat · também documentos gerados na conversa | **só sessões, logs e histórico**; documentos nunca |
| F10-4 | Remoção da sessão do CLI | comando oficial (se existir na doc) · apagar arquivo de transcript | **comando oficial se documentado; senão apagar arquivo**, com teste de fixture |
| F10-5 | Frequência do coletor | 60 s · ao final de cada turno · ambos | **ambos** |
| F10-6 | Exclusão de fato | lógica · física | **lógica**, purga só em "apagar tudo" |
| F10-7 | Janela de 5 h | alinhada ao primeiro evento · relógio fixo | **primeiro evento**, rotulada "estimativa" |
| F10-8 | Plano informado pelo usuário | opcional com estimativa de % · não oferecer | **opcional**, limites como campos editáveis (não publicados oficialmente) |
| F10-9 | Formato de exportação | zip com JSON + arquivos · só JSON | **zip** |

---

## 6 · O que precisa estar coberto para o F10 funcionar

### 6.1 Pré-requisitos e dependências
1. **F01**: banco, jobs, `usage_event` básico, logs JSONL próprios, `settings`, i18n, `time.ts`, lançador.
2. **F04**: `chat_session` com `category` e `provider_session_id`; sessões vivas controláveis (abort/hibernar).
3. **F02**: perfil ativo (filtro em Meus dados).
4. Fixtures reais de logs do Claude Code na versão fixada na imagem (coletadas durante F04 e anonimizadas) para o parser.
5. Verificação documental: comando oficial de listagem/remoção de sessão do Claude Code (para F10-4); caminho e formato dos transcripts em `~/.claude/projects`.
6. Seções de terceiros (F03, F05, F07, F08): F10 entrega as molduras; a disponibilidade vem por `available`.

### 6.2 Testes unitários (Vitest) · obrigatórios
**`packages/core`**
- `usage/parser-claude-log.ts`: fixtures por versão suportada → eventos corretos (modelo, tokens, cache, ts UTC, `provider_session_id`); linha malformada é pulada com contagem de erros; campos desconhecidos ignorados; arquivo truncado no meio de uma linha não quebra e o cursor fica na última linha completa.
- `usage/cursor.ts`: leitura incremental por offset; arquivo recriado (inode diferente) reinicia do zero; arquivo encolhido reinicia.
- `usage/dedupe.ts`: mesmo evento nas duas fontes → um registro, `origin=claude-log`, categoria herdada do evento narnia; eventos distintos a 2 s de distância não colidem.
- `usage/summary.ts`: agregações por dia/janela 5 h/semana/modelo/categoria/sessão com eventos sintéticos; janela alinhada ao primeiro evento; custo com preço vigente na data (`pricing.ts` com duas vigências).
- `facts/update.ts`: edição grava `fact_history` e marca `verified=1`; invalida `card_json` dos perfis afetados; exclusão lógica mantém referências.
- `export.ts`: zip contém `data.json` válido contra o schema, todos os uploads/digests/documentos, nenhum `config.json`/chave/log do CLI; `wipe.ts` apaga só o previsto e preserva `config.json`.
- `cache/clear.ts`: prévia conta corretamente por categoria e por conversa; execução apaga sessões/mensagens/eventos/logs do escopo e **nada** de fatos/arquivos/documentos (asserção por contagem antes/depois em todas as tabelas).
- `settings`: validação por chave; seção indisponível rejeita escrita com 409.

**`apps/api`**
- Rotas de fatos: listagem paginada com FTS5 (`q`), filtro `verified=0`, PUT com validação por tipo, DELETE lógico, histórico.
- `/api/usage/summary` e `/events`: parâmetros, limites de data em UTC, 400 em `group` inválido.
- `/api/cache/preview` e `/clear`: exige `confirm`; encerra sessões vivas (SDK mockado) antes de apagar; idempotente.
- `/api/export`: cria job; download só com token; `/api/wipe`: exige nome correto e segundo fator pelo WS; após wipe, `/api/onboarding/state` volta ao passo 1.
- `/api/doctor`: cada verificação isolada com mocks (CLI ausente, pasta sem escrita, porta ocupada, pasta dentro de repo git).
- Coletor como job periódico: agenda, não sobrepõe execuções, registra última execução e erros.

**`apps/web`**
- `FactCard`: edição inline com validação, selo, fonte, excluir com confirmação; `FilterBar` combina filtros; `FactHistoryDrawer` mostra antes/depois.
- `DigestEditor`: salva com `edited_by_user`.
- `/uso`: renderiza resumo, alterna agrupamentos, tabela paginada com horários no fuso do usuário (mock de fuso), banner de estimativa só com plano informado, aviso quando coletor tem erro.
- Modal Limpar cache: prévia, checkbox obrigatório, chamada de API, estado concluído.
- Configurações: seções indisponíveis desabilitadas com rótulo; salvar por seção; troca de idioma da UI atualiza textos sem reload; apagar tudo exige as duas confirmações.
- `DoctorPanel`: renderiza lista de checagens com estado e ação sugerida.
- i18n: varredura de literais estendida às novas pastas.

### 6.3 Testes e2e (Playwright, Chromium) · obrigatórios
- **E2E edição de fato invalida cartões (decisão F02-10, 2026-10-08)**: seed `engineer` com dois perfis → em Meus dados editar o título de uma experiência pela interface → WS `profile.card_invalidated` chega → os cartões dos dois perfis mostram "desatualizado" → abrir cada um reconstrói com nova data e o título novo aparece no cartão do perfil que destaca essa experiência; apagar a experiência remove ênfase e relevância e o cartão deixa de citá-la. Substitui a versão de F02 (que altera o fato por `_test/facts`).
Com `NARNIA_PROVIDER=mock`, banco semeado (fixtures de fatos, sessões e eventos), e logs de CLI fixture copiados para o volume de teste.
- **E2E-01 editar fato**: abrir Meus dados → editar título de uma experiência → selo passa a verificado → histórico mostra antes/depois → cartão do perfil no dashboard reflete.
- **E2E-02 filtro não verificados**: filtrar → só fatos ◐ → verificar um → some do filtro.
- **E2E-03 excluir fato**: excluir skill → some da lista → exportação não a inclui → documento que a referenciava continua abrindo.
- **E2E-04 cartão de arquivo**: abrir evidência → digest visível → editar resumo → salvar → reabrir mantém.
- **E2E-05 medidor com duas fontes**: logs fixture do CLI + eventos narnia → `/uso` mostra totais sem duplicidade (valor esperado da fixture) → alternar por categoria e por conversa.
- **E2E-06 limpar cache por conversa**: escolher conversa → prévia com contagens → limpar → conversa some do chat e do medidor → fatos e documentos inalterados (contagem via API).
- **E2E-07 limpar cache por categoria**: categoria `ingestão` → eventos somem → arquivos e fatos ingeridos permanecem.
- **E2E-08 exportar tudo**: iniciar → job na bandeja → baixar zip → conteúdo validado (data.json + uploads).
- **E2E-09 apagar tudo**: primeira confirmação → segunda → redireciona ao onboarding → `./data` sem uploads/digests → login do CLI preservado (`/api/provider/status` continua logado no mock).
- **E2E-10 configurações**: mudar modelo padrão de chat e fuso → recarregar → valores mantidos → horários da tabela de uso mudam com o fuso.
- **E2E-11 doctor**: `narnia-jobs doctor --json` contra o compose de teste → todas as checagens `ok`; com pasta de dados somente leitura → checagem falha com mensagem.
- **E2E-12 seção em breve**: com F08 desligado por flag → seção Voz aparece como "em breve" e não aceita escrita.

### 6.4 Teste manual com provider real (antes de fechar F10)
Com login real: 3 sessões de chat em categorias diferentes + 1 ingestão; comparar o total do medidor com o que o próprio Claude Code reporta (`/cost` ou equivalente na sessão interativa) e com a contagem dos JSONL; limpar o cache de uma conversa e confirmar que a sessão não aparece mais em `claude` (listagem de sessões) nem no medidor. Registrar em §8; decide F10-1 e F10-4.

### 6.5 Definição de pronto
- Testes de 6.2 e 6.3 verdes na CI; cobertura ≥ 85 % em `packages/core/usage` e `packages/core/cache` (apagam dados: exigem rigor extra).
- Diferença entre o medidor e a contagem direta dos JSONL ≤ 1 % no teste manual.
- "Limpar cache" e "apagar tudo" nunca removem fatos/arquivos/documentos (asserção automatizada em todas as tabelas).
- `narnia-jobs doctor` documentado no README; Configurações com todas as seções da L9.
- `../02 §F6`, `../03 §15`, `../04 §C2` e `../05 L4/L9` atualizados.

---

## 7 · Riscos específicos
| Risco | Mitigação |
|-------|-----------|
| Formato dos JSONL do Claude Code mudar sem aviso | parser por versão com fixtures; falha de parse vira aviso na UI, nunca bloqueio; eventos `narnia` continuam |
| Duplicidade ou falta de eventos no dedupe | chave estável + testes com fixtures reais; tela mostra origem de cada evento no detalhe |
| Apagar a sessão errada do CLI | mapeamento `chat_session.provider_session_id` obrigatório; prévia lista ids; só apaga sessões criadas pelo Narnia |
| Exportação grande (uploads/documentos) travar a API | job em segundo plano com streaming do zip para disco; progresso na bandeja |
| Wipe acidental | nome do usuário + segundo fator por WS; botão fora do fluxo normal; log do evento |
| Limites do plano não publicados | medidor mostra consumo; % só com plano informado e rótulo "estimativa" |

## 8 · Registro de execução
(Preencher durante a implementação: datas, versão do CLI e dos logs, diferença medida, decisões tomadas.)
