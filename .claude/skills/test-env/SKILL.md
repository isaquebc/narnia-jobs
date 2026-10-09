---
name: test-env
description: Ambiente de testes do Claude para o narnia-jobs (instância isolada "claude"). Use sempre que for subir a aplicação, popular ou zerar dados, chamar a API, consultar o banco, rodar testes/e2e ou validar uma mudança no app; nunca use a stack do dono (./data, :5173, :3100).
---

# Ambiente de testes do Claude (`scripts/claude-env.sh`)

O dono usa a aplicação como usuário final na **instância padrão** (`make dev`: projeto Docker `narnia-jobs-helpper`,
dados em `./data`, web :5173, api :3100, token `dev-token`, provider real). Essa instância **nunca** é tocada pelo Claude.

O Claude trabalha na **instância `claude`** (valores em `.env.claude`): projeto `narnia-claude`, dados em
`./.claude-data/dev`, web :5174, api :3200, token `claude-token`, provider **mock** por padrão, Redis e
`node_modules` próprios. `.claude/settings.json` exporta `NARNIA_INSTANCE=claude` nas sessões do Claude Code, então
`./start.sh …` e `make …` chamados pelo Claude já caem nessa instância; mesmo assim, prefira a ferramenta abaixo.

| Comando | Faz |
|---------|-----|
| `scripts/claude-env.sh up` | sobe web, api, worker e redis da instância e espera a api |
| `scripts/claude-env.sh status` | containers, health, provider, pasta de dados, URL |
| `scripts/claude-env.sh seed engineer` | reset + fixture (`engineer`, `leader`, `long`; só com mock) |
| `scripts/claude-env.sh reset` | zera banco, arquivos derivados e fila |
| `scripts/claude-env.sh api GET /api/profiles` | chama a API com o token |
| `scripts/claude-env.sh sql "select …"` | consulta somente leitura no SQLite |
| `scripts/claude-env.sh test` · `lint` · `typecheck` · `build` · `e2e` | comandos do `start.sh` na instância |
| `scripts/claude-env.sh down` · `wipe` | para / remove tudo da instância |

Provider real na instância (gasta a assinatura; só quando o teste exigir):
`NARNIA_PROVIDER=claude-code scripts/claude-env.sh up` e, uma vez, `scripts/claude-env.sh cli login`.

Regras:
- Nunca rodar `docker compose` sem `-p narnia-claude`/`-p narnia-e2e`, nunca `restart`/`stop`/`down` no projeto
  `narnia-jobs-helpper`, nunca apagar ou editar `./data`.
- Navegador headless: apontar para `http://127.0.0.1:5174/?token=claude-token`.
- O e2e (`scripts/claude-env.sh e2e`) usa o projeto `narnia-e2e` e `./.e2e-data`; também não toca o dono.
