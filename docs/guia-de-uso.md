# Guia de uso

Referência de cada parte do narnia-jobs. Para o caminho do primeiro uso à primeira candidatura, siga o [tutorial](tutorial.md); para instalar, atualizar e desinstalar, o [README](../README.md).

## Login da assinatura do Claude

A extração do currículo e o recrutador usam a **sua** assinatura do Claude, pelo CLI oficial dentro do container. Dois caminhos:

1. **Padrão, login no volume** (uma vez): `./start.sh login`. O CLI imprime uma URL; abra, autorize e cole o código de volta. A credencial fica no volume `claude-auth`, renova sozinha e sobrevive a reinícios e reboots.
2. **Alternativa, token de longa duração**: no seu computador, com o Claude Code instalado, rode `claude setup-token` e cole o valor em `.env` como `CLAUDE_CODE_OAUTH_TOKEN=…`. Quando essa variável existe, ela prevalece sobre o login do volume. O token expira em um ano.

`./start.sh doctor` mostra qual mecanismo está ativo (volume, token ou nenhum), além de Redis, pasta de dados e worker.

## Perfis

Depois do primeiro uso, **Perfis** (menu lateral ou "Gerenciar perfis" no seletor do topo) permite ter vários perfis sobre os mesmos fatos, um por cargo-alvo: criar do zero ou clonar, trocar o ativo pelo seletor (todas as abas acompanham), renomear, arquivar e desarquivar. Em cada perfil: **Ênfases** (destacar, ocultar e ordenar experiências, projetos, skills, formação e idiomas, com prévia do cartão), **Narrativa** (seu pitch), **Recrutador** (persona: tom, honestidade, rigor e senioridade do recrutador, com restaurar padrão) e **Cartão** (o resumo de ~300 tokens que o recrutador recebe; mostra se está desatualizado e tem o botão "Atualizar cartão"). O dashboard sugere perfis por heurística, sem custo; o botão **Analisar possíveis perfis** usa o modelo sobre todo o seu histórico e, por isso, mostra a estimativa de tokens e pede confirmação antes.

## Ingestão e GitHub

Em **Ingestão** você adiciona dados depois do primeiro uso: **GitHub**, **Currículo** (outro CV) e **Texto livre** ("conte a sua história de carreira e de vida"). Reenviar o mesmo arquivo ou texto avisa "já lido" e aponta a execução anterior.

- **Conectar o GitHub.** Se o `gh` do seu computador estiver logado, o app reaproveita esse login (o lançador entrega o token ao container a cada `up`/`dev`). Senão, escolha **Login próprio do app**: aparece um código; clique em **Abrir GitHub**, cole o código e autorize. A escolha fica em **Configurações**.
- **Pública ou privada.** A análise pública lê só repositórios públicos e funciona sem login (sem as métricas de contribuição, que o GitHub só entrega logado). A privada inclui os privados e exige o GitHub conectado; o app só lê.
- **Orçamento e plano.** Antes de rodar, a tela mostra seu plano, quanto já usou das janelas de 5 horas e semanal, a estimativa e um orçamento recomendado. O GitHub sempre pede confirmação; CV e texto seguem sozinhos abaixo de 10 mil tokens.
- **Freio.** Se o orçamento acabar, a execução para e pergunta: continuar com mais orçamento, encerrar com o que foi feito, ou deixar para depois.
- **Pendências.** O sino no topo e a página **Pendências** reúnem revisões, conflitos, execuções esperando decisão, sugestões de perfil e análises concluídas; cada item some sozinho quando você resolve.
- **Evidências.** Repositórios analisados com relatório, métricas, resumo editável e **Reanalisar** (atualizar com commits novos, aprofundar ou cobrir o que ficou de fora).
- **Contrato, carga horária, salário e benefícios.** Cada experiência pode ter (todos opcionais) o tipo de contrato (CLT, PJ, freelance, estágio, temporário), a carga horária semanal (separada do contrato: um PJ pode ter 20, 30 ou 44 horas), o salário com valor, período (hora, mês ou ano) e moeda, e benefícios de uma lista (vale-refeição, plano de saúde, odontológico, seguro de vida, vale-transporte, auxílio home office, PLR/bônus, ações, 13º, férias remuneradas, auxílio educação, previdência privada, academia, day off de aniversário) mais outros em texto livre. A ingestão de CV ou texto extrai o que estiver escrito, com a citação do trecho, sem converter nem estimar; uma experiência já conhecida recebe esses dados como atualização para você aprovar. O cartão do perfil mostra a **trajetória do salário** pelo equivalente mensal (salário por hora × carga semanal), com a variação entre experiências na mesma moeda, e o recrutador usa isso para dizer se você está subindo ou descendo. Para trazer o salário de um texto já ingerido, ingira de novo (**Ler de novo**).

