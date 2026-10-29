# F07 · Candidaturas

Entregável 7 do plan-v0. Cobre a feature **#3** de `../02-fluxos-do-usuario.md §F5` e o fluxo `§F5.1`: o rastreador de candidaturas em kanban, com etapas datadas, documentos, análise, contatos, notas e agenda. No MVP, a agenda exporta para o Google Calendar **sem autenticação** (link + `.ics`); a integração com o MCP oficial do Google (`../08-docker-calendar-voz.md §2`) entra como opção, prevista para a fase 7 do plano.

Status: **em andamento** (2026-10-28): M1 a M7 implementados; faltam o teste manual com provider real (§6.4) e o teste do guia do Google por outra pessoa. Requisitos novos do dono em §0, que valem sobre o resto do arquivo onde houver conflito. Decisão global 12 fechada em 2026-10-07: integração autenticada com o Google Calendar **mantida como opcional**, com guia passo a passo; a feature funciona completa sem Google (link + `.ics`).

---

## 0 · Requisitos do dono (2026-10-27) · valem sobre §1 a §6

1. **Só o botão "Aplicar" cria a candidatura.** Ele fica na página da vaga salva e, na extensão, na janela da análise e na do formulário. Cria a candidatura com a vaga, a versão do CV (**obrigatória**, F07-10) e a da carta, se houver, **travadas** (a candidatura guarda a `document_version`, não o documento; regerar o CV depois não muda o que foi enviado) e a **data da candidatura**, que a pessoa pode trocar antes de confirmar (ex.: aplicou ontem). Substitui o requisito de 2026-10-11 de "gerar CV para uma vaga cria a candidatura" e o "+ nova" à mão: vaga salva é o "interesse".
2. **Colunas:** Aplicado → 1ª Entrevista → Em processo → Oferta → Encerrado (sai "Interesse").
3. **Etapas do processo (pipeline) ajustáveis por candidatura.** Padrão: Análise de currículo · Bate-papo com Talent · Entrevista com liderança · Entrevista técnica · Oferta · Contratação. A pessoa adiciona (ex.: "Design system", "Pair programming"), remove e reordena com arrastar e soltar. Se a descrição da vaga traz as etapas, elas vêm da leitura da vaga (§0.1) e viram o pipeline da candidatura ao aplicar.
4. **Cartão em "Em processo" mostra a etapa atual como "x/N"** do pipeline daquela candidatura; a coluna não depende do pipeline (F07-8).
5. **Notas e anexos datados:** texto e/ou arquivos (e-mails, imagens, textos, PDFs, vídeo etc.), com data que a pessoa pode trocar antes de salvar (ex.: registrar um e-mail de ontem).
6. **Arquivamento:** candidatura sem atividade por 40 dias fica arquivada por padrão; há um caminho para ver as arquivadas.
7. **Busca** na página de candidaturas por empresa, cliente, cargo, data e contato.
8. **(2026-10-27, segunda rodada)** Na lista de vagas, destacar as já aplicadas; no quadro, a coluna **"Vagas salvas"** antes de Aplicado (vagas sem candidatura, com o Aplicar); na página da vaga, **arquivar a vaga** que não deu um bom fit, com o motivo, **para melhorar o score de fit** (o motivo alimenta o recrutador especializado: marco M1.6, abaixo).

### 0.1 Como encaixa no que existe
- **Nomes no código:** `applications`/`application_form` já são o formulário da extensão (F12). As tabelas da F07 viram `job_application`, `job_application_stage` e `job_application_entry`; o repositório, `jobApplications`. A rota da janela da extensão (`/candidatura`) continua; a página nova é `/candidaturas`.
- **Contatos:** os da vaga (`posting_contact`, F06) são os da candidatura; a cadeia de contatos (§1) entra na M6.
- **Etapas na vaga:** a extração da vaga (`posting.extract`) ganha `hiring_steps` (lista de nomes, vazia quando a descrição não diz). Muda prompt estruturado → gate F06-14 antes do commit.
- **Anexos:** em `<dados>/job-applications/<id>/`, com o nome original guardado no banco; entram no backup como os uploads (cópia dos que faltam).
- **Arquivamento:** atividade = aplicar, mudar de etapa ou coluna, nota, anexo, editar a candidatura. A conta roda no boot e a cada 24 h, como a poda das capturas; arquivar é marcar (`archived_at`), nunca apagar. Desarquivar à mão; atividade nova numa arquivada a desarquiva.

