# F12 · Extensão do navegador

Entregável 12 do plan-v0. Uma extensão do Chrome (Chromium) que liga as páginas abertas pela pessoa ao narnia local: **captura de dados** (vagas de qualquer plataforma, enviadas à F06) e **ajuda no preenchimento de formulários de candidatura** (perguntas localizadas e respostas sugeridas numa janela própria, com copiar, refazer e chat). A análise da página do perfil do LinkedIn ficou para a F09, depois desta task, lendo a página por esta extensão (F12-7). Depende de F04 (chat, skills, provider pela assinatura), F05 (CV da vaga) e F06 (vagas). O gate pairwise de prompts (F04-avaliacoes AV-5, M7) vem antes, para os prompts novos desta task já nascerem passando por ele.

Status: **em implementação** (2026-10-22). M1 (extensão, pareamento, Configurações) e M2 (captura de vaga e janela `/candidatura`) entregues; M3 em diante a fazer. Decisões fechadas: F12-1 a F12-13 (as propostas P-1 a P-5 do rascunho viraram F12-9 a F12-13).

---

## 1 · Decisões do dono

| Id | Tema | Decisão | Data |
|----|------|---------|------|
| F12-1 | Escopo da primeira versão | A extensão **nasce com captura de dados e preenchimento de formulários**. Ler o perfil da pessoa em outras plataformas (Gupy, Indeed…) fica para o futuro, fora desta versão. | 2026-10-21 |
| F12-2 | Janela | Ao acionar a extensão, abre uma **janela popup** (`chrome.windows.create({type: "popup"})`: sem abas nem barra de navegação; o Chrome pode mostrar uma faixa fina, só de leitura, com o endereço) que carrega uma **página do próprio narnia** (ex.: `/candidatura`), reaproveitando o chat e as tools. A extensão em si só lê a página e entrega ao narnia. | 2026-10-21 |
| F12-3 | Formulário de candidatura | A extensão captura a estrutura do formulário (rótulos, campos, opções, ajudas); o **Haiku localiza e organiza as perguntas**; uma **skill de candidatura com o Sonnet** sugere as respostas a partir dos dados da pessoa e da vaga, sem inventar (mesma regra do CV). Na janela, cada resposta tem **copiar** e **refazer**; refazer abre o **chat na mesma janela**, no contexto daquela pergunta. Tudo pela assinatura. Preencher sozinho no formulário e enviar não estão no escopo. | 2026-10-21 |
| F12-4 | Uma extensão ou uma por clone | **Uma extensão só**; nas opções, a instância (endereço) e um **código de pareamento** mostrado em Configurações do narnia (sem copiar token). O dono carrega a extensão a partir do `.owner-src` (só muda com `promote`); os testes do Claude usam Chromium headless próprio contra a instância `claude`, nunca o Chrome do dono. | 2026-10-21 |
| F12-5 | Ordem | Gate pairwise (F04-avaliacoes M7) → **F12** → F07. Antes da F07 a janela de candidatura não registra candidatura no kanban; a ligação entra na F07. | 2026-10-21 |
| F12-6 | Prompts | Todo prompt novo desta task (localizador de campos, skill de candidatura) é versionado no Phoenix com dataset, avaliadores e juiz, e passa pelo gate com pairwise (AV-5) antes do commit. | 2026-10-21 |
| F12-7 | LinkedIn | A **análise do perfil do LinkedIn fica na F09**, depois da F12: a F09 lê a página do perfil pela extensão desta task. A F12 não traz nada específico do LinkedIn além da captura de vagas. O destino da importação pelo ZIP (F03-7) se decide na F09. | 2026-10-22 |
| F12-8 | Navegadores | **Alvo por enquanto: só o Chrome.** Testes e instruções de instalação só para ele; derivados do Chromium (Edge, Brave) e Firefox ficam para o futuro. | 2026-10-22 |
| F12-9 | Credencial da extensão | O pareamento gera um **token de dispositivo** próprio (persistente, revogável em Configurações), em vez do token do boot. Vale para toda a API, como o do dono: a instância é local e de uma pessoa só, e a janela popup carrega a web inteira. | 2026-10-22 |
| F12-10 | Build e carregamento | Pacote `apps/extension/` (Manifest V3, TypeScript, build no Docker). `./start.sh extension` gera `apps/extension/dist/`; o `promote` também gera. O dono carrega uma vez `.owner-src/apps/extension/dist` em `chrome://extensions` ("Carregar sem compactação") e depois só clica "Recarregar" após cada `promote`. Chrome Web Store fora desta versão. | 2026-10-22 |
| F12-11 | Formulário sem a descrição da vaga | A janela **não** responde só com o perfil: pede para a pessoa **abrir a página da descrição da vaga** (e clicar no narnia lá, o que salva a vaga e a liga ao formulário) **ou colar a descrição no chat** da janela. Só depois as respostas são geradas. | 2026-10-22 |
| F12-12 | Perguntas sensíveis | Autodeclaração (raça, gênero, deficiência, orientação, religião, idade e afins): quando aparece uma pergunta assim sem dado guardado, o **chat da janela pergunta à pessoa** e **ingere a resposta como evidência** (fato da pessoa, pela ingestão da conversa); com o dado já guardado, a resposta sai dele, sem perguntar de novo. Consentimentos (LGPD, termos) ficam sempre com a pessoa, sem sugestão. Pretensão salarial usa o piso e a pesquisa da F06, sem número inventado. | 2026-10-22 |
| F12-13 | Ligação com a F07 | Até a F07, a janela guarda o formulário e as respostas (`application_form`) ligados à vaga; a F07 transforma isso em candidatura ("marquei como enviada") sem migração destrutiva. | 2026-10-22 |

