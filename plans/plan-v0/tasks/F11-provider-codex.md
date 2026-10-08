# F11 · Provider Codex

Entregável 11 do plan-v0. Entrega o **segundo provider** previsto em `../01-viabilidade.md §2.2` e `../07-dois-modos.md`: o usuário escolhe o Codex (OpenAI) com a própria assinatura do ChatGPT, nos dois modos. Modo A: o chat web usa `codex exec` dentro do container, normalizado para a mesma interface `Provider` do Claude Code. Modo B: o usuário conversa no Codex CLI do host, e um adaptador em `adapters/codex/` gera as instruções e a configuração de MCP a partir de `plugin/`. O núcleo (dados, tools MCP, skills, features) não muda. Depende de F01 (provider abstrato, Docker), F04 (`plugin/`, MCP HTTP, sessões) e F10 (Configurações, medidor).

Status: **em escopo** (2026-10-07). Nada implementado.

> **Aviso de verificação.** Nada sobre o Codex foi verificado contra a documentação oficial nesta sessão de planejamento. Todo item marcado **[a verificar]** descreve o comportamento esperado e deve ser confirmado na documentação oficial do Codex antes de implementar. A lista consolidada está em §6.1. Se a verificação contradisser o plano, atualizar este arquivo antes de codar.

---

## 1 · Objetivo e resultado esperado

1. No onboarding (passo 1) e em Configurações, o usuário escolhe **Codex** como provider e vê o estado do login (instalado, logado, versão).
2. Faz o login da assinatura do ChatGPT **uma vez** dentro do container, com credencial persistida em volume próprio, igual ao fluxo do Claude Code.
3. Usa chat, ingestão, clarificação e features no modo A com o Codex, com a mesma UI, as mesmas skills e as mesmas tools MCP; a UI indica o que degrada (ver §2.6).
4. No modo B, roda `narnia-jobs install-plugin codex` e passa a usar o recrutador dentro do Codex CLI do host, com os dados servidos pelo MCP HTTP do container.
5. Vê o uso do Codex no medidor (ao menos pelos logs próprios) e pode trocar de provider a qualquer momento sem perder dados: perfis, fatos e documentos são do núcleo, não do provider.

### Dentro do escopo
- `CodexProvider` em `apps/api/src/providers/codex/` implementando a interface `Provider` (de F01/F04): `detect`, `extractCv`, `startSession`, `send`, `abort`, `resume` (se suportado **[a verificar]**).
- Normalização de eventos do Codex para o modelo de eventos interno (`text_delta`, `tool_use`, `tool_result`, `result` com `usage`, `error`).
- Instalação do Codex CLI na imagem Docker; volume `codex-auth` para `~/.codex`; comando de login documentado.
- Configuração de MCP HTTP do Narnia para o Codex (modo A dentro do container; modo B no host) **[a verificar: formato e local da config]**.
- `adapters/codex/`: gerador de `AGENTS.md` + skills/instruções a partir de `plugin/` (persona, skills) **[a verificar: suporte a skills no Codex]**.
- Seleção de provider (onboarding, Configurações), mapeamento de modelos (chat/ingest/documents/interview/clarify → modelos do Codex), medidor com `origin=narnia` para Codex e, se existirem logs locais de sessão **[a verificar]**, um parser à parte.
- Matriz de paridade de features documentada e refletida na UI.

### Fora do escopo (e para onde vai)
- Provedores além do Codex (Gemini CLI etc.) → futuro, pelo mesmo padrão.
- Entrevista por voz com Codex: depende de sessão viva com streaming input **[a verificar]**; se não houver, degrada para turnos com reinício de processo (latência maior) ou fica indisponível e documentado.
- Modo B com hooks (injeção automática do cartão do perfil): se o Codex não tiver hooks equivalentes, o cartão vai no `AGENTS.md` gerado e é regenerado ao trocar perfil (ver §2.5).
- Uso de API key da OpenAI em vez de assinatura → suportado só se o CLI suportar nativamente; a UI não pede chave.

---

## 2 · Arquitetura deste entregável