### 0.2 Marcos
| Marco | Conteúdo |
|---|---|
| M1 | Dados (migração 0027), regras no core, API; botão Aplicar na página da vaga (data editável, versões travadas, aviso de candidatura já existente); página `/candidaturas` com quadro de 5 colunas, lista, busca e arquivadas; arquivamento por inatividade. |
| M1.5 | Destaque das aplicadas na lista de vagas, coluna "Vagas salvas", arquivar a vaga com motivo (migração 0028). |
| M1.6 | O fit usa os motivos: o especializado recebe as vagas arquivadas e o porquê (prompt/contexto muda → gate F06-14). |
| M2 | Pipeline editável na candidatura (adicionar, remover, arrastar), "x/N" no cartão; `hiring_steps` na extração da vaga (gate). |
| M3 | Notas e anexos datados (upload, prévia de imagem, PDF e vídeo, baixar), backup dos anexos. |
| M4 | Extensão: Aplicar na janela da análise e na do formulário. |
| M5 | Agenda das etapas (link Google, `.ics`), lembretes, funil. |
| M6 | Skill `candidaturas` + tools MCP, conversar sobre a candidatura, cadeia de contatos, modo B. |
| M7 | Google Calendar autenticado (opcional, F07-4). |

---

## 1 · Objetivo e resultado esperado

Com F01 e F04 prontos (F05 e F06 enriquecem), a pessoa consegue:

1. ver um kanban por perfil com as colunas Interesse → Aplicado → Entrevista → Oferta → Encerrado e arrastar cartões entre elas;
2. criar uma candidatura à mão ou a partir de uma análise de vaga (F06), e abrir o cartão com vaga, documentos gerados (F05), análise, contatos, notas e agenda;
3. registrar etapas com data/hora no seu fuso (gravadas em UTC): entrevista, prova, retorno, prazo;
4. receber lembretes simples na UI (bandeja/badge) para etapas nas próximas 24 h e etapas atrasadas;
5. adicionar uma etapa ao Google Calendar por link pré-preenchido ou baixar `.ics`, sem conectar conta;
6. opcionalmente, conectar a conta Google (cliente OAuth próprio) e deixar o recrutador criar/consultar eventos pelo MCP oficial;
7. ver um funil simples (quantas em cada coluna, taxa de avanço, tempo médio por etapa);
8. no modo B, usar `/narnia-jobs:candidaturas` para listar, mover e agendar por texto, recebendo links da UI.

### Dentro do escopo
- Tabelas `application`, `application_event`, `contact`, `calendar_link`; migração do stub `application.create_minimal` de F06.
- Skill `plugin/skills/candidaturas` + tools `application.*` e `calendar.*` (locais) no MCP (F04).
- Kanban com drag-and-drop, cartão detalhado, agenda, lembretes na UI, funil.
- **Alerta de candidatura repetida (F06-11, herdado da F06):** na análise e na página da vaga, avisar quando já existe candidatura para a mesma empresa e role; a F06 entregou só "Vagas parecidas" (vagas salvas, não candidaturas).
- Exportação de evento: link `calendar.google.com/calendar/render?action=TEMPLATE…` e arquivo `.ics` (RFC 5545) gerados no servidor.
- Integração opcional com o MCP oficial do Google Calendar: comando `narnia-jobs google connect`, detecção de "conectado", uso condicional pela skill.
- Página L7 de `../05-layouts.md`.
- **Candidatura a partir do CV com vaga (requisito do dono, 2026-10-11):** gerar CV para uma vaga (F05) cria/atualiza a candidatura com a vaga salva e o CV gerado; **lista de candidaturas** além do kanban, abrir uma candidatura (vaga, CV, análise, histórico, contatos), **conversar sobre ela no chat** (sessão da F04 com a candidatura como contexto) e **atualizar o status** pela tela ou pelo chat.
- **Pessoas e cadeia de contatos:** em cada candidatura, quem está do outro lado (nome, papel: recrutador, gestor, indicação; empresa, canal) e a **cadeia de contatos** em ordem (quem indicou quem, data, canal, resumo); o recrutador registra pelas tools `contact.*` quando o assunto da conversa é uma vaga.

### Fora do escopo (e para onde vai)
- Análise da vaga → F06; CV → F05; carta/mensagem → F09; simulação → F08 (o cartão só linka).
- Notificações fora da UI (e-mail, push, desktop) → fora do plan-v0.
- Sincronização bidirecional completa com o Google (editar no Google reflete aqui) → fase posterior; em F07 o Narnia cria/consulta eventos, e guarda `google_event_id`.
- Outros calendários (Outlook, Apple) → `.ics` já cobre importação manual.
- Importação de candidaturas de sites de emprego → fora do projeto.

---

## 2 · Arquitetura deste entregável

### 2.1 Modelo de estados
```
interesse ─► aplicado ─► entrevista ─► oferta ─► encerrado(aceita)
    │            │            │           └────► encerrado(recusada)
    └────────────┴────────────┴──────────────────► encerrado(desistiu | sem retorno | reprovado)
```
- Mover um cartão cria um `application_event` de tipo `status_change` com timestamp UTC; o funil é calculado a partir desses eventos.
- Etapas agendadas (`interview`, `test`, `deadline`, `followup`) são `application_event` com `scheduled_at` (UTC) e `timezone` do usuário no momento do registro.

