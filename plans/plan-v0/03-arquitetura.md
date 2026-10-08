# 03 · Arquitetura

Leia antes `01-viabilidade.md`, `07-dois-modos.md` e `08-docker-calendar-voz.md`. **Decisão de 2026-10-06: o sistema roda em Docker** (compose), com dados persistidos em bind mount no host e o login da assinatura em volume nomeado. Isso muda o transporte do MCP para HTTP (ver §1 e §12). A arquitetura abaixo descreve o **núcleo compartilhado e o modo plugin (B)**; o **modo wrapper (A)** acrescenta a rota `/chat` na UI web e o pacote `providers/claude-code`, que carrega o mesmo `plugin/` pelo Agent SDK. Tudo que vale para B vale para A.

---

## 1 · Visão geral

```
┌──────────────────────────── máquina do usuário ─────────────────────────────┐
│                                                                              │
│  ┌──────────────────────┐   stdio (MCP)   ┌──────────────────────────────┐   │
│  │ Claude Code (CLI /   │◄───────────────►│ narnia-mcp                    │   │
│  │ app desktop)         │                 │  tools: profile.* evidence.*  │   │
│  │  + plugin "narnia"   │                 │  ingest.* applications.*      │   │
│  │    skills, agente,   │                 │  documents.*                  │   │
│  │    hooks             │                 └───────────────┬──────────────┘   │
│  └──────────┬───────────┘                                 │                  │
│             │ assinatura do usuário                       │ narnia-core      │
│             ▼                                             ▼                  │
│      API da Anthropic                     ┌──────────────────────────────┐   │
│                                           │ SQLite (WAL) + arquivos       │   │
│  ┌──────────────────────┐                 │ ~/.local/share/narnia-jobs/   │   │
│  │ Codex CLI (futuro)   │◄── MCP ────────►│                              │   │
│  │  + AGENTS.md gerado  │                 └───────────────▲──────────────┘   │
│  └──────────────────────┘                                 │                  │
│                                                           │ narnia-core      │
│  ┌──────────────────────┐    HTTP/WS      ┌───────────────┴──────────────┐   │
│  │ navegador            │◄───────────────►│ narnia-ui (servidor local)    │   │
│  │ http://127.0.0.1:…   │                 │  API REST + SPA               │   │
│  │  (modo A: /chat)     │                 │  modo A: Agent SDK carrega    │   │
│  └──────────────────────┘                 │  plugin/ + .mcp.json ────────┼──►│ narnia-mcp
│                                           └──────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────────┘
```

