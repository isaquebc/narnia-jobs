# 07 · Viabilidade de manter os dois modos

Pergunta: dá para manter, ao mesmo tempo, (A) o **wrapper local** (chat web próprio sobre o Agent SDK, usando o login do usuário) e (B) o **modo plugin** (usuário conversa dentro do Claude Code, Narnia entra como plugin + MCP)?

**Resposta curta: sim, e sai mais barato do que parece, porque o plugin é o artefato compartilhado.** O Agent SDK carrega um plugin local inteiro (skills, agente, hooks, `.mcp.json`) com uma linha de configuração. Então o modo B não é uma segunda implementação: é a mesma pasta `plugin/` que o modo A já precisa carregar. Verificado em https://code.claude.com/docs/en/agent-sdk/plugins (opção `plugins: [{ type: "local", path }]`).

---

## 1 · O que é compartilhado (escrito uma vez)

| Camada | Implementação única | Observação |
|--------|---------------------|------------|
| `core` (domínio, SQLite, ingestão determinística, export PDF/DOCX) | sim | 100% independente de modo |
| Servidor MCP (tools `profile.*`, `evidence.*`, `ingest.*`, ...) | sim | stdio; o plugin aponta para ele em `.mcp.json`; o SDK o descobre pelo mesmo arquivo |
| Persona do recrutador (`plugin/agents/recrutador.md`) | sim | o SDK lê `agents/` do plugin |
| Features como skills (`plugin/skills/*`) | sim | invocadas como `/narnia:gerar-cv` nos dois modos |
| Hook `SessionStart` (injeta cartão do perfil) | sim | o SDK executa `hooks/hooks.json` do plugin |
| UI web de dados (Meus dados, Ingestão/revisão, Candidaturas, Config) | sim | só lê/escreve SQLite; não sabe qual modo gerou os dados |

Estimativa grosseira de esforço: isso é ~75% do projeto.

## 2 · O que é específico de cada modo

| Peça | Modo A (wrapper) | Modo B (plugin) |
|------|------------------|-----------------|
| Interface de chat | **nossa**: streaming, render de tool calls, sessões, troca de modelo, medidor de uso, botões de ação | a do Claude Code (terminal/app desktop); nada a construir |
| Adaptador de provider | `ClaudeCodeProvider` (SDK) e, depois, `CodexProvider` (`codex exec --json` + normalização de eventos) | gerador de instalação: `claude plugin install` / cópia da pasta; para Codex, gerar `AGENTS.md` + `config.toml` |
| Troca de perfil | tool `profile.switch` + reiniciar sessão com novo cartão | mesma tool + hook; usuário digita `/narnia:perfil pm` |
| Ações sugeridas ("Gerar CV para esta vaga") | botão que abre a feature preenchida | o agente escreve um link `http://127.0.0.1:…/cv?vaga=…` e o usuário clica |
| Revisão de ingestão | na UI web, com atalho a partir do chat | na UI web, ou pelo chat ("aceite tudo exceto...") |
| Testes de integração | SDK em CI com API key de teste (ou mocks) | smoke test do plugin com `claude -p` em CI |

Esforço específico: modo A ≈ 20% (quase tudo é a UI de chat), modo B ≈ 5% (instalador e docs).

**Conclusão de custo:** manter os dois custa ~5% a mais do que só o wrapper, e ~20% a mais do que só o plugin. O modo B é quase gratuito uma vez que o plugin existe para alimentar o SDK.

## 3 · Onde os dois modos divergem de verdade (riscos)

### 3.1 Consumo de tokens é diferente, e favorece o wrapper
No modo A o SDK usa por padrão um **system prompt mínimo** e só as tools que listarmos (`systemPrompt` indefinido = "minimal prompt"; `tools: [...]`). No modo B o recrutador roda dentro de uma sessão completa do Claude Code, com o system prompt padrão e as ferramentas de código (Bash, Read, Edit...) no contexto. Com prompt caching o custo real cai, mas para o objetivo "caber no menor plano" o modo A é o mais econômico. Mitigação no modo B: `agents/recrutador.md` com `tools:` restrito e `model: sonnet`, e orientar o usuário a usar `/model sonnet`.

### 3.2 Política de uso: os riscos são opostos, e é por isso que ter os dois vale a pena
- Modo A é a zona cinzenta ("oferecer login do claude.ai em produto de terceiro"). Com o projeto open source (decidido em 2026-10-06), o risco é real e assumido: o Narnia não intermedeia credenciais, cada usuário usa o CLI oficial, e o `README` explica a política.
- Modo B é uso normal do produto. Se a Anthropic fechar a brecha do modo A (por exemplo, SDK recusando credencial de assinatura), o Narnia continua funcionando no modo B sem reescrever nada além da UI de chat, que vira opcional. **O modo B é o seguro do projeto.**

