# narnia-jobs

Projeto **open source**: clone, rode localmente e use a assinatura da IA que preferir (Claude Code primeiro; Codex planejado). Coleção de ferramentas locais para apoiar a busca de emprego: um recrutador(a) sênior como agente, perfis múltiplos (um por cargo-alvo), ingestão de dados (CV, GitHub, LinkedIn) e features isoladas (gerar CV, analisar vaga, candidaturas, simular entrevista). Roda na máquina do usuário via Docker (Linux, Windows e Mac), com dados persistidos em pasta do host fora do versionamento.

**Estado:** fase de descoberta. Nenhum código ainda; o que existe é o plano `plan-v0` em `plans/plan-v0/`.

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

### Onde ficam os dados e como fazer backup

Tudo que é seu fica em `./data` (ou na pasta apontada por `NARNIA_DATA_DIR` no `.env`): banco SQLite, currículos enviados, textos extraídos, documentos gerados e logs de uso. Essa pasta nunca entra no repositório (`.gitignore`). **Backup = copiar `./data`** com os serviços parados (`./start.sh down`). O login da assinatura fica no volume Docker `claude-auth`, e a fila no volume `redis-data`.

### Comandos

| Comando | Faz |
|---------|-----|
| `./start.sh up` | sobe (ou atualiza) os serviços e imprime a URL |
| `./start.sh down` | para os serviços; dados e login preservados |
| `./start.sh down --purge` | para e **remove os volumes**: apaga o login da assinatura e a fila; a pasta `./data` fica |
| `./start.sh login` | login da assinatura dentro do container |
| `./start.sh doctor` | diagnóstico |
| `./start.sh logs [api\|worker\|web\|redis]` | acompanha os logs |
| `./start.sh status` | estado dos containers |

No Windows, `.\start.ps1` tem os mesmos subcomandos. `docker compose down -v` equivale a `down --purge`.

### Portas e rede

Só a porta escolhida (`NARNIA_PORT`) é publicada, e apenas em `127.0.0.1`: nada fica acessível pela rede local. A porta `8089` é reservada ao callback OAuth do Google Calendar (feature futura). Se a porta salva estiver ocupada na próxima vez, o `up` escolhe outra e avisa; os dados não dependem da porta.

## Desenvolvimento

Pré-requisito único: **Docker** (Docker Desktop no Windows/macOS, Docker Engine + Compose v2 no Linux). Node, pnpm e todas as ferramentas rodam dentro de containers; nada é instalado no host.

```bash
./start.sh dev        # sobe web (http://127.0.0.1:5173), api (http://127.0.0.1:3100), worker e redis com hot reload
./start.sh test       # testes unitários (Vitest) de todos os pacotes
./start.sh lint       # Biome
./start.sh typecheck  # tsc
./start.sh build      # build de todos os pacotes
./start.sh shell      # shell no container de desenvolvimento
./start.sh cli doctor # CLI narnia-jobs dentro do container de dev: doctor | login | install-plugin
./start.sh test:sh    # testes dos lançadores: start.sh (bats) e start.ps1 (Pester), em containers
```

No Windows, use `.\start.ps1` com os mesmos subcomandos. Imagens de produção: `docker/Dockerfile` (api e worker; a fonte TypeScript roda com `tsx`) e `docker/web.Dockerfile` (nginx + SPA). `docker-compose.e2e.yml` sobrepõe o compose de produção com provider mock, token fixo e pasta de dados descartável (`./.e2e-data`) para os testes de ponta a ponta.

Em desenvolvimento o provider padrão é o **mock** (`NARNIA_PROVIDER=mock`): nenhuma chamada ao modelo nem à assinatura. Para usar o Claude Code de verdade, exporte `NARNIA_PROVIDER=claude-code` e faça o login com `./start.sh cli login`. O token de boot em dev é `dev-token` (`NARNIA_TOKEN`); em produção é aleatório e impresso no log da api.

### Fluxo completo da API com `curl` (provider mock)

```bash
./start.sh dev -d api worker            # api em 127.0.0.1:3100
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

Com `./start.sh dev` no ar, abra `http://127.0.0.1:5173/?token=dev-token`. O `?token=` vira cookie (`/api/auth/enter`) e a página volta para `/`, que redireciona ao passo salvo do onboarding ou ao dashboard. O Vite faz proxy de `/api` e `/ws` para a api. Fluxo do primeiro uso em 5 passos: provider → currículo (arquivo ou texto livre, com opções de OCR e leitura pelo modelo e estimativa por chamada) → extração (etapas da cadeia, também na bandeja de atividades do topo) → revisão (identidade com telefone obrigatório, propostas com origem por trecho) → perfil (dados de carreira obrigatórios, "não sei" marca para pesquisa, alerta informativo do piso DIEESE) → dashboard. Tema claro/escuro no ícone do topo; textos vêm todos de `apps/web/src/i18n/pt-BR.ts`.

Estrutura: `apps/web` (React + Vite), `apps/api` (Hono: REST, WS, enfileira jobs, CLI `narnia-jobs`), `apps/worker` (BullMQ: cadeia de ingestão), `packages/shared` (schemas zod, contratos, tempo, i18n), `packages/core` (domínio, storage, leituras de PDF, consolidação), `packages/providers` (Claude Code via Agent SDK e mock). Metodologia: TDD, conforme `plans/plan-v0/09-metodologia-tdd.md`.
