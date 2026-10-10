# narnia-jobs

Projeto **open source**: clone, rode localmente e use a assinatura da IA que preferir (Claude Code primeiro; Codex planejado). Coleção de ferramentas locais para apoiar a busca de emprego: um recrutador(a) sênior como agente, perfis múltiplos (um por cargo-alvo), ingestão de dados (CV, GitHub, LinkedIn) e features isoladas (gerar CV, analisar vaga, candidaturas, simular entrevista). Roda na máquina do usuário via Docker (Linux, Windows e Mac), com dados persistidos em pasta do host fora do versionamento.

**Estado:** F01 (primeiro uso), F02 (perfis) e F03 (ingestão e GitHub) implementados: instalação por Docker, extração do currículo e de texto livre com revisão, perfis múltiplos com ênfases, cartão e persona do recrutador, ingestão do GitHub com orçamento e notificações, e backups automáticos. O plano está em `plans/plan-v0/`; a próxima entrega é o chat com o recrutador (F04), na ordem de `plans/plan-v0/tasks/README.md`.

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

Com `./start.sh dev` no ar, abra `http://127.0.0.1:5173/?token=dev-token`. O `?token=` vira cookie (`/api/auth/enter`) e a página volta para `/`, que redireciona ao passo salvo do onboarding ou ao dashboard. O Vite faz proxy de `/api` e `/ws` para a api. Fluxo do primeiro uso em 5 passos: provider → currículo (arquivo ou texto livre, com opções de OCR e leitura pelo modelo e estimativa por chamada) → extração (etapas da cadeia, também na bandeja de atividades do topo) → revisão (identidade com telefone obrigatório, propostas com origem por trecho) → perfil (dados de carreira obrigatórios, "não sei" marca para pesquisa, alerta informativo do piso DIEESE) → dashboard. Tema claro/escuro no ícone do topo; textos vêm todos de `apps/web/src/i18n/pt-BR.ts`.

Estrutura: `apps/web` (React + Vite), `apps/api` (Hono: REST, WS, enfileira jobs, CLI `narnia-jobs`), `apps/e2e` (Playwright, um arquivo por cenário: `e2e-NN-*` do F01, `f02-NN-*` do F02 e `f03-NN-*` do F03), `apps/worker` (BullMQ: cadeia de ingestão), `packages/shared` (schemas zod, contratos, tempo, i18n), `packages/core` (domínio, storage, leituras de PDF, consolidação), `packages/providers` (Claude Code via Agent SDK e mock). Metodologia: TDD, conforme `plans/plan-v0/09-metodologia-tdd.md`.
