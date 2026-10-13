# F04 · Avaliações de prompts no Phoenix

Extensão da F04 pedida pelo dono em 2026-10-13: **todos os prompts versionados no Phoenix, com avaliadores salvos lá e rodáveis pelo Phoenix**, servindo de teste de prompt e de garantia do padrão de entrega das respostas.

Status: **M1–M5 implementados** (2026-10-13, provados com o mock na instância `claude`); falta a rodada com o Claude real (custa a assinatura: só a pedido do dono). M6: README, CLAUDE.md, E2E-17.

## 1 · Decisões do dono

| # | Decisão | Data |
|---|---------|------|
| AV-1 | Conteúdo das conversas vai para o Phoenix local por padrão (`NARNIA_OTEL_CONTENT=0` desliga). | 2026-10-13 |
| AV-2 | O Phoenix chama o modelo por uma **ponte pela assinatura** (endpoint compatível com a API de mensagens da Anthropic, servido pela api com o Agent SDK). Configurável no Phoenix (AI Providers: editar a ponte ou usar uma chave de API) e no menu Configurações › Avaliações. | 2026-10-13 |
| AV-3 | Os prompts que dependem das tools do `/mcp` (recrutador, notas, skills) rodam pelo nosso comando num **perfil temporário** criado das fixtures e apagado no fim (conversas, fontes e ingestões junto); assim a rodada vale também na instância do dono sem tocar no perfil real. | 2026-10-13 |
| AV-4 | O repositório continua a fonte dos prompts; a sincronização cria uma versão no Phoenix por mudança (metadata com o commit) e a tag `production` marca a versão em uso. O app nunca lê prompt do Phoenix. | proposta aceita em 2026-10-13 |
| AV-3 (revisão) | **Premissa errada:** os fatos (experiências, formação, skills) são do usuário, não do perfil; um perfil temporário não isola nada. **Decisão do dono: banco temporário isolado** (SQLite descartável com fixture fictícia, app e `/mcp` próprios em 127.0.0.1, token próprio, apagado no fim). | 2026-10-13 |

## 2 · Viabilidade (verificada no código do Phoenix 20.21)

- Provedor Anthropic customizado aceita `baseUrl`, `defaultHeaders` e `apiKey`; o Playground usa o cliente oficial (`messages.create` e `messages.stream`).
- `response_format` json_schema vira `output_config.format` (mesmo formato do `outputFormat` do Agent SDK).
- Avaliadores de código versionados (`createCodeEvaluator`/`createCodeEvaluatorVersion`) rodam em TypeScript no sandbox Deno local da imagem (`deno run --no-remote --no-npm`, sem rede): função `evaluate({ output, reference, input, metadata })`, arquivo único sem imports.
- Avaliadores do dataset (`createDatasetCodeEvaluator`, `createDatasetLlmEvaluator`) rodam sozinhos só nos experimentos do Playground; nos experimentos do nosso comando, rodamos o mesmo arquivo e gravamos por `/v1/experiment_evaluations`.
- Limites: temperatura/top_p/stop ignorados pela ponte (avisados); histórico de várias mensagens vira transcrição; cada chamada abre um processo do CLI (concorrência limitada, 429 quando lota); consumo da cota da assinatura; uso pessoal e local (a ponte só escuta na rede dos containers e no 127.0.0.1, com chave, desligável).

## 3 · Marcos

1. **M1 · Ponte e Configurações › Avaliações:** `POST /bridge/anthropic/v1/messages` (com e sem streaming, saída estruturada, uso), chave própria, concorrência, liga/desliga, modelo padrão, registro do provedor no Phoenix, chave de API opcional no Phoenix.
2. **M2 · Prompts versionados:** sincronização dos 17 prompts (8 estruturados, persona, 3 notas, 5 skills) com tag `production`.
3. **M3 · Datasets e avaliadores de código** dos 8 prompts estruturados, versionados no Phoenix e presos aos datasets.
4. **M4 · Juízes** (avaliadores com modelo) com o padrão de entrega de cada prompt.
5. **M5 · Comando dos prompts com tools** em perfil temporário, experimentos com os mesmos avaliadores.
6. **M6 · Documentação e e2e.**