## Chat com o recrutador

Menu › **Geral** › **Chat**. O recrutador é **global**: conhece a sua carreira e todos os seus perfis, e para uma análise dirigida a um perfil (aderência a uma vaga, o que estudar, o que melhorar no currículo) chama o **recrutador especializado** daquele perfil, que roda dentro do mesmo turno (os chips das ferramentas dele aparecem marcados "especializado"). As conversas não pertencem a um perfil: trocar o perfil ativo não fecha nenhuma, e o menu as agrupa por tema (Carreira, Vaga, Clarificação…). Até 5 ficam abertas ao mesmo tempo (a sexta pergunta qual encerrar) e conversas paradas por 1 hora hibernam e retomam do ponto na próxima mensagem (Configurações › Chat ajusta os limites e o modelo padrão, Sonnet). O recrutador já começa conhecendo a persona e o cartão do seu perfil, busca detalhes nos seus dados pelas ferramentas (os chips mostram quais usou) e cita a fonte do que afirma. Você pode colar um texto da sua história, mandar um arquivo ou um link do GitHub: ele cria a ingestão e as propostas vão para a revisão (nada é gravado sem você aprovar; o GitHub sempre pede confirmação do orçamento). Na interface web, o recrutador só lê páginas (WebFetch) dos domínios confiáveis (lista editável em Configurações › Chat); as buscas na web não passam por essa lista. No Claude Code (modo B), as pesquisas seguem as permissões do seu próprio Claude Code. Na revisão de uma ingestão, **Clarificar com o recrutador** abre uma conversa cujas respostas viram propostas da mesma execução.

**Custo:** cada mensagem usa a sua assinatura do Claude; o rodapé do chat mostra os tokens do turno e da conversa, o custo equivalente e o teto por conversa, se você definir um em Configurações › Chat.

## Vagas

Cole uma vaga (ou o link dela) no **Chat** ou em **Vagas** (menu › Geral). A vaga é sempre salva (salvar não é se candidatar). Pelo link, o servidor lê a página; se ela depende de JavaScript ou de aceitar cookies, abre num navegador headless isolado (serviço `browser`); sites que exigem login ou bloqueiam robôs (LinkedIn, por exemplo) pedem para colar o texto.

- **Na hora, sem tokens**, uma heurística local extrai cargo, senioridade, role, local, contrato, moeda, faixa, benefícios, requisitos e diferenciais, e procura cada palavra-chave da vaga nos seus dados (cobertura dos obrigatórios e riscos para cada perfil, como "vaga híbrida e perfil só remoto").
- **Em segundo plano**, um modelo barato (Haiku por padrão) extrai a vaga de novo e um segundo agente junta as duas extrações. Na página da vaga, cada campo mostra de onde veio: heurística, modelo, os dois concordando, ou você. O que você edita nunca é sobrescrito.
- Vaga com a mesma empresa, cliente, cargo e role de uma já salva abre um **modal com o diff** e a certeza de ser a mesma vaga: atualizar a salva, salvar como nova ou descartar.
- **A análise** roda numa conversa própria, com o título "contratante/cliente - role": o recrutador compara a vaga com todos os seus perfis pelo especializado de cada um, e grava o fit por perfil, o recomendado, o que você atende (cada item ligado a um fato seu), as lacunas (só depois de buscar e não achar), riscos, palavras-chave que faltam, perguntas prováveis, o que estudar e o que melhorar no currículo. Se os seus dados ou a vaga mudarem depois, a página avisa e oferece **Reanalisar** (nada é refeito sozinho, para não gastar tokens; a extração do modelo terminando depois da análise não conta como mudança). A bandeja mostra a análise em andamento e, quando ela fica pronta, o link para a vaga.
- **Página da vaga:** todos os campos e a descrição editáveis, contatos (com quem você falou, por LinkedIn, WhatsApp ou e-mail) e notas. Quando o recrutador altera uma nota sua, a mudança espera a sua confirmação na bandeja (**Aguardando você**) e em Pendências. Se você já registrou outra vaga da mesma empresa com o mesmo role, a página mostra **Vagas parecidas** com os links. O botão **Gerar** faz o CV ou a carta da vaga (veja Currículos e cartas), e **Aplicar** cria a candidatura (veja Candidaturas).
- **Busca** na página Vagas por empresa, cliente, cargo, role ou nome de contato.
- **Configurações › Modelos por tarefa** escolhe o modelo do Claude de cada tarefa (extração, junção, comparação de vaga repetida, análise, geração e revisão do currículo).