### 2.1 Visão
```
container narnia-jobs (imagem ganha o Codex CLI)
  apps/api
   ├─ providers/claude-code/   (F01/F04)               ┐ mesma interface Provider
   └─ providers/codex/         (F11)                   ┘
        ├─ detect.ts          `codex --version` + estado de login [a verificar comando/arquivo]
        ├─ exec.ts            spawn `codex exec` por turno ou sessão [a verificar flags: saída JSON, modelo, cwd, sandbox, aprovação]
        ├─ events.ts          parser do stream de eventos do Codex → eventos internos
        └─ mcp-config.ts      escreve a config de MCP do Narnia (HTTP /mcp) no local esperado pelo Codex [a verificar]
volumes: ./data:/data · claude-auth:/home/node/.claude · codex-auth:/home/node/.codex [a verificar o diretório]
```
- A escolha do provider é global (`settings.provider.active`) com possibilidade de override por tarefa em fase futura.
- Sessões de chat guardam `provider` e `provider_session_id`; trocar o provider ativo não migra sessões antigas (ficam somente leitura, rotuladas).

### 2.2 Interface `Provider` (herdada; o que o Codex precisa cumprir)
```ts
interface Provider {
  id: "claude-code" | "codex" | "mock";
  detect(): Promise<ProviderStatus>;                            // instalado, logado, versão, dica de login
  extractCv(input, onProgress?): Promise<ExtractionResult>;      // saída estruturada em JSON
  startSession(opts: SessionOpts): Promise<ProviderSession>;     // plugin/, prompt de sistema, tools permitidas, modelo
}
interface ProviderSession {
  id: string; send(text: string): AsyncIterable<ProviderEvent>; abort(): void; close(): Promise<void>;
}
type ProviderEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_use"; name: string; input: unknown }
  | { type: "tool_result"; name: string; output: unknown }
  | { type: "result"; usage: Usage; costUsdEst?: number; providerSessionId?: string }
  | { type: "error"; code: string; message: string };
```
Lacunas prováveis do Codex a tratar na implementação, todas **[a verificar]**:
- Saída estruturada por JSON Schema: se não houver equivalente ao `outputFormat`, `extractCv` usa prompt "responda apenas JSON" + validação zod com até 2 retentativas.
- Sessão viva com entrada em streaming: se não houver, `ProviderSession.send` relança `codex exec` por turno com `resume` do id de sessão, ou reenvia o histórico resumido.
- Prompt de sistema e carregamento de `plugin/`: se o Codex não carregar plugins, o adaptador gera `AGENTS.md` no `cwd` da sessão com a persona + skill ativa.
- Ferramentas nativas (busca na web, shell): restringir via flags/config de sandbox e aprovação para que o recrutador só use as tools MCP e, se existir, busca na web.

### 2.3 Normalização de eventos
- `events.ts` consome o stream do `codex exec` (JSON por linha ou outro formato **[a verificar]**) e emite `ProviderEvent`. Mapeamento esperado: mensagens parciais do assistente → `text_delta`; chamadas de ferramenta/MCP → `tool_use`/`tool_result`; evento final com contagem de tokens → `result` (se o Codex não reportar tokens, estimar por `chars/4` e marcar `usage.estimated = true`).
- Fixtures reais do stream, capturadas na verificação documental/prototipagem, viram testes de snapshot.

### 2.4 Modo A: login e MCP dentro do container
- Imagem: instala o Codex CLI (pacote npm oficial **[a verificar nome e versão]**); `codex-auth` montado em `~/.codex` **[a verificar]**.
- Login: `docker compose run --rm narnia-jobs codex login` (ou o comando equivalente **[a verificar]**), com fluxo por URL/código ou device flow; `detect()` lê o estado sem gastar tokens.
- MCP: `mcp-config.ts` escreve a entrada do servidor `narnia-jobs` apontando para `http://127.0.0.1:3100/mcp` no arquivo de configuração do Codex dentro do container **[a verificar: formato TOML/JSON, suporte a transporte HTTP, cabeçalho de autenticação]**. Se o Codex só aceitar MCP por stdio, o `api` expõe também um shim stdio (`narnia-jobs mcp-stdio`) que faz proxy para o HTTP.

### 2.5 Modo B: adaptador `adapters/codex/`
```
plugin/ (fonte da verdade) ─► adapters/codex/generate.ts ─►
   ~/.codex/config.toml (ou equivalente) com o MCP narnia-jobs → http://127.0.0.1:${NARNIA_PORT}/mcp   [a verificar]
   <pasta de trabalho>/AGENTS.md: persona do recrutador + cartão do perfil ativo + índice de skills
   skills: se o Codex suportar skills [a verificar], copia/transforma plugin/skills/*; senão, cada skill vira uma seção do AGENTS.md
```
- `narnia-jobs install-plugin codex` executa o gerador e imprime o que escreveu; `narnia-jobs install-plugin codex --refresh` regenera após trocar de perfil (sem hooks, o cartão fica no arquivo).
- Troca de perfil no modo B com Codex: a tool `profile.switch` funciona, mas o cartão injetado só muda após `--refresh`; a skill avisa.

