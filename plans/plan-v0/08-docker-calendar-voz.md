# 08 · Viabilidade: Docker, Google Calendar e entrevista por voz

Análise das três atualizações de 2026-10-06 que exigem decisão técnica. As demais (telefone obrigatório, CV como primeiro input, revisão da extração, registro de contexto por arquivo) foram incorporadas direto em `02`, `03`, `04` e `05`.

---

## 1 · Rodar em Docker

**Viável, com três consequências de desenho.**

### 1.1 Login da assinatura dentro do container
O CLI `claude` guarda a credencial OAuth em `~/.claude/.credentials.json` no Linux (no macOS usa o Keychain, por isso **não** montamos o `~/.claude` do host: quebra no Mac e mistura configurações). Dentro do container, que é Linux, vale o arquivo.

| Opção | Como | Avaliação |
|-------|------|-----------|
| **A. Volume nomeado + login único** | `claude-auth:/home/node/.claude`; na primeira execução `narnia-jobs login` roda `claude auth login` dentro do container, imprime a URL, o usuário cola o código | **padrão**: igual nos 3 SOs, o refresh token renova sozinho, sobrevive a reboot |
| **B. `CLAUDE_CODE_OAUTH_TOKEN`** | `claude setup-token` no host gera token de 1 ano; passa por `.env` | **alternativa suportada** (decisão de 2026-10-07): usada automaticamente quando presente no `.env`; útil sem navegador no host; token em texto no `.env` (gitignored), expira em 1 ano |
| C. Montar `~/.claude` do host | bind mount | descartado (Keychain no Mac, conflito de settings) |

Fonte: https://code.claude.com/docs/en/authentication (ordem de precedência de credenciais; `setup-token`).

### 1.2 Persistência quando o container não está rodando
Nada fica no sistema de arquivos do container. Dois volumes:

```yaml
services:
  web:                      # nginx: SPA + proxy de /api, /ws e /mcp para a api
    build: { context: ., dockerfile: docker/web.Dockerfile }
    ports:
      - "127.0.0.1:${NARNIA_PORT:-3100}:80"   # porta do host escolhida por start.sh / start.ps1
    depends_on: [api]
  api:
    build: { context: ., dockerfile: docker/Dockerfile }
    command: ["node", "--no-warnings=ExperimentalWarning", "apps/api/dist/server.js"]
    ports:
      - "127.0.0.1:8089:8089"                 # callback OAuth (Google Calendar), porta fixa
    volumes:
      - ${NARNIA_DATA_DIR:-./data}:/data      # SQLite, uploads, digests, exports, snapshots, logs, config.json
      - claude-auth:/home/node/.claude         # login da assinatura (volume) …
    environment:
      - NARNIA_DATA_DIR=/data
      - REDIS_URL=redis://redis:6379
      - CLAUDE_CODE_OAUTH_TOKEN=${CLAUDE_CODE_OAUTH_TOKEN:-}   # … ou token do .env (decisão 11)
    depends_on: [redis]
  worker:
    build: { context: ., dockerfile: docker/Dockerfile }
    command: ["node", "--no-warnings=ExperimentalWarning", "apps/worker/dist/main.js"]
    volumes: [ "${NARNIA_DATA_DIR:-./data}:/data", "claude-auth:/home/node/.claude" ]
    environment: [ "NARNIA_DATA_DIR=/data", "REDIS_URL=redis://redis:6379", "CLAUDE_CODE_OAUTH_TOKEN=${CLAUDE_CODE_OAUTH_TOKEN:-}" ]
    depends_on: [redis]
  redis:
    image: redis:7-alpine
    command: ["redis-server", "--appendonly", "yes"]
    volumes: [ "redis-data:/data" ]
volumes:
  claude-auth:
  redis-data:
```
SQLite continua sendo o banco: api e worker abrem o mesmo arquivo em `/data` (WAL; um escritor por vez, leituras concorrentes). O Redis guarda só filas, eventos e locks.
- **Porta dinâmica**: `./start.sh` / `.\start.ps1` (só Docker no host) escolhem a primeira porta livre em 3100–3199, gravam em `.env` e imprimem a URL. A porta não afeta os dados: o banco é o mesmo em toda execução.
- Dados do usuário em **bind mount** (pasta visível no host, fácil de copiar/backup). Padrão `./data`, já no `.gitignore`; o usuário pode apontar `NARNIA_DATA_DIR` para fora do repositório.
- Credencial em **volume nomeado**: persiste a reinícios e reboots; só some com `docker compose down -v`, que a documentação do projeto deve alertar.
- SQLite em WAL funciona em bind mount nos 3 SOs (Docker Desktop usa VM com sistema de arquivos compartilhado; performance menor no Mac/Windows, irrelevante para este volume de dados).

