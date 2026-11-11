# F14 · Leitura de e-mails (Gmail)

Entregável 14 do plan-v0. O narnia lê a caixa do Gmail da pessoa e transforma os e-mails de vagas em dados: alertas viram vagas num **feed**, confirmações viram candidaturas com a data e hora do e-mail, negativas encerram a candidatura, atualizações entram no histórico (e movem a etapa quando a confiança permite) e convites de entrevista viram etapas na agenda. Depende de F06 (vagas, extração, duplicata, `browser`), F07 (candidaturas, agenda, `.ics`, reject), F12 (captura que completa vaga com link fechado) e do gate de prompts (F04-avaliacoes M7).

Status: **aprovado pelo dono em 2026-11-11; M1 em andamento**. Decisões F14-1 a F14-15 fechadas com o dono; revisão contra o código em §2.0; falta a aprovação do plano; M0 passou em 2026-11-11 (§10); falta o `check` de expiração em 2026-11-19.

---

## 1 · Objetivo e resultado esperado

Com o Gmail conectado, a pessoa consegue:

1. escolher, na primeira execução, quanto tempo para trás ler (7, 30, 90 dias ou uma data);
2. ver as vagas dos alertas num feed ordenado por match, com a origem (e-mail, plataforma) e a flag "link não abriu";
3. ter as candidaturas criadas, atualizadas e encerradas pelos e-mails, com a data e hora de cada um e o link do e-mail como referência;
4. aprovar ou desfazer o que o narnia fez com cada e-mail;
5. encontrar, no Gmail, todo e-mail processado com a etiqueta `narnia-jobs` e marcado como lido; a exceção é o e-mail em quarentena, que recebe `narnia-jobs/suspeito` e **continua não lido** (F14-14).

### Dentro do escopo
- Conexão OAuth com o cliente da própria pessoa (o mesmo do Calendar), escopo `gmail.modify`.
- Sincronização no worker: janela inicial, depois `history.list` no intervalo configurado (F14-8).
- Classificação (alerta, candidatura recebida, negativa, atualização, convite, fora do assunto) e extração.
- Feed de vagas; pré-análise automática acima do corte (F14-6).
- Ligação e-mail → vaga → candidatura; perfil (F14-5); movimento de etapa com aprendizado (F14-2).
- Convites: `.ics` por código, etapa provisória, bloqueio por clique (F14-3).
- Caixa de revisão, desfazer por e-mail, Configurações (conexão, janela, corte, taxa de acerto).
- **Tela de tarefas agendadas** (F14-12): todas as rotinas periódicas do narnia, com o log de cada execução e o que ela tocou (e-mails lidos, vagas, candidaturas).
- **Risco do e-mail e confiabilidade do remetente** (F14-13): nada de abrir link, anexo ou agir sozinho a partir de e-mail de risco alto.

### Fora do escopo (e para onde vai)
- MCP do Gmail no chat do recrutador → futuro (F14-4).
- Outlook/IMAP → futuro, pela interface `MailSource`.
- Push (Pub/Sub `users.watch`) → exige endpoint público; a instância é local.
- Rascunho de follow-up (`drafts.create`) em candidatura parada → sugestão futura (§9).
- Enviar e-mail → nunca.

---

## 2 · Arquitetura

### 2.0 Revisão contra o código (2026-11-11)

Levantamento no commit `f93815e`. Para cada peça reaproveitada: onde está, o que muda e os **testes de regressão (RT)**, escritos **antes** de mexer, verdes no código atual, que travam o comportamento que não pode mudar. Os RT entram no começo do marco que toca a peça (§6).

#### 2.0.1 Vagas (F06, F12)
| Peça | Onde | O que muda na F14 |
|---|---|---|
| Busca do link (fetch simples → JSON-LD → `browser`, anti-SSRF, robots) | `apps/api/src/postings/fetch.ts` (`fetchPostingPage`, `extractPosting`), `browser.ts` | nada no fetch; chamado também pelo worker do e-mail |
| Entrada da vaga | `apps/api/src/services/postings.ts` `intakePosting`, `packages/core/src/postings/ingest.ts` `createPostingFromIntake` | hoje **link que falha não cria vaga** e texto < 200 caracteres é recusado: entra um caminho próprio `intakePostingFromMail` (cria com os campos do e-mail, `link_status=failed`, sem exigir JD; heurística só se houver texto) sem mudar a rota atual |
| Origem dos campos | `FieldSourceSchema` (`packages/shared/src/schemas/posting.ts:62`) | nova origem `email`, abaixo de `user` (o que veio do e-mail pode ser corrigido pelo modelo e pela extensão) |
| Link canônico | `canonicalUrl`/`samePostingUrl` (`packages/core/src/extension/captures.ts:15/30`), só na comparação | ganhar LinkedIn (`/comm/jobs/view/<id>` = `/jobs/view/<id>`, `midToken`, `midSig`, `eid`, `otpToken`, `trackingId`) e ids numéricos; coluna nova `canonical_url` indexada |
| Duplicata | `identity.ts`, `duplicatePostings`/`decideDuplicate` (`ingest.ts:151/209`), `posting.extract` | candidatas pela coluna `canonical_url` e pelo `identity_hash` **em SQL** (hoje passam pelo `list()` com teto de 500); alerta com N vagas: uma comparação pelo modelo por vaga com candidata (teto por rodada) |
| Captura da extensão | `apps/api/src/routes/extension.ts` (`POST /captures/:id/posting` sempre cria vaga nova) | se a captura casa pelo link canônico com uma vaga `source=email` e `link_status=failed`, **completa essa vaga** (junção sem perguntar, campos `email` cedem) |
| Pré-análise sem tokens | `buildPreAnalysis` (`match.ts:157`), `coverage`, `risksByProfile` | base do `match_score` do feed (cobertura − penalidade dos riscos do melhor perfil), calculada no intake |
| Pré-análise automática (F14-6) | análise = conversa (`openPostingAnalysis`, teto `maxLiveSessions`) | não serve em lote: a automática entra numa fila própria, **uma por vez**, respeitando o teto de conversas vivas; `POSTING_TASKS.analyze` existe sem processador |
| Arquivar | `setArchived`, `PostingArchiveReasonSchema`, check da 0028 | motivo `stale` (reconstrução da tabela na migração); **fora** do diálogo (`PostingArchive.tsx:71` lê o schema), de `discardedPostings` (`tools.ts:233`), de `savedPostingsText` (`cli-evals.ts:86`) e da instrução do `recrutador-especializado` |
| Lista de vagas | `GET /api/postings` → `searchPostings`, `PostingsPage.tsx`, `usePostings` | feed = filtro novo (`feed=1`, ordem por `match_score`), não uma página paralela |
| Contatos | `postingContactsRepo.add/findDuplicate`, `posting.contact_add` | contato de recrutador vindo do e-mail usa `add` com `findDuplicate` (sugestão futura, §9) |

