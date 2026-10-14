# narnia-jobs

Projeto **open source**: clone, rode localmente e use a assinatura da IA que preferir (Claude Code primeiro; Codex planejado). Coleção de ferramentas locais para apoiar a busca de emprego: um recrutador(a) sênior como agente, perfis múltiplos (um por cargo-alvo), ingestão de dados (CV, GitHub, LinkedIn) e features isoladas (gerar CV, analisar vaga, candidaturas, simular entrevista). Roda na máquina do usuário via Docker (Linux, Windows e Mac), com dados persistidos em pasta do host fora do versionamento.

**Estado:** F01 (primeiro uso), F02 (perfis), F03 (ingestão de CV, texto e GitHub, com notificações) e F04 (chat com o recrutador na web e no terminal, com rastros locais no Phoenix) implementados. O plano está em `plans/plan-v0/`; as próximas entregas (gerar CV, analisar vaga, candidaturas) seguem a ordem de `plans/plan-v0/tasks/README.md`.

| Documento | Conteúdo |
|-----------|----------|
| [plans/plan-v0/01-viabilidade.md](plans/plan-v0/01-viabilidade.md) | análise de viabilidade, política da Anthropic sobre assinatura e a decisão de dois modos |
| [plans/plan-v0/02-fluxos-do-usuario.md](plans/plan-v0/02-fluxos-do-usuario.md) | onboarding, troca de perfil, ingestão, chat, features, gestão de dados |
| [plans/plan-v0/03-arquitetura.md](plans/plan-v0/03-arquitetura.md) | plugin + MCP + UI web local, storage, ingestão por profundidade, economia de tokens, fases |
| [plans/plan-v0/04-escopo-de-dados.md](plans/plan-v0/04-escopo-de-dados.md) | usuário base, perfil, features, modelo de fato com fonte |
| [plans/plan-v0/05-layouts.md](plans/plan-v0/05-layouts.md) | wireframes de todas as telas |
| [plans/plan-v0/06-decisoes-em-aberto.md](plans/plan-v0/06-decisoes-em-aberto.md) | decisões que dependem do dono do projeto |
| [plans/plan-v0/07-dois-modos.md](plans/plan-v0/07-dois-modos.md) | viabilidade de manter wrapper local (Agent SDK) e modo plugin ao mesmo tempo |
| [plans/plan-v0/09-metodologia-tdd.md](plans/plan-v0/09-metodologia-tdd.md) | TDD obrigatório, e2e por fluxo e registro para o harness futuro |
| [plans/plan-v0/tasks/README.md](plans/plan-v0/tasks/README.md) | **entregáveis F01–F11**: um por fluxo/feature, com ordem e dependências; cada um com arquitetura, dados, layouts, decisões e testes |
| [plans/plan-v0/08-docker-calendar-voz.md](plans/plan-v0/08-docker-calendar-voz.md) | viabilidade de rodar em Docker, integrar Google Calendar via MCP e entrevista por voz mãos livres |

## Uso

Pré-requisito único: **Docker** (Docker Desktop no Windows/macOS; Docker Engine + Compose v2 no Linux). Nada mais é instalado no host: a aplicação roda em quatro containers (web, api, worker, redis).

```bash
git clone <este repositório> && cd narnia-jobs-helpper
./start.sh up          # Windows: .\start.ps1 up
```

O `up` escolhe a primeira porta livre entre 3100 e 3199 (gravada em `.env` como `NARNIA_PORT` e reutilizada enquanto estiver livre), constrói as imagens na primeira vez, espera a api ficar saudável e imprime a URL de abertura, já com o token de acesso local:

```
  narnia-jobs está no ar:

    http://127.0.0.1:3100/?token=…
```

Abra essa URL no navegador. O token protege a API local contra outros sites abertos no mesmo navegador; ele é gerado uma vez e guardado em `./data/.token`, então a URL continua a mesma depois de reiniciar.

### Login da assinatura do Claude

A extração do currículo e o recrutador usam a **sua** assinatura do Claude, pelo CLI oficial dentro do container. Dois caminhos:

1. **Padrão, login no volume** (uma vez): `./start.sh login`. O CLI imprime uma URL; abra, autorize e cole o código de volta. A credencial fica no volume `claude-auth`, renova sozinha e sobrevive a reinícios e reboots.
2. **Alternativa, token de longa duração**: no seu computador, com o Claude Code instalado, rode `claude setup-token` e cole o valor em `.env` como `CLAUDE_CODE_OAUTH_TOKEN=…`. Quando essa variável existe, ela prevalece sobre o login do volume. O token expira em um ano.

