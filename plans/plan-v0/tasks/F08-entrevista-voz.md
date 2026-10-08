# F08 · Entrevista por voz

Entregável 8 do plan-v0. Cobre o fluxo **F5.2** de `../02-fluxos-do-usuario.md` (simulador de entrevista mãos livres) conforme a viabilidade em `../08-docker-calendar-voz.md §3` e a arquitetura em `../03-arquitetura.md §11 e §16`. Depende de F04 (sessões de chat, `plugin/`, MCP) e de F07 (candidaturas, de onde vem a vaga). É uma feature **só do modo A**: no modo B o Claude Code tem ditado, mas não fala de volta.

Status: **em escopo** (2026-10-07). Nada implementado.

---

## 1 · Objetivo e resultado esperado

Com uma candidatura cadastrada, o usuário consegue, sem tocar no teclado depois de clicar em "Iniciar":

1. escolher a candidatura e o tipo de entrevista (técnica, comportamental, desenho de sistema);
2. testar microfone e voz, ver o aviso de privacidade (com os provedores locais nenhum áudio sai da máquina) e iniciar;
3. falar naturalmente: a detecção de fala decide quando começou e terminou, sem segurar botão;
4. ouvir a resposta do recrutador em voz, frase a frase, com pausa de 2–3 s por turno; se começar a falar, a voz do recrutador para (barge-in);
5. ver a transcrição rolando, pausar, trocar para modo texto ou encerrar a qualquer momento;
6. ao encerrar, receber feedback consolidado por competência e ter a transcrição salva na candidatura. Nenhum áudio é gravado.

### Dentro do escopo
- Interfaces `SttProvider` e `TtsProvider` (padrão de N provedores) em `packages/shared/voice/` e registro de provedores em `apps/web/src/voice/`.
- Provedores entregues: STT **Whisper local no navegador** (padrão), Web Speech API; TTS **Piper** (pt-BR) e **Kokoro** (en) locais (padrão por idioma do perfil), `speechSynthesis`. Provedores pagos (Deepgram/OpenAI/ElevenLabs) e Whisper no servidor entram como **esqueleto registrável** (interface + tela de chave), sem implementação completa.
- Gestão de download de modelos: tamanhos, progresso, cache (Cache API/OPFS), verificação de integridade, botão "remover modelo".
- VAD Silero (`@ricky0123/vad-web`) para mãos livres; barge-in.
- Skill `entrevista` em `plugin/skills/entrevista/` + tools MCP `interview.*`; sessão do SDK em **streaming input** (sessão viva por entrevista); sentenciador no servidor; WS `/interview`.
- Feedback por resposta (curto, opcional na tela) e consolidado ao encerrar; transcrição salva como `interview_session` + `interview_turn`.
- Tela L8 completa, incluindo tela inicial (teste de mic/voz) e final (feedback).
- Modo texto como fallback dentro da mesma sessão.

### Fora do escopo (e para onde vai)
- Whisper no servidor (`whisper.cpp` no container) → fase 7 do plano; fica o provider registrado como "em breve".
- Provedores pagos funcionais → fase 7; F08 entrega só a interface e o cadastro de chave.
- Gravação de áudio → nunca (decisão em `04 §E`).
- Entrevista no modo B → não existe; a skill `entrevista` no terminal roda em texto.
- Agendamento da entrevista real no calendário → F07.
- Avaliação com rubricas por empresa/cargo específicas → futuro; F08 usa rubrica genérica por tipo.

---

## 2 · Arquitetura deste entregável

