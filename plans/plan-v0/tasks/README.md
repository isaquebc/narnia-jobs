# Tasks do plan-v0

Cada task é um entregável fechado, escopado no mesmo padrão (objetivo, escopo, arquitetura, dados, layouts, decisões, cobertura de testes, riscos, registro). Os fluxos de `../02-fluxos-do-usuario.md` mapeiam assim: F1 → F01; F2 → F02; F3 → F03; F4 → F04; F5 (features) → F05 a F09, uma por feature, porque as features são isoladas por desenho; F6 → F10. F11 é o segundo provider.

| Task | Fluxo | Entrega em uma frase | Depende de |
|------|-------|----------------------|------------|
| [F01-onboarding](F01-onboarding.md) | F1 | fundação (monorepo, Docker, SQLite, jobs, provider mínimo, testes) + primeiro uso com CV/texto livre, revisão e primeiro perfil | — |
| [F02-troca-de-perfil](F02-troca-de-perfil.md) | F2 | vários perfis, ênfases, cartão do perfil, persona derivada, seletor no shell | F01 |
| [F03-ingestao](F03-ingestao.md) | F3 | GitHub público e privado pelo `gh`, métricas, orçamento ligado ao plano, análise incremental e relatórios, segundo CV/texto com "já lido", reconciliação com conflitos, revisão anti-alucinação, notificações (LinkedIn adiado) | F01, F02 (clarificação depende de F04) |
| [F04-chat-recrutador](F04-chat-recrutador.md) | F4 | servidor MCP (`/mcp`), `plugin/`, chat web via Agent SDK (modo A), instalação no Claude Code (modo B), clarificação, pesquisa em fontes confiáveis | F01, F02 |
| [F10-gestao-de-dados](F10-gestao-de-dados.md) | F6 | Meus dados completo, exportar/apagar, medidor de uso completo, limpar cache, Configurações, `doctor` | F01, F04 |
| [F05-gerar-cv](F05-gerar-cv.md) | F5.1 | conteúdo pelo agente + layout no servidor com 3 templates e upload de template, PDF/DOCX, versões | F02, F04 |
| [F06-analisar-vaga](F06-analisar-vaga.md) | F5.2 | fit, lacunas, riscos, palavras-chave ATS, perguntas prováveis; ponte para CV e entrevista | F02, F04 |
| [F07-candidaturas](F07-candidaturas.md) | F5.3 | kanban, agenda com link/`.ics`, integração opcional com o MCP oficial do Google Calendar | F04, F06 |
| [F09-carta-e-linkedin](F09-carta-e-linkedin.md) | F5.5/5.6 | carta/mensagem por candidatura e otimização de LinkedIn | F05, F07 |
| [F08-entrevista-voz](F08-entrevista-voz.md) | F5.4 | entrevista mãos livres com Whisper local + TTS local (padrão de N provedores), só modo A | F04, F07 |
| [F11-provider-codex](F11-provider-codex.md) | — | segundo provider (Codex) nos modos A e B; exige verificação documental antes de implementar | F04, F10 |

## Ordem sugerida (ondas)

```
Onda 1  F01
Onda 2  F02 ──► F03 ──► F04   (decisão do dono, 2026-10-09: F03 antes da F04; o botão "Clarificar" fica desabilitado até a F04)
Onda 3  F10
Onda 4  F05   F06 ──► F07  (features; F05 e F06 em paralelo)
Onda 5  F09   F08
Onda 6  F11
```

## Itens adiados
| Item | Origem | Desenho preservado em |
|------|--------|-----------------------|
| Ingestão do export do LinkedIn (ZIP de CSVs) | F03-7, adiado pelo dono em 2026-10-09 | `F03-ingestao.md` §9 |

## Critério de entregável publicável (decisão global 4, 2026-10-07)

Não existe corte fixo de MVP: o release é decisão do dono do projeto quando as features estiverem redondas. Por isso **toda task, ao fechar, tem de poder ser publicada sozinha**. A definição de pronto de cada uma inclui, além dos testes:
1. **Instalação limpa e atualização**: `narnia-jobs up` funciona do zero e sobre uma pasta `./data` criada pela task anterior (migrations só para frente, nunca destrutivas; teste de upgrade com banco da versão anterior).
2. **Documentação de uso** no README público: o que a feature faz, como usar, limites conhecidos.
3. **Estados de erro com mensagem acionável** em toda tela nova (sem tela em branco, sem stack trace).
4. **i18n completo** da task em pt-BR (nenhuma string fora do dicionário).
5. **CI verde** nos três sistemas para o que a task toca (matriz de SO em `core`; build da imagem e e2e em Linux).
6. **Nada de dados pessoais** no repositório, nas fixtures ou nos logs de CI.
7. **Registro em §8** da task com o que ficou fora e por quê.

## Convenções entre tasks
- **TDD obrigatório** (`../09-metodologia-tdd.md`): teste que falha antes do código; correção começa por teste de regressão; e2e por fluxo; registro em §8 com ids e "teste antes: sim/não".
- **Tudo em Docker**: desenvolvimento, testes e CI em containers; o host só precisa de Docker. Nenhum comando de task pode exigir Node/pnpm no host.
- **Jobs em BullMQ/Redis** com espelho na tabela `job`; serviços separados (api, worker, web, redis, e os que cada task adicionar).
- Ids de decisão: `Fxx-n`; ids de e2e: `E2E-nn` dentro de cada task (prefixar com a task ao citar fora dela: `F03/E2E-02`).
- Toda feature = skill em `plugin/skills/` + tools MCP + página web; funciona em modo A e B (no B, saída em texto e links para a UI).
- Toda operação com modelo ou > 2 s é job em segundo plano (F01 §2.5) e grava `usage_event`.
- Tempo em UTC; exibição via `packages/shared/time.ts`.
- Quando uma task muda algo dos documentos 02–05, atualiza-os no mesmo PR e registra em `§8`.

## Pontos de integração entre tasks (acordados na escrita dos escopos)
- **`facts_version`** (F01 §3): contador em `settings` incrementado em toda escrita de fato, por um único ponto do `core`. F02 invalida `profile.card_json` a partir dele; F06 usa na chave do cache de análise; F10 incrementa ao editar fatos.
- **`application.create_minimal`**: F06 entrega como stub para ligar análise a uma candidatura; F07 substitui pela implementação completa e migra os registros.
- **Tools MCP `profile.*`**: definidas em F02, servidas pelo servidor MCP entregue em F04. F02 as expõe por REST até F04 existir.
- **Sessão de clarificação**: botão em F01/F03, sessão e skill em F04.
- **`usage_event`**: gravação começa em F01 (origem `narnia`); coletor dos logs do Claude Code e tela completa em F10.