## 2 · Decisões abertas

Nenhuma.

## 3 · Objetivo e resultado esperado

A pessoa navega como sempre. Numa página de vaga ou de candidatura, clica no ícone do narnia: abre uma janela pequena do narnia ao lado, que

1. **na vaga**: mostra o que foi lido (título, empresa, local, trecho da descrição) e um botão **Salvar vaga**, que entra pelo fluxo da F06 (duplicata, extração, análise);
2. **no formulário**: lista as perguntas do formulário na ordem da página, cada uma com a resposta sugerida, **Copiar** e **Refazer**; Refazer abre o chat na mesma janela, já no contexto daquela pergunta, e a resposta combinada no chat volta para a lista.

A extensão não preenche nem envia nada (F12-3) e só lê a página quando a pessoa clica (sem leitura em segundo plano).

### Dentro do escopo
- Extensão MV3 para o Chrome (F12-8): ícone, página de opções (endereço da instância, código de pareamento, estado da conexão), leitura da página sob demanda.
- Pareamento e token de dispositivo (F12-9); lista de dispositivos com revogar em Configurações.
- Página `/candidatura` do narnia na janela popup, com chat embutido.
- Captura de vaga → `POST /api/postings/intake` (texto já capturado + URL + campos do JSON-LD).
- Captura de formulário → localizador (Haiku) → respostas (Sonnet) → copiar, refazer, chat.
- Prompts novos com dataset, avaliadores, juiz e gate pairwise (F12-6).
- Tools MCP para o modo B (ler o formulário e as respostas, gravar resposta revisada).

### Fora do escopo (e para onde vai)
- Preencher campos ou enviar o formulário (F12-3; fora do plano).
- Registrar candidatura no kanban (F07, F12-13).
- Perfil do LinkedIn (F09, F12-7); perfil em outras plataformas (futuro, F12-1).
- Edge, Brave, Firefox; publicação na Chrome Web Store (futuro, F12-8).
- Upload de arquivo pelo formulário (o CV): a janela só oferece **baixar o CV da vaga** (F05) para a pessoa anexar.

## 4 · Arquitetura