### 2.1 Visão
```
navegador (host)                                              container narnia-jobs
──────────────────────────────────────────────                ─────────────────────────────────────────
mic ─► AudioWorklet ─► VAD (Silero WASM) ─► segmento ─► SttProvider ─► texto ─► WS /interview {user_text}
  ▲                                                                                     │
  │                                            interview worker ◄── SDK query() streaming input (sessão viva)
  │                                                    │  plugin/ + tools interview.*, profile.get_card,
  │                                                    │  application.get, experience.get
  └── barge-in: VAD detecta voz → cancela TtsProvider   │
TtsProvider ◄── fila de frases ◄── WS {sentence} ◄── sentenciador ◄── {delta}
                                                       └── {turn_end, feedback_short, usage}
```
- O container só vê texto. Todo áudio, modelo de STT/TTS e VAD rodam no navegador do host.
- Uma entrevista = uma sessão do SDK (categoria `entrevista`) mantida viva com `streaming input`; o CLI não é relançado por turno.
- O sentenciador corta o stream em frases (pontuação forte + comprimento mínimo) e envia cada uma ao navegador assim que fecha, para o TTS começar antes do fim da resposta.
- Barge-in: quando o VAD detecta voz durante a fala do TTS, o navegador cancela a reprodução, descarta a fila de frases e envia `{interrupt}`; o servidor aborta o turno atual (`AbortController`) e marca a resposta como interrompida na transcrição.

### 2.2 Interfaces (em `packages/shared/voice/`)
```ts
interface SttProvider {
  id: string; label: string; kind: "browser" | "server" | "remote";
  languages: string[];                      // BCP-47
  prepare(opts: { lang: string; onProgress?: (p: ModelProgress) => void }): Promise<void>;  // download/cache do modelo
  transcribe(segment: Float32Array, opts: { lang: string; sampleRate: number }): Promise<Transcript>;
  dispose(): Promise<void>;
}
interface TtsProvider {
  id: string; label: string; kind: "browser" | "server" | "remote";
  voices(lang: string): Promise<Voice[]>;
  prepare(opts: { voice: Voice; onProgress?: (p: ModelProgress) => void }): Promise<void>;
  synthesize(text: string, voice: Voice): AsyncIterable<AudioChunk>;   // streaming por chunk
  cancel(): void;
}
interface VoiceRegistry { stt: Map<string, SttProvider>; tts: Map<string, TtsProvider>; }
```
Provedores registrados em F08:

| Papel | id | Implementação | Status em F08 |
|-------|----|---------------|---------------|
| STT | `whisper-browser` | `@huggingface/transformers`, modelo `whisper-base`/`small` multilíngue (ONNX), WebGPU com fallback WASM, roda em Web Worker | **padrão, completo** |
| STT | `web-speech` | `SpeechRecognition` contínuo; aviso "áudio vai ao Google" | completo |
| STT | `whisper-server` | `whisper.cpp` no container via WS binário | esqueleto (interface + "em breve") |
| STT | `remote-*` | Deepgram/OpenAI com chave do usuário | esqueleto + tela de chave |
| TTS | `piper-browser` | Piper em WASM (`piper-tts-web`), vozes pt-BR (`pt_BR-faber`, `pt_BR-edresson`) | **padrão pt-BR, completo** |
| TTS | `kokoro-browser` | `kokoro-js` WebGPU/WASM, vozes en-US/en-GB | **padrão en, completo** |
| TTS | `speech-synthesis` | `speechSynthesis` do navegador | completo |
| TTS | `remote-*` | ElevenLabs/OpenAI/Azure com chave do usuário | esqueleto + tela de chave |

Seleção: por idioma do perfil (`profile.doc_locale`), com override em `voice_settings`. Se o provedor padrão não estiver disponível (sem WebGPU e WASM muito lento, sem modelo baixado), a tela inicial sugere a alternativa e não deixa iniciar sem um STT e um TTS prontos.

### 2.3 Gestão de modelos (navegador)
- `ModelManager` em `apps/web/src/voice/models.ts`: catálogo com id, URL (Hugging Face Hub), tamanho, hash; download com progresso (bytes/total), armazenamento na **Cache API** (fallback OPFS), verificação de hash, remoção, listagem do que está em cache e espaço usado.
- Download só sob ação do usuário (tela de teste de voz ou Configurações), nunca automático no boot.
- Tamanhos de referência mostrados na UI: Whisper base ≈ 150 MB, small ≈ 500 MB; Piper voz pt-BR ≈ 60–120 MB; Kokoro ≈ 90–330 MB. Valores exatos medidos na implementação e gravados no catálogo.