## Currículos e cartas

Cada perfil tem o seu currículo (**Perfis › Currículo**) e cada vaga pode ter um CV e uma carta de apresentação por perfil (botão **Gerar** na página da vaga, com o perfil recomendado pela análise já escolhido). Também dá para pedir ao recrutador no chat ("gera meu CV para esta vaga, com mais peso em liderança") e, depois de pronto, pedir alterações.

- **Nunca mente.** O modelo (Sonnet por padrão) escreve só os textos e diz de qual fato seu cada linha veio; empresa, cargo, datas, contato e links vêm dos seus dados. Termo que a vaga pede e você não tem nunca aparece; uma experiência próxima aparece com o nome verdadeiro (Docker para quem não tem Kubernetes).
- **Breve e no idioma da vaga.** No máximo 2 páginas, com as experiências e skills de maior aderência (o score de match aparece na tela); as menos aderentes de uma carreira longa ficam fora do PDF e viram um **roteiro para aprofundar na entrevista**. O CV da vaga sai no idioma da vaga; se o seu currículo não mostra esse idioma fluente, a tela pergunta antes.
- **Revisado.** Antes de chegar a você, o PDF passa por checagens (links que existem e respondem, fonte, espaçamento, quebras de página, até 2 páginas, aderência a ATS de pelo menos 90%) e por um revisor (Haiku por padrão) que lê as páginas e o texto atrás de invenção, fatos errados, relevância e problemas visuais. Reprovado, é gerado de novo uma vez com os apontamentos; se reprovar outra vez, chega com o alerta **Não passou na revisão** e os motivos. **Atualizar** gera de novo (quantas vezes quiser, com instruções opcionais).
- **Links clicáveis** para e-mail, WhatsApp, LinkedIn, GitHub e portfólio; o que falta aparece na tela com um campo para cadastrar.
- **Carta de apresentação** opcional, junto com o CV da vaga ou sozinha, em PDF ou em texto para colar: o que a vaga pede, o que você cobre e as principais lacunas, com abertura para aprender.
- **Versões**: cada geração, edição ou troca de modelo é uma versão nova, com a data; dá para baixar qualquer uma e comparar com a anterior. **Editar** muda o texto, a ordem e as seções sem gastar tokens do gerador; o documento é montado e revisado de novo.
- **Modelos**: Clássico, Moderno e Compacto, e os seus (**Configurações › Modelos de currículo**, formato em [docs/templates-de-cv.md](templates-de-cv.md)). Papel A4 ou Letter.
- **Desatualizado**: se os seus dados, o perfil ou a vaga mudarem depois, o documento avisa; nada é refeito sozinho.
- **Processos** (menu › Geral) lista tudo o que roda em segundo plano, com cancelar e tentar de novo; **Configurações › Processos simultâneos** define quantos jobs de cada fila rodam juntos.

## Candidaturas

Salvar uma vaga não é se candidatar: na página da vaga, **Aplicar** cria a candidatura, com o CV e a carta daquela vaga. Em **Candidaturas** (menu › Geral), o quadro tem as colunas **Aplicado**, **1ª Entrevista**, **Em processo**, **Oferta** e **Encerrado**, mais as **Vagas salvas**; arraste os cartões entre as colunas ou use a busca. Cada candidatura tem:

- **Etapas** do processo, em ordem, com a etapa atual marcada.
- **Agenda:** entrevistas, testes ou cases, prazos e retornos, com data, hora, link e notas, cada um ligado a uma etapa se você quiser. Cada evento tem **Adicionar ao Google Calendar** e o arquivo `.ics`. Com o Google Calendar conectado ([docs/google-calendar.md](google-calendar.md)), o recrutador cria o evento direto no seu calendário quando você agenda pela conversa (mão única: editar no Google não muda o narnia-jobs); sem ele, tudo funciona com o link e o `.ics`.
- **Notas e anexos** (o CV e a carta enviados, e o que mais quiser guardar).
- **Contatos**: com quem você falou, por LinkedIn, WhatsApp ou e-mail, quem indicou quem. Dá para editar um contato pela interface ou pedir ao recrutador ("o e-mail da Ana mudou").
- **Conversar** sobre a candidatura com o recrutador, que conhece a vaga, a análise e as etapas.
- **Encerrar candidatura** com o motivo, ou **Fui desclassificado(a)** colando o e-mail recebido (fica como nota, com a etapa em que parou). **Ver arquivadas** mostra as arquivadas.


## Extensão do Chrome (vagas e formulários de candidatura)

A extensão leva vagas de qualquer site para o narnia e ajuda nos formulários de candidatura, numa janela ao lado. Ela lê a página só quando você clica no ícone e manda o conteúdo para a sua instância, no seu computador.

**Instalar** (o passo a passo com os endereços desta instância está em **Configurações › Extensão do navegador › Como instalar no Chrome**):

1. Gere a extensão: `./start.sh extension` (Windows: `.\start.ps1 extension`).
2. Em `chrome://extensions`, ligue o **Modo do desenvolvedor**, clique em **Carregar sem compactação** e escolha `apps/extension/dist`.
3. Fixe o ícone do narnia na barra.
4. **Parear:** em Configurações › Extensão do navegador, gere um código (vale 10 minutos e uma vez só). Nas opções da extensão (botão direito no ícone › Opções), informe o endereço da instância e o código. Os navegadores conectados aparecem em Configurações, com **Desconectar**.

Depois de cada atualização do narnia, clique em recarregar no cartão do narnia em `chrome://extensions`: o Chrome não recarrega sozinho extensões sem compactação.

**Usar:** numa página, clique no ícone e escolha **Analisar a vaga** (salva a vaga, mostra o fit por perfil e gera CV e carta) ou **Ajudar no formulário** (organiza as perguntas, sugere as respostas com os seus dados e a vaga, deixa copiar, editar, ajustar no chat e preencher na página, e anexa o CV da vaga). Cada página vira uma aba na janela, num menu que mostra o que está processando e o que terminou sem você ver. O formulário aberto na mesma aba da vaga entra na aba dela (ou pelo botão **Procurar o formulário nesta aba**), sem duplicar a vaga. Formulário em várias páginas: avance nele na mesma aba e clique no ícone a cada etapa (ou em **Ler a próxima etapa nesta aba**); as perguntas aparecem por etapa, e **Preencher** vale na etapa aberta.

**Limites:**
- Só no Chrome (e navegadores baseados nele).
- O Chrome só deixa a extensão ler a página depois do seu clique, e só no site em que você clicou. Se o formulário abriu em outro site, clique no ícone de novo nele.
- Formulário embutido de outro site (Greenhouse, Lever, Workday): o Chrome pede a sua permissão para aquele site na primeira vez.
- A extensão nunca envia o formulário e nunca lê o que você digitou; preenche só quando você clica. Consentimentos ficam com você, e autodeclaração (raça, gênero, deficiência…) só é respondida com o que você mesmo declarou no chat.
- As páginas lidas e os formulários ficam no banco (entram no backup diário); páginas que não viraram vaga nem formulário são apagadas depois de 30 dias.

## Recrutador no terminal (Claude Code, modo B)

O mesmo recrutador do chat roda no Claude Code do seu computador, com o mesmo cartão do perfil e as mesmas tools:

```bash
./start.sh up                # a instância precisa estar no ar
./start.sh install-plugin   # Windows: .\start.ps1 install-plugin
```

