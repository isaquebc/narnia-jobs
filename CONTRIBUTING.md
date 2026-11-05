# Contribuir com o narnia-jobs

> **English summary.** Everything runs in Docker: the only host requirement is Docker with Compose v2 (no Node or pnpm on the host). Start the dev stack with `./start.sh dev` (hot reload; `NARNIA_PROVIDER=mock ./start.sh dev` to avoid spending your Claude subscription), run `./start.sh lint`, `typecheck`, `test`, `e2e` and `test:sh`, and write a failing test before the fix (TDD is mandatory). Commits follow `type(scope): message` in Portuguese. Step-by-step tutorial (fork, branch, tests, pull request): [docs/en/contributing.md](docs/en/contributing.md). Never commit real personal data (names, companies, job postings, e-mails): use fictional ones (Acme, Globex, Ana Maria Exemplo). Changing a prompt requires the evaluation gate against the real model (see below). Code, comments, docs and the UI are in Brazilian Portuguese; English issues and pull requests are welcome.

Obrigado por querer contribuir. Para o passo a passo (fork, branch, testes e pull request), comece pelo [tutorial de contribuição](docs/contribuir.md). Este guia é a referência do ambiente, dos testes, das convenções e das avaliações dos prompts. Para usar o narnia-jobs, veja o [README](README.md) e o [tutorial](docs/tutorial.md).

## Ambiente

Pré-requisito único: **Docker** com Compose v2. Node, pnpm e todas as ferramentas rodam dentro de containers; nada é instalado no host.

```bash
./start.sh dev        # web (http://127.0.0.1:5173/?token=dev-token), api (127.0.0.1:3100), worker e redis com hot reload
./start.sh test       # testes unitários (Vitest) de todos os pacotes
./start.sh lint       # Biome (formatação e lint); ./start.sh lint --write corrige
./start.sh typecheck  # tsc
./start.sh build      # build de todos os pacotes
./start.sh shell      # shell no container de desenvolvimento
./start.sh cli doctor # CLI narnia-jobs no container de dev: doctor | login | install-plugin
./start.sh test:sh    # testes dos lançadores: start.sh (bats) e start.ps1 (Pester)
./start.sh e2e        # ponta a ponta: Playwright em container contra a stack de produção com provider mock
                      #   --ui-only pula as fases de down/up, worker e porta; --grep "E2E-19" filtra
```

No Windows, `.\start.ps1` tem os mesmos subcomandos. Em Linux e macOS há um `Makefile` fino sobre o `start.sh` (`make help`): `make dev`, `make check` (lint, typecheck e testes), `make e2e`.

O modo dev usa o provider **Claude Code** com a sua assinatura, como a produção; a diferença é o hot reload. Para desenvolver a interface sem gastar a assinatura: `NARNIA_PROVIDER=mock ./start.sh dev` (o mock devolve sempre o mesmo currículo fictício). O token em dev é `dev-token`; em produção é aleatório. Dev e produção publicam a porta 3100 da api, então suba um de cada vez.

Os containers rodam com o uid e o gid de quem chama o lançador (`NARNIA_UID`/`NARNIA_GID`), então `./data` e os arquivos gerados ficam do seu usuário. Chame o compose pelo `start.sh`: um `docker compose` direto antes do primeiro `up` cria `./data` como root.

## Estrutura

| Pasta | O que tem |
|-------|-----------|
| `apps/web` | interface (React + Vite + TanStack Router/Query + Tailwind); textos em `src/i18n/pt-BR.ts` |
| `apps/api` | Hono: REST, WebSocket, servidor MCP (`/mcp`), chat (Agent SDK), CLI `narnia-jobs` |
| `apps/worker` | BullMQ: ingestão, extração de vagas, geração e revisão de currículos |
| `apps/extension` | extensão do Chrome (Manifest V3) |
| `apps/e2e` | Playwright, um arquivo por cenário |
| `packages/shared` | schemas zod, contratos, tempo |
| `packages/core` | domínio, banco (SQLite, SQL puro com migrações), busca, documentos |
| `packages/providers` | Claude Code via Agent SDK, mock e os prompts estruturados |
| `plugin/` | persona do recrutador, subagente, skills e hooks: a mesma fonte nos modos A e B |
| `evals/` | casos, juízes, linhas de base e saídas aprovadas das avaliações |
| `docker/` | Dockerfiles e entrypoint |
| `plans/` | planejamento e registro de execução ([plans/README.md](plans/README.md)) |

