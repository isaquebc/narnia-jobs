# Leitura do Gmail (opcional)

O narnia-jobs pode ler a sua caixa do Gmail e transformar os e-mails de vagas em dados:

- **Alertas de vagas** (LinkedIn, Glassdoor, Coders e outros) viram vagas num **feed**, ordenado pelo match com os seus perfis. O narnia tenta abrir o link de cada vaga; se não abrir (o LinkedIn costuma pedir login), a vaga ganha a marca **link não abriu** e você completa pela extensão do navegador.
- **Confirmações de candidatura** criam a candidatura com a **data e a hora do e-mail**.
- **Negativas** encerram a candidatura com a data e a hora do e-mail e uma nota com o link para ele.
- **Atualizações** viram nota na candidatura e sugerem a próxima etapa.
- **Convites de entrevista** viram etapas na agenda: o convite `.ics` da empresa é o evento oficial; um horário combinado só no texto vira uma etapa **provisória**.
- Todo e-mail processado ganha a etiqueta **`narnia-jobs`** e é marcado como lido. E-mails fora do assunto não são tocados. E-mails suspeitos ganham a etiqueta **`narnia-jobs/suspeito`** e continuam não lidos.

Tudo roda no seu computador. O narnia chama a API do Gmail direto (sem modelo no meio); o modelo só lê o texto do e-mail para classificar, sem ferramentas, e nunca abre anexos nem links de e-mails suspeitos.

## Como conectar

