# narnia-jobs · instruções para o Claude

Idioma: responder e documentar em pt-BR. Plano em `plans/plan-v0/` (tasks em `plans/plan-v0/tasks/`); TDD obrigatório
(`plans/plan-v0/09-metodologia-tdd.md`); tudo roda em Docker (nada de Node/pnpm no host).

## RUN local: duas instâncias do mesmo código

| | Dono (usuário final) | Claude (testes e desenvolvimento) |
|---|---|---|
| Como sobe | `make dev` / `./start.sh dev` | `scripts/claude-env.sh up` (skill `test-env`) |
| Projeto Docker | `narnia-jobs-helpper` | `narnia-claude` (dev), `narnia-claude-prod` (up), `narnia-e2e` (e2e) |
| Dados | `./data` | `./.claude-data/` |
| Portas | web 5173, api 3100, Phoenix 6006 | web 5174, api 3200, Phoenix 6106 (prod 3250–3299, OAuth 8189) |
| Token | `dev-token` | `claude-token` |
| Provider | Claude Code real | mock (real só com `NARNIA_PROVIDER=claude-code`) |

Seleção: `NARNIA_INSTANCE=claude` carrega `.env.claude` em `start.sh`/`start.ps1`; os valores do arquivo vencem o
ambiente (exceto `NARNIA_PROVIDER`). `.claude/settings.json` exporta essa variável em todas as sessões do Claude Code.

**Backups do dono:** `./backups` (raiz do projeto) pertence ao dono e **nunca** é lido, alterado, podado ou apagado pelo Claude; a instância `claude` usa `./.claude-data/backups`. `./start.sh restore` na instância do dono **só a pedido explícito do dono**; para testar restauração, use `scripts/claude-env.sh restore` na instância `claude`.

**Regra inegociável:** tudo que o Claude faz (subir, reiniciar, resetar, semear, migrar, testar, e2e, navegador) afeta
**somente** a instância `claude`. Nunca parar, reiniciar ou recriar containers do projeto `narnia-jobs-helpper`, nunca
ler/escrever/apagar `./data`, nunca usar as portas 5173/3100 nem o token `dev-token`. O dono usa a versão mais recente
do código já pronta e não pode perder dados entre testes.

**Código da instância do dono (`.owner-src`, decisão CM-4):** o Claude trabalha sempre na raiz. A instância do dono roda
de `.owner-src`, uma worktree git que só muda por `./start.sh promote` (ou `.\start.ps1 promote`), então edições em
andamento não chegam a ela. Ao fechar um marco verde (lint, typecheck, testes, e2e), o Claude **avisa o dono** para
rodar `./start.sh promote` e, se mudaram dependências, composes ou a imagem, `make dev-down && make dev`. O Claude
**nunca roda `promote`** (a ferramenta recusa na instância `claude`) nem reinicia a instância do dono. Sem `.owner-src`
(antes do primeiro `promote`), a instância do dono monta a raiz e recebe as edições pelo hot reload, como antes.

## Comandos

- Ferramenta de testes: `scripts/claude-env.sh help` (detalhes na skill `.claude/skills/test-env/SKILL.md`).
- Qualidade: `scripts/claude-env.sh lint|typecheck|test|build`; e2e: `scripts/claude-env.sh e2e` (`--ui-only --grep X`).
- Lançadores: `scripts/test/*.bats` e `scripts/test/start.Tests.ps1` (`./start.sh test:sh`).
- Commits só quando o dono pedir; push só quando o dono pedir.

## Modo B, Phoenix e avaliações (F04)