Imagens: `docker/Dockerfile` (api e worker; a fonte TypeScript roda com `tsx`), `docker/web.Dockerfile` (nginx + SPA). `docker-compose.e2e.yml` sobrepõe a produção com provider mock, token fixo e dados descartáveis (`./.e2e-data`).

## Convenções

- **TDD obrigatório** ([plans/plan-v0/09-metodologia-tdd.md](plans/plan-v0/09-metodologia-tdd.md)): o teste que falha vem antes do código; correção de bug começa por um teste de regressão.
- **Commits** no formato `tipo(escopo): mensagem` em pt-BR (`feat`, `fix`, `docs`, `chore`, `test`), com o porquê no corpo.
- **Nenhum dado pessoal real** em código, testes, fixtures, avaliações ou mensagens de commit: use nomes fictícios (Acme, Globex, Initech, Ana Maria Exemplo, `exemplo/...`). O CI confere que nada de `./data` ou `.env` entra no repositório.
- **Textos da interface** sempre pelo dicionário `apps/web/src/i18n/pt-BR.ts`.
- **Toda tarefa com modelo ou com mais de 2 s** é um job em segundo plano.
- **Mudou um comportamento:** atualize o README, o [tutorial](docs/tutorial.md) (as duas línguas) e o [guia de uso](docs/guia-de-uso.md).

## Fluxo completo da API com `curl` (provider mock)

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
curl -s -H "$H" -H 'content-type: application/json' -X PUT -d @user.json $B/api/user        # identidade + telefone
curl -s -H "$H" -H 'content-type: application/json' -d @profile.json $B/api/profiles      # primeiro perfil
curl -s -H "$H" $B/api/dashboard
```

Antes, salve como `user.json` e `profile.json` os corpos de exemplo `VALID_USER` e `VALID_PROFILE` de `apps/api/test/helpers.ts`. O WebSocket de progresso fica em `ws://127.0.0.1:3100/ws?token=dev-token`.

## Avaliações dos prompts (Phoenix)

As avaliações do recrutador (`evals/chat/`, conversas de referência com regras sem tokens e o juiz `evals/judges/narnia-recrutador.md`) rodam com `./start.sh evals chat`, sempre num **banco temporário isolado**: o comando abre um banco descartável com um perfil fictício, um `/mcp` próprio em `127.0.0.1` e conversa pelo Claude de verdade com as ferramentas desse banco; no fim apaga tudo. Os seus dados nunca entram. O resultado vira experimento do dataset `narnia-chat` e os rastros das conversas vão para o projeto `narnia-evals`, separados dos seus. `./start.sh evals pdf` faz o mesmo com a leitura de um PDF fictício, `./start.sh evals cv-review` avalia o revisor do currículo com as imagens reais das páginas (um CV correto, um com fato inventado e um com o cabeçalho sobreposto de propósito; precisa do serviço `browser`), e `./start.sh evals all` roda tudo.

Os prompts do narnia-jobs ficam **versionados no Phoenix** (Prompts) e cada prompt estruturado tem um **dataset** com exemplos fictícios e **avaliadores presos a ele**, que são o teste de prompt e garantem o padrão de entrega das respostas:

- **Prompts:** as chamadas estruturadas (leitura do PDF, fatos, registro de contexto, sugestão de perfis, escolha de arquivos, análise de repositório, síntese, revisão anti-alucinação, título da conversa; da análise de vagas, extração, junção e comparação de vaga repetida; do currículo, geração do CV, da carta e revisão), a persona do recrutador geral e o recrutador especializado, as notas de contexto do chat e as skills do terminal. O repositório é a fonte: a sincronização cria uma versão nova quando um prompt muda (com o commit na descrição) e marca a versão em uso com a tag `production`.
- **Avaliadores de código** (TypeScript, rodam no sandbox Deno do próprio Phoenix, sem rede): JSON no schema, citações literais da fonte, nenhum ano fora da fonte, idioma, limites (arquivos, um veredito por item), ids de apoio do histórico e cobertura dos termos esperados (com termos proibidos para pegar instrução escondida no documento). O código mora em `packages/core/src/evals/prompt-evaluators/` e é publicado como arquivo único.
- **Juízes** (avaliador com modelo, `padrao_de_entrega`): o padrão de entrega de cada prompt em `evals/judges/<prompt>.md`, com rótulos `atende`, `parcial` e `nao_atende`.

