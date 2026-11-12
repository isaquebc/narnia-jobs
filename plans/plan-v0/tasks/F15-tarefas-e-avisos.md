# F15 · Tarefas (kanban) e avisos nativos

Entregável 15 do plan-v0, pedido pelo dono em 2026-11-12 depois de um e-mail real: uma empresa convidou para uma etapa automática (triagem com perguntas técnicas por WhatsApp, num parceiro de recrutamento) e listou as fases do processo **numa imagem** no começo do corpo. O narnia classificou como contato de recrutador, gravou só uma nota e não viu as fases (a imagem é remota e o narnia nunca baixa nada de um e-mail).

Status: **decisões F15-1 a F15-6 fechadas com o dono em 2026-11-12; plano aprovado pelo dono em 2026-11-12; em execução**. Depende de F07 (candidaturas, etapas, `StagesEditor`) e F14 (leitura do Gmail, risco do remetente, desfazer, agendador, gate de prompts).

---

## 1 · Objetivo e resultado esperado

A pessoa consegue:

1. ver todas as suas tarefas num **kanban** (A fazer, Fazendo, Feito), criar as suas, arrastar entre colunas e filtrar por tag, origem, candidatura e prazo;
2. receber, sem fazer nada, a tarefa de uma ação pedida por e-mail (triagem, teste online, formulário, documentos, escolher horário), com o prazo, o link da ação, a candidatura e o e-mail;
3. ser avisada por uma **notificação nativa do sistema** (Linux, Windows, macOS) quando uma tarefa nasce, quando o prazo chega perto e quando vence, mesmo com o navegador fechado;
4. ligar o computador no dia seguinte e receber o aviso do que venceu enquanto ele estava desligado;
5. ver as etapas da candidatura montadas pelas fases que o e-mail lista, inclusive quando estão numa imagem.

### Fora do escopo
- Web Push (service worker): exige o navegador rodando e passa pelo servidor de push do navegador (F15-3).
- Tarefas recorrentes, subtarefas, responsáveis: a lista é pessoal.
- OCR de anexos (PDF, imagem anexa): só imagens do corpo (F15-5).

---

## 2 · Arquitetura

### 2.1 Tarefas
- Tabela `todo` (o nome `task` já é usado pela fila e pelo agendador): título, nota, coluna (`todo`, `doing`, `done`), posição, prazo (UTC, opcional), link de ação, origem (`manual`, `email`), candidatura, vaga e e-mail (opcionais), criada, concluída. `todo_tag` (tarefa, tag).
- Tags: as do e-mail nascem com a empresa, `e-mail` e o tipo da ação (`triagem`, `teste`, `formulário`, `documentos`, `entrevista`, `agendar`); as manuais são livres, com sugestão das já usadas.
- API `/api/todos` (listar com filtros, criar, editar, mover, apagar) e tools MCP `todos.*` para o recrutador; skill curta no `plugin/`.
- Web: página **Tarefas** no menu, kanban com `@dnd-kit` (o mesmo do `StagesEditor`), filtros, cartão com prazo (vencida em destaque), tags, links; cartão **Tarefas** na página da candidatura.

### 2.2 Avisos nativos (F15-3)
- Notificações novas: `todo.created`, `todo.due_soon` (24 h antes), `todo.overdue`. Entram na bandeja como as outras.
- Rotina agendada `todos.reminders` (a cada 15 min): como o agendador roda na primeira volta tudo o que passou da hora, ao ligar o computador ela avisa o que venceu enquanto ele estava desligado (F15-4). Cada aviso uma vez (marcado na tarefa).
- **Vigia no host** (`scripts/notify/narnia-notify.sh` e `.ps1`), subido em segundo plano por `./start.sh dev|up` e `.\start.ps1 dev|up`, parado no `down`; um por instância (arquivo de PID na pasta de dados). Pergunta à api `GET /api/notifications/native?after=<cursor>` com o token, a cada 20 s, só em `127.0.0.1`; mostra cada aviso novo e guarda o cursor. Sem Node no host: bash + `curl` + `notify-send` (Linux), PowerShell + toast do Windows (`Windows.UI.Notifications`), `osascript` (macOS). Sem o programa de aviso, o vigia avisa uma vez no terminal e sai.
- Clique: abre a tarefa no navegador onde o sistema permite (`notify-send --action` nas versões novas; toast com `launch`); senão, o texto leva o caminho.
- A instância `claude` usa o vigia só nos testes (com um `notify-send` falso); nada aparece na tela do dono.