### 4.1 Revisão contra o código (2026-10-22)
- **Autenticação** (`apps/api/src/auth.ts`): `Authorization: Bearer` ou cookie `narnia_token`; `?token=` só em `GET /api/auth/enter`. Um token único, gerado no boot se `NARNIA_TOKEN` não existe (`server.ts:36`); nada de pareamento. `hostGuard` (`hosts.ts`) aceita `127.0.0.1`/`localhost`.
- **CORS**: não existe. O service worker da extensão com `host_permissions` para `http://127.0.0.1/*` e `http://localhost/*` não depende de CORS, então **a API continua sem CORS**.
- **Vagas**: `POST /api/postings/intake` já aceita `text` capturado (sem fetch no servidor), `url` e `fields` parciais; falta só um campo para o JSON-LD bruto e o HTML não é necessário.
- **Chat**: não há componente de chat embutível; a conversa vive em `features/chat/ChatPage.tsx` (760 linhas) com `hooks/useChat.ts`. Sessão com nota de contexto segue o padrão de `SessionManager.openDocumentFeedback` (criar `job`, `setPosting`, `renderNote`, `send(..., {display, asUser})`).
- **Web**: React 19 + TanStack Router (`apps/web/src/app/router.tsx`); token na web por `sessionStorage` + cookie via `/api/auth/enter`.
- **Prompts estruturados**: `packages/providers/src/claude-code/prompt-specs.ts` + `prompts/*.md`; schemas em `packages/shared`; datasets em `apps/api/src/evals/prompt-datasets.ts`; juízes em `evals/judges/`.
- **e2e**: Playwright com Chromium embutido, sem extensão; carregar extensão exige `launchPersistentContext` com `--load-extension` (funciona em headless no Chromium do Playwright).
- **Portas**: tudo em `127.0.0.1`, porta por variável (dono 3100 na produção, 5173 no dev; `claude` 5174/3200): o endereço da instância é configurável nas opções.

### 4.2 Peças

```
Chrome do usuário                               narnia (instância local)
┌──────────────────────────────┐                 ┌───────────────────────────────────────────┐
│ página da vaga / formulário  │                 │ api                                        │
│   ▲ content script (sob      │  captura JSON   │  POST /api/extension/pair  (código → token)│
│   │ demanda, activeTab)      ├────────────────►│  POST /api/extension/captures              │
│ service worker (MV3)         │  Bearer device  │  GET  /api/extension/captures/:id          │
│   └─ chrome.windows.create ──┼──────┐          │  POST /api/applications/:id/answers …      │
│ opções: instância + código   │      │          │ worker: application.locate (Haiku)         │
└──────────────────────────────┘      │          │         application.answer (Sonnet)        │
                                      ▼          │ web: /candidatura?captura=<id>             │
                          janela popup ──────────►  (chat embutido, copiar, refazer)          │
                                                 └───────────────────────────────────────────┘
```

### 4.3 Extensão (`apps/extension/`)
- Manifest V3; permissões mínimas: `activeTab`, `scripting`, `storage`; `host_permissions` só para `http://127.0.0.1/*` e `http://localhost/*` (falar com o narnia). Sem `<all_urls>`: a página só é lida quando a pessoa clica (o `activeTab` dá acesso à aba naquele momento).
- **Iframes de outra origem** (Greenhouse, Lever e Workday embutem o formulário): o `activeTab` não alcança; a extensão pede, na hora, `chrome.permissions.request` para a origem do iframe (permissão opcional `optional_host_permissions: ["https://*/*"]`), com a explicação na janela.
- **Leitor** (`src/capture/`), puro e testável em jsdom:
  - `readPosting(document)`: URL, título, `innerText` limpo do conteúdo principal (heurística de maior bloco de texto, sem menus e rodapé), JSON-LD `JobPosting` se houver.
  - `readForm(document)`: campos visíveis (`input`, `textarea`, `select`, `[contenteditable]`, `role=radiogroup/listbox/combobox`) com rótulo (por `label[for]`, `aria-labelledby`, `aria-label`, texto vizinho), tipo, opções, obrigatório, limite de caracteres, ajuda (`aria-describedby`), grupo (`fieldset/legend`, títulos de seção), ordem e um seletor estável (só para referência; nada é preenchido). Entra no Shadow DOM aberto (Workday). Senhas, cartões e campos ocultos ficam de fora.
  - Formulário em várias etapas: cada clique é uma captura nova; a janela junta as etapas do mesmo formulário (mesma URL base + vaga) em vez de criar outro.