`./start.sh doctor` mostra qual mecanismo está ativo (volume, token ou nenhum), além de Redis, pasta de dados e worker.

### Perfis

Depois do primeiro uso, **Perfis** (menu lateral ou "Gerenciar perfis" no seletor do topo) permite ter vários perfis sobre os mesmos fatos, um por cargo-alvo: criar do zero ou clonar, trocar o ativo pelo seletor (todas as abas acompanham), renomear, arquivar e desarquivar. Em cada perfil: **Ênfases** (destacar, ocultar e ordenar experiências, projetos, skills, formação e idiomas, com prévia do cartão), **Narrativa** (seu pitch), **Recrutador** (persona: tom, honestidade, rigor e senioridade do recrutador, com restaurar padrão) e **Cartão** (o resumo de ~300 tokens que o recrutador recebe; mostra se está desatualizado e tem o botão "Atualizar cartão"). O dashboard sugere perfis por heurística, sem custo; o botão **Analisar possíveis perfis** usa o modelo sobre todo o seu histórico e, por isso, mostra a estimativa de tokens e pede confirmação antes.

### Ingestão e GitHub

Em **Ingestão** você adiciona dados depois do primeiro uso: **GitHub**, **Currículo** (outro CV) e **Texto livre** ("conte a sua história de carreira e de vida"). Reenviar o mesmo arquivo ou texto avisa "já lido" e aponta a execução anterior.

- **Conectar o GitHub.** Se o `gh` do seu computador estiver logado, o app reaproveita esse login (o lançador entrega o token ao container a cada `up`/`dev`). Senão, escolha **Login próprio do app**: aparece um código; clique em **Abrir GitHub**, cole o código e autorize. A escolha fica em **Configurações**. Depois de atualizar o código do projeto, reconstrua a stack uma vez para ter o `gh` no container: `make dev-down && make dev` (ou `./start.sh down && ./start.sh up`).
- **Pública ou privada.** A análise pública lê só repositórios públicos e funciona sem login (sem as métricas de contribuição, que o GitHub só entrega logado). A privada inclui os privados e exige o GitHub conectado; o app só lê.
- **Orçamento e plano.** Antes de rodar, a tela mostra seu plano, quanto já usou das janelas de 5 horas e semanal, a estimativa e um orçamento recomendado. O GitHub sempre pede confirmação; CV e texto seguem sozinhos abaixo de 10 mil tokens.
- **Freio.** Se o orçamento acabar, a execução para e pergunta: continuar com mais orçamento, encerrar com o que foi feito, ou deixar para depois.
- **Pendências.** O sino no topo e a página **Pendências** reúnem revisões, conflitos, execuções esperando decisão, sugestões de perfil e análises concluídas; cada item some sozinho quando você resolve.
- **Evidências.** Repositórios analisados com relatório, métricas, resumo editável e **Reanalisar** (atualizar com commits novos, aprofundar ou cobrir o que ficou de fora).
- **Contrato, carga horária, salário e benefícios.** Cada experiência pode ter (todos opcionais) o tipo de contrato (CLT, PJ, freelance, estágio, temporário), a carga horária semanal (separada do contrato: um PJ pode ter 20, 30 ou 44 horas), o salário com valor, período (hora, mês ou ano) e moeda, e benefícios de uma lista (vale-refeição, plano de saúde, odontológico, seguro de vida, vale-transporte, auxílio home office, PLR/bônus, ações, 13º, férias remuneradas, auxílio educação, previdência privada, academia, day off de aniversário) mais outros em texto livre. A ingestão de CV ou texto extrai o que estiver escrito, com a citação do trecho, sem converter nem estimar; uma experiência já conhecida recebe esses dados como atualização para você aprovar. O cartão do perfil mostra a **trajetória do salário** pelo equivalente mensal (salário por hora × carga semanal), com a variação entre experiências na mesma moeda, e o recrutador usa isso para dizer se você está subindo ou descendo. Para trazer o salário de um texto já ingerido, ingira de novo (**Ler de novo**).

### Chat com o recrutador