Vários containers (decisão de 2026-10-07), um núcleo:
- **api**: Hono; REST, WebSocket, o chat do modo A (Agent SDK + CLI instalados na imagem) e o **servidor MCP via streamable HTTP** em `/mcp`. No modo B, o Claude Code do host conecta em `http://127.0.0.1:<porta>/mcp`.
- **worker** (um ou mais): processadores **BullMQ** para ingestão, OCR, extração pelo modelo, clarificação, geração de CV e demais jobs; mesma imagem da api, comando diferente; escala por tipo de fila.
- **web**: a SPA buildada servida por nginx (em desenvolvimento, Vite com hot reload em container próprio).
- **redis**: filas BullMQ, eventos de progresso (pub/sub) e locks.
- serviços futuros por task: `ocr` dedicado se Tesseract pesar, `whisper` (F08), `renderer` com Chromium (F05).
- **narnia-core**: biblioteca compartilhada (domínio, storage, ingestão determinística, geração de documentos).
- **plugin/**: pasta instalada no host (modo B) e carregada pelo SDK dentro da api (modo A); seu `.mcp.json` aponta para a URL acima.

O diagrama acima mostra o desenho lógico; o físico, com volumes e portas, está em §12. O stdio foi descartado porque, com os dados dentro dos containers, o Claude Code do host não teria como iniciar o processo MCP. **O host só precisa de Docker**: desenvolvimento, testes e CI rodam em containers.

## 2 · Estrutura do repositório (monorepo TypeScript)

Refinada em `tasks/F01-onboarding.md §2.2` (2026-10-06): stack React + Node, com `apps/` separando site e API.

```
narnia-jobs-helpper/
├─ apps/
│  ├─ web/         React 19 + Vite + TanStack Router/Query + Tailwind + shadcn/ui (SPA)
│  └─ api/         Hono + WebSocket; hospeda o Agent SDK (modo A), o MCP via HTTP (/mcp) e serve a SPA em produção
├─ packages/
│  ├─ core/        domínio, storage (node:sqlite + migrations SQL), extração de texto, digest, validações
│  └─ shared/      schemas zod, tipos e contratos de API compartilhados entre web e api
├─ plugin/         plugin do Claude Code (ver §4): .claude-plugin/, .mcp.json, skills/, agents/, hooks/
├─ adapters/
│  └─ codex/       gera AGENTS.md + config.toml a partir das mesmas skills (futuro)
├─ docker/         Dockerfile multi-stage, entrypoint.sh
├─ docker-compose.yml
└─ plans/          planos por versão (plan-v0 = descoberta); plans/plan-v0/tasks/ = entregáveis por fluxo
```

Stack: Node ≥ 22.13 (`node:sqlite` sem flag), TypeScript, pnpm workspaces + Turborepo, Biome, Vitest (unitários), Playwright (e2e). Sem módulos nativos. PDF: `unpdf` (leitura) e impressão do navegador (exportação); DOCX: `docx` (geração) e `mammoth` (leitura).

## 3 · Armazenamento

Pasta de dados resolvida com `env-paths` (ou equivalente), sobrescrevível por `NARNIA_DATA_DIR`:

```
<data-dir>/
├─ narnia.sqlite (+ -wal, -shm)
├─ uploads/            CVs e exports originais (nome original + hash)
├─ digests/            registro de contexto por arquivo (resumo, pontos principais, índice de seções, texto extraído)
├─ snapshots/          READMEs e metadados coletados do GitHub (reuso sem rede)
├─ exports/            documentos gerados (PDF/DOCX)
└─ config.json         provider ativo, modelos padrão, token do GitHub (perm. 0600)
```

Tabelas principais: `user`, `profile`, `profile_emphasis`, `experience`, `achievement`, `project`, `skill`, `skill_evidence`, `education`, `certification`, `language`, `publication`, `preference`, `fact_source`, `source_file`, `file_digest`, `ingestion_run`, `ingestion_proposal`, `application`, `application_event`, `calendar_link`, `document`, `document_version`, `interview_session`, `interview_turn`, `chat_log` (opcional, só metadados de uso).

Nada disso vive no repositório. `.gitignore` inclui `*.sqlite*`, `uploads/`, `exports/` por garantia.

## 4 · Plugin do Claude Code

| Componente | Função | Custo em tokens |
|------------|--------|-----------------|
| `agents/recrutador.md` | persona do recrutador sênior; instruções de honestidade, citar fonte, marcar inferência; proibido inventar | carregado só quando usado |
| `skills/recrutador` | ponto de entrada `/narnia:recrutador` para iniciar a conversa de carreira | pequeno |
| `skills/perfil` | `/narnia:perfil <nome>` → `profile.switch` e recarrega o cartão | pequeno |
| `skills/ingerir` | `/narnia:ingerir cv|github|linkedin --profundidade rapida|equilibrada|profunda` | ver §6 |
| `skills/gerar-cv`, `analisar-vaga`, `entrevista`, `candidaturas` | uma skill por feature, cada uma dizendo quais tools usar | só quando invocada |
| `hooks/hooks.json` | `SessionStart`: lê perfil ativo e injeta cartão (~300 tokens) + lembrete de persona | ~350 tokens por sessão |
| `.mcp.json` | `{ "narnia-jobs": { "type": "http", "url": "http://127.0.0.1:3100/mcp" } }` | 0 |

Desenho de persona: a especialidade do recrutador deriva do perfil (`cargo-alvo`, `área`, `senioridade`, `mercado`), montada pelo hook a partir do banco. Trocar perfil = trocar recrutador.

## 5 · Servidor MCP: tools e lazy load

Regra: o modelo recebe no máximo o **cartão do perfil** sem pedir. Todo o resto vem por tool, em fatias pequenas e paginadas.

| Grupo | Tools | Notas |
|-------|-------|-------|
| profile | `profile.list`, `profile.get_card`, `profile.switch`, `profile.update_emphasis`, `profile.create` | o cartão é cacheado e invalidado em qualquer escrita |
| evidence | `experience.list/get/upsert`, `project.list/get/upsert`, `skill.list/upsert`, `education.list/upsert`, `achievement.add` | `list` devolve resumos de 1 linha; `get` o detalhe |
| facts | `fact.search(q)`, `fact.verify(id)`, `fact.unverified(limit)` | busca FTS5 no SQLite |
| research | `research.save(url, title, excerpt, used_for)` + tool nativa **WebSearch** liberada para o agente recrutador | só para preencher dados obrigatórios que o usuário não sabe; fontes confiáveis, sempre citadas |
| jobs | `job.status(id)`, `job.list(profile)` | o agente informa o andamento de ingestões em segundo plano |
| session | `session.set_category(cat)` | categoria alimenta o medidor e o "limpar cache" |
| ingest | `ingest.prepare(source, depth)`, `ingest.next_chunk(run)`, `ingest.propose(run, facts[])`, `ingest.set_digest(run, file, digest)`, `ingest.finish(run)` | ver §6 |
| files | `file.list`, `file.get_digest(id)`, `file.get_text(id, from, to)` | o digest (~200–400 tokens) substitui reabrir o arquivo; texto só por trecho |
| calendar | (externo) `create_event`, `list_events`, `suggest_time`… do MCP oficial do Google, quando conectado | ver `08 §2`; a skill `candidaturas` só os usa se existirem |
| applications | `application.list/get/create/update_status/add_note` | alimenta o kanban |
| documents | `document.save(type, markdown, params)`, `document.list/get` | a UI exporta PDF/DOCX |
| interview | `interview.start/record_turn/finish` | histórico de simulações, inclusive as por voz (texto transcrito) |
| usage | `usage.log(tokens_in, tokens_out, model, feature)` | opcional; alimenta o medidor da UI |

Cada skill de feature declara em seu texto exatamente quais tools usar, e o plugin pode restringir ferramentas por agente (`tools:` no frontmatter do agente). Isso é o "lazy load" na prática.

## 6 · Ingestão: velocidade × profundidade

A ingestão divide trabalho entre **código determinístico (0 tokens)** e **extração pelo modelo (tokens)**. A profundidade controla só a segunda parte.

Pré-processamento no `core`, sem modelo:
- CV em PDF: **três leituras consolidadas** (decisão de 2026-10-07): (1) extração de texto da camada de texto (`unpdf`); (2) **OCR** das páginas renderizadas (Tesseract, por+eng), sempre que a camada de texto for pobre ou divergir; (3) **leitura do documento pelo modelo** (o PDF é entregue ao modelo via tool `Read`, que lê PDFs, para extração ciente de layout). Um consolidador alinha os três por seção, resolve divergências por voto e confiança e produz o texto canônico + mapa de origem por trecho. DOCX/MD: só (1), e (3) quando a confiança ficar baixa. Normalizar, detectar seções, datas e e-mails.
- GitHub: API REST (token opcional, aumenta limite): lista de repos, linguagens, estrelas, datas, tópicos, README, contribuições; opcionalmente `git clone --depth 1` para amostragem de arquivos.
- LinkedIn export: CSVs já estruturados (Positions, Skills, Education, Certifications): quase tudo vira fato sem modelo.

| Nível | O que vai para o modelo | Modelo sugerido | Estimativa* |
|-------|-------------------------|-----------------|-------------|
| Rápida | CV: texto inteiro em 1 passada. GitHub: tabela de repos + primeiras 60 linhas de cada README (até 20 repos) | Haiku | 5–15k tokens, 1–2 chamadas |
| Equilibrada | + README completo dos 10 repos mais relevantes, estatísticas de commits, árvore de arquivos resumida | Haiku/Sonnet | 20–50k tokens, 5–10 chamadas |
| Profunda | + amostra de código por repo (arquivos de entrada, configs, testes), resumo por repo e síntese cruzada (padrões, nível técnico aparente) | Sonnet | 60–150k tokens, 15–30 chamadas |

\*Estimativas de ordem de grandeza para calibrar a UI; medir na implementação. A tool `ingest.prepare` devolve a estimativa real (contagem de caracteres/4) antes de qualquer chamada, e a skill exige confirmação do usuário.

Fluxo técnico:
```
ingest.prepare(source, depth)  → cria ingestion_run, pré-processa, devolve {estimativa, n_chunks}
loop: ingest.next_chunk(run)   → devolve um chunk; o modelo extrai fatos e chama ingest.propose(run, facts)
ingest.finish(run)             → marca para revisão
revisão                        → na UI web (tela L3) ou por chat ("aceite tudo exceto...")
```
Toda proposta nasce com `confiança` e `fonte`; só vira fato após aceite.

**Registro de contexto do arquivo (digest).** Em toda extração de arquivo, o modelo também produz e grava via `ingest.set_digest`: resumo em prosa (~200–400 tokens), lista de pontos principais (cargos, empresas, períodos, tecnologias, formação, idiomas, links), índice de seções com offsets no texto extraído e metadados (páginas, idioma detectado, data do documento). O texto extraído fica em `digests/` junto. Regra: nenhuma skill reabre o arquivo; usa `file.get_digest` e, se precisar citar, `file.get_text` por trecho.

## 7 · Economia de tokens (checklist de projeto)

1. Cartão do perfil como único contexto implícito (~300 tokens), recalculado em escrita.
2. Tools devolvem resumos de uma linha por padrão; detalhe sob demanda.
3. Haiku para extração, Sonnet para conversa e documentos; Opus nunca por padrão.
4. Ingestão em chunks com estimativa prévia e confirmação.
5. Agente recrutador sem ferramentas de sistema de arquivos/Bash (evita "passeios" caros). **WebSearch** é a única tool nativa liberada, e só para dados obrigatórios que o usuário não sabe.
6. Documentos gerados em Markdown; exportação para PDF/DOCX é código, não modelo.
7. Medidor de uso na UI (via `usage.log` ou leitura dos logs de sessão do Claude Code) para o usuário ver quanto sobrou do plano.

## 8 · Segurança e privacidade

- UI web escuta só em `127.0.0.1`, porta aleatória ou configurável; token de sessão simples na URL de abertura para evitar que outra aba/local acesse.
- Dados nunca no repositório; `narnia-jobs doctor` avisa se `NARNIA_DATA_DIR` apontar para dentro de um repositório git.
- Token do GitHub em `config.json` com permissão 0600 (ou keychain do SO em fase futura).
- Uploads tratados como dados não confiáveis: parsers em JS puro, sem execução.
- O que sai da máquina: só o que o CLI do agente envia ao modelo. A UI não faz chamadas externas além da API do GitHub quando o usuário pede ingestão.

## 9 · Multiplataforma

- Node ≥ 22.13 como único runtime; instalação via `npm i -g narnia-jobs` ou `npx`.
- Caminhos via `path` e `env-paths`; nada de `~` literal.
- Abrir navegador com `open` (pacote), funciona nos três SOs.
- Testes de CI em matriz ubuntu/windows/macos desde o início.

## 10 · Modo A: chat na UI web sobre o Agent SDK

```ts
import { query } from "@anthropic-ai/claude-agent-sdk";
for await (const msg of query({
  prompt: userMessage,
  options: {
    plugins: [{ type: "local", path: PLUGIN_DIR }],   // persona, skills, hooks, .mcp.json
    model: profile.chatModel ?? "sonnet",
    tools: [],                                           // sem Bash/Read/Edit: só tools MCP do plugin
    systemPrompt: profileCard,                           // mínimo; o hook SessionStart também injeta
    resume: session?.id,
    maxTurns: 8,
  },
})) { /* normalizar eventos → WebSocket → UI */ }
```
- Sem `ANTHROPIC_API_KEY` no ambiente, o CLI por baixo usa a credencial do `/login` (assinatura). Com a chave, cobra por uso. A UI mostra qual está ativa.
- `tools: []` + system prompt mínimo é o que torna o modo A mais econômico que o B por mensagem.
- O provider normaliza eventos (`text_delta`, `tool_use`, `tool_result`, `result` com `usage`/`total_cost_usd`) para a UI; o `CodexProvider` futuro produz os mesmos eventos a partir de `codex exec --json`.
- Nenhum prompt ou tool é definido aqui: tudo vem de `plugin/` e `packages/mcp/`.

## 11 · Entrevista por voz (modo A)

Provedores de STT/TTS seguem o padrão de N provedores (§16). Padrão: Whisper local + TTS local.

Todo o áudio fica no navegador do host; o container só recebe e envia texto. Detalhes e alternativas em `08 §3`.

```
navegador                                      container
───────────────────────────────────            ──────────────────────────────
mic → VAD (Silero WASM) → STT (provider: Whisper local) ─► WS /interview: {text}
                                               → SDK streaming input (sessão viva)