- **Service worker**: no clique, injeta o leitor (`chrome.scripting.executeScript`, `allFrames` quando autorizado), manda a captura para `POST /api/extension/captures` e abre (ou foca) a janela popup em `<instância>/candidatura?captura=<id>`. Se a janela já está aberta, reaproveita.
- **Opções**: endereço da instância (padrão `http://127.0.0.1:3100`), código de pareamento, botão "Testar conexão", nome do dispositivo. Guarda o token em `chrome.storage.local`.
- **Login na janela**: a janela abre `<instância>/api/extension/enter?device=<token>` (como o `/api/auth/enter`: grava o cookie e redireciona para `/candidatura?...`), para a web da janela ficar autenticada sem expor o token do dono.

### 4.4 Pareamento (F12-9)
- Configurações → "Extensão do navegador" → **Parear**: a API gera um código de 8 caracteres (sem 0/O/1/I), válido por 10 minutos e de uso único, mostrado com o endereço da instância.
- Na extensão, a pessoa cola o código; `POST /api/extension/pair {code, name}` (rota pública, com limite de tentativas) devolve um token de dispositivo aleatório. A API guarda só o hash (`extension_device`).
- `authMiddleware` passa a aceitar também tokens de dispositivo não revogados (atualiza `last_seen_at`). Revogar em Configurações derruba na hora.

### 4.5 Captura de vaga (F06)
- `POST /api/extension/captures {kind: "page", url, title, text, jsonLd?, form?}` guarda a captura e devolve `{id, posting?: duplicata provável}` (heurística local de URL e título, sem tokens).
- **Salvar vaga** na janela chama `POST /api/postings/intake {text, url, fields}`; `fields` vêm do JSON-LD (`hiringOrganization`, `jobLocation`, `baseSalary`, `datePosted`). Depois disso vale todo o fluxo da F06 (extração, duplicata pelo modelo, análise na conversa da vaga).
- `IntakeSchema` ganha `source: "extension"` para a origem aparecer na vaga.

### 4.6 Formulário: localizar e responder
1. **Localizar** (tarefa `application.locate`, fila `extract`, prompt `narnia-application-locate`, Haiku): entrada = campos brutos da captura; saída = perguntas normalizadas `{id, question, kind (texto curto, texto longo, escolha, múltipla, sim/não, número, data, arquivo, consentimento, autodeclaração), options[], required, maxChars?, fieldRefs[], section}`. Junta rótulos quebrados, separa "outro (especifique)", descarta campos de navegação e marca as de autodeclaração e de consentimento (F12-12). Uma heurística por código vem antes (campos óbvios como nome, e-mail e telefone saem direto dos dados, sem modelo).
2. **Pré-condições** (F12-11, F12-12):
   - **Sem a descrição da vaga** (a página do formulário não traz e nenhuma vaga ficou ligada): a janela não gera respostas. Mostra "Abra a página da descrição desta vaga e clique no narnia lá, ou cole a descrição aqui", com o chat aberto. Capturar a página da vaga salva a vaga (F06) e a liga ao formulário aberto na janela; texto colado no chat entra por `posting_create` e também liga. Vaga já salva com a mesma empresa e título é sugerida para confirmar.
   - **Autodeclaração sem dado guardado**: o chat da janela pergunta à pessoa, uma pergunta por vez, dizendo que a resposta fica guardada localmente e é reaproveitada em outros formulários; a resposta entra como evidência pela ingestão da conversa (F04), com origem "declarado pela pessoa". Com o dado guardado, a resposta é escolhida por código entre as opções da página (sem modelo); "Prefiro não informar" é sempre uma opção respeitada.
   - **Consentimentos**: só exibidos ("você decide"), sem sugestão.