**RT das vagas:** (RT-V1) rota de intake com link que falha por `robots`, `http_error`, `timeout` → status e **nenhuma vaga** gravada; (RT-V2) intake com texto **e** link grava o link sem buscar; (RT-V3) `canonicalUrl` atual (utm, `trk`, `/apply`, barra final) continua igual; (RT-V4) diálogo de arquivar mostra exatamente os 8 motivos de hoje; `discardedPostings` devolve motivo e nota na ordem atual; (RT-V5) `decideDuplicate` update/new/cancel e `moveCaptures` (já cobertos; conferir que continuam verdes); (RT-V6) `POST /captures/:id/posting` sem vaga de e-mail parecida continua criando vaga nova; (RT-V7) `GET /api/postings` sem filtro devolve o mesmo conjunto e ordem.

#### 2.0.2 Candidaturas e agenda (F07)
| Peça | Onde | O que muda na F14 |
|---|---|---|
| Criar candidatura | `applyToPosting` (`packages/core/src/job-applications/index.ts:110`), repo `create` | hoje **exige CV gerado pelo narnia** (`cv_version_id NOT NULL`, `cv_required`): candidatura vinda do e-mail pode existir sem CV (F14-15); `create` ganha `appliedAt` (data e hora do e-mail) separado de `now` |
| Datas | `repos/job-applications.ts` `update(id, patch, now)` usa o mesmo `now` no move, em `last_activity_at` e `updated_at` | parâmetro `at` só para o move; **`last_activity_at` continua no agora** (senão a candidatura antiga arquivaria na rodada seguinte) |
| Histórico de etapas | `setCurrentStage` não grava histórico | tabela de mudanças de etapa (de, para, `at`, origem, e-mail): base do desfazer e do aprendizado (F14-2) |
| Negativa | `rejectJobApplication` (`entries.ts:147`), `POST /:id/reject` | aceita `at`; nota e encerramento **na mesma transação** (hoje a nota fica se o encerramento falha); referência ao e-mail |
| Notas datadas | `addJobApplicationEntry` (dia, sem hora) | nota do e-mail com o dia no fuso da pessoa e a ligação ao `mail_message` (hora exata e link do Gmail) |
| Agenda | `addJobApplicationEvent` (aceita só hora local + fuso), `job_application_event` | entrada em UTC direto, `provisional`, `ics_uid` externo; **leitor de `.ics` novo** (não existe) em `packages/shared` |
| Funil | `jobApplicationFunnel` (`agenda.ts:146`) | "por origem" (sugestão futura) usa `posting.source` |
| Desfazer | não existe em nenhum lugar; o modelo mais próximo é a nota pendente da F06-17 (`postings/notes.ts`) | sugestão/ação guarda o estado anterior (coluna, etapa, ids criados) para reverter |
| Tools `job_application.*` | `tools.ts`, auditoria `audit-e2-mcp-coverage.test.ts` (`CASES`) | nenhuma tool nova na v0 |

**RT das candidaturas:** (RT-C1) linhas de `job_application_move` conferidas direto (coluna e `at`) em criar, mover, encerrar e reabrir; (RT-C2) Aplicar pelo botão continua exigindo CV pronto (`cv_required`, `wrong_posting`, `version_not_ready`) e uma ativa por vaga; (RT-C3) `reject` atual (nota com a data, `closed_stage`, 409, etapa de fora); (RT-C4) `archiveInactive` com 40 dias, idempotente, atividade desarquiva; (RT-C5) agenda: reabrir (`done:false`) e "arquivada não lembra" (lacunas de hoje); (RT-C6) funil com os mesmos números do teste atual; (RT-C7) auditoria do MCP inalterada.

#### 2.0.3 Infraestrutura
| Peça | Onde | O que muda na F14 |
|---|---|---|
| Fila e tarefas | `QueueAdapter`, `enqueueTask` (idempotente por chave), `TASK_HANDLERS` (`apps/worker/src/tasks.ts`) | fila nova `scheduled` (concorrência 1, fora de Configurações; roda todas as tarefas agendadas, a sincronização do Gmail entre elas: a janela inicial é longa e não pode ocupar a `extract` das vagas); toca ~8 lugares (`QUEUE_NAMES` ×3, `QueueRecord`, `Queues` do api, `server.ts`, `FakeQueueAdapter`, `WORKER_QUEUES`, `WorkerSettingsSection`) |
| Agendador | **não existe** (nenhum `upsertJobScheduler`); rotinas em `setInterval` no `apps/api/src/server.ts:49-71` | job schedulers do BullMQ no worker; `pruneCaptures` e `archiveJobApplicationsNow` migram para ele |
| Verificador de travados | `runSweep` (`liveness.ts:108`) só cura ingestão e documentos | execução agendada travada vira `error` no `scheduled_run` |
| Processos | `ProcessesPage`, `useJobs`, `JobRow`, rotas `/api/jobs` | aba "Tarefas agendadas"; etapas novas em `STAGE_ORDER` + i18n |
| Configurações | `settings(key, value_json)`, rotas `/api/settings/<x>` (molde `worker-settings.ts`), card molde `GoogleCalendarSection` | chaves `mail.*` (intervalo, janela, corte, teto, links) e cartão Gmail |
| Segredos | não existe `<dados>/secrets/` nem helper | helper novo (0600); o token nunca volta em resposta (molde `routes/media.ts`) |
| Backup | lista fixa em `packages/core/src/db/backup.ts` (`copyMissing` só arquivos planos, não sobrescreve); `restore_files` em `start.sh:194` e `start.ps1` | `<dados>/mail/<gmail_id>.eml` **plano e imutável** (cabe no `copyMissing`); `mail` nas três listas; `secrets/` fica fora sem mexer |
| OAuth | porta `NARNIA_OAUTH_PORT` (8089; 8189 na instância `claude`), publicada só no compose de produção; hoje quem escuta é o CLI do Claude | o **api** escuta o callback do Gmail nessa porta durante a conexão; publicar também no compose de dev; `googleCalendarCallbackPort` vira genérico; o cliente vem de `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` no `.env` (como o dono já configurou, 2026-11-11) ou do cartão de Configurações, e o segredo nunca volta em resposta |
| Modelo sem tools | `single()`/`runRaw` (`claude-code-provider.ts`, `tools: []`, `json_schema`, zod), `recordUsage`, `MockProvider` | operações novas `mailClassify`, `mailExtract` (e `mailProfile`, se F14-5 pedir o modelo) |
| Prompts | `prompt-files.ts`, `STRUCTURED_PROMPTS`, `PROMPT_DATASETS`, `RULES`, juízes, gate | checklist completo; os testes que contam prompts (21 → N) mudam de número, o resto fica |
| Extensão | `activeTab` + `scripting` já permitem ler a aba do Gmail no clique; menu em `popup.ts` | **sem permissão nova** (o manifesto continua igual); itens do Gmail no popup quando a aba é `mail.google.com`; mensagem `narnia.mail` lê só remetente e id |
| Notificações | `notification` + `upsert`; agrupado no molde `syncSuggestionNotifications` | tipos novos: vagas novas (agrupada), revisão pendente (agrupada), candidatura encerrada por e-mail, Gmail desconectado |
| Gmail falso | molde `packages/core/src/testing/fake-gh.ts` (estado em arquivo, api + worker, `POST /api/_test/...`) | `fake-gmail` no mesmo formato, para unitários, api e e2e |

