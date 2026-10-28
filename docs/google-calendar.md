# Google Calendar (opcional)

A agenda das candidaturas funciona sem conectar nenhuma conta: cada evento (entrevista, teste, prazo, retorno) tem o botão **Adicionar ao Google Calendar**, que abre o modelo de evento já preenchido, e o **Baixar .ics**, que importa em qualquer calendário (Google, Outlook, Apple). Editar o evento no narnia sobe a sequência do `.ics`, então importar de novo atualiza o evento em vez de duplicar.

Conectar o Google Calendar é opcional (decisão F07-4). Conectado, o recrutador cria e consulta os eventos direto no seu calendário pelas tools do servidor MCP oficial do Google, e guarda o id de cada evento criado.

## Como conectar

1. **Cliente OAuth.** No [Google Cloud Console](https://console.cloud.google.com/), num projeto seu:
   - ative a **Google Calendar API**;
   - em **APIs e serviços › Credenciais**, crie um **ID do cliente OAuth** do tipo **Aplicativo da Web**;
   - em **URIs de redirecionamento autorizados**, ponha `http://localhost:8089/callback`;
   - na tela de consentimento, adicione o seu e-mail como usuário de teste.
2. **Registrar no narnia.** Com o app no ar, rode no terminal do projeto:
   ```bash
   ./start.sh google connect <SEU_CLIENT_ID>
   ```
   No Windows: `.\start.ps1 google connect <SEU_CLIENT_ID>`. O comando pede o **segredo do cliente** (ele não vai por argumento nem fica no histórico do terminal) e abre o login.
3. **Login.** Abra o endereço que o comando mostrar, entre com a sua conta Google e autorize. A credencial fica no volume `claude-auth`, junto com o login do Claude.
4. **Conferir.** Em **Configurações › Google Calendar**, clique em **Verificar de novo**: o estado passa a **Conectado**. No terminal: `./start.sh google status`.

Se o estado ficar em **Precisa de login**, repita o passo 3 com `./start.sh google connect <SEU_CLIENT_ID>`.

## O que muda quando está conectado

- Ao agendar pela conversa ("marca a entrevista técnica para quinta às 14h"), o recrutador oferece criar o evento no seu Google Calendar e guarda o id do evento na candidatura.
- O link do modelo e o `.ics` continuam em cada evento, para quem usa outro calendário.
- A sincronização é de mão única: editar o evento no Google não muda o narnia.

## Detalhes técnicos

- O servidor MCP é `google-calendar` (`https://calendarmcp.googleapis.com/mcp/v1`), registrado com `claude mcp add --transport http … --client-id … --client-secret --callback-port 8089 --scope user` dentro do container do api.
- O estado vem de `claude mcp list` (rota `GET /api/integrations/google-calendar/status`, com cache de 1 minuto).
- A porta do callback é a 8089 do container, publicada só em `127.0.0.1`.