1. **Cliente OAuth** (uma vez). No [Google Cloud Console](https://console.cloud.google.com/), num projeto seu:
   - ative a **Gmail API**;
   - em **APIs e serviços › Tela de consentimento OAuth**, escolha **Externo**, preencha o nome do app e o seu e-mail, adicione o escopo `https://www.googleapis.com/auth/gmail.modify` e, em **Usuários de teste**, o seu endereço do Gmail;
   - em **APIs e serviços › Credenciais**, crie um **ID do cliente OAuth** do tipo **Aplicativo da Web**;
   - em **URIs de redirecionamento autorizados**, ponha os dois endereços:
     - `http://localhost:8089/callback` (o app no dia a dia; com `NARNIA_OAUTH_PORT` no `.env`, troque 8089 por essa porta);
     - `http://localhost:8090/callback` (o modo de desenvolvimento, `make dev`; com `NARNIA_DEV_OAUTH_PORT`, troque 8090 por essa porta).
2. **Registrar o cliente no narnia.** Em **Configurações › Gmail**, cole o **ID do cliente** e o **segredo**, ou ponha `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` no `.env` e reinicie. O segredo nunca volta para a tela.
3. **Conectar.** Clique em **Conectar**: o login do Google abre numa aba nova. Entre com a conta que você pôs como usuário de teste e autorize. A aba mostra "pode fechar" e o cartão passa a **Conectado**.
4. **Primeira leitura.** Escolha **quanto tempo para trás** ler (até um ano). A leitura vai do e-mail mais antigo para o mais novo, para que a negativa nunca chegue antes da candidatura.

**Limite de uso do Google:** a primeira leitura de uma caixa cheia pode bater no limite por minuto do Google. O narnia espera e tenta de novo; se o limite continuar, a leitura para com um aviso no log e continua na próxima execução (sem pedir para reconectar).

**Modo de teste do Google:** com a tela de consentimento em "Teste", o Google pode expirar o login depois de 7 dias. Quando isso acontece, o cartão mostra **Reconectar** e uma notificação avisa; é só conectar de novo (os e-mails já lidos não se repetem).

## Onde aparece

- **Vagas › Feed do e-mail:** as vagas dos alertas numa coluna, da maior compatibilidade para a menor, com os selos de nova, origem e plataforma, match e link que não abriu, o local e o modo, o começo da descrição, a data e a hora em que o e-mail chegou e a data em que a vaga foi salva. Cada card tem **Analisar** (ou **Ver análise**), **Ver vaga oficial** (na Coders, que não manda link por vaga, **Procurar na Coders**), **Ver o e-mail** e **Arquivar vaga**. Vagas iguais (mesma empresa e mesmo cargo, com links diferentes, como a mesma vaga do LinkedIn em vários países) aparecem num card só; com descrição nas duas, só se o texto for o mesmo. O card lista as versões, cada uma com local, plataforma, data do e-mail e a candidatura, para você escolher em qual se candidatar; **Separar** tira do grupo a que for outra vaga, e a página dela tem **Juntar às vagas iguais**. Vaga sem descrição (o LinkedIn não deixa robôs abrirem a página) ganha um **match provisório**, só pelo cargo, senioridade e local do alerta; o completo chega com a descrição, pela extensão, e o provisório nunca dispara a pré-análise automática. Filtros por plataforma, período, só as novas e só as de link que não abriu. As de match alto ganham a pré-análise sozinhas (corte e teto diário em Configurações › Gmail › Feed de vagas). Vagas do feed sem nenhuma interação por 30 dias são arquivadas sozinhas.
- **Candidatura › Pelo e-mail:** as etapas sugeridas pelos e-mails (mover ou recusar), os e-mails que mexeram na candidatura (cada um com **Desfazer**) e o histórico das etapas com a origem de cada mudança.
- **Candidatura › Agenda:** selos **Provisória**, **Convite da empresa** e **Cancelada**. A etapa provisória tem o botão **Bloquear agenda**, que abre o Google Agenda já preenchido; quando o convite oficial chega, ele toma o lugar da provisória e o narnia avisa para tirar o bloqueio.
- **E-mails para revisar** (`/emails`, link no cartão do Gmail e notificação): e-mails que o narnia não conseguiu ligar a uma vaga com segurança e os da quarentena, com o motivo. Escolha a vaga, aplique à vaga sugerida, aplique mesmo assim, ignore, confie no remetente ou processe a quarentena mesmo assim.
- **Processos › Tarefas agendadas:** cada leitura, com o log e os itens tocados (e-mails, vagas, candidaturas). Cada leitura que mexeu em e-mails tem **Desfazer daqui em diante**, e o cartão tem **Desfazer todas as leituras**: apaga tudo o que essas leituras criaram (candidaturas, notas e vagas, mesmo as que você já usou) e devolve os e-mails à fila. As vagas que já existiam antes da leitura ficam; delas sai só o que o e-mail criou. A leitura automática fica pausada: clique em **Rodar agora** quando quiser ler de novo e tire a pausa quando quiser que ela volte a rodar sozinha.

## Confiança no remetente

Cada e-mail recebe um nível de risco, calculado por código:

- **Confiável:** a autenticação do Gmail (DMARC, DKIM ou SPF) confere com o domínio do remetente e o remetente é uma plataforma conhecida, está na sua lista de confiáveis, tem bom histórico ou é o site de uma vaga em que você se candidatou (o domínio do link da vaga ou do site da empresa). Plataforma de recrutamento (InHire, Gupy, Greenhouse, Lever e outras) responde pela empresa: o `Reply-To` da empresa nela não é sinal de golpe.
- **Neutro:** o narnia lê e registra a nota, mas **não cria nem encerra candidatura, não remarca nem cancela entrevista sozinho**: o e-mail vai para a revisão com **Aplicar mesmo assim**. Eventos novos de remetente neutro nascem provisórios e sem link.
- **Alto (quarentena):** domínio parecido com o de uma empresa conhecida, nome de marca no remetente sem o domínio dela, autenticação que falhou, anexos ou links perigosos, pedidos típicos de golpe (pagamento, documentos). Nada é aberto: o e-mail ganha `narnia-jobs/suspeito`, fica não lido e aparece na quarentena.

Em **Configurações › Gmail › Remetentes** você confia ou bloqueia endereços e domínios (domínio de webmail só por endereço). A extensão do navegador tem os botões **Confiar**, **Bloquear** e **Processar este e-mail agora** quando você está com um e-mail aberto no Gmail. Confiar num remetente com e-mails em quarentena oferece **Avaliar de novo**.

## Etapas pelo e-mail

Por padrão o narnia **só sugere** a próxima etapa. Ele passa a mover sozinho quando:

- o remetente é confiável e a confiança do e-mail é alta (90 ou mais);
- você já decidiu pelo menos 20 sugestões, com 95% de acerto (um erro pesa o dobro de um acerto);
- nenhum movimento automático foi desfeito na última semana.

Contam como erro: sugestão recusada, movimento desfeito, sugestão aprovada com outra etapa e etapa trocada à mão para trás logo depois. Avançar no processo depois não é erro. A etapa que você escolhe para uma dica que o narnia não conhecia (por exemplo, "Painel com o time") vira vocabulário daquela empresa. **Configurações › Gmail › Etapas pelo e-mail** mostra o acerto e tem a chave para nunca mover sozinho.

## Desfazer

Cada e-mail aplicado tem **Desfazer** na candidatura. Ele apaga o que o e-mail criou (nota, evento, sugestão) e devolve o que o e-mail mudou (etapa, encerramento, horário da entrevista), **só no que ainda está como o e-mail deixou**; o que mudou depois fica e é avisado. Desfazer a confirmação apaga a candidatura e a vaga criadas por ela, desde que você não tenha acrescentado nada (notas, eventos, gravações, outros e-mails); se acrescentou, apague pela página da candidatura. A etiqueta `narnia-jobs` continua no Gmail.

## Privacidade

- O token do Google fica em `<dados>/secrets/` (só o seu usuário lê) e **não entra no backup**: depois de restaurar, conecte de novo.
- Os e-mails lidos ficam em `<dados>/mail/` (formato `.eml`) e entram no backup.
- O modelo que classifica o e-mail não tem ferramentas e devolve só dados validados; instruções escondidas no e-mail são ignoradas. Link vindo do modelo só vale se estiver no próprio e-mail.
- Desconectar em Configurações revoga o acesso no Google.

## Detalhes técnicos

- API REST do Gmail (`messages.list` com `after:`, `messages.get` em `raw`, `history.list`, `labels.create`, `batchModify`), chamada pelo worker na tarefa agendada `mail.sync` (a cada 1 hora por padrão; mínimo 10 minutos; botão **Rodar agora** em Processos › Tarefas agendadas).
- Escopo `gmail.modify` (ler, etiquetar e marcar como lido; nada é apagado nem enviado).
- O retorno do login escuta em `NARNIA_OAUTH_PORT` (8089) no app e em `NARNIA_DEV_OAUTH_PORT` (8090) no modo de desenvolvimento, só durante a conexão, publicado só em `127.0.0.1`.