O `install-plugin` registra o servidor MCP do narnia-jobs no Claude Code (escopo do usuário; o token fica num arquivo só seu na cópia `.plugin-build/`, que precisa continuar lá) e instala o plugin (persona, skills, o hook que traz o cartão e o que registra o uso no medidor) por um marketplace local. Mudou a persona em Configurações? Rode o `install-plugin` de novo para o agente do terminal acompanhar. Reinicie o Claude Code e use `/narnia-jobs:recrutador`, `/narnia-jobs:perfil`, `/narnia-jobs:clarificar <execução>`, `/narnia-jobs:descoberta` (pergunta só o que falta no perfil) ou `/narnia-jobs:github-publico` (revisão do seu perfil público do GitHub a partir dos relatórios da ingestão) ou `/narnia-jobs:analisar-vaga` (cole a vaga: ela é salva e analisada contra todos os perfis; a análise completa abre em Vagas) ou `/narnia-jobs:gerar-cv` (currículo do perfil ou para uma vaga, e a carta; devolve o link do documento revisado), `/narnia-jobs:candidaturas` (lista, move de coluna e atualiza as candidaturas) ou `/narnia-jobs:responder-candidatura` (ajusta as respostas de um formulário aberto pela extensão). O recrutador especializado vem junto no plugin, como subagente. **Configurações › Modo plugin (terminal)** mostra o endereço do MCP, o estado e o último uso. Se a porta mudar, rode o `install-plugin` de novo; o `./start.sh doctor` confere se o MCP está registrado e o plugin instalado.

## Configurações

Em **Configurações**, na ordem da tela:

- **GitHub:** login do `gh` do computador ou login próprio do app.
- **Chat:** modelo padrão, conversas abertas ao mesmo tempo, hibernação, teto de custo por conversa e os domínios confiáveis para pesquisa.
- **Termos aprendidos pela busca:** apelidos que o recrutador aprendeu para achar os seus fatos (por exemplo, "fintech" para uma empresa de pagamentos); dá para apagar os errados.
- **Busca por sentido:** opcional. Liga uma busca semântica local (baixa um modelo de 113 MB do Hugging Face uma vez e usa ~400 MB de RAM) para o recrutador achar fatos pelo assunto, e não só pelas palavras. Um aviso sugere ligar quando os seus fatos não cabem mais no contexto do recrutador. Desligar apaga os vetores.
- **Modelos por tarefa:** o modelo do Claude de cada tarefa (extração, junção, análise, geração e revisão do currículo).
- **Modelos de currículo:** enviar e remover os seus modelos (`.zip`, formato em [docs/templates-de-cv.md](templates-de-cv.md)).
- **Processos simultâneos:** quantas tarefas de cada fila rodam juntas.
- **Modo plugin (terminal):** estado do recrutador no Claude Code.
- **Extensão do navegador:** passo a passo de instalação, pareamento e navegadores conectados.
- **Google Calendar:** estado da conexão opcional.
- **Avaliações:** ponte do Phoenix (para quem desenvolve; ver o CONTRIBUTING).
- **Ingestão:** revisor anti-alucinação, quando seguir sozinho sem pedir confirmação, unidade do orçamento, teto dos snapshots e, dentro dele, os **Backups** (quantas cópias guardar, padrão 5).

## Rastros e avaliações (Arize Phoenix local)

O Phoenix é opcional e local: guarda um rastro de cada conversa e de cada tarefa com IA, para você ver o que o modelo recebeu, o que respondeu, as ferramentas usadas e o custo. Nada sai do seu computador. Para ligar, ponha no `.env` e rode `./start.sh up`:

```
COMPOSE_PROFILES=observability
NARNIA_OTEL_ENDPOINT=http://phoenix:6006/v1/traces
```

Depois abra `http://127.0.0.1:6006`.

- **Projeto `narnia-jobs`:** um rastro por mensagem do chat. O turno é a raiz (sua pergunta e a resposta), e dentro dele aparecem, em ordem, cada chamada ao modelo (system prompt, mensagens, texto e ferramentas pedidas, modelo, tokens e cache) e cada ferramenta (argumentos e resultado, com a execução no servidor MCP como filha). As conversas aparecem na aba **Sessions**. Cada job do worker (leitura do PDF, fatos, GitHub) também vira um rastro, com as chamadas ao modelo dentro, e as etapas de uma ingestão ficam agrupadas como uma sessão.
- **Anotações em cada turno:** os avaliadores que não gastam tokens (anos e empresas fora do perfil, fontes fora da lista de domínios confiáveis, teto de custo e de turnos) avaliam cada resposta e gravam "passou/falhou" com a explicação, mais uma nota de resumo (custo, ferramentas e o que falhou).
- **Conteúdo:** perguntas, respostas, prompts e resultados de ferramentas vão para o Phoenix por padrão. Para deixar só metadados (modelo, tokens, custo, tempo), defina `NARNIA_OTEL_CONTENT=0` no `.env`.

