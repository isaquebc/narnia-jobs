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
- Calibração dos juízes: `scripts/claude-env.sh evals calibration [id…] [--strict]` mede falsos positivos e negativos do juiz do recrutador e do pairwise em respostas rotuladas (`evals/calibration/*.jsonl`); os avaliadores por código têm a calibração em `packages/core/test/evals/graders-calibration.test.ts`. Mudou o juiz ou o contexto dele: rode a calibração antes do gate.
- Avaliações do chat: `scripts/claude-env.sh evals [chat] [--strict] [id…]` (casos em `evals/chat/*.jsonl`; resultados no Phoenix da instância, `http://127.0.0.1:6106`: spans no projeto `narnia-evals` e um experimento por rodada no dataset `narnia-chat`). Com o mock é smoke; com `NARNIA_PROVIDER=claude-code`, avaliação real.
- **Gate de prompts (F06-14, autorizado pelo dono):** todo prompt novo ou alterado (persona, especializado, skills, notas, estruturados, juízes) passa por `NARNIA_PROVIDER=claude-code scripts/claude-env.sh evals prompts|chat … --gate` antes do commit, na assinatura, sem pedir; `--update-baseline` só sem regressão. A linha de base fica em `evals/baselines.json` (versionada). Fora isso, provider real continua só a pedido.
- **Gate pairwise (AV-5, AV-6, M7):** prompt que mudou só é trocado se for **upgrade**: com `--gate`/`--update-baseline`, cada caso compara a saída nova com a aprovada (`evals/approved/<prompt>.jsonl`, versionada) por um juiz cego (`evals/judges/pairwise.md`, ordem trocada; discordância = empate); passa com vitórias > derrotas e sem regressão nas notas. Correção de casos: `--fixes=id,…` (ganhos e nenhuma derrota). Sem aprovada = primeira aprovação; mesma versão = sem pairwise. O `--update-baseline` aprovado grava as saídas, e o boot do api ingere cada arquivo no Phoenix como experimento "aprovada". `--seed-approved` grava só a primeira aprovada dos prompts sem uma (sem pairwise, sem mexer na linha de base, nunca com rodada incompleta).
- **Gate robusto do chat (2026-10-25):** cada caso aprovado guarda as dependências (`deps`: prompts → hash, `apps/api/src/evals/chat-deps.ts`: agentes e nota do cartão sempre; notas e skills que a API injeta conforme a abertura e as tools); o pairwise só compara os casos cujas dependências mudaram, com `--samples=N` amostras (padrão 5 no gate, 3 no `--noise`); o placar soma as amostras (decisão do dono 2026-10-26: a maioria por caso, com 2 casos afetados, invertia o veredito da mesma versão entre rodadas). O lado A são amostras novas da versão aprovada (plugin extraído do commit que gravou a aprovada, `approved-plugin.ts`, válido só se reproduz as `deps`); a saída guardada é só o recurso sem esse commit, porque ela venceu o gate anterior e fica acima da média (ganhou 7 de 7 casos decididos num A contra A). `evals chat --noise` é o teste A contra A (casos sem mudança, N amostras novas de cada lado): grava `ruido:narnia-chat` na linha de base (`decisivos_por_amostra`), que dá a margem do pairwise (saldo ≥ ⌈√(taxa de pares decididos pelo acaso · pares julgados)⌉) e a tolerância das médias (a maior entre 5 pontos e a variação medida). Rode o `--noise` de novo quando mudar o juiz ou os casos. **Retomada (2026-10-28):** no gate (`--gate`, `--update-baseline`, `--noise`), cada conversa terminada e cada julgamento vão para `evals/.checkpoint/narnia-chat.json` (fora do git) assim que terminam; o primeiro erro do modelo (limite de uso, turno sem resposta) para a rodada, e o mesmo comando retoma de onde parou se prompts, casos, aprovadas, juízes e opções forem os mesmos (`--fresh` começa do zero). O arquivo é apagado quando a rodada grava a linha de base. **Gate dos estruturados com amostras (2026-10-29):** `evals prompts` usa o mesmo método: o prompt que mudou roda cada caso `--samples=N` vezes (padrão 5, uma repetição por experimento do Phoenix, uma depois da outra: a ponte atende 2 chamadas) contra N amostras da versão aprovada (achada pelo hash no histórico de versões do Phoenix; sem ela, a saída guardada); `--feature=id,…` vale para os casos do dataset de cada prompt; `--noise` mede `ruido:<prompt>` só nos prompts iguais à aprovada (3 + 3 repetições); erro passageiro da ponte tenta a repetição de novo até 2 vezes; retomada em `evals/.checkpoint/narnia-prompts.json`. **Não-inferioridade (`--feature=id,…`, decisão do dono 2026-10-25):** mudança que acrescenta funcionalidade declara os casos novos (sem aprovada); cada um passa se a maioria das amostras passa em todos os avaliadores e o juiz não reprova (≥ parcial), e os casos antigos afetados passam com derrotas − vitórias < margem do ruído. Mudança que altera comportamento existente continua precisando ser upgrade. **Aprovação do dono (`--owner-approved`, 2026-10-26):** só quando o gate reprovou e o dono aprovou explicitamente na conversa; com `--update-baseline`, grava a linha de base e as aprovadas apesar da regressão ou do pairwise (o motivo sai no log; rodada incompleta não grava) e a decisão vai para o plano. Nunca por iniciativa do Claude.