### 1.3 Impacto no modo plugin (B)
No modo B o Claude Code roda **no host** (terminal/app desktop), mas os dados e o servidor MCP ficam no container. Logo o MCP não pode ser stdio: passa a ser **MCP via streamable HTTP** em `http://127.0.0.1:3100/mcp`, servido pelo mesmo processo da UI. O `.mcp.json` do plugin aponta para essa URL. Consequência: modo B exige o container ligado. O modo A roda inteiro dentro do container (UI + SDK + CLI instalado na imagem `node:22-slim`).

### 1.4 Custos do Docker
- Pré-requisito pesado em Windows/Mac (Docker Desktop). Aceito pela decisão do dono do projeto, reforçada em 2026-10-07: **tudo dockerizado, inclusive desenvolvimento**, para o host não ter conflitos de versão. O `README` não documenta instalação sem Docker.
- O container não abre navegador: a CLI imprime a URL. Microfone, impressão em PDF e OAuth acontecem no navegador do host, então não são afetados.
- Clone do GitHub para ingestão profunda roda dentro do container; precisa de `git` na imagem.

**Veredito:** viável; muda o transporte do MCP para HTTP e adiciona um passo de login único.

---

## 2 · Candidaturas conectadas ao Google Calendar

**Viável via o servidor MCP oficial do Google, com uma fricção inevitável: cada usuário precisa criar o próprio cliente OAuth no Google Cloud Console.**

Fatos verificados:
- Google publica um **MCP remoto oficial** do Calendar: `https://calendarmcp.googleapis.com/mcp/v1`, status *Developer Preview*, tools `list_calendars, list_events, get_event, create_event, update_event, delete_event, respond_to_event, suggest_time`. Autenticação OAuth 2.0 com **client ID e secret criados pelo usuário** no Google Cloud Console. Fonte: https://developers.google.com/workspace/calendar/api/guides/configure-mcp-server
- O Claude Code aceita credenciais OAuth pré-configuradas: `claude mcp add --transport http --client-id … --client-secret --callback-port 8089 …`, e o login é feito com `claude mcp login <nome>` ou `/mcp`. Em modo não interativo (SDK, `claude -p`) ele **não** executa o fluxo OAuth: o login tem de ser feito uma vez numa sessão interativa. Fonte: https://code.claude.com/docs/en/mcp (seções "Use pre-configured OAuth credentials" e "Authenticate with remote MCP servers").

Como fica no Narnia:

| Etapa | Modo A (container) | Modo B (host) |
|-------|--------------------|---------------|
| Usuário cria cliente OAuth no Google Cloud (redirect `http://localhost:8089/callback`) | guia passo a passo na tela Configurações | idem |
| Registrar o servidor | `narnia-jobs google connect` roda `claude mcp add …` dentro do container (escopo user, fica no volume `claude-auth`) | mesmo comando no host |
| Login | `claude mcp login google-calendar` dentro do container; callback na porta 8089 mapeada | idem no host |
| Uso | skill `candidaturas`: ao mover para "Entrevista" com data, chama `create_event`; `list_events` para evitar conflito; `suggest_time` para propor horários | igual |

Alternativas consideradas:
- **Link "Adicionar ao Google Calendar" + arquivo `.ics`**: zero autenticação, zero fricção. Entra no MVP como base e continua existindo como fallback.
- **Integração própria via `googleapis` no backend**: mesma fricção de cliente OAuth, mais código nosso, nenhum ganho. Descartada.
- **Distribuir um client ID nosso**: escopo de Calendar é sensível e exigiria verificação do app pelo Google; inviável para projeto local/open source.

**Veredito:** viável como feature opcional, habilitada em Configurações quando o usuário conecta a conta; MVP entrega link + `.ics` sem autenticação.

---