Menu › grupo do perfil atual › **Chat**. Cada conversa pertence ao perfil ativo; até 5 ficam abertas ao mesmo tempo (a sexta pergunta qual encerrar) e conversas paradas por 1 hora hibernam e retomam do ponto na próxima mensagem (Configurações › Chat ajusta os limites e o modelo padrão, Sonnet). O recrutador já começa conhecendo a persona e o cartão do seu perfil, busca detalhes nos seus dados pelas ferramentas (os chips mostram quais usou) e cita a fonte do que afirma. Você pode colar um texto da sua história, mandar um arquivo ou um link do GitHub: ele cria a ingestão e as propostas vão para a revisão (nada é gravado sem você aprovar; o GitHub sempre pede confirmação do orçamento). Pesquisas na internet usam só domínios confiáveis (lista editável em Configurações › Chat). Na revisão de uma ingestão, **Clarificar com o recrutador** abre uma conversa cujas respostas viram propostas da mesma execução.

**Custo:** cada mensagem usa a sua assinatura do Claude; o rodapé do chat mostra os tokens do turno e da conversa, o custo equivalente e o teto por conversa, se você definir um em Configurações › Chat.

### Recrutador no terminal (Claude Code, modo B)

O mesmo recrutador do chat roda no Claude Code do seu computador, com o mesmo cartão do perfil e as mesmas tools:

```bash
make dev            # ou ./start.sh up; a instância precisa estar no ar
./start.sh install-plugin   # Windows: .\start.ps1 install-plugin  (com a produção no ar: --prod)
```

O `install-plugin` registra o servidor MCP do narnia-jobs no Claude Code (escopo do usuário; o token fica num arquivo só seu na cópia `.plugin-build/`, que precisa continuar lá) e instala o plugin (persona, skills, o hook que traz o cartão e o que registra o uso no medidor) por um marketplace local. Mudou a persona em Configurações? Rode o `install-plugin` de novo para o agente do terminal acompanhar. Reinicie o Claude Code e use `/narnia-jobs:recrutador`, `/narnia-jobs:perfil`, `/narnia-jobs:clarificar <execução>`, `/narnia-jobs:descoberta` (pergunta só o que falta no perfil) ou `/narnia-jobs:github-publico` (revisão do seu perfil público do GitHub a partir dos relatórios da ingestão). Se a porta mudar, rode o `install-plugin` de novo; o `./start.sh doctor` avisa quando o MCP ou o plugin estão desatualizados.

### Rastros e avaliações (Arize Phoenix local)

No `make dev` o Phoenix sobe junto: abra `http://127.0.0.1:6006`. Nada sai do seu computador.

- **Projeto `narnia-jobs`:** um rastro por mensagem do chat. O turno é a raiz (sua pergunta e a resposta), e dentro dele aparecem, em ordem, cada chamada ao modelo (system prompt, mensagens, texto e ferramentas pedidas, modelo, tokens e cache) e cada ferramenta (argumentos e resultado, com a execução no servidor MCP como filha). As conversas aparecem na aba **Sessions**. Cada job do worker (leitura do PDF, fatos, GitHub) também vira um rastro, com as chamadas ao modelo dentro, e as etapas de uma ingestão ficam agrupadas como uma sessão.
- **Anotações em cada turno:** os avaliadores que não gastam tokens (anos e empresas fora do perfil, fontes fora da lista de domínios confiáveis, teto de custo e de turnos) avaliam cada resposta e gravam "passou/falhou" com a explicação, mais uma nota de resumo (custo, ferramentas e o que falhou).
- **Conteúdo:** perguntas, respostas, prompts e resultados de ferramentas vão para o Phoenix por padrão. Para deixar só metadados (modelo, tokens, custo, tempo), defina `NARNIA_OTEL_CONTENT=0` no `.env`.

Na produção (`./start.sh up`) o Phoenix fica desligado; para ligar, ponha no `.env`:

```
COMPOSE_PROFILES=observability
NARNIA_OTEL_ENDPOINT=http://phoenix:6006/v1/traces
```

As avaliações do recrutador (`evals/chat/`, conversas de referência com regras sem tokens e o juiz `evals/judges/narnia-recrutador.md`) rodam com `./start.sh evals chat`, sempre num **banco temporário isolado**: o comando abre um banco descartável com um perfil fictício, um `/mcp` próprio em `127.0.0.1` e conversa pelo Claude de verdade com as ferramentas desse banco; no fim apaga tudo. Os seus dados nunca entram. O resultado vira experimento do dataset `narnia-chat` e os rastros das conversas vão para o projeto `narnia-evals`, separados dos seus. `./start.sh evals pdf` faz o mesmo com a leitura de um PDF fictício, e `./start.sh evals all` roda prompts, chat e PDF.