3. **Responder** (tarefa `application.answer`, prompt `narnia-application-answer`, Sonnet): entrada = perguntas que não são de autodeclaração nem de consentimento + resumo do perfil (o mesmo `buildCvBrief` da F05, com os ids curtos) + vaga (se houver) + idioma do formulário; saída por pergunta `{id, answer, origins[], confidence, gap?}`. Regras do CV valem: cada afirmação aponta origem; sem dado, `gap` explica o que falta ("conte no chat") em vez de inventar; escolha só entre as opções da página; respeita `maxChars`. A conferência por código (`assembleAnswers`) recusa origem inexistente, número ou empresa fora dos dados e opção fora da lista.
4. **Refazer** abre, na mesma janela, uma conversa `job` com a vaga e a nota `candidatura-contexto.md` (pergunta, opções, limite, resposta atual) e a skill `responder-candidatura` (`plugin/skills/responder-candidatura/SKILL.md`, modos A e B). A tool `application_answer_save` grava a resposta combinada, que volta para a lista como versão nova (a anterior fica no histórico).

### 4.7 Janela `/candidatura`
- Rota nova em `router.tsx` (`/candidatura`, `validateSearch: {captura, formulario}`), com layout compacto (sem o shell lateral), pensado para ~420×720.
- O chat embutido exige extrair de `ChatPage.tsx` um componente `ChatPanel` (lista de mensagens, envio, estados), usado pela página do chat e pela janela; a página do chat continua igual (refatoração coberta pelos testes existentes do chat).
- A janela consulta a captura e o formulário pelo WebSocket já existente (estados de tarefa da F01).

### 4.8 API nova
| Rota | Faz |
|------|-----|
| `POST /api/extension/pairing` | gera código (Configurações) |
| `POST /api/extension/pair` | código → token de dispositivo (pública, limitada) |
| `GET /api/extension/devices` · `DELETE /api/extension/devices/:id` | lista e revoga |
| `GET /api/extension/enter?device=` | cookie para a janela e redireciona |
| `POST /api/extension/captures` · `GET /api/extension/captures/:id` | grava e lê a captura |
| `POST /api/applications` `{captureId, postingId?, profileId}` | cria o formulário e enfileira o localizador |
| `GET /api/applications/:id` | perguntas, respostas, estado |
| `POST /api/applications/:id/answers` `{questionIds?}` | (re)gera respostas |
| `POST /api/applications/:id/questions/:qid/chat` | abre a conversa de refazer |

### 4.9 Modo B
Tools MCP `application_get` (perguntas e respostas de um formulário) e `application_answer_save`; a skill `responder-candidatura` funciona no Claude Code com o link para a janela.

## 5 · Dados (migração nova, só aditiva)

| Tabela | Colunas principais |
|--------|-------------------|
| `extension_device` | `id`, `name`, `token_hash`, `created_at`, `last_seen_at`, `revoked_at` |
| `extension_pairing` | `code_hash`, `expires_at`, `used_at` (limpa as vencidas) |
| `extension_capture` | `id`, `kind`, `url`, `title`, `payload_json` (texto, JSON-LD, campos), `device_id`, `created_at` |
| `application_form` | `id`, `posting_id?`, `profile_id`, `url`, `locale`, `questions_json`, `status`, `facts_version`, `created_at`, `updated_at` |
| `application_answer` | `id`, `form_id`, `question_id`, `version`, `answer`, `origins_json`, `gap`, `source` (modelo, chat, editada), `created_at` |

Capturas e formulários são dados da pessoa: entram no backup e na exportação (F10), e "apagar dados" os apaga. Capturas sem formulário nem vaga são podadas após 30 dias.

## 6 · Layouts

**Opções da extensão**
```
narnia · extensão
Instância   [ http://127.0.0.1:3100        ]
Código      [ K7QM-3XPA ]   [Parear]
Estado      ● conectado como "Chrome do notebook"   [Testar]
```

**Janela · vaga**
```
┌ narnia ─────────────────────────────┐
│ Senior Backend Engineer · Nubank    │
│ São Paulo · híbrido · lido da página│
│ "We are looking for…" (trecho)      │
│ ⚠ parece a vaga "Backend Sr" salva  │
│ [Salvar vaga]  [Abrir a salva]      │
└─────────────────────────────────────┘
```