**RT da infraestrutura:** (RT-I1) `pruneCaptures` e o arquivamento de candidaturas dão o mesmo resultado rodando pelo agendador; (RT-I2) backup: pastas atuais copiadas e **`secrets/` nunca entra**; `restore_files` (bats) com as pastas de hoje; (RT-I3) `/api/jobs` lista, cancela e tenta de novo como hoje; (RT-I4) manifesto da extensão idêntico (o teste com `toEqual` já existe) e o menu atual (`posting`, `form`, `open`) no `popup.ts` (sem teste hoje); (RT-I5) ordem dos cartões de Configurações; (RT-I6) `createQueues` e `applyConcurrency` com as filas de hoje mais a `mail`; (RT-I7) provider estruturado (`tools: []`, `invalid_output`) já coberto.

#### 2.0.4 Defeitos encontrados no caminho (corrigir com teste no marco que toca a peça)
1. `buildIcs` não escapa `;` (`packages/shared/src/calendar.ts:53`, `.replace(/;/g, ";")`) e o teste aceita: RFC 5545 pede `\;`.
2. O arquivamento diário chama `archiveJobApplicationsNow({ repos })` sem `bus` (`server.ts:60`): a interface não recebe o evento.
3. `BullQueueAdapter.retry` de uma tarefa cancelada devolve false (o tipo não está em `STAGES`): a rota já chamou `requeue`, responde 500 e o espelho fica `queued`; o adaptador não tem teste.
4. `decideDuplicate` "update" copia contatos só com nome, origem, e-mail e telefone (perde LinkedIn, papel, data, resumo, indicação) e sem `findDuplicate`.
5. `rejectJobApplication` não é transacional (a nota fica se o encerramento falhar).

### 2.1 Visão
```
worker (BullMQ, repetível: 1 h por padrão, mínimo 10 min, F14-8)
  └─ MailSource (GmailRest | FakeGmail nos testes)
       history.list / messages.list(after:) → messages.get(raw) → attachments.get(.ics)
  └─ mail_message (idempotência por gmail_id) + <dados>/mail/<id>.eml
  └─ pré-filtro por código (remetentes conhecidos, palavras-chave) → fora do assunto: não toca no e-mail
  └─ risco do e-mail + confiabilidade do remetente, por código (§2.7) → define o que pode ser feito
  └─ parsers por código (alertas LinkedIn/Gupy/Indeed…, .ics) → modelo só no que sobrar
  └─ classificação/extração: Haiku, SEM tools, e-mail como dado (prompt injection)
  └─ ações no domínio (posting, job_application, reject, evento) em transação
  └─ batchModify: +narnia-jobs, −UNREAD (só depois de gravar)
```

### 2.2 Ordem e idempotência
- A janela inicial é processada **do mais antigo para o mais novo** (a negativa não pode chegar antes da candidatura).
- `mail_message.gmail_id` único; reprocessar é explícito (botão), nunca duplicado.
- Etiqueta e lido só depois do commit; falha no Gmail fica pendente e é refeita na próxima rodada.
- `historyId` expirado (≈ 1 semana) → volta para `messages.list` com `after:` do último e-mail processado.

### 2.3 Classes e ações
| Classe | Ação |
|---|---|
| Alerta (1..N vagas) | cada vaga: duplicata (link normalizado, `identity_hash`), cria/junta `posting` com `source=email`; tenta abrir o link (fetch, JSON-LD, `browser`); falhou → `link_status=failed` |
| Candidatura recebida | liga à vaga (link no e-mail → `identity_hash` → modelo); cria a vaga se não houver; cria/move a candidatura para Aplicado com a data e hora do e-mail; perfil por F14-5 |
| Negativa | `reject` existente com nota datada (texto + link do e-mail), etapa atual |
| Atualização | nota datada; etapa sugerida ou movida (F14-2) |
| Convite | F14-3 |
| Fora do assunto | nada (não etiqueta, não marca como lido) |
| Risco alto | quarentena: `narnia-jobs/suspeito`, não lido, revisão (F14-14) |
| Incerto | caixa de revisão |

### 2.4 Aprendizado do movimento de etapa (F14-2)
Acerto = sugestão aprovada; erro = sugestão recusada, automático desfeito ou etapa corrigida à mão depois do e-mail. Automático liga com ≥ 20 decisões e ≥ 95 % de acerto na faixa de confiança alta; um desfazer recente volta ao modo sugestão; erro pesa mais que acerto. Correções e aprovações recentes entram como exemplos no prompt (vocabulário por empresa e plataforma). Configurações mostram a taxa e permitem desligar.

### 2.5 Segurança e privacidade
- Token em `<dados>/secrets/` (600), **fora do backup**; restaurou → reconecta.
- O modelo que lê o e-mail não tem tools; só devolve JSON validado por schema.
- Só e-mails que passaram no pré-filtro vão ao modelo.
- Repositório público: fixtures e casos de avaliação sintéticos, nunca e-mails reais do dono.

### 2.6 Tarefas agendadas (F14-12)
- Um agendador único no worker (job schedulers do BullMQ: sobrevive a reinício e não roda a mesma tarefa duas vezes ao mesmo tempo) substitui os `setInterval` do api. Tarefas: sincronização do Gmail, arquivamento do feed (F14-9), pré-análise automática (F14-6/7), arquivamento de candidaturas inativas (F07 §0-6) e poda das capturas (F12). As futuras entram pelo mesmo registro.
- Cada execução grava `scheduled_run` (início, fim, status, contadores, erro, log em linhas com nível) e `scheduled_run_item` (o que tocou: e-mail, vaga, candidatura, link, com a ação e o resultado).
- Tela "Tarefas agendadas" (aba nova em Processos): por tarefa, próxima e última execução, status, intervalo (editável, respeitando o mínimo), pausar/retomar e "rodar agora"; histórico de execuções; detalhe com o log e os itens. Na sincronização do Gmail, os itens são os e-mails lidos (remetente, assunto, data, classe, risco, o que foi feito, link para o e-mail no Gmail e para a vaga/candidatura).
- Retenção: execuções e logs por 90 dias (configurável); os `mail_message` ficam (são a referência das candidaturas).

### 2.7 Risco do e-mail e confiabilidade do remetente (F14-13)
Ler o e-mail pela API não executa nada (texto, sem imagens remotas nem scripts). O risco está em **abrir links**, **baixar anexos**, **mandar o texto ao modelo** e **agir no domínio** a partir de um e-mail falso (negativa falsa encerrando candidatura, convite falso, golpe de vaga). Por isso, antes de qualquer passo:

- **Sinais do e-mail, por código:** SPF/DKIM/DMARC (`Authentication-Results`), DKIM alinhado ao domínio do `From`; domínio parecido com o de uma plataforma conhecida (homóglifo, distância de edição, punycode: `linkedln.com`); nome de exibição de marca com domínio de outra; `Reply-To` em outro domínio; links para outro domínio, encurtadores, IP, punycode; anexos perigosos (executável, `.html`, `.zip`, Office com macro); termos de golpe (PIX, taxa de inscrição, curso pago, dados bancários, documentos antes da entrevista).
- **Confiabilidade do remetente** (por domínio e por endereço, `mail_sender`): base por tipo (plataformas e ATS conhecidos com DKIM alinhado; domínio de empresa de vaga salva ou candidatura; webmail genérico = recrutador individual; desconhecido), ajustada pelo histórico (e-mails processados sem problema sobem; revisões recusadas e golpes descem) e pela pessoa (**confiar** ou **bloquear**, que vencem o resto).
- **Níveis e o que cada um permite:**