### 2.2 Skill `candidaturas` e tools MCP
| Tool | Função |
|------|--------|
| `application.list(profile, status?)`, `application.get(id)` | leitura em fatias (lista = 1 linha por cartão) |
| `application.create({company, title, posting_id?, url?, source})` | substitui o stub de F06 |
| `application.update(id, fields)`, `application.set_status(id, status, reason?)` | movimentação |
| `application.add_note(id, text)`, `application.add_contact(id, contact)` | anotações |
| `application.schedule(id, {type, scheduled_at_utc, duration_min, location?, link?, notes?})` | cria etapa; devolve `event_id` + links de calendário |
| `application.upcoming(profile, hours=48)` | lembretes |
| `calendar.links(event_id)` | URL do Google (template) + caminho do `.ics` |
| `calendar.google_status()` | `connected: boolean` (checa se o servidor MCP `google-calendar` está registrado e autenticado) |
| (externo, condicional) `create_event`, `list_events`, `suggest_time`, `update_event` | do MCP oficial do Google, só quando `connected` |
A skill: lista e move por texto, agenda etapas convertendo "quinta 14h" para UTC usando o fuso do usuário, e **só** chama as tools do Google se `calendar.google_status().connected`; caso contrário devolve o link/`.ics`. Em modo B a saída é texto com links `…/candidaturas/<id>`.

### 2.3 Exportação de calendário sem autenticação (no `api`)
| Saída | Implementação |
|-------|---------------|
| Link Google | `https://calendar.google.com/calendar/render?action=TEMPLATE&text=<título>&dates=<início>/<fim em UTC, formato basic>&details=<descrição com link da candidatura>&location=<local ou link>` |
| `.ics` | gerado por biblioteca (`ics`) com `UID` estável (`event_id@narnia-jobs`), `DTSTART`/`DTEND` em UTC, `DESCRIPTION`, `URL`, `SEQUENCE` incrementado a cada edição para que reimportar atualize |
| Rota | `GET /api/applications/:id/events/:eid/calendar.ics` e `…/google-link` |

### 2.4 Integração opcional com o MCP oficial do Google Calendar
Conforme `../08-docker-calendar-voz.md §2` e `../03-arquitetura.md §12`:
1. Usuário cria cliente OAuth no Google Cloud (guia na tela de Configurações; redirect `http://localhost:8089/callback`).
2. `narnia-jobs google connect` pede client ID e secret e executa, dentro do container: `claude mcp add --transport http google-calendar https://calendarmcp.googleapis.com/mcp/v1 --client-id <id> --client-secret --callback-port 8089 --scope user`, depois `claude mcp login google-calendar` (porta 8089 publicada no compose).
3. A API expõe `calendar.google_status()` lendo `claude mcp list`/estado do servidor; a UI mostra "conectado" e a skill passa a usar as tools do Google.
4. Modo B no host: o mesmo comando roda no host; as credenciais ficam no `~/.claude` do host.
5. Evento criado via Google guarda `google_event_id` em `application_event`; edição local chama `update_event` quando conectado, senão só regenera o `.ics` (`SEQUENCE+1`).

### 2.5 Lembretes na UI
- `application.upcoming` é consultado pelo shell a cada 5 min (ou via WS quando há mudança): badge no menu "Candidaturas" e item na bandeja de atividades para etapas em < 24 h e atrasadas.
- Sem notificações do sistema operacional em F07.

### 2.6 API
| Método e rota | Função |
|---------------|--------|
| `GET /api/applications?profile=&status=` · `POST /api/applications` · `GET/PUT /api/applications/:id` · `DELETE` | CRUD |
| `POST /api/applications/:id/status` | mover (cria evento `status_change`) |
| `POST /api/applications/:id/events` · `PUT/DELETE …/events/:eid` | etapas |
| `GET …/events/:eid/calendar.ics` · `GET …/events/:eid/google-link` | exportação |
| `POST /api/applications/:id/notes` · `…/contacts` | anotações |
| `GET /api/applications/upcoming?profile=&hours=` | lembretes |
| `GET /api/applications/funnel?profile=` | estatísticas |
| `GET /api/integrations/google-calendar/status` · `POST …/connect` (dispara o fluxo do §2.4 e devolve instruções) | integração |

---

## 3 · Dados deste entregável

| Tabela | Colunas principais |
|--------|--------------------|
| `application` | `id`, `profile_id`, `company`, `title`, `posting_id?` (F06), `url?`, `source` (manual/analysis/chat), `status` (interesse/aplicado/entrevista/oferta/encerrado), `closed_reason?` (aceita/recusada/desistiu/sem_retorno/reprovado), `salary_offered?`, `priority?`, `created_at`, `updated_at` (UTC) |
| `application_event` | `id`, `application_id`, `type` (status_change/interview/test/deadline/followup/note), `from_status?`, `to_status?`, `scheduled_at?` (UTC), `duration_min?`, `timezone` (IANA no momento do registro), `location?`, `link?`, `notes?`, `google_event_id?`, `ics_sequence` (int), `created_at` |
| `contact` | `id`, `application_id`, `name`, `role?`, `email?`, `phone?`, `linkedin?`, `notes?` |
| `note` | `id`, `application_id`, `text`, `created_at` (UTC) |
| `calendar_link` | `event_id`, `google_url`, `ics_path`, `generated_at` |
| `document` (F05) | ganha uso de `application_id` já previsto |
| `job_analysis` (F06) | `application_id` já previsto |