### 3.3 Drift entre modos
Se prompts ou comportamentos forem duplicados, os modos divergem. Regra de projeto: **nenhum texto de persona, instrução de feature ou definição de tool fora de `plugin/` e `packages/mcp/`**. O wrapper nunca "melhora" o prompt por conta própria; ele só escolhe modelo, perfil e tools permitidas.

### 3.4 Ritmo de versões
O SDK TS está em 0.3.x com releases quase diários; o formato de plugin muda menos. Mitigação: fixar versão do SDK, smoke test em CI nos dois modos, e manter o contrato entre wrapper e plugin restrito às opções `plugins`, `systemPrompt`, `tools`, `model`, `resume`.

### 3.5 Experiência do usuário
No modo B não há botões, só texto e links. O desenho das skills deve assumir isso (sempre oferecer o link da UI web como saída). No modo A os mesmos links viram botões. Mesma lógica, duas renderizações.

## 4 · Como estruturar para que "dois modos" não vire "dois produtos"

```
plugin/                    ← fonte da verdade: persona, skills, hooks, .mcp.json
packages/mcp/              ← tools (usadas pelos dois modos via .mcp.json)
packages/core/             ← domínio e storage
packages/ui/               ← UI web de dados (modo-agnóstica) + rota /chat (só modo A)
packages/providers/
  ├─ claude-code/          ← SDK: query({ plugins:[plugin/], systemPrompt, tools, model })
  └─ codex/                ← futuro: exec + normalização; ou gerador de AGENTS.md no modo B
packages/cli/              ← `narnia-jobs ui` (A+B), `narnia-jobs install-plugin claude|codex` (B)
```

Regras:
1. O wrapper carrega o plugin pelo SDK; nunca duplica skills nem prompts.
2. Toda feature é uma skill + tools MCP + (opcional) uma página na UI web. Se funciona no modo B, funciona no A.
3. A UI web não depende do chat para nada: tudo que o agente faz passa pelo SQLite e aparece na UI.
4. CI roda dois smoke tests: `narnia-jobs chat` (SDK, com mock ou API key de teste) e `claude -p "/narnia:perfil" --plugin-dir plugin/`.

## 5 · Ordem de construção recomendada

| Fase | Entrega | Modo |
|------|---------|------|
| 0 | monorepo, `core`, SQLite, `narnia-jobs doctor` | ambos |
| 1 | MCP + `plugin/` (persona, `/narnia:perfil`, `/narnia:recrutador`) testado **direto no Claude Code** | B pronto |
| 2 | UI web de dados (onboarding, Meus dados, Config) | ambos |
| 3 | Chat web sobre o SDK carregando `plugin/` | A pronto |
| 4 | Ingestão CV/GitHub + revisão | ambos |
| 5 | Features: gerar CV, analisar vaga, candidaturas | ambos |
| 6 | Entrevista, LinkedIn, Codex (provider no A, gerador no B) | ambos |

O modo B fica pronto na fase 1 sem nenhuma UI, o que permite validar persona, tools e economia de tokens cedo e barato. O modo A entra na fase 3 reaproveitando tudo.

**Como ficou (F04, 2026-10-11):** os dois modos foram entregues juntos sobre o mesmo núcleo. **Modo A** (web): o api abre a sessão pelo Agent SDK com o system prompt montado do template do plugin, o servidor MCP do próprio api e o plugin local; o hook não reinjeta o cartão. **Modo B** (terminal): `./start.sh install-plugin` registra o servidor por `claude mcp add-json -s user` com `headersHelper` (o token fica num arquivo 0600 da cópia instalável, fora da linha de comando e da config do Claude Code) e instala o plugin pelo marketplace local (`claude plugin marketplace add` + `claude plugin install`), com nome por instância; o agente `recrutador` instalado é renderizado pela api (persona e domínios atuais, tools do servidor registrado, cartão buscado por `profile_get_card`); o hook `SessionStart` entrega persona + cartão (rota em texto puro) e avisa quando a API está fora; o hook `Stop` registra o uso da sessão no medidor (relê o transcript e manda só id, modelo e tokens de cada mensagem; o app ignora o que já contou); `./start.sh doctor` confere MCP, plugin e porta. O smoke real do modo B (`scripts/smoke-plugin.sh --yes`, E2E-09) roda só sob demanda porque usa a assinatura. Única fonte de prompt: `plugin/` e `packages/{shared,core}` (teste de varredura).

## 6 · Veredito

| Critério | Avaliação |
|----------|-----------|
| Custo adicional de manter os dois | baixo (~5% sobre o wrapper) |
| Risco de drift | baixo se `plugin/` for a única fonte de prompts e tools |
| Benefício | seguro contra mudança de política + validação antecipada + uso no terminal/app desktop para quem preferir |
| Recomendação | **manter os dois**, com o modo A como experiência principal e o modo B como base e fallback |