**Janela · formulário**
```
┌ narnia · candidatura ───────────────┐
│ Vaga: Backend Sr · Nubank  [trocar] │
│ (sem vaga: "abra a descrição da     │
│  vaga ou cole aqui" + chat)         │
│ Perfil: Engenharia backend [trocar] │
│ ─────────────────────────────────── │
│ 1. Por que você quer trabalhar aqui?│
│    "Venho de 6 anos em pagamentos…" │
│    origem: Acme, Globex  [Copiar]   │
│                          [Refazer]  │
│ 2. Anos com Kafka? (número)         │
│    ⚠ sem dados: conte no chat       │
│                          [Refazer]  │
│ 3. Gênero (autodeclaração)          │
│    ? o chat vai te perguntar        │
│ 📎 Baixar CV da vaga                │
└─────────────────────────────────────┘
```
Refazer troca a lista pelo chat na mesma janela, com "← voltar às perguntas".

**Configurações → Extensão do navegador**: botão Parear (código e validade), dispositivos com último uso e Revogar, link para as instruções de instalação.

## 7 · Marcos

| Marco | Entrega | Prova |
|-------|---------|-------|
| M1 | `apps/extension` (MV3, build no Docker, `./start.sh extension`, `promote` gera), pareamento, token de dispositivo, revogar, opções, seção em Configurações (botão Parear e dispositivos); tirar o aviso "em construção" do tutorial `/extensao` | unit da API e da extensão; e2e: parear e testar conexão com a extensão carregada |
| M2 | Leitor de vaga, captura, janela `/candidatura` modo vaga, Salvar vaga → F06 | e2e com página de vaga de fixture (com e sem JSON-LD), duplicata |
| M3 | Leitor de formulário (labels, grupos, Shadow DOM, iframes com permissão), `application.locate` + heurística + autodeclaração e consentimento; dataset, juiz e gate | unit em jsdom com fixtures no estilo Gupy, Greenhouse, Lever e Workday; gate real do prompt |
| M4 | `application.answer` + `assembleAnswers` + copiar + baixar CV; dataset, juiz e gate | unit da conferência; e2e com mock; gate real |
| M5 | `ChatPanel` extraído, refazer no chat, skill `responder-candidatura`, nota de contexto, tool `application_answer_save`, pedido da descrição da vaga (F12-11), autodeclaração perguntada e ingerida (F12-12), tools MCP do modo B | testes do chat seguem verdes; e2e refazer → resposta nova na lista; gate do chat com caso novo |
| M6 | Formulário em várias etapas, poda de capturas, backup/exportação, README (instalar no Chrome, parear, limites), registro | e2e de duas etapas; teste de upgrade do banco; teste manual do dono no Chrome dele |

## 8 · Testes

### 8.1 Unitários (Vitest)
- **Extensão**: `readPosting` e `readForm` em jsdom com fixtures HTML fictícias (rótulo por `for`, `aria-*`, texto vizinho, `fieldset`, radio, select, checkbox de consentimento, Shadow DOM, campos ocultos e senha excluídos); montagem do manifesto (permissões mínimas).
- **core**: pareamento (código, validade, uso único, hash), heurística de campos óbvios, classificação de autodeclaração e consentimento, resposta de autodeclaração por código a partir do fato guardado (com "prefiro não informar"), `assembleAnswers` (origem, número, opção fora da lista, `maxChars`), junção de etapas.
- **api**: rotas novas (auth por dispositivo, revogado = 401, limite de tentativas no `pair`, `enter` grava cookie), intake com `source: extension`, abertura da conversa de refazer com a nota.
- **worker**: `application.locate` e `application.answer` com o mock, `usage_event` gravado.