Regras:
- Datas/horas sempre UTC no banco; `timezone` guardado no evento para reconstruir "o que o usuário viu" mesmo se mudar de fuso depois.
- `status_change` nunca é apagado (histórico do funil); etapas agendadas podem ser editadas/apagadas.
- Apagar uma candidatura apaga eventos, contatos e notas; documentos (F05) e análises (F06) ficam, com `application_id` nulo.

---

## 4 · Layouts deste entregável

Referência: `../05-layouts.md` L7. Componentes a construir:

| Tela | Componentes | Estados a cobrir |
|------|-------------|------------------|
| Kanban (L7) | `Board` com 5 `Column`, `ApplicationCard` (empresa, cargo, fit se houver, última etapa, próxima data no fuso), drag-and-drop, filtro por texto, "+ nova" | vazio · com cartões · arrastando · erro ao mover (reverte) |
| Cartão | `ApplicationDrawer` com abas Vaga (texto/URL/análise F06) · Documentos (F05) · Agenda · Contatos · Notas; `StatusStepper`; `CloseDialog` (motivo) | sem análise · com análise · encerrada |
| Agenda | `EventList`, `EventForm` (tipo, data/hora no fuso do usuário, duração, local/link, notas), `CalendarActions` ("Adicionar ao Google Calendar", "Baixar .ics", "Criar no Google" quando conectado) | sem eventos · futuro · passado · atrasado · sincronizado com Google |
| Lembretes | badge no menu + itens na `ActivityTray` | nenhum · próximos · atrasados |
| Funil | `FunnelStats` (contagem por coluna, taxa de avanço, tempo médio por etapa) | poucos dados · suficiente |
| Config › Integrações | `GoogleCalendarCard` (guia passo a passo, campos client ID/secret, instrução do comando, status conectado) | não conectado · aguardando login · conectado · erro |
| Modo B | listagem textual por coluna; confirmação de movimento/agendamento com link | — |

---

## 5 · Decisões em aberto deste entregável

| # | Decisão | Opções | Padrão proposto |
|---|---------|--------|-----------------|
| F07-1 | Drag-and-drop | `@dnd-kit` · `react-beautiful-dnd` (descontinuada) · `pragmatic-drag-and-drop` | **`@dnd-kit`** (acessível, mantida, teclado) |
| F07-2 | Geração de `.ics` | biblioteca `ics` · `ical-generator` · manual | **`ics`** (simples, RFC 5545, testável) |
| F07-3 | Fuso do evento | gravar UTC + fuso do usuário no evento · só UTC · fuso do local da entrevista | **UTC + fuso do usuário** (decisão 17); campo opcional "fuso do entrevistador" exibido ao lado |
| F07-4 | Quando entra o OAuth do Google | fase 7 do plano (após F07 base) · junto com F07 · nunca | **fase 7**: F07 entrega link + `.ics` e a estrutura de `google_status`; a conexão real é a última etapa |
| F07-5 | Lembretes | só UI (badge/bandeja) · + notificação do navegador (Notification API) | **só UI** em F07; Notification API como opção simples depois |
| F07-6 | Encerramento | motivo obrigatório · opcional | **obrigatório** (alimenta o funil e o recrutador) |
| F07-7 | Múltiplos perfis | candidatura pertence a um perfil · pode ser compartilhada | **um perfil** (coerente com F02): o do CV travado; sem CV, o perfil ativo |
| F07-8 | Coluna × etapa do pipeline | coluna derivada da etapa atual · coluna independente | **Fechada (dono, 2026-10-27): independentes.** A coluna é o que a pessoa move; o pipeline é de cada candidatura (uma pode ter 3 etapas, outra 6) e o "x/N" só aparece no cartão em "Em processo". Uma candidatura nunca interfere na outra. |
| F07-9 | Aplicar de novo na mesma vaga | uma candidatura ativa por vaga (o botão abre a existente) · várias | **uma ativa por vaga**; encerrada ou arquivada permite outra |
| F07-10 | Sem CV para a vaga | **Fechada (dono, 2026-10-27): toda candidatura tem um currículo.** O diálogo de Aplicar escolhe a versão pronta do CV da vaga ou do CV geral do perfil; sem nenhum pronto, o botão leva a gerar o CV e não cria nada. A carta é opcional (trava a versão se houver). |
| F07-11 | Tamanho dos anexos | limite por arquivo | **100 MB por arquivo** (vídeo de entrevista cabe; acima disso, guardar o link) |
| F07-12 | Onde ficam os anexos | `<dados>/job-applications/<id da candidatura>/` · pasta plana por id do anexo | **Pasta plana `<dados>/job-applications/<id do anexo>`** (2026-10-28): o backup copia os que faltam como faz com os uploads e a restauração devolve os que faltam, sem subpastas. |
| F07-13 | Geração do `.ics` (F07-2) | biblioteca `ics` · manual | **Manual** (2026-10-28, `packages/shared/src/calendar.ts`): RFC 5545 com escape e dobra de linha testados; sem dependência nova, e a mesma função serve a web, a api e as tools. |
| F07-14 | Endereço da interface no `.ics` e no link do Google | `NARNIA_PUBLIC_URL` · origem da página | **Origem da página** (`?origin=` na rota do `.ics`; a web monta o link do Google), com `NARNIA_PUBLIC_URL` como reserva nas tools do recrutador. |
| F07-15 | Candidatura pela conversa | tool `job_application.create` · só o botão | **Só o botão Aplicar** (§0-1): a skill manda o link da vaga para a pessoa aplicar. |

