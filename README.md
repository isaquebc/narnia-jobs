# narnia-jobs

[![CI](https://github.com/isaquebc/narnia-jobs/actions/workflows/ci.yml/badge.svg)](https://github.com/isaquebc/narnia-jobs/actions/workflows/ci.yml) · [English](README.en.md)

**Um assistente de busca de emprego que roda no seu computador.** Você envia o seu currículo, o narnia-jobs organiza a sua carreira em fatos com fonte, e um recrutador sênior com IA (o Claude, pela sua assinatura) conversa com você, analisa vagas, monta currículos e cartas em PDF sem inventar nada e acompanha as suas candidaturas. Tudo fica numa pasta da sua máquina, em Docker.

- **Perfis a partir do CV.** Lê PDF, DOCX ou texto livre (com OCR para PDF escaneado) e o seu GitHub; cada fato vira uma proposta com o trecho de origem, e nada entra sem a sua revisão. Vários perfis sobre os mesmos fatos, um por cargo-alvo.
- **Recrutador no chat.** Conhece a sua carreira e todos os perfis, busca nos seus dados, cita a fonte de cada afirmação e pesquisa o mercado registrando as fontes. Também roda dentro do Claude Code, como plugin.
- **Análise de vaga.** Cole o texto ou o link: fit por perfil, o que você atende (ligado aos seus fatos), lacunas, riscos, palavras-chave de ATS e perguntas prováveis.
- **Currículo e carta.** PDF de até 2 páginas no idioma da vaga, revisado por checagens automáticas e por um segundo modelo antes de chegar a você; três modelos prontos e os seus.
- **Candidaturas.** Quadro por etapa, agenda com `.ics` e, opcionalmente, o Google Calendar.
- **Extensão do Chrome.** Leva vagas de qualquer site e ajuda a preencher formulários de candidatura com respostas a partir dos seus dados.

A interface está em **português (Brasil)**. Os currículos e cartas saem no idioma da vaga (português ou inglês).

## O que ainda não existe

Entrevista simulada por voz, análise dos vídeos gravados das entrevistas, leitura e envio automático de e-mails, mensagem a recrutador e otimização do LinkedIn, exportar e apagar os dados pela interface, o medidor de uso completo e um segundo provedor de IA (Codex) estão planejados ([plans/plan-v0/tasks/README.md](plans/plan-v0/tasks/README.md)). A importação do export do LinkedIn foi adiada.

## Antes de começar

- **Docker** com Compose v2: Docker Desktop no Windows e no macOS; Docker Engine no Linux. Nada mais é instalado no computador.
- **Uma assinatura do Claude com acesso ao Claude Code** (Pro ou Max). O uso consome os limites do seu plano, como usar o Claude Code; a tela de ingestão mostra a estimativa antes de rodar, e o chat mostra o gasto de cada conversa.
- **Espaço:** cerca de 2,5 GB de disco para as imagens e 1 GB de RAM livre (o Phoenix, opcional, soma 1 GB de disco e 500 MB de RAM; a busca por sentido, opcional, 113 MB e 400 MB).
- Opcionais: o **GitHub CLI** (`gh`) logado no computador, para importar repositórios privados sem novo login; o **Chrome**, para a extensão; o **Claude Code** instalado, para usar o recrutador no terminal.

Testado em Linux; no Windows e no macOS roda pelo Docker Desktop (as funções do lançador são testadas no CI dos três sistemas).

> **Aviso:** o app nunca foi testado de ponta a ponta no Windows, porque o autor não tem uma máquina com Windows. O `start.ps1` e as funções dele passam no CI, mas o uso real pode ter problemas. Se algo falhar, [abra uma issue](https://github.com/isaquebc/narnia-jobs/issues).

### Sobre o uso da assinatura do Claude

O narnia-jobs usa o **CLI oficial do Claude Code** dentro de um container, logado com a **sua** conta, na **sua** máquina. Ele nunca recebe, guarda fora do seu computador ou repassa a sua credencial.

A documentação do Agent SDK da Anthropic diz que, sem aprovação prévia, desenvolvedores terceiros não podem oferecer o login do claude.ai ou os limites da assinatura nos seus produtos. O narnia-jobs não é um serviço: cada pessoa roda a própria cópia com o próprio login, como outros projetos abertos que embrulham o Claude Code. Ainda assim, a regra existe e a decisão é sua. Por isso há dois modos sobre o mesmo núcleo:

- **Modo A, interface web:** o chat e as tarefas em segundo plano usam o CLI logado no container (o padrão).
- **Modo B, plugin do Claude Code:** você conversa no seu próprio Claude Code e o narnia-jobs entra como plugin e servidor MCP. É o caminho inequivocamente dentro das regras ([tutorial, passo 8](docs/tutorial.md#8-o-recrutador-no-claude-code-modo-b)).

A análise completa está em [plans/plan-v0/01-viabilidade.md](plans/plan-v0/01-viabilidade.md).

## Instalação rápida

```bash
git clone https://github.com/isaquebc/narnia-jobs.git
cd narnia-jobs
./start.sh up        # Windows: .\start.ps1 up
./start.sh login     # uma vez: login da sua assinatura do Claude dentro do container
```

O `up` constrói as imagens (a primeira vez leva alguns minutos), escolhe uma porta livre entre 3100 e 3199 e imprime o endereço já com o token de acesso:

```
  narnia-jobs está no ar:

    http://127.0.0.1:3100/?token=…
```

Abra esse endereço no navegador e siga o primeiro uso. O passo a passo completo, do currículo à primeira candidatura, está no **[tutorial](docs/tutorial.md)**.

## Privacidade: o que fica e o que sai do seu computador

**Fica no seu computador:** tudo o que é seu, na pasta `./data` (banco SQLite, currículos enviados, documentos gerados) e os backups em `./backups`. O login da assinatura fica num volume do Docker. O narnia-jobs não tem telemetria própria nem servidor na nuvem; o Phoenix, quando ligado, também é local.

**Sai, e para onde:**

| Para | O quê | Quando |
|------|-------|--------|
| Anthropic (pelo CLI do Claude Code, na sua conta) | o conteúdo de que o modelo precisa: currículo, fatos, mensagens do chat, vagas, textos dos documentos | em toda tarefa com IA; segue a política de dados da Anthropic, inclusive a telemetria do próprio CLI |
| Anthropic (busca na web) | as buscas que o recrutador faz (salários, empresas): a ferramenta de busca roda do lado da Anthropic | quando ele pesquisa |
| Os sites pesquisados | o pedido das páginas que o recrutador lê | quando ele lê uma página; no chat web, só dos domínios confiáveis (Configurações › Chat) |
| O site da vaga | o pedido da página e, se ela precisar de JavaScript, os recursos que ela carrega (num navegador isolado, sem imagens nem fontes) | quando você salva uma vaga pelo link |
| Os links do seu currículo | uma visita a cada link (identificada como um Chrome comum) | ao gerar o PDF, para não publicar link quebrado |
| API do GitHub | consultas aos seus repositórios | quando você importa o GitHub |
| Hugging Face | o download do modelo de 113 MB, uma vez | quando você liga a busca por sentido |
| Google | eventos da agenda | só se você conectar o Google Calendar |

## Atualizar

```bash
git pull
./start.sh up
```

As migrações do banco rodam sozinhas, com um backup antes de cada uma. Depois de atualizar, recarregue a extensão em `chrome://extensions` e, se usa o recrutador no terminal, rode `./start.sh install-plugin` de novo.

## Desinstalar

```bash
./start.sh down --purge                           # para tudo e remove os volumes (logins do Claude e do GitHub, fila, Phoenix)
docker image rm narnia-jobs/app narnia-jobs/web narnia-jobs/browser
# se instalou o recrutador no Claude Code:
claude mcp remove -s user narnia-jobs
claude plugin uninstall narnia-jobs@narnia-jobs-local
claude plugin marketplace remove narnia-jobs-local
```

Remova a extensão em `chrome://extensions`. Por fim, apague a pasta do projeto: ela contém `./data` e `./backups`, ou seja, **todos os seus dados**. Guarde uma cópia antes, se quiser.

## Problemas comuns

- **`./start.sh doctor`** diagnostica login, Redis, pasta de dados, worker, último backup e o plugin no Claude Code. Comece por ele.
- **"Não logado" ou login vencido:** `./start.sh login` de novo. Alternativa: `claude setup-token` no seu computador e `CLAUDE_CODE_OAUTH_TOKEN=…` no `.env`.
- **Porta ocupada:** o `up` escolhe outra entre 3100 e 3199 e avisa. A porta `8089` (retorno do login do Google Calendar) também precisa estar livre. Se não estiver, ponha `NARNIA_OAUTH_PORT=<outra>` no `.env` e use `http://localhost:<outra>/callback` como endereço de retorno no cliente OAuth do Google.
- **"a pasta ./data não é gravável":** a pasta foi criada como root (por um `docker compose` chamado direto); o erro traz o `sudo chown` exato.
- **Windows:** use o PowerShell (`.\start.ps1 up`). Se o script for bloqueado, rode `powershell -ExecutionPolicy Bypass -File .\start.ps1 up`. Clonar dentro do WSL2 deixa o Docker bem mais rápido.
- **Docker parado:** o lançador avisa; inicie o Docker Desktop (ou `sudo systemctl start docker`).

## Documentação

| | |
|---|---|
| [Tutorial](docs/tutorial.md) · [Tutorial (English)](docs/en/tutorial.md) | do primeiro uso à primeira candidatura, passo a passo |
| [Guia de uso](docs/guia-de-uso.md) | referência de cada funcionalidade, configurações, comandos, dados e backup |
| [Modelos de currículo](docs/templates-de-cv.md) | como criar o seu modelo (`.zip`) |
| [Google Calendar](docs/google-calendar.md) | conexão opcional da agenda das candidaturas |
| [Primeira contribuição](docs/contribuir.md) · [First contribution](docs/en/contributing.md) | do fork ao pull request aceito, passo a passo |
| [Contribuir](CONTRIBUTING.md) | ambiente de desenvolvimento, testes, avaliações dos prompts |
| [Segurança](SECURITY.md) | como relatar uma vulnerabilidade e o modelo de ameaça |
| [Planos](plans/README.md) | documentos internos de projeto e decisões |

## Licença

[MIT](LICENSE). Contribuições são bem-vindas: comece pelo [tutorial de contribuição](docs/contribuir.md), veja o [CONTRIBUTING](CONTRIBUTING.md) e o [código de conduta](CODE_OF_CONDUCT.md).