- **Nunca** rodar `install-plugin` contra o Claude Code real do dono: nos testes, `HOME` temporário e `NARNIA_CLAUDE_BIN` falso (a instância `claude` usa os nomes `narnia-jobs-claude`/`narnia-jobs-claude-local`).
- `scripts/smoke-plugin.sh --yes` (E2E-09) usa a assinatura de quem roda: só a pedido do dono.
- Prompts e avaliadores no Phoenix (tarefa `plans/plan-v0/tasks/F04-avaliacoes-phoenix.md`): o api registra a ponte da assinatura e sincroniza prompts, datasets e avaliadores no boot; `scripts/claude-env.sh evals prompts|chat|pdf|cv-review|all` (chat e pdf num banco temporário isolado, apagado no fim; cv-review monta PDFs no `browser`; mock = smoke; real só a pedido).
- Avaliações do chat: `scripts/claude-env.sh evals [chat] [--strict] [id…]` (casos em `evals/chat/*.jsonl`; resultados no Phoenix da instância, `http://127.0.0.1:6106`: spans no projeto `narnia-evals` e um experimento por rodada no dataset `narnia-chat`). Com o mock é smoke; com `NARNIA_PROVIDER=claude-code`, avaliação real.
- **Gate de prompts (F06-14, autorizado pelo dono):** todo prompt novo ou alterado (persona, especializado, skills, notas, estruturados, juízes) passa por `NARNIA_PROVIDER=claude-code scripts/claude-env.sh evals prompts|chat … --gate` antes do commit, na assinatura, sem pedir; `--update-baseline` só sem regressão. A linha de base fica em `evals/baselines.json` (versionada). Fora isso, provider real continua só a pedido.

## Recrutador global e vagas (F06)

- O chat é global (F06-8): `chat_session.profile_id` é só contexto; o recrutador geral recebe os cartões de todos os perfis e chama o subagente `recrutador-especializado` (`plugin/agents/recrutador-especializado.md`, mesmo arquivo nos modos A e B). No modo A o subagente roda dentro do turno (`CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1`).
- Vagas: domínio `posting` (`job` é a fila). Link de vaga: fetch simples, JSON-LD e, se falhar, o serviço `browser` (Chromium headless, rede só com o api e o worker, `NARNIA_BROWSER_WS`; no e2e o api não usa, o worker usa para os PDFs). Heurística sem tokens em `packages/core/src/postings/`; extração, junção e duplicata pelo modelo na tarefa `posting.extract`; análise numa conversa `job` com a skill `analisar-vaga`. Plano e decisões F06-1 a F06-17 em `plans/plan-v0/tasks/F06-analisar-vaga.md`.

## Currículo e carta (F05)

- Documento (`document`/`document_version`, migração 0015) por (tipo, perfil, vaga); o conteúdo JSON é a verdade, PDF e prévias (`<dados>/documents/<id>/v<n>/`) são derivados. Um pedido só (`requestDocument`) para botão, "Atualizar" e as tools `cv.*`; edição e troca de modelo (`editDocument`, `changeDocumentLayout`) viram `cv.render`, sem o gerador.
- Tarefa `cv.generate` (fila `extract`): resumo pelo código (`buildCvBrief`, score de match, ocultos, roteiro, lacunas) → Sonnet escreve só textos e origens (`narnia-cv-generate`, `narnia-cover-letter-generate`) → `assembleCv` confere origem, tecnologia e termo sem evidência → link morto nos dados sai do PDF com aviso (`pruneDeadLinks`) → PDF no `browser` só com `data:` (fontes inline) → checagens por código (layout, links F05-23, ATS ≥ 90) → Haiku revisa as páginas pela tool `Read` (`narnia-cv-review`) → uma regeração automática; reprovou de novo, `ready_with_issues` com aviso.
- O gerador recebe ids curtos (`aliasBriefIds`: e1, a3, s12…), o idioma dos dados (`sourceLocale`; igual ao do documento, cargo/local/curso saem como nos dados) e os anos de experiência já calculados. Voltar a um modelo já montado a partir do mesmo texto (mesma origem: última versão gerada ou editada) reaproveita a versão; "Tentar de novo" (`fixIssues`) refaz com os erros da versão atual.
- Templates do usuário: só o `.zip` em `<dados>/templates/` (backup copia; restauração devolve); validação `template.validate`; JavaScript desligado e rede bloqueada. Formato em `docs/templates-de-cv.md`.
- Avaliações: `narnia-cv-generate`/`narnia-cover-letter-generate` em `evals prompts`; o revisor com imagens em `scripts/claude-env.sh evals cv-review` (gate também). Plano e decisões F05-1 a F05-23 em `plans/plan-v0/tasks/F05-gerar-cv.md`.