---

## 6 · O que precisa estar coberto para o F07 funcionar

### 6.1 Pré-requisitos e dependências
1. **F01**: jobs/bandeja (lembretes), `time.ts` (UTC ↔ fuso), i18n, perfil.
2. **F04**: MCP, `plugin/`, sessões; `claude mcp add/login` verificados em `../08 §2`.
3. **F06**: `posting_id` e análise no cartão (opcional; F07 substitui o stub `application.create_minimal`).
4. **F05**: documentos no cartão (opcional).
5. **F02**: kanban filtra pelo perfil ativo (sem F02, há um perfil só).
6. Ordem interna: tabelas + API → kanban → cartão/agenda → `.ics`/link → lembretes → funil → skill → (fase 7) Google MCP.

### 6.2 Testes unitários (Vitest) · obrigatórios
**`packages/core` (applications/)**
- Transições: todas as permitidas criam `status_change`; `encerrado` sem motivo → erro; voltar de `encerrado` → permitido com novo evento.
- Funil: fixtures de eventos → contagens, taxa de avanço e tempo médio por etapa corretos; candidatura sem eventos conta só na coluna atual.
- `upcoming`: eventos em < 24 h, atrasados e futuros distantes classificados corretamente em UTC; independe do fuso.

**`packages/shared`**
- `time.ts`: "quinta 14:00" em `America/Sao_Paulo` → UTC correto, inclusive na virada de horário de verão de outra zona (`Europe/Lisbon`).
- Schemas: `ApplicationEvent` exige `timezone` quando há `scheduled_at`.

**`apps/api`**
- `.ics`: `UID` estável, `DTSTART/DTEND` em UTC com `Z`, `SEQUENCE` incrementa ao editar, escape de vírgulas/quebras em `DESCRIPTION`; parse de volta com `ical.js`/`node-ical` valida.
- Link Google: URL codificada, `dates` em UTC formato basic, `details` contém o link da candidatura.
- `google_status`: mock de `claude mcp list` → `connected` true/false; comando ausente → false com motivo.
- Skill helper: conversão de "amanhã 10h" (texto) para `scheduled_at_utc` usando o fuso do usuário (função pura, com data fixa injetada).
- Rotas: mover status inválido → 400; apagar candidatura remove eventos/contatos/notas e desvincula documentos/análises; `upcoming` e `funnel` filtram por perfil.
- Lembretes: cálculo publica evento WS `reminder.update` quando um evento entra na janela.

**`apps/web`**
- `Board`: drag-and-drop move o cartão e chama a API; falha reverte; acessível por teclado.
- `EventForm`: entrada no fuso do usuário, envia UTC, mostra o fuso usado; validação de duração.
- `CalendarActions`: link abre em nova aba com os parâmetros corretos; "Criar no Google" só aparece quando `connected`.
- `ApplicationDrawer`: abas renderizam vazio/cheio; `CloseDialog` exige motivo.
- `FunnelStats`: renderiza com poucos dados sem dividir por zero.
- Lembretes: badge atualiza por WS.

### 6.3 Testes e2e (Playwright, Chromium) · obrigatórios
Compose com `NARNIA_PROVIDER=mock`; para o Google, um **mock do servidor MCP** HTTP local registrado no lugar do oficial nos testes.
- **E2E-01 criar e mover**: "+ nova" → preencher → cartão em Interesse → arrastar para Aplicado → recarregar → continua em Aplicado; histórico mostra a transição com hora no fuso.
- **E2E-02 agendar entrevista**: abrir cartão → Agenda → nova etapa "entrevista" quinta 14:00 → aparece com fuso → `.ics` baixa e contém `DTSTART` em UTC esperado → link Google abre URL com `dates` corretos.
- **E2E-03 lembrete**: criar etapa daqui a 2 h (relógio de teste) → badge "1" e item na bandeja; marcar como concluída → some.
- **E2E-04 atrasado**: etapa no passado sem conclusão → marcada "atrasada".
- **E2E-05 a partir da análise** (com F06): "Abrir candidatura" na análise → cartão com aba Vaga preenchida e fit no cartão.
- **E2E-06 documentos** (com F05): gerar CV a partir do cartão → aparece na aba Documentos.
- **E2E-07 encerrar**: mover para Encerrado → diálogo exige motivo → funil atualiza.
- **E2E-08 funil**: 6 candidaturas de fixture em estados variados → contagens e taxas corretas.
- **E2E-09 Google não conectado**: botão "Criar no Google" ausente; Config mostra guia e status "não conectado".
- **E2E-10 Google conectado (mock)**: registrar o mock como `google-calendar` → status "conectado" → agendar → mock recebe `create_event` → `google_event_id` gravado → editar hora → mock recebe `update_event`.
- **E2E-11 modo B**: `claude -p "/narnia-jobs:candidaturas listar" --plugin-dir plugin/` → listagem por coluna com links; `"… mover Acme para entrevista"` → cartão move.
- **E2E-12 troca de fuso**: alterar `timezone` do usuário → horários exibidos mudam, UTC gravado não.
- **E2E-13 persistência**: `down/up` → candidaturas, eventos e `.ics` continuam.