| Nível | Modelo | Links | Anexos | Ações sozinho |
|---|---|---|---|---|
| Confiável | sim | abre os da vaga | `.ics`, `.pdf` | sim (com as regras da F14-2/3/5) |
| Neutro | sim | só de domínios confiáveis | `.ics` | não: o que muda candidatura vai para a revisão |
| Risco alto | não | nenhum | nenhum | nada: quarentena, na revisão com os motivos |

- **Links nunca abertos, em qualquer nível:** os que parecem ação (descadastrar, confirmar, aceitar, recusar, "não tenho interesse", login). Só links com cara de página de vaga.
- A tela de tarefas e a revisão mostram o nível e os motivos de cada e-mail; a pessoa pode mudar o nível do remetente dali.

#### Lista de remetentes (pedido do dono, 2026-11-11)
- Configurações › Gmail › **Remetentes**: listas de **confiáveis** e **bloqueados**, com adicionar e remover. Entrada por endereço (`rh@empresa.com`) ou por domínio (`@empresa.com`); domínio de webmail (gmail.com, outlook.com…) só por endereço. Cada linha mostra a origem (manual, extensão, revisão), o último e-mail e quantos já vieram.
- A lista **vence** a nota automática; quem não está nela segue a nota (§2.7). O narnia **sugere** confiar em remetentes com bom histórico (botão, nunca sozinho).
- **Confiar só vale com autenticação ok:** e-mail de remetente confiável com SPF/DKIM/DMARC falhando continua risco alto (o `From` pode ser forjado), com o motivo "remetente confiável, mas a autenticação falhou".
- Ao confiar num remetente com e-mails em quarentena, o narnia oferece **reprocessar** esses e-mails.
- **Extensão (F12):** com um e-mail aberto no Gmail web, o menu do ícone ganha **Confiar neste remetente** e **Bloquear este remetente**; o content script lê só o endereço do remetente da mensagem aberta (e o id da mensagem, para "processar este e-mail agora"), nada do corpo. Pede permissão de host para `mail.google.com` (conferir as permissões atuais da extensão).

---

## 3 · Dados (migrações 0040+)
- `mail_account` (email, status, history_id, label_id e suspect_label_id (as duas criadas pelo `labels.create`), janela inicial, conectado em, último erro).
- `mail_message` (gmail_id único, thread_id, from, subject, received_at, class, confidence, result_json, status `pending|done|review|ignored|error`, gmail_synced, processed_at, undone_at, raw_path).
- `posting`: `source` (`manual|link|extension|email`), `source_ref_json` (gmail_id, plataforma), `link_status` (`ok|failed|none`), `feed_state` (`new|seen|dismissed`), `match_score`.
- `mail_sender` (domínio/endereço, tipo, score, override `trusted|blocked`, origem do override `manual|extension|review`, contadores, visto em) e em `mail_message`: `risk_level`, `risk_reasons_json`, `sender_id`.
- `scheduled_task` (nome, intervalo, pausada, próxima execução) · `scheduled_run` (tarefa, início, fim, status, contadores, erro, log) · `scheduled_run_item` (execução, tipo e id do alvo, ação, resultado).
- `stage_suggestion` (mail_message, application, from/to, confidence, decisão, decidida em) — base do §2.4.
- Etapa provisória e ligação ao evento da empresa em `job_application_event` (`provisional`, `ics_uid`, `ics_sequence` já existe).

---

## 4 · Layouts
- Configurações › Integrações: cartão Gmail (guia, conectar, janela inicial, intervalo, corte e teto da pré-análise, links por rodada, taxa de acerto e chave do automático).
- Configurações › Gmail › Remetentes: confiáveis e bloqueados, adicionar/remover, sugestões (§2.7).
- Extensão: "Confiar/Bloquear este remetente" e "Processar este e-mail agora" no Gmail web.
- Processos › Tarefas agendadas: lista das tarefas, histórico, detalhe da execução com log e itens (§2.6).
- Feed de vagas: lista por match, filtros (origem, plataforma, data, link falhou, analisada), ações analisar/salvar/arquivar com motivo.
- Caixa de revisão: e-mail, o que o narnia propõe, aprovar/corrigir.
- Candidatura: histórico com "movida pelo e-mail de … · desfazer", "perfil escolhido pelo modelo · motivo · trocar", etapa provisória.
- Visual detalhado: conversa com o dono antes do marco de UI.

---

## 5 · Decisões

### 5.1 Fechadas
| Id | Tema | Decisão | Data |
|----|------|---------|------|
| F14-1 | Quem chama o Gmail | O **worker, direto, sem modelo**; o modelo só classifica e extrai, sem tools. | 2026-11-11 |
| F14-2 | Atualização de candidatura | Nota datada sempre; **move sozinho com confiança alta, sugere nos outros casos**, aprendendo com aprovações, desfeitas e correções à mão; sempre sugere até ter dados suficientes (§2.4). | 2026-11-11 |
| F14-3 | Convite de entrevista | O evento oficial é o da empresa: `.ics` lido por código vira etapa ligada a ele; horário combinado sem convite vira etapa **provisória** com "bloquear agenda" **por clique**; o oficial substitui a provisória e avisa sobre o bloqueio; remarcação e cancelamento atualizam. | 2026-11-11 |
| F14-4 | API ou MCP | **API REST do Gmail** (`history`, anexos `.ics`, `labels.create`, `batchModify`, `raw`; estável). MCP do Gmail só no chat, futuro. | 2026-11-11 |
| F14-5 | Perfil da candidatura | Perfil do CV/carta gerados para a vaga → perfil já definido na vaga → **modelo escolhe** (motivo visível, trocar). | 2026-11-11 |
| F14-6 | Pré-análise do feed | Score de match por código; **pré-análise automática acima de 70** (configurável), com teto diário. | 2026-11-11 |
| — | Etiqueta e lido | Todo e-mail processado ganha `narnia-jobs` e é marcado como lido (pedido inicial); fora do assunto não é tocado. | 2026-11-11 |
| F14-7 | Teto da pré-análise automática | **10 vagas/dia** por padrão, configurável. | 2026-11-11 |
| F14-8 | Intervalo da sincronização | **1 h** por padrão, configurável, **mínimo 10 min**; só com a instância no ar; botão "verificar agora". | 2026-11-11 |
| F14-9 | Vagas do feed não tocadas | **Arquivadas depois de 30 dias** sem interação (abrir, analisar, salvar, candidatar, editar). Motivo novo de arquivamento (`stale`, "sem interação"), que **não** entra na calibração do fit; o `check` de `archive_reason` (0028) precisa ser refeito na migração. Pré-análise automática não conta como interação. | 2026-11-11 |
| F14-10 | Links abertos por rodada | **Até 100** por padrão, configurável, numa fila com concorrência baixa no `browser` (o resto vai para a próxima rodada). | 2026-11-11 |
| F14-11 | Ligação ambígua e-mail → vaga | **Caixa de revisão**, com a mesma regra de aprendizado da F14-2. | 2026-11-11 |
| F14-12 | Tarefas agendadas | Agendador único no worker e **tela de tarefas agendadas** com o log de cada execução e os itens tocados (e-mails lidos, vagas, candidaturas); as rotinas diárias atuais migram para ele (§2.6). | 2026-11-11 |
| F14-13 | Risco e remetentes | Nenhum link, anexo, modelo ou ação a partir de e-mail de **risco alto**; nota de confiabilidade por remetente e **lista de confiáveis e bloqueados** editável, com botões na extensão; confiar só vale com autenticação ok (§2.7). | 2026-11-11 |
| F14-14 | E-mail em quarentena no Gmail | Etiqueta **`narnia-jobs/suspeito`** e fica **não lido**; aparece na revisão com os motivos. | 2026-11-11 |
| F14-15 | Candidatura sem CV do narnia | **CV opcional na candidatura vinda de e-mail**: com CV gerado para a vaga, liga a última versão pronta com a marca "presumido"; sem, o cartão mostra "CV enviado não registrado" com ligar uma versão ou anexar o arquivo usado. O botão Aplicar continua exigindo CV (RT-C2). `cv_version_id` vira opcional (reconstrução da `job_application` com `-- narnia: foreign-keys-off`) e `cv_presumed`/`source` entram na tabela. | 2026-11-11 |

