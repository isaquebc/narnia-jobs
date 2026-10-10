# narnia-jobs · instruções para o Claude

Idioma: responder e documentar em pt-BR. Plano em `plans/plan-v0/` (tasks em `plans/plan-v0/tasks/`); TDD obrigatório
(`plans/plan-v0/09-metodologia-tdd.md`); tudo roda em Docker (nada de Node/pnpm no host).

## RUN local: duas instâncias do mesmo código

| | Dono (usuário final) | Claude (testes e desenvolvimento) |
|---|---|---|
| Como sobe | `make dev` / `./start.sh dev` | `scripts/claude-env.sh up` (skill `test-env`) |
| Projeto Docker | `narnia-jobs-helpper` | `narnia-claude` (dev), `narnia-claude-prod` (up), `narnia-e2e` (e2e) |
| Dados | `./data` | `./.claude-data/` |
| Portas | web 5173, api 3100 | web 5174, api 3200 (prod 3250–3299, OAuth 8189) |
| Token | `dev-token` | `claude-token` |
| Provider | Claude Code real | mock (real só com `NARNIA_PROVIDER=claude-code`) |

Seleção: `NARNIA_INSTANCE=claude` carrega `.env.claude` em `start.sh`/`start.ps1`; os valores do arquivo vencem o
ambiente (exceto `NARNIA_PROVIDER`). `.claude/settings.json` exporta essa variável em todas as sessões do Claude Code.

**Backups do dono:** `./backups` (raiz do projeto) pertence ao dono e **nunca** é lido, alterado, podado ou apagado pelo Claude; a instância `claude` usa `./.claude-data/backups`. `./start.sh restore` na instância do dono **só a pedido explícito do dono**; para testar restauração, use `scripts/claude-env.sh restore` na instância `claude`.

**Regra inegociável:** tudo que o Claude faz (subir, reiniciar, resetar, semear, migrar, testar, e2e, navegador) afeta
**somente** a instância `claude`. Nunca parar, reiniciar ou recriar containers do projeto `narnia-jobs-helpper`, nunca
ler/escrever/apagar `./data`, nunca usar as portas 5173/3100 nem o token `dev-token`. O dono usa a versão mais recente
do código pelo hot reload da instância dele e não pode perder dados entre testes. Mudanças de código chegam à instância
do dono sozinhas (hot reload); migrations rodam no boot da api dela quando o dono reiniciar. Se uma mudança exigir
reiniciar a instância do dono (dependência nova, migration urgente), **avisar o dono e deixar que ele reinicie**.

## Comandos

- Ferramenta de testes: `scripts/claude-env.sh help` (detalhes na skill `.claude/skills/test-env/SKILL.md`).
- Qualidade: `scripts/claude-env.sh lint|typecheck|test|build`; e2e: `scripts/claude-env.sh e2e` (`--ui-only --grep X`).
- Lançadores: `scripts/test/*.bats` e `scripts/test/start.Tests.ps1` (`./start.sh test:sh`).
- Commits só quando o dono pedir; push só quando o dono pedir.