### 2.4 Skill `entrevista` e tools MCP
- `plugin/skills/entrevista/SKILL.md`: instruções do entrevistador: assume a persona do recrutador do perfil ativo, conhece a vaga (`application.get`), faz uma pergunta por turno, adapta ao tipo (técnica: profundidade e trade-offs; comportamental: STAR; sistema: requisitos, escala, trade-offs), avalia cada resposta em 1–2 frases **internas** (não faladas) via `interview.record_turn`, e ao receber `{end}` produz o feedback consolidado via `interview.finish`. Fala curto (máx. ~60 palavras por turno, exceto feedback final), sem listas nem markdown, porque vai virar áudio.
- Tools (em `apps/api/src/mcp/tools/interview.ts`): `interview.start(application_id, type, mode)`, `interview.record_turn(session_id, question, answer, feedback_short, score?)`, `interview.finish(session_id, feedback_json)`, `interview.get(session_id)`, `interview.list(application_id)`.
- Modo texto: mesma sessão e skill; a UI só troca mic/TTS por caixa de texto.

### 2.5 API e WS
| Rota | Função |
|------|--------|
| `POST /api/interviews` `{applicationId, type, mode}` | cria `interview_session`, abre sessão do SDK (categoria `entrevista`), devolve `sessionId` |
| `WS /interview?sessionId=` | cliente → `{user_text}`, `{interrupt}`, `{pause}`, `{resume}`, `{set_mode}`, `{end}`; servidor → `{sentence}`, `{delta}`, `{turn_end, usage}`, `{feedback_short}`, `{state}`, `{final_feedback}`, `{error}` |
| `GET /api/interviews/:id` · `GET /api/applications/:id/interviews` | transcrição e feedback |
| `GET/PUT /api/voice/settings` | provedores e vozes escolhidos, chaves de serviços remotos (cifradas em `config.json`) |
| `GET /api/voice/catalog` | catálogo de modelos (ids, URLs, tamanhos, hashes) |

Um turno gera um `usage_event` (categoria `entrevista`, sessão). Timeout de inatividade de 10 min pausa a entrevista e hiberna a sessão do SDK; retomar faz `resume`.

---

## 3 · Dados deste entregável

| Tabela | Colunas principais |
|--------|--------------------|
| `interview_session` | `id`, `profile_id`, `application_id`, `type` (technical/behavioral/system), `mode` (voice/text), `stt_provider`, `tts_provider`, `voice_id`, `lang`, `status` (preparing/live/paused/finished/aborted), `provider_session_id`, `started_at`, `finished_at` (UTC), `duration_s`, `total_tokens`, `final_feedback_json`, `summary` |
| `interview_turn` | `id`, `session_id`, `idx`, `question`, `answer`, `answer_source` (stt/text), `interrupted` (bool), `feedback_short`, `score` (1–5, opcional), `asked_at`, `answered_at` (UTC), `stt_latency_ms`, `first_audio_ms` |
| `voice_settings` | `id` (=1), `stt_provider_id`, `tts_provider_by_lang_json` (`{"pt-BR": {"provider":"piper-browser","voice":"pt_BR-faber"}, ...}`), `vad_sensitivity`, `silence_ms` (padrão 700), `auto_feedback_on_screen` (bool), `updated_at` |
| `voice_model_cache` (opcional, espelho do que está no navegador) | `model_id`, `size_bytes`, `cached_at`, `browser_fingerprint` |

Regras:
- `final_feedback_json` segue schema em `packages/shared/schemas/interview.ts`: competências avaliadas (nome, nota 1–5, evidência citada da transcrição), pontos fortes, o que treinar, próximos passos.
- Nunca existe coluna ou arquivo de áudio. Teste automatizado garante que nenhum endpoint aceita `audio/*`.
- Chaves de serviços remotos em `config.json` (0600), nunca no SQLite nem na exportação.

---