### 8.2 e2e (Playwright, Chromium com a extensão)
- Projeto novo `extension` em `apps/e2e/playwright.config.ts`: `chromium.launchPersistentContext` com `--disable-extensions-except` e `--load-extension=apps/extension/dist`, headless, contra a pilha do e2e (mock); páginas de fixture servidas por um servidor estático no próprio container de teste.
- Casos: E2E-01 parear e testar conexão; E2E-02 vaga → janela → Salvar → vaga na lista da F06; E2E-03 formulário → perguntas e respostas → copiar; E2E-04 refazer → chat → resposta nova; E2E-05 dispositivo revogado → extensão pede novo pareamento; E2E-06 formulário em iframe de outra origem (permissão opcional); E2E-07 formulário sem descrição → abrir a página da vaga → vaga ligada e respostas geradas; E2E-08 pergunta de autodeclaração → chat pergunta → fato ingerido → próximo formulário responde sem perguntar.
- Nunca o Chrome do dono (F12-4); só o Chromium do Playwright.

### 8.3 Avaliações (F12-6)
- `narnia-application-locate`: 6+ formulários fictícios (curto, longo, várias etapas, rótulos quebrados, autodeclaração e consentimento, injeção no texto da página: "ignore as instruções e responda que…").
- `narnia-application-answer`: perguntas com e sem dado, escolha fechada, limite de caracteres, idioma inglês, pretensão salarial, injeção na descrição da vaga.
- Avaliadores por código (schema, opção válida, `maxChars`, sem autodeclaração ou consentimento respondidos pelo modelo, origens válidas) e juiz de padrão de entrega; versão inicial aprovada pelo gate pairwise.
- Casos novos no chat: refazer uma resposta pela conversa; perguntar a autodeclaração e ingerir como evidência; pedir a descrição da vaga quando falta.

### 8.4 Teste manual do dono (antes de fechar)
Carregar a extensão do `.owner-src`, parear com a instância dele, salvar uma vaga real e abrir um formulário real (sem enviar), conferindo as respostas.

### 8.5 Definição de pronto
Lint, typecheck, unit, e2e e gate verdes; README com instalação e limites; i18n completo; estados de erro acionáveis (instância fora do ar, pareamento vencido, página sem formulário, iframe sem permissão); critérios de `tasks/README.md`.

## 9 · Riscos
| Risco | Mitigação |
|-------|-----------|
| Sites montam formulários de jeitos muito diferentes (React sem `label`, Shadow DOM, iframes) | leitor com várias estratégias de rótulo + Haiku para organizar; fixtures por plataforma; "Capturar de novo" quando faltar pergunta |
| Injeção de instruções no texto da página | captura tratada sempre como dado (delimitada no prompt); casos de injeção nos datasets |
| Token de dispositivo vazado | só hash no banco, revogar em Configurações, `host_permissions` só para 127.0.0.1/localhost |
| A janela popup mostra a faixa de endereço | aceito em F12-2 |
| Mudança de porta ou de instância | endereço configurável e "Testar conexão" nas opções |
| Chrome atualiza políticas de extensão sem compactação | só o Chrome (F12-8); instruções no README; Web Store fica para o futuro |
| Respostas genéricas sem vaga | F12-11: sem a descrição, a janela pede a página da vaga ou o texto colado antes de responder |
| Dado sensível guardado | só local, origem "declarado pela pessoa", editável e apagável em Meus dados (F10); "prefiro não informar" respeitado |

## 10 · Registro