#### Prompts e avaliadores no Phoenix (ponte pela assinatura)

Os prompts do narnia-jobs ficam **versionados no Phoenix** (Prompts) e cada prompt estruturado tem um **dataset** com exemplos fictícios e **avaliadores presos a ele**, que são o teste de prompt e garantem o padrão de entrega das respostas:

- **19 prompts**: as 9 chamadas estruturadas (leitura do PDF, fatos, registro de contexto, sugestão de perfis, escolha de arquivos, análise de repositório, síntese, revisão anti-alucinação e título da conversa), a persona do recrutador, as 4 notas de contexto do chat e as 5 skills do terminal. O repositório é a fonte: a sincronização cria uma versão nova quando um prompt muda (com o commit na descrição) e marca a versão em uso com a tag `production`.
- **Avaliadores de código** (TypeScript, rodam no sandbox Deno do próprio Phoenix, sem rede): JSON no schema, citações literais da fonte, nenhum ano fora da fonte, idioma, limites (arquivos, um veredito por item), ids de apoio do histórico e cobertura dos termos esperados (com termos proibidos para pegar instrução escondida no documento). O código mora em `packages/core/src/evals/prompt-evaluators/` e é publicado como arquivo único.
- **Juízes** (avaliador com modelo, `padrao_de_entrega`): o padrão de entrega de cada prompt em `evals/judges/<prompt>.md`, com rótulos `atende`, `parcial` e `nao_atende`.

**Como rodar pelo Phoenix:** abra um prompt (`narnia-…`) no Playground, escolha o dataset de mesmo nome e rode: o modelo responde pela ponte e os avaliadores rodam sozinhos, com as notas no experimento. **Pelo terminal:** `./start.sh evals prompts [nome…] [--strict]` (Windows: `.\start.ps1 evals prompts`) roda os prompts estruturados sobre os datasets como experimentos do Phoenix e imprime as notas; `--strict` sai com erro quando alguma avaliação fica abaixo de 100%. A leitura do PDF usa a tool Read e roda por `./start.sh evals pdf` (abaixo).

**Ponte pela assinatura.** O Phoenix chama o modelo pela API; como o narnia-jobs usa a sua assinatura do Claude (sem chave de API), a api oferece um endereço compatível com a API de mensagens da Anthropic (`/bridge/anthropic`) que responde pelo Claude Code com o seu login. Quando o api sobe com o Phoenix no ar, ele registra a ponte no Phoenix (AI Providers, provedor `narnia-assinatura`) e sincroniza prompts, datasets e avaliadores. Em **Configurações › Avaliações** você liga ou desliga a ponte, escolhe o modelo padrão e quantas chamadas rodam ao mesmo tempo, troca a chave, registra de novo, sincroniza e, se preferir pagar por token, guarda uma chave de API da Anthropic, que fica só no Phoenix.

Limites da ponte: executa uma tool só quando ela é forçada (o formato dos juízes do Phoenix); prompts com tools de verdade rodam pelo comando; ignora temperatura, `top_p` e `stop_sequences` (avisa no header `x-narnia-ignored-params`); junta um histórico de várias mensagens numa transcrição; e consome a cota da assinatura, como o chat. Ela só aceita a própria chave (nunca o token de boot) e escuta na rede dos containers e em `127.0.0.1`.

### Onde ficam os dados e como fazer backup

Tudo que é seu fica em `./data` (ou na pasta apontada por `NARNIA_DATA_DIR` no `.env`): banco SQLite, currículos enviados, textos extraídos, documentos gerados e logs de uso. Essa pasta nunca entra no repositório (`.gitignore`). O login da assinatura fica no volume Docker `claude-auth`, e a fila no volume `redis-data`.

**Backups automáticos** ficam em `./backups`, na raiz do projeto, **fora** de `./data` (ou em `NARNIA_BACKUP_DIR`, por exemplo um disco externo ou uma pasta sincronizada): uma cópia consistente do banco no primeiro boot de cada dia em que há dados e outra antes de cada migration, mais os uploads copiados sem duplicar. Ficam no máximo 5 cópias no total (configurável em Configurações › Backups); ao bater o teto, a mais antiga sai. **Apagar `./data` apaga os seus dados, mas não os backups.** Se o banco for recriado vazio e houver backup, a aplicação avisa com uma notificação crítica que traz o comando de restauração.

Para restaurar: `./start.sh restore backups/<arquivo>.sqlite` (para a stack, guarda o banco atual em `backups/narnia-before-restore-…`, copia o escolhido e sobe de novo). Backup manual continua valendo: copiar `./data` com os serviços parados (`./start.sh down`).