---

## 6 · Marcos
| Marco | Conteúdo |
|---|---|
| M0 | Viabilidade com a conta real do dono: OAuth com cliente próprio, `history.list`, `labels.create`, `batchModify`, anexo `.ics`; expiração do token em modo "Testing". Script descartável na instância `claude`, só a pedido e com a conta do dono. |
| M1 | RT-I1 a RT-I7 e defeitos 2 e 3 de §2.0.4 antes de tudo; agendador no worker + tela de tarefas agendadas (migrando as rotinas diárias atuais); `MailSource` + Gmail falso; conexão OAuth, token, status, Configurações; migrações. |
| M2 | RT-V3, RT-V7; sincronização (janela, ordem, history, fallback), `mail_message`, `.eml`, etiqueta e lido. |
| M3 | Pré-filtro, risco do e-mail e confiabilidade do remetente (§2.7), lista de remetentes e botões na extensão, quarentena; parsers por código (alertas das plataformas principais, `.ics`). |
| M4 | RT-V1, RT-V2, RT-V4 a RT-V6 e defeito 4; prompts de classificação/extração (Haiku, sem tools) + gate; alertas → feed, link, `link_status`, score, pré-análise acima do corte. |
| M5 | RT-C1 a RT-C4, RT-C7 e defeito 5; candidatura recebida, negativa, perfil (F14-5), ligação à vaga, caixa de revisão. |
| M6 | RT-C5, RT-C6 e defeito 1; atualizações e aprendizado (F14-2); convites (F14-3); desfazer. |
| M7 | UI final do feed e da revisão, docs (`docs/gmail.md`), e2e, teste manual do dono. |

## 7 · Testes
- TDD por marco; Gmail falso (HTTP local) no e2e; nenhum teste toca a conta real.
- Fixtures sintéticas por plataforma (alertas com 1 e N vagas, confirmação, negativa, atualização, convite com `.ics`, remarcação, cancelamento, e-mail malicioso com instruções).
- Gate de prompts (F06-14) para cada prompt novo.

## 8 · Riscos
| Risco | Mitigação |
|---|---|
| Token expira em 7 dias com o cliente em "Testing" | conferir no M0; guia explica; status "reconectar" na UI |
| HTML dos alertas muda | parser por código com fallback no modelo; fixture por plataforma |
| Link do LinkedIn exige login | `link_status=failed` + completar pela extensão (F12) |
| Ligação errada de e-mail a candidatura | ordem de sinais, caixa de revisão, desfazer |
| Prompt injection no e-mail | modelo sem tools, saída por schema, ações só no domínio; risco alto não vai ao modelo |
| Phishing ou golpe de vaga | §2.7: sinais por código, remetente com histórico, quarentena, links de ação nunca abertos |
| Custo da pré-análise | corte + teto diário |
| 100 links por rodada sobrecarregam o `browser` ou disparam bloqueio das plataformas | fila com concorrência baixa e espaçamento por domínio |

## 9 · Sugestões futuras
Contato de recrutador a partir do e-mail; follow-up de candidatura parada com rascunho no Gmail; funil por origem; MCP do Gmail no chat; Outlook/IMAP.

## 10 · Registro de execução

### M0 · viabilidade (2026-11-11)
Script descartável (container `node:22-bookworm-slim`, porta 8189 da instância `claude`, refresh token em `.claude-data/m0-gmail/`, cliente do `.env` do dono), rodado pelo dono no terminal dele, com a conta real. **Tudo passou:**
- OAuth com cliente próprio (Aplicativo da Web, modo Testing, PKCE, `access_type=offline`): refresh token emitido com `gmail.modify`.
- `labels.create`: `narnia-jobs` e `narnia-jobs/suspeito` criadas.
- Busca dos últimos 30 dias: 295 mensagens de vagas (≈ 10/dia; cabe no teto de 10 pré-análises/dia).
- Remetentes (amostra de 150): Glassdoor 70, LinkedIn 61, `app.coders.com.br` 13, `jobs2web.com` (SAP SuccessFactors) 2, Nerdin, InHire, Indeed e um domínio de empresa, 1 cada. **Ordem dos parsers por código do M3: Glassdoor, LinkedIn, Coders**; o resto vai ao modelo até ganhar parser.
- Autenticação: 150/150 com DMARC, DKIM e SPF `pass` (os sinais do §2.7 estão presentes nos cabeçalhos).
- `format=raw`: 163 KB na amostra (≈ 50 MB/mês em `<dados>/mail/` no volume atual; guardar só os e-mails processados).
- `history.list`: funciona; 292 mensagens desde a mais antiga da amostra.
- `.ics`: 5 e-mails no último ano; `attachments.get` devolve o anexo; amostra com `METHOD:REQUEST`, `DTSTART`, `SEQUENCE:0`.
- `batchModify`: etiqueta e lido aplicados e desfeitos; estado original conferido.
- **Pendente:** `check` em 2026-11-19 (8 dias) para saber se o refresh token expira em 7 dias no modo Testing.