## 4 · Layouts deste entregável

Referência: `../05-layouts.md` L8.

| Tela | Componentes | Estados a cobrir |
|------|-------------|------------------|
| Início da entrevista | `ApplicationPicker`, `InterviewTypeSelector`, `VoiceReadiness` (STT e TTS escolhidos, modelo baixado?, botão baixar com progresso), `MicTest` (barra de nível + "diga algo" → transcrição de teste), `VoiceTest` (ouvir frase de exemplo), `PrivacyNotice` (muda conforme provider), botão Iniciar | sem candidaturas · modelo não baixado · baixando · mic negado · WebGPU ausente (aviso de lentidão) · pronto |
| Entrevista ao vivo (L8) | `StateRing` (ouvindo / pensando / falando / pausado), `TranscriptFeed` (turnos, badge "interrompido"), `TurnFeedbackChip` (opcional), `UsageMini`, `Timer`, controles pausar / modo texto / encerrar, seletor rápido de mic e voz | ouvindo · processando STT · aguardando modelo · falando · barge-in · pausado · erro de provider (com "trocar provedor") · modo texto |
| Feedback final | `CompetencyTable` (nota + evidência), `StrengthsList`, `TrainList`, `NextSteps`, link para a transcrição na candidatura, botão "nova entrevista" | com feedback · sessão abortada (feedback parcial) |
| Configurações → Voz | `ProviderSelect` STT/TTS por idioma, `VoiceSelect`, `ModelCacheList` (tamanho, remover), `RemoteKeyForm` por serviço, sliders VAD/silêncio | padrão · modelo em cache · sem cache · chave inválida |
| Candidatura → aba Entrevistas | lista de sessões (data no fuso do usuário, tipo, duração, nota média), abrir transcrição | vazio · com sessões |

Regras de UI: foco em acessibilidade (todos os controles operáveis por teclado, estado anunciado por `aria-live`), tema claro/escuro, textos via `t()`.

---

## 5 · Decisões em aberto deste entregável

| # | Decisão | Opções | Padrão proposto |
|---|---------|--------|-----------------|
| F08-1 | Modelo Whisper padrão | `base` (≈150 MB, mais rápido) · `small` (≈500 MB, melhor pt-BR) | **`base`** como padrão, `small` oferecido como "qualidade" |
| F08-2 | Onde roda o VAD | navegador (Silero WASM) · servidor | **navegador** |
| F08-3 | Transcrição parcial em tempo real | só segmento final (após silêncio) · parciais a cada ~1 s | **só final** em F08 (menos CPU); parciais como melhoria |
| F08-4 | Feedback por resposta na tela | sempre visível · opcional (configuração) · só no final | **opcional**, desligado por padrão (não distrai) |
| F08-5 | Sentenciador | regex de pontuação + mínimo de 40 chars · biblioteca de segmentação | **regex** com casos de teste |
| F08-6 | Barge-in aborta a resposta do modelo | sim (aborta turno) · não (só silencia TTS) | **aborta**, transcrição marca "interrompido" |
| F08-7 | Armazenamento de modelos | Cache API · OPFS · IndexedDB | **Cache API** com fallback OPFS |
| F08-8 | Modelo do Claude na entrevista | Sonnet · Haiku | **Sonnet** (qualidade das perguntas); configurável |
| F08-9 | Timeout de inatividade | 5 · 10 · 15 min | **10 min** |
| F08-10 | Chaves de serviços remotos | `config.json` cifrado com chave local · texto puro 0600 | **cifrado** (`node:crypto`, chave em `/data/.key`) |

---

## 6 · O que precisa estar coberto para o F08 funcionar

