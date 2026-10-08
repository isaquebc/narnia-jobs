# 01 · Viabilidade

Data da análise: 2026-10-06. Ambiente verificado nesta máquina: Node 22.16, Claude Code 2.1.291, Python 3.11.

## Resumo executivo

O projeto é viável. O formato original ("interface de chat que embrulha o Claude Code usando a assinatura do usuário") funciona tecnicamente via **Agent SDK** (Node ou Python) e é o que vários projetos da comunidade fazem (CloudCLI, claude-code-webui, opcode), mas a documentação oficial proíbe que terceiros ofereçam login do claude.ai dentro de produtos. Para um sistema **local e pessoal** o risco prático é baixo; para distribuição, é real. A decisão tomada em 2026-10-06 foi manter **dois modos sobre o mesmo núcleo**: (A) wrapper local com chat web próprio sobre o Agent SDK, experiência principal; (B) modo plugin, em que o usuário conversa dentro do Claude Code e o Narnia entra como plugin + MCP, que serve de base e de seguro contra mudança de política. O plugin é o artefato compartilhado: o SDK o carrega inteiro. Análise detalhada em `07-dois-modos.md`.

## 1 · O bloqueio: assinatura dentro de um wrapper

Trecho literal da documentação do Agent SDK (https://code.claude.com/docs/en/agent-sdk/overview):

> Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK. Use the API key authentication methods described in the Quickstart instead.

Consequências práticas, confirmadas em https://code.claude.com/docs/en/authentication e https://code.claude.com/docs/en/headless:

| Caminho | Funciona tecnicamente? | Permitido? |
|---------|------------------------|------------|
| Agent SDK + login de assinatura | sim (o SDK roda o CLI logado) | **não**, salvo aprovação prévia da Anthropic |
| `claude -p --output-format stream-json` chamado por nossa UI, com assinatura | sim | mesma restrição: é "oferecer login do claude.ai no nosso produto" |
| `claude setup-token` (token OAuth de 1 ano) | sim | destinado a CI/scripts do próprio usuário, não a produtos |
| Agent SDK ou `claude -p --bare` com `ANTHROPIC_API_KEY` | sim | **sim** (cobrança por uso na API, não pela assinatura) |
| Usuário conversa no próprio Claude Code, e nosso código entra como plugin/MCP | sim | **sim**, é o uso normal do produto |

Decisão de público (2026-10-06): **open source**, qualquer pessoa clona e roda localmente com a própria assinatura. Isso coloca o modo A na mesma situação de CloudCLI, claude-code-webui e opcode: projetos abertos, ativos, que cada usuário roda na própria conta, mas que o texto da política alcança. Posição do projeto: (1) o Narnia nunca distribui credenciais nem intermedeia login, cada usuário usa o CLI oficial na própria máquina; (2) o `README` explica a política e deixa a escolha do modo com o usuário; (3) o modo plugin (B) é tratado como caminho de primeira classe, não fallback, porque é o único inequivocamente permitido para um projeto distribuído. Pedir aprovação à Anthropic é possível, mas não dá para planejar contando com isso.

## 2 · O que continua viável (e como)

Os itens abaixo valem para os dois modos, salvo indicação.

### 2.1 Objetivo "usar a assinatura do usuário, no menor plano"
Viável no modo plugin. O Claude Code aceita `/model sonnet` e `/model haiku`, então a ingestão (pesada) roda em Haiku e a conversa em Sonnet. No plano Pro, os modelos disponíveis são Sonnet e Haiku (Opus/Fable só no Max), o que já força o desenho econômico. Limites do Pro funcionam em janelas de 5 horas com teto semanal; a documentação não publica números exatos.

### 2.2 Objetivo "provider selecionável (Claude Code hoje, Codex depois)"
Viável e até mais limpo que no desenho original. O ponto de integração vira **MCP + arquivos de instrução**, dois padrões que ambos suportam:
- Claude Code: plugin (`.claude-plugin/plugin.json`) com skills, agente, hooks e `.mcp.json`.
- Codex CLI: servidores MCP em `~/.codex/config.toml`, instruções em `AGENTS.md`, skills. *(Validar detalhes da versão atual do Codex antes de implementar.)*
O "provider" passa a ser um **adaptador de instalação**: gera a configuração certa para cada CLI. O núcleo (dados, ingestão, features) não muda.

### 2.3 Objetivo "features isoladas com lazy load dos dados"
Encaixa perfeitamente no modelo de skills + tools MCP. Cada feature é uma skill (`/narnia:gerar-cv`), carregada só quando invocada, e sua instrução diz quais tools chamar. Nenhum dado do usuário entra no contexto sem uma chamada explícita.

### 2.4 Objetivo "vários perfis, trocar perfil troca o viés do recrutador"
Viável com uma tool `profile.switch` + hook `SessionStart` que injeta o cartão do perfil ativo (~300 tokens) e a persona do recrutador. Trocar perfil custa uma chamada de tool.

### 2.5 Objetivo "dados pessoais fora do repositório"
Viável e trivial: SQLite na pasta de dados do SO (`~/.local/share/narnia-jobs`, `%APPDATA%\narnia-jobs`, `~/Library/Application Support/narnia-jobs`) + arquivos enviados ao lado. O repositório nunca contém dados; o `.gitignore` reforça.

### 2.6 Objetivo "Linux, Windows e Mac"
Viável com Node ≥ 22.13 (já exigido pelo Claude Code) e **zero módulos nativos**: `node:sqlite` embutido, `pdfjs-dist` e `mammoth` em JS puro para PDF/DOCX. Evita o problema clássico de compilar `better-sqlite3` no Windows.

### 2.7 Interface web local
Painel de dados, revisão de ingestão, kanban de candidaturas, prévia/exportação de CV e configurações, independente de modo. No modo A ganha a rota `/chat` sobre o Agent SDK (Node, `@anthropic-ai/claude-agent-sdk`), que carrega o mesmo `plugin/` e usa a credencial do `/login` do usuário quando não há `ANTHROPIC_API_KEY`. Quem preferir pagar por uso só precisa definir a chave.

## 3 · Riscos e mitigação

| Risco | Impacto | Mitigação |
|-------|---------|-----------|
| Experiência de chat fica no terminal/app do Claude Code, não na nossa UI | média: menos controle visual | o app desktop do Claude Code já tem chat decente; nossa UI foca no que o chat faz mal (tabelas, kanban, diff de revisão, prévia de documento) |
| Mudança de política/API de plugins | baixa | núcleo isolado do adaptador de provider; MCP é padrão aberto |
| Consumo de tokens da ingestão profunda estourar janela do Pro | média | pré-processamento determinístico, Haiku por padrão, estimativa antes de rodar, profundidade em 3 níveis |
| Alucinação do recrutador sobre dados do usuário | alta para o objetivo "honestidade" | fatos com fonte e selo "verificado"; persona instruída a citar a fonte e a marcar inferências |
| Codex não ter paridade de recursos (hooks, skills) | baixa | o adaptador degrada: injeta persona e perfil via AGENTS.md gerado |

## 4 · Veredito

| Objetivo inicial | Status |
|------------------|--------|
| Viabilidade | **viável em dois modos sobre um núcleo**: wrapper local (SDK) + plugin do Claude Code; ver `07-dois-modos.md` |
| Fluxos do usuário | definidos em `02-fluxos-do-usuario.md` |
| Arquitetura | definida em `03-arquitetura.md` |
| Escopo de dados | definido em `04-escopo-de-dados.md` |
| Layouts | definidos em `05-layouts.md` |
| Manter os dois modos | analisado em `07-dois-modos.md` |
| Decisões que dependem de você | listadas em `06-decisoes-em-aberto.md` |