As avaliações dos prompts (datasets, juízes, gates) estão no [CONTRIBUTING](../CONTRIBUTING.md#avaliações-dos-prompts-phoenix).

## Onde ficam os dados e como fazer backup

Tudo que é seu fica em `./data` (ou noutra pasta: veja "Mudar as pastas" abaixo): banco SQLite, currículos enviados, textos extraídos, documentos gerados e logs de uso. Essa pasta nunca entra no repositório (`.gitignore`). O login da assinatura fica no volume Docker `claude-auth`, e a fila no volume `redis-data`.

**Backups automáticos** ficam em `./backups`, na raiz do projeto, **fora** de `./data` (ou noutra pasta, por exemplo um disco externo ou uma pasta sincronizada): uma cópia consistente do banco no primeiro boot de cada dia em que há dados e outra antes de cada migration, mais os uploads e os modelos de currículo enviados (`.zip`) copiados sem duplicar; os PDFs gerados não entram, porque o conteúdo fica no banco e eles podem ser montados de novo. Ficam no máximo 5 cópias no total (configurável em Configurações › Backups); ao bater o teto, a mais antiga sai. **Apagar `./data` apaga os seus dados, mas não os backups.** Se o banco for recriado vazio e houver backup, a aplicação avisa com uma notificação crítica que traz o comando de restauração.

Para restaurar: `./start.sh restore backups/<arquivo>.sqlite` (para o api e o worker, guarda o banco atual em `backups/narnia-before-restore-…`, copia o escolhido e sobe os dois de novo). Backup manual continua valendo: copiar `./data` com os serviços parados (`./start.sh down`).


**Mudar as pastas.** Para guardar os dados ou os backups noutro lugar, ponha no `.env`, por exemplo, `NARNIA_DATA_DIR=/mnt/disco/narnia` e `NARNIA_BACKUP_HOST_DIR=/mnt/disco/backups`, e rode `./start.sh up`. A variável exportada no shell vence o `.env`. O `restore` procura os backups na mesma pasta.
## Comandos

| Comando | Faz |
|---------|-----|
| `./start.sh up` | sobe (ou atualiza) os serviços e imprime a URL |
| `./start.sh down` | para os serviços; dados e login preservados |
| `./start.sh down --purge` | para e **remove os volumes**: apaga os logins do Claude e do GitHub (o do app), a fila e os dados do Phoenix; a pasta `./data` fica |
| `./start.sh login` | login da assinatura dentro do container |
| `./start.sh doctor` | diagnóstico: login, Redis, worker, caminho e tamanho do banco e do WAL, processo com o banco apagado ainda aberto, último backup e última requisição |
| `./start.sh restore <arquivo>` | restaura um backup de `./backups` (guarda o banco atual antes) |
| `./start.sh install-plugin` | instala o recrutador no Claude Code deste computador (MCP + plugin) |
| `./start.sh extension` | gera a extensão do Chrome em `apps/extension/dist` |
| `./start.sh google status` · `google connect <client-id>` | Google Calendar opcional ([docs/google-calendar.md](google-calendar.md)) |
| `./start.sh help` | todos os comandos, inclusive os de desenvolvimento |
| `./start.sh logs [api\|worker\|web\|redis\|browser]` | acompanha os logs |
| `./start.sh status` | estado dos containers |

No Windows, `.\start.ps1` tem os mesmos subcomandos (sem teste de ponta a ponta no Windows: o autor não tem Windows). `docker compose down -v` equivale a `down --purge`.

## Portas e rede

Todas as portas publicadas ficam só em `127.0.0.1`: nada fica acessível pela rede local. São a da interface (`NARNIA_PORT`, a primeira livre entre 3100 e 3199), a `8089`, que recebe o retorno do login do Google Calendar, e a `6006` do Phoenix, se ligado. Se a 8089 estiver ocupada, ponha `NARNIA_OAUTH_PORT=<outra>` no `.env` e use `http://localhost:<outra>/callback` como endereço de retorno no cliente OAuth do Google. Se a porta da interface estiver ocupada na próxima vez, o `up` escolhe outra e avisa; os dados não dependem da porta.