### 2.3 E-mail → tarefa e fases (F15-2, F15-6)
- A saída do `narnia-mail-classify` ganha `actions[]` (`kind`, `title`, `url`, `dueAt`) e `process` (`stages[]` com as fases na ordem, `current` com a fase atual). Link de ação só vale se estiver no próprio e-mail (regra da F14). Mudança de prompt: gate de prompts real (F06-14) com casos sintéticos novos (`--feature`).
- Ações viram tarefas quando o e-mail é de remetente confiável ou do mesmo domínio da vaga ou da empresa de uma candidatura já feita; senão, o e-mail vai para a revisão com a tarefa proposta. Tarefa repetida (mesma candidatura, mesmo tipo, ainda aberta) não nasce de novo.
- Fases: candidatura com as etapas padrão, sem edição da pessoa → as etapas viram as fases do e-mail, a candidatura vai para a fase atual pelas regras de movimento da F14 (confiável + acerto alto move; senão sugere) e fica uma nota com o link do e-mail; candidatura com etapas editadas → só sugestão ("o e-mail lista estas fases: aplicar?").
- **Desfazer** do e-mail apaga as tarefas que ele criou (as já movidas pela pessoa ficam, com aviso) e devolve as etapas anteriores se ainda estiverem como o e-mail deixou.

### 2.4 Imagens do corpo com OCR (F15-5)
- Só em e-mails ligados a uma candidatura já feita, e só de remetente confiável ou do mesmo domínio da vaga ou da empresa dessa candidatura. Nunca da quarentena, de remetente neutro sem esse vínculo, nem de alertas.
- No máximo 3 imagens por e-mail, `http(s)` público (sem IP privado), até 5 MB, tipo `image/*`, sem cookies, tempo limite; ignora as pequenas (ícones, pixels de rastreio, menos de 200 px de lado).
- OCR local com `tesseract` (por + eng) no worker, sem modelo. O texto vai para o classificador num bloco à parte ("Texto das imagens do e-mail") e o resultado fica guardado (não baixa de novo no refazer).

---

## 3 · Dados (migrações 0049+)
- `0049_todos.sql`: `todo`, `todo_tag`, índices por coluna/posição e prazo.
- Notificações novas e os campos de aviso (`notified_due_soon_at`, `notified_overdue_at`) na própria tarefa.
- `mail_message.images_json`: o texto do OCR por imagem e o motivo de não ter baixado.

## 4 · Layouts
- **Tarefas:** filtros no topo (busca, tags, origem, candidatura, "só vencidas"); três colunas; botão **Nova tarefa** (título, nota, prazo, link, tags, candidatura). No celular, colunas em abas.
- **Candidatura:** cartão **Tarefas** com as abertas e **Nova tarefa** já ligada.

## 5 · Decisões (fechadas com o dono em 2026-11-12)
| Id | Decisão |
|----|---------|
| F15-1 | Lista geral: tarefas do e-mail e manuais, com tags e filtro. |
| F15-2 | Ação pedida por e-mail vira tarefa, com notificação ao nascer. |
| F15-3 | Aviso por notificação nativa do sistema, pelo vigia no host subido pelos lançadores (Linux e Windows; macOS de brinde). Sem Web Push. |
| F15-4 | Ao ligar o computador, conferir o que passou da hora (rotinas e prazos) e avisar. |
| F15-5 | Imagens do corpo só de remetente confiável ou do mesmo domínio da vaga/empresa esperada, e só em e-mails de candidaturas já feitas; OCR local. |
| F15-6 | Fases do e-mail trocam as etapas sozinhas só se a candidatura tem as etapas padrão sem edição; senão, sugestão. Avanço pela regra da F14. |

## 6 · Marcos
| Marco | Entrega |
|-------|---------|
| M1 | Tarefas: dados, API, tools, página kanban, filtros, tags, cartão na candidatura. |
| M2 | Avisos: notificações `todo.*`, rotina `todos.reminders`, endpoint para o vigia, vigia em bash e PowerShell nos lançadores (bats e Pester). |
| M3 | E-mail → tarefa e fases: saída do classificador, aplicação, revisão, desfazer; gate de prompts. |
| M4 | Imagens com OCR: `tesseract` no worker, regras de download, texto no classificador. |
| M5 | Docs (`docs/gmail.md`, `docs/tarefas.md`, README), e2e, gate completo. |