## 4 · Registro

| Data | Marco | Nota |
|------|-------|------|
| 2026-10-13 | M1 | Ponte `POST /bridge/anthropic/v1/messages` (com e sem streaming, saída estruturada por `output_config`, uso no medidor como `avaliacao.ponte`, chave própria em `x-api-key`/Bearer, nunca o token de boot, concorrência com fila curta e 429, liga/desliga, parâmetros ignorados avisados) sobre `provider.complete` (Agent SDK sem tools e sem configurações do usuário; mock determinístico com o menor objeto do schema). Configurações › Avaliações (estado, chave, trocar chave, registrar no Phoenix, chave de API opcional como segredo do Phoenix). Provado: teste de credenciais do Phoenix (`messages.create`) passa pela ponte. |
| 2026-10-13 | M2 | `STRUCTURED_PROMPTS` (fonte única: system do `.md`, template do usuário, variáveis, modelo, schema, tools); o provider renderiza o mesmo template (testes antigos de prompt verdes). Catálogo dos 17 prompts e sincronização (cria; hash diferente = versão nova; tag `production`; `customProviderId` da ponte; commit na descrição); setup no boot (registra a ponte se faltar, sincroniza) e botão. Provado: 17 prompts no Phoenix, segunda rodada sem mudança. |
| 2026-10-13 | M3 | Avaliadores de código no core (`prompt-evaluators/`: json_schema, citações literais, anos, idioma, limite de arquivos, vereditos, ids de apoio, cobertura com termos proibidos), publicados como arquivo TypeScript único (teste: o arquivo roda sozinho e dá o mesmo resultado do módulo); datasets tipados dos 8 prompts (casos difíceis: sem datas, inglês, instrução escondida, proposta sem sustentação); 8 datasets e 27 avaliadores no Phoenix (Deno), presos aos datasets. Provado: experimento pelo Phoenix (`chatCompletionOverDataset`) com a ponte e os avaliadores rodando sozinhos. |
| 2026-10-13 | M4 | Juízes `padrao_de_entrega` (`evals/judges/<prompt>.md`, rótulos atende/parcial/nao_atende, variáveis por JSONPath do contexto); a ponte emula a tool forçada dos juízes (saída estruturada → `tool_use`). Provado: pré-visualização do juiz pela ponte e experimento com o juiz. `evals/` entra na imagem (Dockerfile e `.dockerignore`). |
| 2026-10-13 | M5 (estruturados) | `narnia-jobs evals prompts [nome…] [--strict]` (`./start.sh`/`.\start.ps1 evals prompts`, `scripts/claude-env.sh evals prompts`): sincroniza e roda os 7 prompts estruturados sem tools como experimentos do Phoenix, com resumo por avaliador. Não grava dados do usuário. Bats 53/53, Pester 31/31. |
| 2026-10-13 | M5 (sandbox) | `openEvalSandbox` (banco descartável + fixture `engineer` + app completa com fila sem worker + servidor em 127.0.0.1:porta livre + token próprio; `close` derruba e apaga). `narnia-jobs evals chat|pdf|all` (`./start.sh`, `.\start.ps1`, `scripts/claude-env.sh evals`): conversas de referência no sandbox com regras sem tokens + juiz do recrutador (`evals/judges/narnia-recrutador.md`, preso ao `narnia-chat` para versionar), experimento no Phoenix; leitura do PDF fictício (`evals/fixtures/cv_text.pdf`) com avaliadores de código e juiz, experimento no `narnia-read-document`. Juízes fora do Playground rodam pela assinatura com o mesmo texto e variáveis (`judgeLocally`). Rastros no projeto `narnia-evals`. Provado na instância `claude`: 4/4 conversas e PDF com experimentos no Phoenix; banco da instância intacto (mesmas sessões), nenhuma pasta temporária sobrando. O script antigo `scripts/evals-chat.ts` saiu (o `evals` sem subcomando agora é o chat no sandbox). Limite: as 5 skills do terminal só rodam no Claude Code (modo B); ficam versionadas no Phoenix, sem rodada. |