- **E2E-x candidatura via CV**: gerar CV para uma vaga (F05) → candidatura aparece na lista com vaga e CV → abrir → "Conversar sobre esta candidatura" abre o chat com o contexto → mudar status pelo chat → histórico registra.
- **E2E-y cadeia de contatos**: no chat sobre uma vaga, informar "falei com a Maria, que me indicou ao João, gestor" → recrutador registra os dois contatos em ordem com papel e data → a candidatura mostra a cadeia.

### 6.4 Teste manual com provider real (antes de fechar F07)
Usar o kanban por 1 semana com candidaturas reais: pedir ao recrutador (modo A e B) para listar, mover e agendar em linguagem natural (10 comandos), conferir conversão de horários, importar 3 `.ics` no Google Calendar/Outlook/Apple e ver se atualizações (`SEQUENCE`) substituem o evento. Se a conexão Google estiver na fase 7: conectar com cliente OAuth real, criar/editar 3 eventos.

### 6.5 Definição de pronto
- Testes de 6.2 e 6.3 verdes na CI; cobertura ≥ 80 % em `core/applications` e `api/calendar`.
- `.ics` validado em 3 calendários no teste manual.
- Todas as horas exibidas no fuso do usuário e gravadas em UTC (teste E2E-12).
- Guia de conexão Google escrito e testado por alguém que não é o autor (fase 7).
- `../02`, `../03`, `../04`, `../05`, `../08` atualizados.

---

## 7 · Riscos específicos
| Risco | Mitigação |
|-------|-----------|
| Fricção do cliente OAuth do Google afasta usuários | link + `.ics` sem autenticação cobrem 90 % do uso; conexão é opcional e tardia (F07-4) |
| MCP oficial do Google em *Developer Preview* muda | uso condicional e isolado em `calendar.*`; mock nos testes; falha vira fallback para `.ics` |
| Conversão de fuso errada em horário de verão | `time.ts` testado em transições; fuso gravado por evento |
| Drag-and-drop frágil em e2e | `@dnd-kit` com suporte a teclado; e2e usa teclado como alternativa ao mouse |
| Lembretes perdidos com a aba fechada | aceito em F07 (só UI); Notification API como evolução |
| Login do MCP Google exige sessão interativa (não roda no SDK) | comando dedicado `narnia-jobs google connect` documentado; status claro na UI |