### Comandos

| Comando | Faz |
|---------|-----|
| `./start.sh up` | sobe (ou atualiza) os serviços e imprime a URL |
| `./start.sh down` | para os serviços; dados e login preservados |
| `./start.sh down --purge` | para e **remove os volumes**: apaga o login da assinatura e a fila; a pasta `./data` fica |
| `./start.sh login` | login da assinatura dentro do container |
| `./start.sh doctor` | diagnóstico: login, Redis, worker, caminho e tamanho do banco e do WAL, processo com o banco apagado ainda aberto, último backup e última requisição |
| `./start.sh restore <arquivo>` | restaura um backup de `./backups` (guarda o banco atual antes) |
| `./start.sh install-plugin` | instala o recrutador no Claude Code deste computador (MCP + plugin) |
| `./start.sh logs [api\|worker\|web\|redis]` | acompanha os logs |
| `./start.sh status` | estado dos containers |

No Windows, `.\start.ps1` tem os mesmos subcomandos. `docker compose down -v` equivale a `down --purge`.

### Portas e rede

Só a porta escolhida (`NARNIA_PORT`) é publicada, e apenas em `127.0.0.1`: nada fica acessível pela rede local. A porta `8089` é reservada ao callback OAuth do Google Calendar (feature futura). Se a porta salva estiver ocupada na próxima vez, o `up` escolhe outra e avisa; os dados não dependem da porta.

## Desenvolvimento

Pré-requisito único: **Docker** (Docker Desktop no Windows/macOS, Docker Engine + Compose v2 no Linux). Node, pnpm e todas as ferramentas rodam dentro de containers; nada é instalado no host.

```bash
./start.sh dev        # sobe web (http://127.0.0.1:5173/?token=dev-token), api (http://127.0.0.1:3100), worker e redis com hot reload
./start.sh test       # testes unitários (Vitest) de todos os pacotes
./start.sh lint       # Biome
./start.sh typecheck  # tsc
./start.sh build      # build de todos os pacotes
./start.sh shell      # shell no container de desenvolvimento
./start.sh cli doctor # CLI narnia-jobs dentro do container de dev: doctor | login | install-plugin
./start.sh test:sh    # testes dos lançadores: start.sh (bats) e start.ps1 (Pester), em containers
./start.sh e2e        # ponta a ponta: Playwright em container contra a stack de produção com provider mock (--ui-only pula as fases de down/up, worker e porta)
```

No Windows, use `.\start.ps1` com os mesmos subcomandos. Em Linux/macOS há também um `Makefile` fino sobre o `start.sh`: `make help` lista tudo; os principais são `make dev` (modo desenvolvimento, hot reload e provider mock), `make up` / `make down` / `make login` / `make doctor` (modo produção local), `make check` (lint + typecheck + testes), `make e2e` e `make tunnel` (URL pública temporária via `cloudflared`, já com o token; exige o `cloudflared` no host). Os modos dev e produção publicam ambos a porta 3100 no host, então suba um de cada vez. Imagens de produção: `docker/Dockerfile` (api e worker; a fonte TypeScript roda com `tsx`) e `docker/web.Dockerfile` (nginx + SPA). `docker-compose.e2e.yml` sobrepõe o compose de produção com provider mock, token fixo e pasta de dados descartável (`./.e2e-data`) para os testes de ponta a ponta.

O modo dev funciona como a produção: provider **Claude Code** com a sua assinatura (o login de `./start.sh login` fica no mesmo volume `claude-auth` e vale para os dois modos; `CLAUDE_CODE_OAUTH_TOKEN` no `.env` também é respeitado). A diferença é o hot reload. Para desenvolver a interface sem gastar a assinatura, suba com `NARNIA_PROVIDER=mock ./start.sh dev`: o mock devolve sempre o mesmo currículo fictício, não lê o arquivo enviado. O token de boot em dev é `dev-token` (`NARNIA_TOKEN`); em produção é aleatório, persistido em `data/.token` e impresso pelo lançador.

### Duas instâncias: a sua e a de testes do agente

**Código da sua instância (`.owner-src`).** Para que edições em andamento não cheguem à sua instância, ela pode rodar de uma cópia separada do código: `./start.sh promote` cria (na primeira vez) ou atualiza a pasta `.owner-src` para o último commit, e o `make dev` passa a usá-la sozinho. Dados (`./data`), backups (`./backups`) e `.env` continuam na raiz. Rode `promote` quando o agente avisar que um marco fechou verde; se mudaram dependências, composes ou a imagem, depois rode `make dev-down && make dev`. Para voltar a usar o código da raiz, apague `.owner-src` com `git worktree remove .owner-src`.