### 6.1 Pré-requisitos e dependências
1. **F04** concluído: sessões do SDK com streaming input, categoria de sessão, `plugin/` carregado, MCP HTTP, `usage_event` por turno.
2. **F07** concluído: `application` com descrição da vaga, aba de candidatura para listar entrevistas.
3. **F02**: perfil ativo e `doc_locale` (define idioma e voz padrão).
4. **F10** (parcial): tela de Configurações existente para abrigar a seção Voz; se F10 não estiver pronto, F08 entrega a seção como página própria e F10 a move.
5. Verificar na implementação: versão de `@huggingface/transformers` com WebGPU estável, disponibilidade de `piper-tts-web` e `kokoro-js` compatíveis com o Vite/Worker, licenças dos modelos e vozes (devem ser compatíveis com open source).
6. Política de segurança do navegador: `http://localhost` é contexto seguro para `getUserMedia`; documentar que acesso por IP da rede exige HTTPS.

### 6.2 Testes unitários (Vitest) · obrigatórios
**`packages/shared`**
- Schemas de `InterviewSession`, `InterviewTurn`, `FinalFeedback`, `VoiceSettings`; JSON Schema estável (snapshot).
- Sentenciador (`voice/sentencer.ts`): corta em `. ! ?` e `;` com mínimo de 40 chars; não corta em abreviações comuns ("Sr.", "Dr.", "ex."), nem dentro de números ("3.5"); flush ao `turn_end`.

**`apps/api`**
- Tools `interview.*`: `start` cria sessão e abre o SDK (mockado) com categoria `entrevista`, `tools` restritas e `maxTurns` por turno; `record_turn` persiste com `idx` sequencial; `finish` valida `feedback_json` contra o schema e fecha a sessão; `get`/`list` filtram por perfil ativo.
- WS `/interview`: `user_text` → turno iniciado; `delta` → frases emitidas na ordem; `interrupt` → `AbortController` disparado, turno marcado `interrupted`, próxima `user_text` aceita; `pause`/`resume` hibernam/retomam (resume mockado); `end` → `final_feedback` uma única vez; mensagens após `end` rejeitadas.
- Timeout de inatividade: timer falso avança 10 min → estado `paused` e sessão hibernada.
- `usage_event` gravado por turno com categoria `entrevista` e `session_id`.
- Nenhuma rota aceita `multipart` com `audio/*` (teste negativo).
- `voice/settings`: chaves remotas gravadas cifradas, nunca devolvidas em claro no GET (apenas `has_key: true`).

**`apps/web`**
- `VoiceRegistry`: registra/resolve provedores, escolhe padrão por idioma, cai para alternativa quando `prepare()` falha.
- `FakeSttProvider`/`FakeTtsProvider` (em `apps/web/test/voice/fakes.ts`): usados em todos os testes de componentes.
- `ModelManager`: download com progresso (fetch mockado em chunks), verificação de hash falha → modelo descartado, cache hit não baixa de novo, remoção libera espaço.
- Pipeline de áudio sem áudio real: `VadGate` com eventos sintéticos (`speech_start`/`speech_end`) → chama `transcribe` com o segmento; durante `tts.playing`, `speech_start` dispara barge-in (cancel + `{interrupt}`).
- `TtsQueue`: toca frases na ordem, descarta fila ao cancelar, emite `playing`/`idle`.
- `StateRing`: transições ouvindo → pensando → falando → ouvindo; `aria-live` anuncia cada estado.
- `TranscriptFeed`: renderiza turnos, badge "interrompido", auto-scroll.
- Tela inicial: bloqueia Iniciar sem STT+TTS prontos; mostra download com progresso; aviso de privacidade muda conforme provider.
- Modo texto: troca de modo mantém a sessão e a transcrição.