### M1 · execução (2026-11-11)
- **Regressão primeiro:** RT-I2 (backup por lista de inclusão; `secrets/` nunca entra), RT-I4 (menu da extensão extraído para `popup-view.ts`, com teste), RT-I5 (ordem dos cartões de Configurações), RT-I1 (poda e arquivamento pelo agendador dão o mesmo resultado), RT-I3/RT-I6/RT-I7 (testes que já existiam, verdes; a lista de filas ganhou `scheduled`).
- **Defeitos de §2.0.4:** 2 (arquivamento diário não avisava a web: agora o worker publica `job_application.updated` por candidatura) e 3 (`BullQueueAdapter.retry` de tarefa cancelada devolvia false: reenfileira com o mesmo id e os dados do espelho; `Job.fromId` trocado por `queue.getJob`).
- **Agendador (F14-12):** migração 0040 (`scheduled_task`, `scheduled_run`, `scheduled_run_log`, `scheduled_run_item`); definições em `packages/core/src/scheduler` (poda das capturas e arquivamento das candidaturas, 24 h, mínimo 60 min); fila `scheduled` (concorrência 1) e tarefa `scheduled.run`; laço no worker a cada 30 s com trava no Redis; retenção de 90 dias (`scheduler.retentionDays`); o `setInterval` diário do api saiu. Rotas `/api/scheduled-tasks` (lista, PATCH intervalo/pausa com o mínimo, rodar agora com `enqueued`, histórico) e `/api/scheduled-runs/:id` (log e itens). Aba "Tarefas agendadas" em Processos.
- **Gmail (F14-4):** segredos em `<dados>/secrets/` (0700/0600); OAuth com PKCE e `gmail.modify`, cliente do `.env` (`GOOGLE_CLIENT_ID`/`SECRET`) ou do cartão; o api escuta o retorno só durante o login; etiquetas `narnia-jobs` e `narnia-jobs/suspeito` criadas na conexão; recusa do refresh vira "Reconectar"; desconectar revoga. `GmailRestSource` (perfil, etiquetas, busca, raw, anexo, histórico com expiração, `batchModify`) e Gmail falso (`testing/fake-gmail.ts`, em memória e em arquivo para o mock/e2e). Cartão "Gmail (opcional)" em Configurações.
- **Portas do retorno do login:** produção na `NARNIA_OAUTH_PORT` (8089 do dono, 8189 da instância `claude`); **dev na `NARNIA_DEV_OAUTH_PORT` (8090 do dono, 8190 da `claude`)**, para não colidir com a produção nem com o `google connect` do Calendar. O dono precisa acrescentar `http://localhost:8090/callback` às URIs de redirecionamento do cliente OAuth. `.env.claude` zera o cliente do Google (a instância do Claude usa o Gmail falso).
- **Revisão independente:** 9 pontos, todos tratados: execução sempre fecha (`finally`, aviso à web melhor esforço); o laço cura execução presa e espelho pendente sem job no Redis; porta própria do dev; clique duplo em Conectar (409), retorno repetido consome o `state`, servidor de retorno sem exceção solta, página de retorno escapada; "rodar agora" diz se entrou na fila; `href` dos itens não aceita `//`.
- **Pré-existente, fora da F14:** 2 testes do `start.bats` (20 e 28) falham quando o `.env` da raiz liga o media (F13): o compose ganha `--profile media` e o teste espera o comando sem ele.

### M2 · execução (2026-11-11)
- **Regressão primeiro:** RT-V3 (o que o link canônico já trata como a mesma vaga: rastreio, ordem da query, barra final, páginas de formulário do Lever, Greenhouse e Gupy) e RT-V7 (`GET /api/postings` sem filtro: não arquivadas, da mais nova para a mais antiga; `archived=1` traz **só** as arquivadas).
- **Leitura (muda §2.1):** em vez do `history.list`, a busca do Gmail com `after:`/`before:` em **fatias de uma semana**, do mais antigo para o mais novo, com um cursor `{since, at}` em `settings` (`mail.cursor`). A busca já filtra remetentes e assuntos de vagas (`DEFAULT_MAIL_QUERY`, configurável em `mail.query`); o histórico traria a caixa inteira. Sobreposição de 24 h entre fatias; `gmail_id` único evita repetir.
- **E-mails guardados:** migração 0041 (`mail_message`, pendente até o processamento do M3); `.eml` em `<dados>/mail/<gmail_id>.eml` (gravação atômica, 0600), no backup e na restauração (`start.sh`, `start.ps1`, com testes bats e Pester). Nada muda no Gmail neste marco. Dependência nova: `mailparser` 3.10.0 (só o cabeçalho é lido aqui).
- **Tarefa agendada `mail.sync`** (1 h, mínimo 10 min): sem conexão ou sem janela, só registra o motivo; até 300 e-mails por execução. Recusa do Google (refresh recusado, 401/403 da API) marca o token, abre a notificação `mail.reconnect` e para; conectar de novo ou desconectar fecha a notificação.
- **Primeira leitura (pedido do dono):** `GET/PUT /api/mail/settings` (até um ano, com folga) e a escolha no cartão do Gmail (7, 30, 90 dias ou uma data), com o resumo do que já foi lido depois.
- **Revisão independente:** 10 pontos; corrigidos os que perdiam ou corrompiam e-mail (limite de 10 mil na busca → fatias; janela trocada no meio da rodada → cursor com compare-and-set; `.eml` cortado → gravação atômica; e-mail ilegível travando a leitura → erro depois de 3 tentativas), 401/403 como reconexão, notificação que não fechava, folga no limite de um ano, sobreposição de 24 h, cabeçalho sem decodificar anexos. Fica para o M3: a ordem cronológica entre execuções quando um e-mail antigo entra depois (só no caso de erro transitório).

### M3 · execução (2026-11-11)
- **Risco do e-mail (F14-13), por código** (`packages/core/src/mail/risk.ts`, `domains.ts`): `Authentication-Results` do Gmail (só o primeiro cabeçalho, só de `mx.google.com`, comentários do ARC descartados); alinhamento do DMARC, DKIM (`header.d`) ou SPF (`smtp.mailfrom`) com o domínio do `From`; domínio registrável pela Public Suffix List (`tldts` 7.4.19, dependência nova); domínio que imita plataforma; marca no nome com outro domínio; `Reply-To`; anexos e links perigosos (IP, punycode, imitação; encurtador é só observação); golpe de vaga por padrão de pedido (PIX para pagar, taxa de inscrição, dados bancários), não por palavra solta. Plataforma autenticada transforma link e texto suspeitos em observação. Níveis: alto (quarentena), neutro, confiável (lista com autenticação alinhada, plataforma alinhada ou histórico de 3 bons sem recusa, também alinhado).
- **Pré-filtro** (`prefilter.ts`): canais de vaga do LinkedIn e ATS = vaga; notificações das plataformas sem assunto de vaga = fora do assunto (intocado no Gmail); mensagens repassadas (LinkedIn, Indeed) e o resto sem sinal = dúvida para o modelo (M4).
- **Avaliação na tarefa `mail.sync`** (`process.ts`): risco alto e não ignorado → quarentena com a etiqueta `narnia-jobs/suspeito`, continua não lido (F14-14); a etiqueta sai sozinha se o e-mail deixar a quarentena (coluna `suspect_label`, migração 0042). Fora do assunto → `ignored`. O resto fica pendente com `class` (`candidate`/`unknown`) e o risco gravado.
- **Remetentes** (migração 0042, `mail_sender`): confiáveis e bloqueados por endereço ou `@domínio` (webmail só por endereço; o próprio endereço não entra), sugestões pelo histórico, "avaliar de novo" a quarentena ao confiar. Cartão "Remetentes" em Configurações › Gmail.
- **Extensão no Gmail web:** "Confiar/Bloquear este remetente" e "Processar este e-mail agora", lendo só o remetente e o id da mensagem aberta (do mesmo nó); sem permissão nova no manifesto. O id pedido é baixado primeiro, fora da busca e da janela.
- **Leitores por código:** alertas do LinkedIn, Glassdoor e Coders (`alerts.ts`: links desembrulhados do rastreio, link canônico, empresa e local, leitura linear de links) e `.ics` (`packages/shared/src/calendar-parse.ts`: TZID IANA, nomes do Windows e `VTIMEZONE` próprio, escapes, linhas dobradas em bytes, `METHOD`, `SEQUENCE`, link do Meet/Teams/Zoom). Ligados ao processamento no M4/M6. **Feitos com e-mails sintéticos**: calibrar com alertas reais quando o dono autorizar.
- **Revisão independente:** 19 pontos, todos tratados, entre eles: `dmarc=pass` forjado no comentário do ARC, SPF/DKIM de outro domínio confirmando remetente da lista, falsos positivos de Greenhouse/Workday/SuccessFactors, "Squad Pix" como golpe, perda de pedido da extensão por corrida, etiqueta de suspeito que não saía, mensagens de recrutador ignoradas, regex quadrática em HTML hostil, escapes e segundos do `.ics`. Fica: `seenCount` conta de novo quando um e-mail é reavaliado (só infla a estatística).