**Como rodar pelo Phoenix:** abra um prompt (`narnia-…`) no Playground, escolha o dataset de mesmo nome e rode: o modelo responde pela ponte e os avaliadores rodam sozinhos, com as notas no experimento. **Pelo terminal:** `./start.sh evals prompts [nome…] [--strict]` (Windows: `.\start.ps1 evals prompts`) roda os prompts estruturados sobre os datasets como experimentos do Phoenix e imprime as notas; `--strict` sai com erro quando alguma avaliação fica abaixo de 100%. **Bloqueador de regressão:** `--gate` compara a rodada com a linha de base versionada em `evals/baselines.json` e sai com erro se algum avaliador cair mais de 5 pontos (no chat, pela média da rodada inteira, porque uma amostra por caso oscila); `--update-baseline` grava a rodada como nova linha de base, só quando não há regressão. Todo prompt novo ou alterado passa por essa rodada com o Claude real antes do commit (ver abaixo). A leitura do PDF usa a tool Read e roda por `./start.sh evals pdf` (abaixo).

**Ponte pela assinatura.** O Phoenix chama o modelo pela API; como o narnia-jobs usa a sua assinatura do Claude (sem chave de API), a api oferece um endereço compatível com a API de mensagens da Anthropic (`/bridge/anthropic`) que responde pelo Claude Code com o seu login. Quando o api sobe com o Phoenix no ar, ele registra a ponte no Phoenix (AI Providers, provedor `narnia-assinatura`) e sincroniza prompts, datasets e avaliadores. Em **Configurações › Avaliações** você liga ou desliga a ponte, escolhe o modelo padrão e quantas chamadas rodam ao mesmo tempo, troca a chave, registra de novo, sincroniza e, se preferir pagar por token, guarda uma chave de API da Anthropic, que fica só no Phoenix.

Limites da ponte: executa uma tool só quando ela é forçada (o formato dos juízes do Phoenix); prompts com tools de verdade rodam pelo comando; ignora temperatura, `top_p` e `stop_sequences` (avisa no header `x-narnia-ignored-params`); junta um histórico de várias mensagens numa transcrição; e consome a cota da assinatura, como o chat. Ela só aceita a própria chave (nunca o token de boot) e escuta na rede dos containers e em `127.0.0.1`.

### Gate de prompts

Prompt novo ou alterado (persona, subagente, skills, notas, prompts estruturados, juízes) só entra com a rodada real:

```bash
NARNIA_PROVIDER=claude-code ./start.sh evals prompts|chat ... --gate
```

O gate compara com a linha de base (`evals/baselines.json`) e, por pares, com a saída aprovada (`evals/approved/`), com um juiz cego: a mudança precisa ser **upgrade** (mais vitórias que derrotas, sem regressão nas notas). Uma funcionalidade nova declara os casos novos com `--feature=id,...` e precisa de não-inferioridade nos antigos. `--update-baseline` grava a rodada nova só sem regressão. A rodada consome a sua assinatura; os detalhes (amostras, ruído, retomada) estão em [CLAUDE.md](CLAUDE.md#modo-b-phoenix-e-avaliações-f04).

## O agente de desenvolvimento do mantenedor

O `CLAUDE.md` e a pasta `.claude/` configuram o Claude Code que o mantenedor usa no projeto. Ele trabalha numa **instância de testes separada** (`NARNIA_INSTANCE=claude`, valores em `.env.claude`, dados em `./.claude-data`, portas 5174/3200, provider mock), operada por `scripts/claude-env.sh`, para nunca tocar a instância de uso real. Se você também usa o Claude Code, essas regras valem para o seu agente: a sua instância de uso fica em `./data`, e os testes do agente na de testes.

A instância de uso do mantenedor roda de uma cópia separada do código, `.owner-src` (uma worktree do git), atualizada por `./start.sh promote` quando um marco fecha verde. Assim, edições em andamento não chegam a ela. Sem `.owner-src`, o `./start.sh dev` usa a raiz, como de costume. Para voltar a usar a raiz: `git worktree remove .owner-src`.

## URL pública temporária (`make tunnel`)

`make tunnel` publica a sua instância numa URL pública temporária (`cloudflared`) **com o token embutido**: qualquer pessoa com a URL acessa os seus dados. Use só para testar no celular, por exemplo, e encerre logo depois.

## CI

A `main` é protegida: as mudanças entram por pull request, com o CI verde, a aprovação do mantenedor e as conversas resolvidas; push forçado e exclusão da branch são bloqueados.

`.github/workflows/ci.yml` roda lint, typecheck, testes com cobertura, build, os testes dos lançadores (bats e Pester), o build das imagens com o smoke do `up`, o e2e completo e a checagem de dados pessoais, além do smoke das funções do lançador no Linux, macOS e Windows. O smoke do plugin com o Claude Code real (`plugin-smoke`) só roda por disparo manual, com o segredo `CLAUDE_CODE_OAUTH_TOKEN`.