TTS por frase (provider: modelo local) ◄──────── WS: {delta} … {turn_end, usage}
barge-in: fala detectada → cancela TTS
```
- Sessão do SDK em **streaming input**: o CLI não é relançado a cada turno; a latência é só a do modelo.
- Sentenciador no servidor: corta o stream em frases para o TTS começar cedo.
- Cada turno é gravado por `interview.record_turn` (pergunta, resposta transcrita, feedback curto).

## 12 · Docker

```
docker/Dockerfile          imagem única da aplicação, multi-stage (dev → build → deps-prod → runtime node:22-bookworm-slim + git + poppler-utils + tessdata); api e worker rodam a fonte TS com `tsx` (F01-62) e usam o CLI do Claude embutido no Agent SDK, sem instalação global (F01-41)
docker/web.Dockerfile      nginx servindo apps/web/dist
docker-compose.yml         serviços: web, api, worker, redis; volumes ./data, claude-auth, redis-data; porta do host dinâmica (ver abaixo)
docker-compose.dev.yml     fonte montada, hot reload (Vite e tsx watch), Redis local; `pnpm` roda dentro dos containers
docker-compose.e2e.yml     override: provider mock, token fixo, pasta `./.e2e-data`, nenhuma porta publicada; roda em projeto compose separado (`narnia-e2e`) por `./start.sh e2e`; o serviço Playwright monta o repositório e o volume `node_modules` do compose de dev
```
Regra: **tudo dockerizado**. Nenhum comando de desenvolvimento exige Node ou pnpm no host; o lançador é um script de shell (`start.sh`) e PowerShell (`start.ps1`) que só usa Docker.
**Porta dinâmica.** O usuário sobe o sistema por `./start.sh` (Linux/macOS) ou `.\start.ps1` (Windows), scripts finos que só dependem de Docker: procuram a primeira porta livre no intervalo 3100–3199 no host, gravam `NARNIA_PORT` em `.env` (a porta salva é reutilizada enquanto estiver livre, F01-64), executam `docker compose up -d`, esperam o `/api/health` e imprimem a URL com o token de boot (persistido em `/data/.token`, então a URL é estável entre reinícios, F01-63). O compose publica `127.0.0.1:${NARNIA_PORT}:80` no serviço `web`, que faz proxy de `/api`, `/ws` e `/mcp` para a `api`. Dentro da rede do compose as portas são fixas. A pasta de dados independe da porta, então o banco é sempre o mesmo entre execuções. Os demais comandos (`login`, `doctor`, `install-plugin`, `logs`, `down`) são subcomandos dos mesmos scripts, executados via `docker compose run --rm api narnia-jobs <cmd>`; no modo B, `install-plugin` lê a porta atual do `.env` para gerar o `.mcp.json`.
Comandos da CLI `narnia-jobs` relevantes ao Docker:
- `narnia-jobs doctor`: checa login do CLI no container, volume de dados gravável, versão do Node, acesso ao MCP pelo host.
- `./start.sh login` (= `docker compose run --rm --no-deps api narnia-jobs login`): login único da assinatura (URL + código) no volume `claude-auth`; alternativa: `CLAUDE_CODE_OAUTH_TOKEN` no `.env`.
- `narnia-jobs google connect`: registra o MCP oficial do Google Calendar com client ID/secret e executa `claude mcp login`.
- `narnia-jobs install-plugin claude`: copia/aponta `plugin/` no host e registra o MCP HTTP (modo B).

## 13 · Jobs em segundo plano e sessões concorrentes

```
api ──enqueue──► Redis (BullMQ: filas ingest · ocr · extract · clarify · cv · misc) ──► worker(s) (concorrência por fila)
 ▲                      │ progresso/eventos (BullMQ events + pub/sub)                     │
 └── WS para a UI ◄─────┘                                                                 └──► tabela job (SQLite): espelho durável
                                                                                               (estado, progresso, resultado, erro)