### 2.6 Paridade de features (preencher após a verificação)
| Feature | Claude Code | Codex (esperado) | Degradação prevista |
|---------|-------------|------------------|---------------------|
| Chat do recrutador | completo | completo via MCP | prompt de sistema por AGENTS.md se não houver opção direta |
| Ingestão (extração JSON) | `outputFormat` | prompt JSON + validação | retentativas; custo um pouco maior |
| Clarificação | sessão viva | sessão por turno ou viva **[a verificar]** | latência maior se relançar processo |
| Gerar CV / carta / LinkedIn | completo | completo (conteúdo JSON) | idem ingestão |
| Analisar vaga | completo | completo | — |
| Candidaturas + Google Calendar | MCP oficial do Google via Claude Code | depende do Codex suportar MCP remoto com OAuth **[a verificar]** | link + `.ics` sempre disponíveis |
| Entrevista por voz | streaming input | **[a verificar]** | turnos sem sessão viva ou indisponível |
| Pesquisa na web para dados obrigatórios | WebSearch nativa | ferramenta de busca do Codex, se houver **[a verificar]** | agente pede ao usuário a fonte |
| Hooks (cartão por sessão, modo B) | hook SessionStart | sem equivalente conhecido **[a verificar]** | AGENTS.md regenerado |
| Medidor | logs do CLI + próprios | logs próprios (+ logs do Codex se existirem **[a verificar]**) | totais só do Narnia, rotulados |

### 2.7 API
| Rota | Função |
|------|--------|
| `GET /api/provider/status?provider=codex` | `detect()` do Codex |
| `PUT /api/settings` (`provider.active`, `models.codex.*`) | troca de provider e mapeamento de modelos (F10) |
| `GET /api/provider/parity` | matriz de §2.6 em JSON para a UI mostrar o que degrada |
| `POST /api/provider/install-plugin {provider:"codex"}` | gera os artefatos do modo B (mesmo que o comando do lançador) |

---

## 3 · Dados deste entregável

| Tabela | Alterações |
|--------|-----------|
| `settings` | `provider.active` aceita `codex`; `models.codex.{chat,ingest,documents,interview,clarify}`; `provider.codex.last_detect_json` |
| `chat_session` (F04) | `provider` já existe; sessões de outro provider ficam `read_only = 1` quando o ativo muda |
| `ingestion_run`, `job`, `document_version`, `interview_session` | coluna `provider` preenchida com `codex` quando for o caso |
| `usage_event` (F10) | `provider = codex`; `usage.estimated` (bool) quando tokens vieram por estimativa |
| `provider_model_map` (nova, opcional) | `provider`, `task`, `model_id`, `label`, `tier` (fast/quality), `updated_at` |
| Arquivos | volume `codex-auth`; `/data/config.json` ganha `providers.codex.{installed, loginHint}` (sem credenciais) |

Regras: nenhuma credencial do Codex entra no SQLite, no `config.json` nem na exportação; o volume de credencial é separado do de dados, como no Claude Code.

---

## 4 · Layouts deste entregável

| Tela | Componentes | Estados a cobrir |
|------|-------------|------------------|
| Onboarding passo 1 (F01) | `ProviderCard` do Codex habilitado: estado, versão, comando de login copiável, "verificar de novo" | não instalado · instalado sem login · logado · erro ao executar |
| Configurações → Provider (F10) | `ProviderSwitch` (Claude Code / Codex), `ModelMap` por tarefa com lista de modelos do provider, `ParityTable` (o que degrada), botão "gerar config do modo B" com saída | provider logado / não logado · troca com sessões ativas (aviso) · paridade com itens degradados |
| Shell (L0) | indicador de provider/modelo no topo mostra Codex; sessões antigas de outro provider com rótulo "somente leitura (Claude Code)" | — |
| Chat (F04) | banner discreto quando uma feature está degradada no provider atual (link para a paridade) | — |
| `/uso` (F10) | filtro por provider; eventos com `estimated` marcados | — |

---

## 5 · Decisões em aberto deste entregável