## 7 · Testes
- core: repositório e regras (mover, posição, filtros), lembretes (vencidas no boot, uma vez só), aplicação das ações e fases, desfazer, regras de download das imagens (domínio, risco, tamanho, IP privado).
- api: rotas `/api/todos` e `/api/notifications/native`.
- web: kanban (arrastar por teclado, filtros, criar), cartão na candidatura.
- lançadores: bats (vigia com `notify-send` e `curl` falsos, PID, parada no `down`) e Pester (toast falso).
- e2e: criar, mover e filtrar tarefas; e-mail sintético de triagem gera a tarefa.
- e-mails de teste sintéticos no formato do real (fases numa imagem gerada no teste); nada do dono no repositório.

## 8 · Riscos
- Toast do Windows sem teste real aqui: o dono confere na tela.
- `notify-send` ausente em algumas distros: aviso uma vez no terminal.
- OCR de imagem estilizada pode errar: o texto vai ao modelo como apoio, e a fase só troca as etapas sozinha nas condições de F15-6.

## 9 · Registro de execução

### Antes do M1 · "Ler de novo" um e-mail (2026-11-12)
Pedido do dono para testar a leitura nova num e-mail só: `rereadMail` (core, `mail/redo.ts`) desfaz tudo o que o e-mail criou (mesmo o usado; vagas que já existiam ficam) e o devolve à fila do começo, sem pausar a leitura; `POST /api/mail/:id/reread` (id do e-mail ou do Gmail) roda a leitura logo depois. Botão **Ler de novo** no detalhe da execução (um por e-mail), na revisão e no cartão "Pelo e-mail" da candidatura. Testes antes: sim (core, api, web).

### M1 · execução (2026-11-12)
- Migração `0049_todos.sql` (`todo`, `todo_tag`; a coluna do kanban é `status`, porque `column` é palavra reservada); repositório `todos` (posição por coluna, nova no topo, mover renumera; tags em minúsculas; filtros por texto, tag, origem, candidatura e vencidas); domínio `packages/core/src/todos` (candidatura dá a vaga; prazo novo zera os avisos).
- API `/api/todos` (listar com `tags`, criar, editar, mover, apagar; WS `todo.updated`).
- Web: página **Tarefas** (`/tarefas`, item no menu), kanban com `@dnd-kit` e **Mover**, filtros, diálogo de criar e editar (prazo no fuso da pessoa), cartão **Tarefas** na candidatura. Guia em `docs/tarefas.md`.
- Tools MCP `todos.*` e a skill ficam para o M3, junto com a mudança de prompt (um gate de prompts só).
- Testes antes: sim (core `test/todos`, api `f15-m1-todos`, web `test/f15`, e2e `F15/E2E-01`).

### M2 · execução (2026-11-12)
- Notificações `todo.created` (informativa), `todo.due_soon` e `todo.overdue` (alerta); `NATIVE_NOTIFICATION_KINDS` (as de tarefa, `mail.interview` e `mail.reconnect`) são as que o vigia mostra. Feita ou apagada, a tarefa resolve os avisos; prazo novo resolve os do prazo antigo. Tarefa manual não avisa ao nascer (quem criou já sabe); a do e-mail e a do recrutador avisam (M3).
- Rotina agendada `todos.reminders` (15 min, mínimo 5): vencidas e as que vencem em 24 h, uma vez cada (marcado na tarefa); na primeira volta depois de ligar o computador, pega o que venceu desligado (F15-4).
- `GET /api/notifications/native?after=…` (JSON ou `format=text`, sem cursor só devolve o cursor: nada do histórico). O vigia em bash e o em PowerShell usam o texto (o bash sem jq nem python; o `ConvertFrom-Json` do PowerShell 7 estragava o cursor ao virar data).
- Vigia: `scripts/notify/narnia-notify.sh` (notify-send com **Abrir** quando há `--action`, osascript) e `narnia-notify.ps1` (toast do Windows pelo id do Windows PowerShell, clique abre o link). Lançadores: `notify_start`/`Start-Notify` no `up` e no `dev` (no dev, para junto com o Ctrl+C), `notify_stop`/`Stop-Notify` no `down` e no `dev-down`; um vigia por pasta de estado (`<dados>/.notify`, com o cursor, o PID e o log); token só pelo ambiente; só `127.0.0.1`. `NARNIA_NOTIFY=0` desliga; `.env.claude` e o E2E-13 desligam.
- Testes antes: sim (core `test/todos/reminders`, api `f15-m2-native`, bats `scripts/test/notify.bats`, Pester "F15-3"). O toast real do Windows não foi visto na tela: falta o dono conferir num Windows.
- Achado: os testes do lançador "instância padrão sem -p" (bats e Pester) falham nesta máquina porque o `.env` do dono tem `NARNIA_MEDIA=1`; não é da F15 (o ambiente vaza para o teste).