no boot do worker: jobs ativos órfãos são retomados pela própria BullMQ (stalled → retry) e refletidos na tabela
```
- **BullMQ + Redis** (decisão de 2026-10-07): a fila vive no Redis; a tabela `job` é o registro durável e consultável pela UI e pelas tools MCP. Jobs são idempotentes por etapa/chunk, com `jobId` determinístico para evitar duplicatas.
- Toda operação que chama o modelo ou leva > 2 s é um job: ingestão (por chunk), OCR, extração, clarificação, geração de CV, análise de vaga.
- A UI nunca bloqueia: a bandeja de atividades (shell L0) lista jobs com progresso, erro e cancelar; o usuário navega livremente.
- Sessões de chat: várias por perfil, cada uma um processo do CLI via SDK (streaming input). Limite configurável de sessões simultâneas (padrão 3) por causa de memória; além disso, novas sessões ficam "em espera". Sessão inativa por N minutos é hibernada (processo encerrado, retomada por `resume`).

## 14 · Geração de CV por templates (no servidor)

| Peça | Decisão |
|------|---------|
| Motor | templates **HTML + CSS** (componentes React renderizados para HTML estático) → PDF com **Chromium headless** (Playwright, já na stack) dentro do container; DOCX via `docx` a partir do mesmo modelo de dados |
| Templates padrão | 3 iniciais: **Clássico** (uma coluna, sóbrio, ATS-friendly), **Moderno** (duas colunas, barra lateral com skills/contato), **Compacto** (uma página, denso, para mercado internacional). Todos com variantes claro/escuro de acento e suporte a pt-BR/en-US |
| Template do usuário | pacote `.zip` ou pasta com `template.html` (Handlebars/EJS), `style.css`, `manifest.json` (nome, variáveis exigidas, página, margens) e `preview.png`; validado no upload contra o **schema de dados do CV** (`packages/shared`), com prévia renderizada antes de salvar. Fase posterior: template `.docx` com placeholders (`docxtemplater`) |
| Conteúdo | o agente gera o **conteúdo** (JSON no schema do CV: resumo, experiências selecionadas, bullets reescritos) e o servidor faz o **layout**. Separar os dois evita tokens gastos com formatação e garante consistência visual |
| Saída | `document_version` com PDF, DOCX, JSON de conteúdo, template e parâmetros; prévia em PNG para a UI |
| Imagem Docker | adiciona Chromium (~300 MB); alternativa menor avaliada e descartada por ora: Typst (binário pequeno, ótimo para CV, mas o usuário teria de escrever templates em Typst) |

## 15 · Medidor de uso e "limpar cache"

- **Fonte 1, logs do Claude Code**: um coletor lê os JSONL de sessão do CLI em `/home/node/.claude/projects/**` (volume `claude-auth`), extrai `usage` por mensagem (modelo, tokens in/out/cache, timestamps) e grava em `usage_event` com `origem = claude-log`. Formato interno, sujeito a mudar: o coletor é tolerante a campos desconhecidos e tem testes com fixtures de cada versão suportada. No modo B os logs ficam no host; o coletor aceita um caminho extra configurável.
- **Fonte 2, logs próprios**: toda chamada ao SDK, job e tool MCP grava JSONL estruturado em `/data/logs/` (sessão, categoria, feature, modelo, tokens do `result`, duração) e `usage_event` com `origem = narnia`. Duplicidade entre as fontes é resolvida por `provider_session_id` + timestamp.
- **Visão**: por dia, por janela de 5 h (alinhada ao plano), por semana, por modelo, por categoria, por sessão; estimativa de custo equivalente em API e, quando o plano é conhecido, % da janela.
- **Limpar cache** (por categoria ou por conversa): encerra a sessão viva, apaga a sessão do Claude Code (`claude session delete`/arquivo), apaga os logs próprios e `usage_event` correspondentes e o histórico de chat; **nunca** apaga fatos, arquivos ou documentos do usuário. Confirmação com resumo do que será apagado.

## 16 · Provedores de voz (padrão de N provedores)

```ts
interface SttProvider { id; kind: "browser" | "server" | "remote"; start(stream, lang): AsyncIterable<Transcript>; }
interface TtsProvider { id; kind; synthesize(text, voice): AsyncIterable<AudioChunk>; voices(lang): Voice[]; }
```
| Papel | Padrão | Alternativas registráveis |
|-------|--------|---------------------------|
| STT | **Whisper local no navegador** (`@huggingface/transformers`, modelo `whisper-small`/`base` multilíngue, WebGPU com fallback WASM; modelos baixados uma vez e cacheados) | Whisper local no servidor (`whisper.cpp` no container, CPU, para máquinas sem WebGPU) · Web Speech API · Deepgram/OpenAI/ElevenLabs (chave do usuário) |
| TTS | **Modelo local**: `Piper` (vozes pt-BR disponíveis; roda em WASM no navegador ou no container) para pt-BR, `Kokoro` (WebGPU/WASM, excelente em inglês) para en-US | `speechSynthesis` do navegador · ElevenLabs/OpenAI/Azure (chave do usuário) |
| Seleção | por idioma do perfil, com override em Configurações; teste de microfone e de voz na tela | |
Trade-offs registrados: Whisper no navegador exige download inicial (~150–500 MB) e hardware razoável; a qualidade de voz pt-BR dos modelos locais é inferior aos serviços pagos, por isso a alternativa continua um clique de distância.

## 17 · Tempo

Tudo gravado em UTC; conversão para `user.timezone` na UI com `moment-timezone` (decisão do dono do projeto; o pacote está em manutenção, então fica isolado em `packages/shared/time.ts` para troca futura sem tocar em componentes). Servidor nunca formata datas para exibição. Datas sem hora não têm fuso.

## 18 · Fases sugeridas

| Fase | Entrega | Critério de pronto |
|------|---------|--------------------|
| 0 | esqueleto do monorepo, `core` com SQLite e modelo de fatos, imagens e compose (web, api, worker, redis) + compose de dev e e2e, `start.sh`/`start.ps1`, login da assinatura | `./start.sh` nos 3 SOs; dados sobrevivem a `down`/reboot; desenvolvimento sem Node no host |
| 1 | MCP com `profile.*` e `evidence.*`, `plugin/` com agente recrutador + hook de perfil | conversar com o recrutador **dentro do Claude Code** sobre dados inseridos à mão (modo B pronto) |
| 2 | UI web: onboarding, Meus dados, Configurações, bandeja de atividades, medidor básico | editar dados sem tocar no banco; ver uso por sessão |
| 3 | Chat web sobre o Agent SDK carregando `plugin/` | mesma conversa da fase 1, agora na UI (modo A pronto) |
| 4 | Ingestão de CV (onboarding) com digest + revisão; GitHub rápida/equilibrada | CV real vira fatos revisados; agente responde sobre o CV sem reabri-lo |
| 5 | Features: gerar CV com 3 templates no servidor (PDF/DOCX) + upload de template, analisar vaga, candidaturas (com link/`.ics`) | gerar um CV com bom padrão visual para uma vaga real |
| 6 | Entrevista por voz (Whisper local + VAD + TTS local, padrão de N provedores) | entrevista de 10 min mãos livres, com feedback |
| 7 | Google Calendar via MCP oficial, LinkedIn, ingestão profunda, templates `.docx`, provedores pagos de voz, Codex | — |