### M4 · execução (2026-11-11)
- **Regressão primeiro:** RT-V1 (link que falha no intake manual: código do erro e nenhuma vaga), RT-V2 (texto e link juntos não buscam a página), RT-V4 (os 8 motivos de arquivar da pessoa), RT-V5 (junção existente), RT-V6 (captura sem vaga de e-mail parecida cria vaga nova). **Defeito 4** corrigido: a junção de duplicata leva o contato inteiro (LinkedIn, papel, data, resumo, indicação) e não repete quem já está.
- **A busca por link mudou para o core** (`packages/core/src/postings/fetch/`; o api reexporta): o worker abre os links das vagas vindas de e-mail. Dependências movidas para o core: `@mozilla/readability`, `linkedom`.
- **Migração 0043** (aditiva, sem reconstruir `posting`): `source` (`manual`/`extension`/`email`), `source_ref_json` (Gmail, plataforma, remetente confiável), `link_status`, `feed_state`, `match_score`, `canonical_url` (índice; preenchido no boot do api para as vagas antigas), `archive_auto` (F14-9 fora do fit), `last_interaction_at`, `auto_analysis_at`. Origem de campo nova `email` (o modelo e a extensão corrigem; a pessoa vence; o link do e-mail o modelo não troca).
- **Link canônico** com o LinkedIn (`/comm/jobs/view/<id>?trackingId…` = `/jobs/view/<slug>-<id>`) e sem `www.`.
- **Prompt novo `narnia-mail-classify`** (Haiku, sem tools; classes: alerta, candidatura recebida, negativa, atualização, convite, contato de recrutador, fora do assunto; injeção no e-mail ignorada): dataset de 10 e-mails sintéticos, avaliadores e juiz; **gate real na assinatura: 100% em schema, idioma, cobertura e juiz; primeira aprovação gravada.** Nota de execução: o juiz com a variável `links` falhava ao montar a entrada no Phoenix (o dataset tinha o campo); voltou às variáveis da 1ª rodada, e o texto diz que os links chegam ao modelo numa lista à parte (o código confere os links).
- **Processamento** (`mail/digest.ts`, tarefa `mail.sync`): alertas do LinkedIn, Glassdoor e Coders pelo leitor por código; o resto pelo modelo. Alerta → vagas no feed (sem duplicar: link canônico, ou empresa e cargo quando os links não diferem); fora do assunto → intocado (confiança baixa → revisão); candidatura, negativa, atualização, convite e contato ficam classificados para o M5/M6. Link vindo do modelo só vale se estiver nos links do e-mail. Processado → etiqueta `narnia-jobs` e lido (antes de abrir os links). Erro passageiro do modelo para a rodada; saída inválida duas vezes → revisão.
- **Links (F14-10)**: até 100 por execução (configurável), um por vez, com pausa por domínio; abriu → descrição, heurística, pré-análise e extração na fila; não abriu → `link_status = failed` (a flag pedida). Descrição já colada pela pessoa não é sobrescrita. A captura da extensão completa a vaga do e-mail cujo link falhou.
- **Score de match sem tokens** (cobertura dos obrigatórios no melhor perfil − 10 por risco), recalculado depois da extração; ordena o feed.
- **Pré-análise automática (F14-6/7)**: tarefa `postings.auto_analyze` (1 h) marca as prontas acima do corte (70) até o teto do dia (10, no fuso da pessoa), **só de remetente confiável** (revisão do M4: a análise é um agente com tools lendo texto de terceiros); o api abre uma por vez (`services/auto-analysis.ts`).
- **Arquivamento do feed (F14-9)**: tarefa `postings.feed_archive` (24 h) arquiva numa só instrução as vagas do e-mail sem interação há 30 dias e sem candidatura (`archive_auto = 'stale'`). Interação: abrir a página (`POST /api/postings/:id/seen`), editar, nota, contato, análise pedida, candidatar, ações pelo chat.
- **Tela**: aba "Feed do e-mail" na página de vagas (selos nova, origem e plataforma, match, link não abriu); "Feed de vagas" em Configurações › Gmail (corte, teto, links por execução); textos das tarefas novas.
- **Revisão independente:** 15 pontos, todos tratados. Ficam: e-mails sem leitor esperam se a execução não tiver modelo (no worker sempre tem); a contagem `seenCount` (M3).