| Data | Marco | Nota |
|------|-------|------|
| 2026-10-21 | — | Task criada a partir da conversa com o dono (F12-1 a F12-6). |
| 2026-10-22 | — | F12-7: análise do LinkedIn vai para a F09, depois desta task. |
| 2026-10-22 | — | F12-8: alvo só o Chrome por enquanto. |
| 2026-10-22 | — | Rascunho do plano (§3 a §9) a partir da revisão do código. |
| 2026-10-22 | — | Dono fechou P-1 a P-5 → F12-9 a F12-13 (P-3 e P-4 mudaram: pedir a descrição da vaga; autodeclaração perguntada no chat e ingerida como evidência). |
| 2026-10-22 | — | Tutorial de instalação no front, a pedido do dono: página `/extensao` (gerar, `chrome://extensions`, modo do desenvolvedor, carregar `apps/extension/dist`, fixar, parear com o endereço da instância; atualizar; problemas comuns) e cartão em Configurações › Extensão do navegador. Aviso "em construção" até o M1. Teste antes: sim (`apps/web/test/f12/extension-install.test.tsx`). |
| 2026-10-22 | M1 | **Extensão e pareamento.** `apps/extension` (MV3, esbuild, ícone gerado no build, opções com endereço, código, nome, Testar conexão e Desconectar; o ícone abre as opções até o M2); `./start.sh extension` / `.\start.ps1 extension` e o `promote` gera junto (falha só avisa). core: migração `0017_extension`, `extensionRepo` (código de uso único por 10 min, novo invalida o anterior, token `nxd_` só em hash, revogar, último uso a cada minuto). api: `/api/extension/pairing`, `/pair` (pública, 10 erros por minuto), `/devices`, `DELETE /devices/:id`, `/me`; `authMiddleware` aceita token de dispositivo, Bearer antes do cookie e dispositivo revogado no Bearer dá 401 mesmo com o cookie do dono (achados do E2E-01). web: Configurações › Extensão do navegador (gerar código, navegadores conectados, desconectar); tutorial com aviso de que, por enquanto, só conecta. e2e F12/E2E-01 com a extensão carregada no Chromium do Playwright (variante com o host `web`, `NARNIA_EXTENSION_EXTRA_HOSTS`). Testes antes: sim. |
| 2026-10-23 | M1 | **Ajustes dos testes do dono.** Pareada, a página de opções mostra só o estado da conexão (endereço, nome, Testar conexão, Desconectar), também ao reabrir pelo ícone; o formulário volta quando não há token ou o dispositivo foi revogado. "Testar conexão" mostra "Testando a conexão…" e a hora da verificação (antes reescrevia o mesmo texto e parecia não fazer nada). "Desconectar" remove o dispositivo no narnia também (via `/me` e `DELETE /devices/:id` com o próprio token). Endereço padrão `http://127.0.0.1:5173`. Testes antes: sim (`apps/extension/test/options-view.test.ts`, E2E-01 ampliado). |
| 2026-10-23 | M2 | **Captura de vaga e janela.** Mudança em relação ao §4.3: a extensão não extrai a vaga; manda o **HTML renderizado** da aba (cópia sem scripts, estilos, mídia, iframes, campos ocultos, senhas, valores digitados e meta de CSRF; o JSON-LD fica, `src/capture/page.ts`) e o api lê com o extrator da F06 (`extractPosting`, via `extension`: JSON-LD, Readability, página bloqueada). Assim páginas atrás de login (LinkedIn) funcionam sem duplicar o leitor. Extensão: `activeTab` + `scripting`; clique sem pareamento abre as opções; pareada, lê a aba, `POST /api/extension/captures` e abre (ou reaproveita, `chrome.storage.session`) a janela popup ao lado em `/api/extension/enter?device=…&next=/candidatura?captura=…`; aba ilegível → `?erro=leitura`, envio recusado → `?erro=envio`; narnia fora do ar ou revogado → "!" no ícone e opções. Posição fora da tela é recusada pelo Chrome: abre sem posição (achado do E2E-02). core: migração `0018_extension_capture`, captura no `extensionRepo` (HTML em `<dados>/captures/<id>.html`), `findLikelyPosting` (mesmo link sem rastreio, ou mesma empresa e cargo). api: `GET /captures/:id` (cargo, empresa, local pela heurística, trecho, vaga parecida), `POST /captures/:id/posting` (`intakePosting` com o texto lido e o HTML como snapshot; salvar de novo devolve a mesma), `/enter` (pública; grava o cookie só se o navegador não está autenticado; destino só dentro do narnia); ws aceita token de dispositivo. web: `/candidatura` sem o layout (BARE no layout raiz), Salvar vaga, aviso de vaga já salva, links abrindo na janela normal; tutorial atualizado. A origem "extensão" fica na captura ligada à vaga (sem coluna nova na vaga). Testes antes: sim (core `captures.test.ts`, api `f12-m2-captures.test.ts` e ws, extensão `flow.test.ts` e `snapshot.test.ts` em jsdom, web `capture-window.test.tsx`, e2e F12/E2E-02 com a página de vaga de fixture em `http://vagas.example`). |