## 3 · Simulador de entrevista por voz, mãos livres, em tempo real

**Viável como pipeline; não como "tempo real" nativo.** A Anthropic não oferece API de áudio em tempo real (não há modelo speech-to-speech do Claude). O modo de voz do app Claude e do Claude Code é um pipeline: reconhecimento de fala → texto para o modelo → síntese de voz. É isso que construiremos, no navegador.

### 3.1 Arquitetura proposta (áudio no navegador do host; o container só troca texto)

Decisão de 2026-10-06: **Whisper local e TTS local desde o início**, dentro de um padrão de N provedores (interfaces em `03 §16`), para que a troca por navegador ou serviço pago seja configuração, não código.

```
microfone ─► VAD (Silero, @ricky0123/vad-web) ─► STT provider ─► texto ─► WebSocket ─► Claude (SDK, streaming)
   ▲                                                                                   │
   └── barge-in: se o usuário fala, para o TTS ◄── TTS provider por frase ◄── texto em stream
```

| Componente | Padrão | Provedores alternativos |
|------------|--------|-------------------------|
| Detecção de fala (mãos livres) | Silero VAD em WebAssembly no navegador; começa ao detectar voz, encerra após ~700 ms de silêncio | botão "falar" |
| STT | **Whisper local no navegador** via `@huggingface/transformers` (WebGPU, fallback WASM), modelo multilíngue `small` ou `base`, download único (~150–500 MB) cacheado | Whisper no servidor (`whisper.cpp`, CPU do container) · Web Speech API (Chrome/Edge, áudio vai ao Google) · Deepgram/OpenAI/ElevenLabs com chave do usuário |
| Modelo | Claude via SDK em **streaming input** (sessão viva) | — |
| TTS | **Modelo local**: Piper (tem vozes pt-BR) e Kokoro (inglês de alta qualidade), em WASM/WebGPU no navegador ou no container | `speechSynthesis` do navegador · ElevenLabs/OpenAI/Azure com chave do usuário |

Por que local primeiro: privacidade (nada de áudio sai da máquina), funciona em qualquer navegador moderno (não depende de `SpeechRecognition`), custo zero. Custo: download inicial e exigência de hardware; por isso os provedores alternativos ficam a um clique em Configurações.

### 3.2 Latência esperada por turno
Fim da fala → fim do STT ~0,5–1,5 s com Whisper local (depende do hardware; WebGPU fica perto do limite inferior); primeiro token do Claude ~1–2 s; primeiro trecho de TTS local ~0,3 s. **Cerca de 2–3 s de pausa antes de a resposta começar**, próximo de uma pausa humana em entrevista. Não há sobreposição de fala nem interrupção instantânea do modelo; o que existe é interrupção do TTS (barge-in) quando o usuário começa a falar.

### 3.3 Restrições
- Whisper no navegador precisa de WebGPU para latência boa (Chrome/Edge; Firefox e Safari ainda parciais em 2026); sem WebGPU cai para WASM (mais lento) ou para o provedor no servidor.
- Microfone exige contexto seguro: `http://localhost` serve; acesso pela rede local exigiria HTTPS.
- Privacidade: com os provedores locais nenhum áudio sai da máquina. Se o usuário escolher Web Speech ou um serviço pago, a tela avisa para onde o áudio vai.
- Tokens: cada turno é uma mensagem de texto normal; uma entrevista de 30 min ≈ 25–40 turnos ≈ 15–30k tokens em Sonnet. Cabe no plano, mas o medidor deve ficar visível.
- No modo B (terminal), o Claude Code tem modo de voz para **ditado**, sem fala de volta. A entrevista por voz é, na prática, uma feature só do modo A.

**Veredito:** viável com Whisper local + VAD + TTS local, sem APIs externas; mais trabalho inicial que a Web Speech API (gestão de download de modelos, WebGPU/WASM, worker de áudio), compensado por privacidade e independência de navegador. O padrão de N provedores mantém as alternativas disponíveis.

Fontes: https://techcrunch.com/2026/03/03/claude-code-rolls-out-a-voice-mode-capability/ , https://claudexia.tech/blog/claude-voice-realtime-stack-2026 , https://www.datastudios.org/post/claude-voice-features-explained-current-status-and-upcoming-real-time-updates