| # | Decisão | Opções | Padrão proposto |
|---|---------|--------|-----------------|
| F11-1 | Sessão de chat com Codex | sessão viva (se o CLI suportar) · processo por turno com `resume` · processo por turno com histórico resumido | **sessão viva se existir; senão `resume`**; decidir após 6.1 |
| F11-2 | Saída estruturada | recurso nativo (se existir) · prompt JSON + zod + 2 retentativas | **nativo se existir; senão prompt+zod** |
| F11-3 | Transporte MCP para o Codex | HTTP direto · shim stdio → HTTP | **HTTP se suportado; senão shim** |
| F11-4 | Modo B sem hooks | AGENTS.md regenerado por comando · gerar a cada troca de perfil automaticamente via tool | **comando `--refresh`** em F11; automação depois |
| F11-5 | Tokens não reportados pelo Codex | estimar por `chars/4` e marcar · não registrar | **estimar e marcar `estimated`** |
| F11-6 | Mapeamento de modelos padrão | um "rápido" para ingestão e um "qualidade" para o resto · um único | **dois níveis**, ids definidos após 6.1 |
| F11-7 | Troca de provider com sessões ativas | bloquear até encerrar · encerrar automaticamente com aviso | **aviso + encerrar** |
| F11-8 | Ferramentas nativas do Codex no recrutador | desligar tudo exceto busca web (se houver) · permitir sandbox de leitura | **só busca web**, sandbox mais restritivo disponível |

---

## 6 · O que precisa estar coberto para o F11 funcionar

### 6.1 Pré-requisitos e verificação documental (bloqueante)
Antes de qualquer código, confirmar na documentação oficial do Codex (OpenAI) e registrar em §8, com URL e data:
1. Nome do pacote/instalador do CLI, versão estável, requisitos (Node/binário), funcionamento em `node:22-slim`.
2. Comando de login com assinatura do ChatGPT, se funciona sem navegador (URL/código ou device flow), onde a credencial é gravada (diretório a montar como volume) e se há comando de status de login sem gastar tokens.
3. `codex exec` (ou equivalente não interativo): flags para saída em JSON/eventos por linha, modelo, diretório de trabalho, sandbox/aprovação, limite de turnos, retomada de sessão, entrada em streaming.
4. Formato exato do stream de eventos: mensagens parciais, chamadas de ferramenta, evento final, contagem de tokens.
5. Suporte a saída estruturada por JSON Schema.
6. Configuração de servidores MCP: arquivo, formato, transporte HTTP (com ou sem cabeçalhos de autenticação) e stdio, escopo por projeto/usuário.
7. Suporte a instruções de projeto (`AGENTS.md`), skills, hooks ou equivalentes.
8. Suporte a MCP remoto com OAuth (para o Google Calendar do F07).
9. Existência e formato de logs locais de sessão (para o medidor) e de um comando de listar/remover sessões (para "limpar cache").
10. Ferramenta de busca na web nativa e como restringir as demais ferramentas.
11. Modelos disponíveis na assinatura e seus ids; restrições de termos de uso para uso do login em ferramentas de terceiros (registrar a posição, como foi feito para o Claude em `../01 §1`).

Dependências de tasks: F01 (interface `Provider`, Docker, lançador), F04 (`plugin/`, MCP HTTP, sessões, modo B), F10 (Configurações, medidor, doctor), F07/F08 só para a matriz de paridade.

### 6.2 Testes unitários (Vitest) · obrigatórios
**`apps/api/src/providers/codex`**
- `detect`: CLI ausente → `installed=false`; instalado sem login → `loggedIn=false` com `loginHint`; logado → versão preenchida (processos mockados por injeção de `exec`).
- `events.ts`: fixtures reais do stream (capturadas em 6.1) → sequência de `ProviderEvent` esperada (snapshot); linhas desconhecidas ignoradas; evento final sem tokens → `usage.estimated=true` com valor `chars/4`; erro do CLI → `error` com código.
- `exec.ts`: monta a linha de comando com as flags decididas (modelo, cwd, sandbox, limite de turnos, resume); aborta o processo em `abort()`; não deixa processo órfão em `close()`.
- `extractCv`: com fixture de resposta JSON válida → resultado validado; JSON inválido → até 2 retentativas → erro tipado; usa o modelo "rápido" do mapeamento.
- `mcp-config.ts`: escreve a configuração esperada (snapshot) sem sobrescrever outras entradas do usuário; idempotente; porta vinda de `NARNIA_PORT`.
- Fábrica de providers: `settings.provider.active=codex` → `CodexProvider`; sessões antigas de outro provider abrem em somente leitura.

**`adapters/codex`**
- `generate.ts`: a partir de um `plugin/` fixture, gera `AGENTS.md` com persona + cartão + índice de skills (snapshot) e a config de MCP; `--refresh` substitui só a seção do cartão; falha clara se `plugin/` estiver incompleto.