### 6.3 Testes e2e (Playwright, Chromium) · obrigatórios
Rodam com `NARNIA_PROVIDER=mock` e, no navegador, `window.__NARNIA_VOICE_FAKE__ = true`, que registra `FakeSttProvider` (recebe transcrições injetadas por `page.evaluate`) e `FakeTtsProvider` (registra frases "faladas" e simula duração). Mock do modelo devolve perguntas e feedback determinísticos por fixture.
- **E2E-01 entrevista completa por voz**: candidatura fixture → tipo técnica → provedores fake "prontos" → Iniciar → primeira pergunta "falada" (fake TTS registra ≥ 1 frase) → injetar 3 respostas → encerrar → feedback final com competências → transcrição com 3 turnos na candidatura.
- **E2E-02 barge-in**: durante a "fala" da segunda pergunta, injetar `speech_start` → TTS cancelado, turno marcado interrompido, próxima resposta aceita.
- **E2E-03 modo texto**: trocar para texto no meio → responder digitando → voltar para voz → sessão continua com a mesma transcrição.
- **E2E-04 pausa e retomada**: pausar → estado "pausado", nenhum turno aceito → retomar → turno aceito.
- **E2E-05 modelo não baixado**: STT real selecionado sem cache (fake simula) → Iniciar desabilitado → "baixar" com progresso → habilitado.
- **E2E-06 mic negado**: permissão recusada (contexto do Playwright) → mensagem clara + sugestão de modo texto.
- **E2E-07 erro do provider no meio**: fake STT lança erro → tela oferece trocar provedor / modo texto → continuar funciona.
- **E2E-08 encerramento por inatividade**: relógio avançado 10 min → "pausado por inatividade" → retomar.
- **E2E-09 uso contabilizado**: ao final, `GET /api/usage/summary` mostra tokens na categoria `entrevista` iguais à soma dos turnos.
- **E2E-10 sem áudio persistido**: ao final, `./data` não contém arquivos de áudio (varredura por extensão/magic bytes) e nenhuma tabela tem blob.

### 6.4 Teste manual com provider real (antes de fechar F08)
Com microfone real, Chrome com WebGPU, em pt-BR e en-US: 3 entrevistas de 10 min (técnica, comportamental, sistema). Medir por turno: latência fim da fala → texto (STT), texto → primeiro áudio, taxa de erro de transcrição percebida, falsos positivos do VAD (ruído de fundo), qualidade das vozes Piper/Kokoro vs `speechSynthesis`. Repetir uma entrevista sem WebGPU (WASM) e uma no Firefox. Registrar em §8; resultados decidem F08-1 e F08-3.

### 6.5 Definição de pronto
- Testes de 6.2 e 6.3 verdes na CI; cobertura ≥ 80% em `packages/shared/voice` e `apps/web/src/voice`.
- Entrevista real de 10 min em pt-BR mãos livres, com barge-in funcionando, sem travar e com feedback coerente (checklist de 6.4 preenchido).
- Nenhum áudio sai da máquina com os provedores padrão (verificado com DevTools → Network durante a entrevista: só WS de texto e Hub na hora do download).
- Documentação do usuário: requisitos de hardware, tamanhos de download, como trocar provedores, limitações por navegador.
- `../02`, `../03 §11/§16`, `../05 L8` e `../08 §3` atualizados com o que mudou.

---

## 7 · Riscos específicos
| Risco | Mitigação |
|-------|-----------|
| Whisper em WASM lento demais em máquinas fracas (> 5 s por segmento) | detectar ausência de WebGPU e sugerir `web-speech` ou modelo `base`; mostrar latência medida no teste de mic |
| Vozes pt-BR locais com qualidade abaixo do esperado | `speechSynthesis` e serviços pagos a um clique; teste de voz antes de iniciar |
| VAD disparando com ruído de fundo (barge-in falso) | sensibilidade e silêncio configuráveis; exigir ≥ 300 ms de voz contínua para barge-in |
| Download de modelos grande e bloqueado em redes corporativas | catálogo permite espelho/URL alternativa; modo texto sempre disponível |
| Bibliotecas de TTS/STT em WASM com API instável ou licenças incompatíveis | fixar versões; verificar licenças (6.1 item 5); interfaces isolam troca |
| Sessão viva do SDK consumindo memória durante pausas longas | hibernar em 10 min e retomar com `resume` |
| Modelo respondendo com listas/markdown (ruim em áudio) | instrução na skill + pós-processamento que remove marcação antes do TTS |

## 8 · Registro de execução
(Preencher durante a implementação: datas, latências medidas, provedores testados, decisões tomadas.)