## Recrutador global e vagas (F06)

- O chat é global (F06-8): `chat_session.profile_id` é só contexto; o recrutador geral recebe os cartões de todos os perfis e chama o subagente `recrutador-especializado` (`plugin/agents/recrutador-especializado.md`, mesmo arquivo nos modos A e B). No modo A o subagente roda dentro do turno (`CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1`).
- Página da vaga: na coluna da pré-análise, os assets (CV e carta pequenos, baixar, "Regerar com mensagem" → `POST /api/documents/:id/feedback` abre a conversa da vaga com a nota `documento-feedback-contexto.md`) e os contatos (fixado + dois últimos, modal com LinkedIn; duplicata por LinkedIn ou e-mail = 409).
- Vagas: domínio `posting` (`job` é a fila). Link de vaga: fetch simples, JSON-LD e, se falhar, o serviço `browser` (Chromium headless, rede só com o api e o worker, `NARNIA_BROWSER_WS`; no e2e o api não usa, o worker usa para os PDFs). Heurística sem tokens em `packages/core/src/postings/`; extração, junção e duplicata pelo modelo na tarefa `posting.extract`; análise numa conversa `job` com a skill `analisar-vaga`. Plano e decisões F06-1 a F06-17 em `plans/plan-v0/tasks/F06-analisar-vaga.md`.

## Currículo e carta (F05)

- Documento (`document`/`document_version`, migração 0015) por (tipo, perfil, vaga); o conteúdo JSON é a verdade, PDF e prévias (`<dados>/documents/<id>/v<n>/`) são derivados. Um pedido só (`requestDocument`) para botão, "Atualizar" e as tools `cv.*`; edição e troca de modelo (`editDocument`, `changeDocumentLayout`) viram `cv.render`, sem o gerador.
- Tarefa `cv.generate` (fila `extract`): resumo pelo código (`buildCvBrief`, score de match, ocultos, roteiro, lacunas) → Sonnet escreve só textos e origens (`narnia-cv-generate`, `narnia-cover-letter-generate`) → `assembleCv` confere origem, tecnologia e termo sem evidência → link morto nos dados sai do PDF com aviso (`pruneDeadLinks`) → PDF no `browser` só com `data:` (fontes inline) → checagens por código (layout, links F05-23, ATS ≥ 90) → Haiku revisa as páginas pela tool `Read` (`narnia-cv-review`) → uma regeração automática; reprovou de novo, `ready_with_issues` com aviso.
- O gerador recebe ids curtos (`aliasBriefIds`: e1, a3, s12…), o idioma dos dados (`sourceLocale`; igual ao do documento, cargo/local/curso saem como nos dados) e os anos de experiência já calculados. Voltar a um modelo já montado a partir do mesmo texto (mesma origem: última versão gerada ou editada) reaproveita a versão; "Tentar de novo" (`fixIssues`) refaz com os erros da versão atual.
- Templates do usuário: só o `.zip` em `<dados>/templates/` (backup copia; restauração devolve); validação `template.validate`; JavaScript desligado e rede bloqueada. Formato em `docs/templates-de-cv.md`.
- Avaliações: `narnia-cv-generate`/`narnia-cover-letter-generate` em `evals prompts`; o revisor com imagens em `scripts/claude-env.sh evals cv-review` (gate também). Plano e decisões F05-1 a F05-23 em `plans/plan-v0/tasks/F05-gerar-cv.md`.