### M5 · execução (2026-11-11)
- **Regressão primeiro:** RT-C1 (uma linha de `job_application_move` por criar, mover, encerrar e reabrir, com o instante), RT-C2 (o Aplicar continua exigindo CV pronto e uma ativa por vaga); RT-C3, RT-C4 e RT-C7 seguem nos testes de F07 sem mudança. **Defeito 5** corrigido: nota e encerramento da negativa numa transação; `withTransaction` aninhada vira savepoint.
- **Migração 0044** (reconstrói `job_application` com `-- narnia: foreign-keys-off`): `cv_version_id` opcional (F14-15), `source` (`manual`/`email`), `cv_presumed`, `profile_pending`, `source_ref_json`; `job_application_move` ganha `source` e `mail_message_id`. A passagem de coluna leva o instante do e-mail; `last_activity_at` fica no agora (não arquiva na rodada seguinte).
- **Candidatura recebida e negativa** (`mail/applications.ts`, dentro do `mail.sync`, do mais antigo para o mais novo): vaga pelo link canônico → empresa e cargo → candidatura ativa da empresa; na dúvida, revisão. Confirmação → candidatura nova com o instante do e-mail (vaga criada se não existir, fora do feed) ou nota na existente; negativa → encerra com o instante e a nota com o link do Gmail, notificação informativa. Perfil (F14-5): CV gerado para a vaga (última versão pronta, CV presumido) → carta gerada → perfil recomendado pela análise → único perfil → a escolher (a análise da vaga define, pedida só com remetente confiável). Cartão da candidatura: selos "veio do e-mail", "CV presumido" e "CV enviado não registrado".
- **Caixa de revisão e quarentena** (`/emails`, link no cartão do Gmail e notificação agrupada `mail.review`): motivo, resumo, abrir no Gmail; escolher a vaga, aplicar à vaga sugerida, aplicar mesmo assim, ignorar; na quarentena, os motivos do risco, confiar no remetente (reavalia o risco dos e-mails dele) e processar mesmo assim.
- **Revisão independente (12 pontos):** tratados 1 a 7 e 9 a 12.
  - Remetente sem confiança (`neutral`, §2.7) não cria nem encerra candidatura sozinho: revisão com "aplicar mesmo assim"; nota em candidatura existente passa.
  - Cada e-mail numa transação, avisos depois do commit.
  - Candidatura arquivada recebe a negativa (sem duplicar); encerrada só ganha a nota; confirmação de candidatura encerrada depois do e-mail vira nota.
  - Ordem: nada mais novo que o e-mail mais antigo ainda sem classe é aplicado.
  - Negativa sem vaga salva ou sem candidatura → revisão (nunca cria vaga e candidatura para encerrar).
  - "Confiar" reavalia em vez de liberar; ignorar a quarentena mantém `narnia-jobs/suspeito`.
  - Nota no fuso da pessoa; campos de controle da revisão saem do resultado; vaga arquivada não é escolhida.
  - **Fica para o M7 (ponto 8):** tela para trocar o perfil, ligar uma versão de CV ou anexar o arquivo enviado na candidatura vinda de e-mail (hoje o perfil a escolher se resolve pela análise da vaga). O CV presumido prende o documento como qualquer candidatura (não dá para apagar o CV ligado).

### M6 · execução (2026-11-11)
- **Regressão primeiro:** RT-C5 (evento reaberto volta a lembrar; candidatura arquivada sem encerrar não lembra) e RT-C6 (funil com os mesmos números, que já existia). **Defeito 1** corrigido: `buildIcs` escapa `;` (`\;`).
- **Migração 0045** (aditiva): `job_application_stage_change` (de, para, instante, origem `manual`/`email`/`suggestion`/`undo`, e-mail), `stage_suggestion` (dica, empresa, plataforma, confiança, modo `suggested`/`auto`, decisão, etapa aplicada, etapa corrigida), evento com `provisional`, `ics_uid`, `ics_remote_sequence`, `blocked_at`, `cancelled_at` e o e-mail; `mail_message.undo_json`.
- **Atualizações** (`mail/updates.ts`, no `mail.sync`, alternando com o M5 em ordem cronológica): a candidatura sai da vaga escolhida na revisão, da mesma conversa do Gmail ou da vaga do e-mail; nota datada sempre. A dica de etapa liga à etapa da candidatura por vocabulário aprendido (empresa ou plataforma), nome ou grupo de palavras (pt/en); só para a frente.
- **Aprendizado (F14-2, §2.4):** sugestão com notificação por padrão. O automático só age com remetente confiável, confiança ≥ 90, ≥ 20 decisões e ≥ 95 % de acerto ponderado (erro pesa o dobro), sem desfazer nos últimos 7 dias. Acerto: sugestão aprovada como veio; automático mantido depois da janela de 7 dias. Erro: recusada, desfeita, aprovada com outra etapa, ou trocada à mão para trás (ou no mesmo dia) depois da decisão; avançar no processo não é correção. A troca manual aprova a sugestão igual e fecha as que ficaram para trás. Configurações › Gmail mostra o acerto e a chave do automático. **Diferença do plano:** os exemplos aprendidos não entram no prompt do classificador (mudaria o prompt e o gate); o vocabulário aprendido liga a dica à etapa por código.
- **Convites (F14-3):** `.ics` do e-mail lido por código; UID novo → evento oficial da etapa (o da mesma etapa ou até 1 dia substitui a provisória e avisa do bloqueio); mesmo UID → remarca ou cancela (SEQUENCE menor que a recebida é ignorada); fuso não reconhecido → provisório com aviso. Sem `.ics`, o horário escrito vira etapa provisória com "Bloquear agenda" (abre o Google Agenda e marca o bloqueio). O `.ics` exportado de um evento cancelado sai como cancelamento.
- **Remetente sem confiança:** nota e sugestão sim; evento novo só provisório e sem link; remarcar, cancelar ou trocar a provisória vai para a revisão com "aplicar mesmo assim" (a revisão aceita também as classes do M6).
- **Desfazer por e-mail** (`mail/undo.ts`, botão em "Pelo e-mail" na candidatura): reverte o que o e-mail fez no M5 e no M6, só o que ainda está como ele deixou (o resto é avisado); a candidatura criada pela confirmação só é apagada se não tiver mais nada (notas da pessoa, eventos, outros e-mails, gravações), com os arquivos; a vaga só sai sem documentos nem análise. Automático ou aprovada desfeita conta como erro.
- **Tela:** cartão "Pelo e-mail" na candidatura (sugestões para mover ou recusar, e-mails com desfazer, histórico das etapas com a origem), selos na agenda (provisória, convite da empresa, cancelada).
- **Revisão independente (24 pontos):** tratados 1 a 23. Fica o 24: mover a etapa (à mão, pelo e-mail ou pelo desfazer) desarquiva a candidatura, como já era antes da F14.
- **Ambiente:** o disco da máquina encheu durante o gate (o envio de gravações respondia 507 e o e2e do F13 falhava); o dono autorizou `docker builder prune` (29,9 GB de cache). A migração 0045 foi ajustada antes do commit: os bancos de teste (instância `claude` e e2e) que já tinham a versão anterior foram recriados; o banco do dono nunca a recebeu.

### M7 · execução (2026-11-11)
- **Feed do e-mail:** filtros por plataforma, período, só as novas e só as de link que não abriu.
- **Perfil e CV na candidatura vinda de e-mail** (ponto 8 da revisão do M5): `PUT /api/job-applications/:id/profile-cv` e o seletor no cartão (trocar o perfil, ligar uma versão pronta do CV do perfil, que deixa de ser presumido, ou tirar o CV); arquivo feito fora do narnia vai numa nota.
- **e2e F14/E2E-01** com o Gmail falso (rota `/api/_test/gmail`, só no mock: caixa e conta conectada): alerta → duas vagas no feed com "link não abriu"; confirmação de remetente sem autenticação → revisão → "Aplicar mesmo assim" → candidatura com o e-mail → desfazer apaga. O primeiro rascunho usava links para `127.0.0.1` e o e-mail foi, corretamente, para a quarentena (link para IP).
- **Docs:** `docs/gmail.md` (cliente OAuth com as duas URIs, modo de teste do Google, onde aparece, confiança, etapas, desfazer, privacidade), ligado no README e no guia de uso.
- **Gate:** lint, typecheck, testes e e2e verdes (94 + os dois refeitos depois de recriar o banco do e2e e trocar os links do teste).
- **Falta:** o teste manual do dono com a conta real (depois do `promote`).