**`packages/core`**
- Medidor: eventos `provider=codex` agregados e filtráveis; eventos `estimated` somados à parte na UI (campo no summary).

**`apps/web`**
- `ProviderCard` do Codex nos 4 estados; `ProviderSwitch` com aviso de sessões ativas; `ModelMap` por tarefa; `ParityTable` renderiza degradações; banner no chat quando a feature atual está degradada.
- i18n: novas strings no dicionário.

### 6.3 Testes e2e (Playwright, Chromium) · obrigatórios
Com `NARNIA_PROVIDER=mock-codex`: um `MockCodexProvider` que reproduz o **formato de eventos real do Codex** (fixtures de 6.1) passando pelo mesmo `events.ts`, para testar a normalização de ponta a ponta sem assinatura.
- **E2E-01 onboarding com Codex**: passo 1 → escolher Codex → estado "não logado" com comando → simular login (endpoint do mock) → verificar → avançar → CV extraído e revisado com o Codex → dashboard.
- **E2E-02 chat com Codex**: sessão nova → mensagem → resposta em stream → tool MCP chamada (chip visível) → `usage_event` com `provider=codex`.
- **E2E-03 troca de provider**: Claude Code → Codex com sessão ativa → aviso → encerrar → sessão antiga em somente leitura → nova sessão com Codex.
- **E2E-04 paridade na UI**: Configurações mostra a matriz; abrir Entrevista com Codex degradado → banner com explicação (ou indisponível, conforme 6.1).
- **E2E-05 modo B**: `narnia-jobs install-plugin codex` no compose de teste → arquivos gerados com a porta correta → `--refresh` após `profile.switch` atualiza o cartão no `AGENTS.md`.
- **E2E-06 medidor**: duas sessões, uma por provider → `/uso` filtra por provider; eventos estimados marcados.
- **E2E-07 erro do CLI**: mock devolve erro de autenticação no meio → mensagem clara e sugestão de login; sessão recuperável após "verificar login".
- **E2E-08 gerar CV com Codex**: documento gerado via prompt JSON + validação → versão salva → export PDF.

### 6.4 Teste manual com provider real (antes de fechar F11)
Com assinatura real do ChatGPT: login no container, chat de 10 turnos, 1 ingestão de CV, 1 geração de CV, modo B no host com o Codex CLI (recrutador responde com dados via MCP). Medir latência por turno (comparar com Claude Code), taxa de JSON inválido na extração, tokens reportados vs estimados. Registrar em §8; decide F11-1, F11-2, F11-5 e F11-6.

### 6.5 Definição de pronto
- §6.1 registrado em §8 com fontes; §2.6 preenchido com fatos verificados; este arquivo atualizado onde a verificação contradisse o esperado.
- Testes de 6.2 e 6.3 verdes na CI; cobertura ≥ 80 % em `providers/codex` e `adapters/codex`.
- Onboarding completo e chat funcionando com o Codex real; modo B funcionando no host.
- README com instalação/login do Codex, matriz de paridade e a posição sobre termos de uso.
- `../01 §2.2`, `../03 §10/§12`, `../07 §2` e `../08 §1` atualizados.

---

## 7 · Riscos específicos
| Risco | Mitigação |
|-------|-----------|
| Codex sem sessão viva/streaming input → latência alta na clarificação e inviabilidade da voz | `resume` por turno; voz marcada como degradada/indisponível na paridade |
| Sem saída estruturada nativa → JSON inválido na ingestão | prompt + zod + retentativas; medir taxa no teste manual; modelo "qualidade" como fallback |
| Config de MCP do Codex sem transporte HTTP ou sem cabeçalhos | shim stdio → HTTP no `api`; token de boot passado por variável de ambiente ao shim |
| Termos de uso da OpenAI sobre uso do login em ferramentas de terceiros | registrar a posição oficial (6.1 item 11) e documentar como no caso do Claude; modo B como caminho seguro |
| Formato de eventos mudar entre versões | fixar versão do CLI na imagem; fixtures por versão; parser tolerante |
| Sem logs locais → medidor parcial | eventos próprios com `estimated`; rotular na UI |
| Drift entre `plugin/` e `AGENTS.md` gerado | gerador é a única fonte; teste de snapshot; `--refresh` documentado |

## 8 · Registro de execução
(Preencher durante a implementação: resultado de cada item de §6.1 com URL e data, versão do CLI, fixtures capturadas, decisões tomadas.)