O mesmo código roda em duas instâncias independentes. A **sua** (`make dev`, dados em `./data`, :5173/:3100) é a de uso real e nunca é tocada pelos testes. A **do agente de desenvolvimento** (`NARNIA_INSTANCE=claude`, valores em `.env.claude`, dados em `./.claude-data`, :5174/:3200, provider mock) é operada por `scripts/claude-env.sh` (`make claude-up`, `make claude-seed ARGS=engineer`, `make claude-wipe`…). Regras completas em `CLAUDE.md`.

### Fluxo completo da API com `curl` (provider mock)

```bash
NARNIA_PROVIDER=mock ./start.sh dev -d api worker   # api em 127.0.0.1:3100
H='Authorization: Bearer dev-token'; B=http://127.0.0.1:3100
curl -s $B/api/health
curl -s -H "$H" $B/api/provider/status                                   # logado (mock)
FILE=$(curl -s -H "$H" -F file=@packages/core/test/fixtures/cv_text.pdf $B/api/files | jq -r .id)
curl -s -H "$H" "$B/api/files/$FILE/estimate"                             # três chamadas por modelo
RUN=$(curl -s -H "$H" -H 'content-type: application/json' -d "{\"fileId\":\"$FILE\"}" $B/api/ingestions | jq -r .id)
watch -n1 "curl -s -H '$H' $B/api/jobs | jq -c '.jobs[] | {type,status,progress}'"   # até as 6 etapas ficarem done
curl -s -H "$H" $B/api/ingestions/$RUN | jq '{status, proposals: (.proposals|length), digest: .digest.summary}'
# revisão: aceitar tudo
DEC=$(curl -s -H "$H" $B/api/ingestions/$RUN | jq -c '{decisions: [.proposals[] | {proposalId: .id, decision: "accepted"}]}')
curl -s -H "$H" -H 'content-type: application/json' -d "$DEC" $B/api/ingestions/$RUN/review
curl -s -H "$H" -H 'content-type: application/json' -X PUT -d @docs-examples/user.json $B/api/user        # identidade + telefone
curl -s -H "$H" -H 'content-type: application/json' -d @docs-examples/profile.json $B/api/profiles      # primeiro perfil
curl -s -H "$H" $B/api/dashboard
```

Os corpos de exemplo de `user.json` e `profile.json` estão em `apps/api/test/helpers.ts` (`VALID_USER`, `VALID_PROFILE`). O WebSocket de progresso fica em `ws://127.0.0.1:3100/ws?token=dev-token`.

### Interface web (M5)

Com `./start.sh dev` no ar, abra `http://127.0.0.1:5173/?token=dev-token`. O `?token=` vira cookie (`/api/auth/enter`) e a página volta para `/`, que redireciona ao passo salvo do onboarding ou ao dashboard. O Vite faz proxy de `/api` e `/ws` para a api. Fluxo do primeiro uso em 6 passos: provider → currículo (arquivo ou texto livre, com opções de OCR e leitura pelo modelo e estimativa por chamada) → extração (etapas da cadeia, também na bandeja de atividades do topo) → revisão (identidade com telefone obrigatório, propostas com origem por trecho) → perfil (dados de carreira obrigatórios, "não sei" marca para pesquisa, alerta informativo do piso DIEESE) → entrevista de descoberta (opcional: o recrutador pergunta só o que ficou faltando e as respostas vão para a revisão) → dashboard. Tema claro/escuro no ícone do topo; textos vêm todos de `apps/web/src/i18n/pt-BR.ts`.

Estrutura: `apps/web` (React + Vite), `apps/api` (Hono: REST, WS, enfileira jobs, CLI `narnia-jobs`), `apps/e2e` (Playwright, um arquivo por cenário: `e2e-NN-*` do F01, `f02-NN-*` do F02 e `f03-NN-*` do F03), `apps/worker` (BullMQ: cadeia de ingestão), `packages/shared` (schemas zod, contratos, tempo, i18n), `packages/core` (domínio, storage, leituras de PDF, consolidação), `packages/providers` (Claude Code via Agent SDK e mock). Metodologia: TDD, conforme `plans/plan-v0/09-metodologia-tdd.md`.
