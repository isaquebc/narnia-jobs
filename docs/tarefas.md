# Tarefas

A página **Tarefas** (no menu, logo abaixo de Candidaturas) é um kanban com três colunas: **A fazer**, **Fazendo** e **Feito**.

## Criar e organizar

- **Nova tarefa:** título, nota, prazo (no seu fuso), link da ação, tags separadas por vírgula e, se quiser, a candidatura a que ela se refere.
- **Mover:** arraste o cartão pela alça (com o mouse ou com o teclado: Tab até a alça, Espaço, setas, Espaço) ou use **Mover**. A tarefa movida para **Feito** guarda a data; voltar para outra coluna desfaz.
- **Prazo:** tarefa com o prazo passado e ainda aberta aparece como **Vencida**, em destaque.
- **Tags:** ficam em minúsculas e sem repetição. Servem para identificar (empresa, assunto, tipo) e filtrar.
- **Filtros:** busca no título, na nota e nas tags; uma tag; a origem (**Minha** ou **Do e-mail**); e **Só as vencidas**.

## Na candidatura

A página de cada candidatura tem o cartão **Tarefas** com as abertas dela e **Nova tarefa**, que já nasce ligada. O cartão da tarefa leva de volta à candidatura.

## Avisos do sistema

O narnia avisa por uma **notificação do próprio sistema** (a que aparece por cima de tudo, mesmo com o navegador fechado) quando:

- uma tarefa nasce de um e-mail;
- o prazo de uma tarefa vence em até 24 horas;
- o prazo passou (cada aviso sai uma vez);
- uma entrevista é marcada pelo e-mail, ou o Gmail precisa ser conectado de novo.

Quem mostra é um pequeno **vigia** que o `./start.sh` (Linux e macOS) e o `.\start.ps1` (Windows) sobem junto com o narnia, no `up` e no `dev`, e param no `down` e no `dev-down`. Ele só conversa com o narnia do seu computador (`127.0.0.1`) e não instala nada:

| Sistema | Como aparece | Precisa de |
|---|---|---|
| Linux | `notify-send` (GNOME, KDE e outros); o botão **Abrir** leva à tarefa | pacote `libnotify-bin` (já vem na maioria das distribuições) |
| Windows | notificação do Windows (central de ações); clicar abre a tarefa | nada (usa o Windows PowerShell) |
| macOS | central de notificações | nada (`osascript`) |

**Computador desligado:** a rotina **Lembretes das tarefas** (Processos › Tarefas agendadas, a cada 15 minutos) roda logo depois de ligar e avisa o que venceu enquanto o computador estava desligado.

Para desligar os avisos do sistema, ponha `NARNIA_NOTIFY=0` no `.env` e rode o narnia de novo. Os avisos continuam na bandeja do narnia. O registro do vigia fica em `<dados>/.notify/notify.log`.

## Tarefas pelo e-mail

Com a [leitura do Gmail](gmail.md) ligada, um e-mail de candidatura que pede uma ação sua vira tarefa em **A fazer**, sozinho:

- **o que conta como ação:** triagem automática (por chat, WhatsApp ou vídeo), teste ou desafio, formulário, mandar documentos, entrevista para comparecer ou escolher um horário. E-mail que só informa ("estamos analisando") não vira tarefa;
- **o que a tarefa traz:** o título com a empresa, o prazo quando o e-mail diz, o link da ação, a candidatura, **Ver o e-mail** e as tags (a empresa, `e-mail` e o tipo, como `triagem` ou `teste`). Ela nasce com o aviso do sistema;
- **link só de quem é de confiança:** o link da ação entra quando o remetente é confiável, ou é do domínio da vaga ou da empresa com a autenticação conferida. De outro remetente, a tarefa nasce sem o link e com a tag `confira`: abra o e-mail e confira antes de clicar;
- **ação ou fases numa imagem:** quando o e-mail traz a etapa ou as fases do processo numa imagem (um banner no começo do corpo), o narnia lê o texto da imagem no seu computador e usa na leitura, com as mesmas regras de confiança (detalhes em [Gmail](gmail.md));
- **sem repetir:** se já existe uma tarefa aberta do mesmo tipo para a mesma candidatura, o e-mail novo não cria outra;
- **Desfazer:** o **Desfazer** do e-mail apaga as tarefas que ele criou. A tarefa que você já moveu de coluna fica.