## 8 · Registro de execução
| Data | Marco | O que aconteceu |
|------|-------|-----------------|
| 2026-10-11 | — | **Plano incrementado (dono):** candidatura criada pelo CV com vaga, lista, abrir, conversar no chat, status pelo chat, pessoas e cadeia de contatos (`contact.*`); testes e2e correspondentes. |
| 2026-10-11 | — | **Requisitos do dono (registro antecipado):** gerar CV para uma vaga salva **a vaga e o CV** como uma candidatura; **lista de candidaturas**, abrir uma candidatura, **conversar com o chat sobre ela** e **atualizar o status**; quando o assunto é uma vaga, salvar **o nome de quem está do outro lado e a cadeia de pessoas contactadas** (recrutador, indicação, gestor, com data e canal de cada contato). |
| 2026-10-27 | — | **Requisitos do dono (§0):** candidatura só pelo botão Aplicar (vaga, CV e carta com versão travada, data editável), colunas Aplicado → 1ª Entrevista → Em processo → Oferta → Encerrado, pipeline ajustável por candidatura e lido da vaga, "x/N" no cartão, notas e anexos datados, arquivamento após 40 dias sem atividade, busca. Marcos M1–M7 em §0.2. |
| 2026-10-27 | M1 | **Entregue:** migração 0027 (`job_application`, `job_application_stage`); core `job-applications/` (opções do Aplicar só com versões prontas, CV obrigatório da vaga ou geral, carta da vaga, data até hoje, uma ativa por vaga, vaga com duplicata pendente não aplica, pipeline padrão de 6 etapas na etapa 1, busca por empresa/cliente/cargo/data/contato, arquivamento por 40 dias); API `/api/postings/:id/apply-options` e `/api/job-applications` (CRUD, evento `job_application.updated`); arquivamento no boot e a cada 24 h; apagar vaga ou documento enviado numa candidatura dá `409 has_application` (o banco também recusa). Web: botão Aplicar na vaga (diálogo com CV e carta, "Mudar a data"; sem CV leva a gerar; com candidatura ativa vira "Ver candidatura"), página `/candidaturas` (quadro de 5 colunas, "x/N" só em Em processo, mover pelo menu do cartão, Encerrado pede o motivo, busca, "Ver arquivadas"), página da candidatura (versões travadas com download, etapas com a atual, arquivar, apagar), item "Candidaturas" no menu. Testes: core 10, api 4, web 8, e2e F07/E2E-01. Arrastar e soltar no quadro fica para a M2, junto do pipeline. |
| 2026-10-27 | M1.5 | **Entregue (pedido do dono):** migração 0028 (`posting.archived_at`, `archive_reason`, `archive_note`); motivos: salário, senioridade, stack, modelo de trabalho, local, contrato, empresa, outro (+ nota livre). `POST /api/postings/:id/archive` (motivo obrigatório; `409 has_active_application` com candidatura ativa) e `/unarchive`; `GET /api/postings` traz a candidatura de cada vaga e separa as arquivadas (`archived=1`; o recrutador continua vendo todas); `GET /api/job-applications` traz `saved` (vagas sem candidatura). Web: vaga aplicada em destaque com "Aplicada · coluna", "Ver arquivadas" na lista de vagas, coluna "Vagas salvas" no quadro com o Aplicar, "Arquivar vaga" (diálogo com motivo e detalhe) e faixa da vaga arquivada com "Desarquivar"; vaga arquivada não mostra o Aplicar. Testes: core 5, api 3, web 5, e2e F07/E2E-02. |
| 2026-10-28 | M1.6 | **Implementado:** `posting_get` devolve `discarded` (as 10 vagas arquivadas mais recentes, com motivo e nota, sem a própria); o especializado (regra 5 nova) trata o motivo como preferência declarada: se a vaga repete o motivo, baixa o fit e põe nos riscos citando a vaga descartada, sem contar como lacuna do currículo. Avaliação: o sandbox ganhou uma vaga PJ arquivada por contrato (o motivo não se repete nas vagas dos outros casos, todas CLT) e o caso `analise-com-vaga-descartada`; o contexto do juiz lista as vagas arquivadas com o motivo (calibração 19/19 e pairwise 6/6). Testes: core 2. |
| 2026-10-28 | M2 | **Implementado:** pipeline editável (`PUT /api/job-applications/:id/stages`: adicionar, remover, reordenar mantendo os ids; a etapa atual continua ou passa para a da mesma posição) e etapa atual pelo `PATCH` (`currentStageId`); editor com arrastar (`@dnd-kit`, também pelo teclado) e botões subir, descer, remover e "Etapa atual"; arrastar o cartão entre as colunas do quadro (o "Mover" continua). Etapas da vaga: `posting.hiring_steps_json` (migração 0029), campo "Etapas do processo seletivo" na vaga e a heurística sem tokens ("Etapas do processo", "Processo seletivo", "Hiring process", linha com setas); ao aplicar, viram o pipeline. **Mudança de rumo:** a regra das etapas no prompt `posting.extract` reprovou o gate dos estruturados por amostra única (as 3 derrotas foram em título, país e origem do Terraform, sem relação com as etapas), e o runner dos estruturados não tem o modo `--feature`; as etapas ficaram fora do formato de saída do modelo (`ModelPostingFieldsSchema`), e os 19 prompts estruturados seguem idênticos às versões aprovadas. Testes: core 7 (+1 heurística), api 2, web 2, e2e F07/E2E-03. |
| 2026-10-28 | M3 | **Implementado:** notas e anexos datados (migração 0030, `job_application_entry` e `job_application_attachment`): texto e/ou arquivos com a data escolhida (até hoje), até 100 MB por arquivo (F07-11; nginx aceita 105 MB só nessa rota); download com `Range` (vídeo avança), imagem, PDF, vídeo, áudio e texto abrem no navegador, o resto baixa como binário (HTML e SVG nunca rodam na origem); editar e apagar (apaga os arquivos); apagar a candidatura apaga os arquivos; backup e restauração (`start.sh`/`start.ps1`) copiam os anexos que faltam (F07-12). Testes: core 5 (+1 backup), api 3, web 4, bats 1, Pester 1, e2e F07/E2E-04. |
| 2026-10-28 | M4 | **Implementado:** Aplicar na janela da extensão depois de "Salvar vaga" e na do formulário com a vaga ligada (sem vaga ligada, não aparece); sem CV, abre a vaga em outra aba no "Gerar CV". Testes: web 2, e2e F07/E2E-05 (captura pela API, como a extensão envia). |
| 2026-10-28 | M5 | **Implementado:** agenda (migração 0031, `job_application_event` com UTC + fuso, `ics_sequence`, `google_event_id`; `job_application_move` com o histórico das colunas, preenchido para as candidaturas antigas); data e hora digitadas no fuso da pessoa (`localToUtc`, testado na virada de Lisboa); link do modelo do Google Calendar e `.ics` (F07-13, F07-14); concluir/reabrir; lembretes (próximas 24 h e atrasados, só de candidaturas ativas) no badge de Candidaturas e na bandeja, recarregados a cada 5 min e por WS; funil (agora, quantas chegaram, taxa de avanço, dias médios das passagens terminadas, motivos de encerramento). Testes: shared 6, core 6, api 3, web 4, e2e F07/E2E-06. |
| 2026-10-28 | M6 | **Implementado:** tools `job_application.list/get/move/set_stage/add_note/schedule/set_google_event/upcoming` (escopo de carreira e vaga; sem criar, F07-15) e a skill `candidaturas` (mesma nos modos A e B); recrutador geral com a seção "Candidaturas"; "Conversar sobre esta candidatura" (migração 0033: uma conversa por candidatura, nota `acompanhamento-contexto`); cadeia de contatos (migração 0032: papel, data, resumo, quem indicou quem) no formulário de contato e no cartão "Pessoas e cadeia de contatos" da candidatura, e na `posting.contact_add` (`referredBy` pelo nome). Avaliação: casos `candidatura-etapa-e-agenda` (conversa da candidatura) e `candidaturas-listar`; "Google Calendar" deixou de contar como empresa no avaliador. Testes: core 5 (+1 avaliador), api 2 (+7 tools na auditoria do MCP), web 3. |
| 2026-10-28 | M7 | **Implementado (falta testar com conta Google real):** status pelo `claude mcp list` (`GET /api/integrations/google-calendar/status`, cache de 1 min; com o mock, "não conectado"), cartão em Configurações com o passo a passo, `./start.sh google connect <client-id>` / `google status` (e no `start.ps1`), guia em `docs/google-calendar.md`. **`CLAUDE_CONFIG_DIR=/home/node/.claude`** nos composes (api, worker, dev): sem isso o registro do MCP (`~/.claude.json`) ficava fora do volume e sumia ao recriar o container (conferido na instância `claude`: com a variável, o arquivo vai para a pasta do volume; as credenciais continuam no mesmo arquivo). A skill oferece criar o evento no Google quando as tools dele estão na conversa e guarda o id. O E2E-10 com um MCP falso do Google não foi feito. Testes: core 3, api 2, web 2. |
| 2026-10-28 | Gate | **Gate do chat aprovado (`--feature`):** os 3 casos novos (`analise-com-vaga-descartada`, `candidatura-etapa-e-agenda`, `candidaturas-listar`) passaram em 5 de 5 amostras; os casos antigos afetados ficaram não-inferiores (pairwise 25 vitórias, 21 derrotas, 29 empates; margem do ruído 7), sem regressão nas médias; linha de base e aprovadas gravadas. O juiz do recrutador passou a aceitar `/candidaturas/<id>` como link de tool (uma amostra reprovou por isso); calibração 19/19 e pairwise 6/6. Quatro rodadas de ~4 h caíram no meio pelo limite da assinatura; daí a **retomada do gate** (conversas e julgamentos guardados em `evals/.checkpoint/`, parada no primeiro erro, mesmo comando retoma) e o **juiz com no máximo 4 chamadas simultâneas** (o pairwise disparava ~150 processos de uma vez e o limite de taxa respondia "usage limit" com a cota em 45%). |
| 2026-10-29 | M2 (modelo) | **Etapas também pelo modelo (pedido do dono):** a reprovação de 2026-10-28 vinha do gate dos estruturados, que julgava uma amostra por caso (o A contra A mediu que o acaso decide 56% dos pares do `posting-extract`) e não tinha `--feature`. O gate dos estruturados ganhou amostras dos dois lados (versão aprovada pelo histórico do Phoenix), `--feature` por prompt, `--noise` por prompt (gravado para os 17 prompts) e retomada. `PostingExtractOutputSchema` volta a ter `hiringSteps` (regra no prompt; o merge não muda): as etapas do modelo vão direto para a vaga (`applyPostingMerge`), vencem a heurística, nunca o usuário, e lista vazia não apaga. Gate: não-inferior (3 vitórias, 5 derrotas, 7 empates; margem 3), casos novos `etapas-em-prosa` 5/5, `etapas-em-lista` 4/5, `sem-etapas` 5/5; juiz do `posting-extract` com o ponto 5 (etapas). **Pendências vistas no ruído:** `extract-facts` inventa `startDate` em texto sem datas (3 de 6 repetições); `posting-extract` quebra os requisitos de `consultoria-completa` em itens soltos (3 derrotas); tolerância das médias de 50 pontos nos prompts com 1–2 casos (variação de uma repetição; proposta: dividir por √N ou mais casos). |

(Preencher durante a implementação: datas, resultados do teste manual, decisões tomadas.)
