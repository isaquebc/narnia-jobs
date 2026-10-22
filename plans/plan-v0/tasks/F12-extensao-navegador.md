# F12 · Extensão do navegador

Entregável 12 do plan-v0. Uma extensão do Chrome (Chromium) que liga as páginas abertas pela pessoa ao narnia local: **captura de dados** (vagas de qualquer plataforma, enviadas à F06) e **ajuda no preenchimento de formulários de candidatura** (perguntas localizadas e respostas sugeridas numa janela própria, com copiar, refazer e chat). A análise da página do perfil do LinkedIn ficou para a F09, depois desta task, lendo a página por esta extensão (F12-7). Depende de F04 (chat, skills, provider pela assinatura), F05 (CV da vaga) e F06 (vagas). O gate pairwise de prompts (F04-avaliacoes AV-5, M7) vem antes, para os prompts novos desta task já nascerem passando por ele.

Status: **em escopo** (2026-10-21, decisões do dono abaixo). Nada implementado. Decisões fechadas (F12-1 a F12-8); próximo passo: plano detalhado (arquitetura, dados, layouts, marcos, testes).

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

## 2 · Decisões abertas

Nenhuma.

## 3 · Registro

| Data | Marco | Nota |
|------|-------|------|
| 2026-10-21 | — | Task criada a partir da conversa com o dono (F12-1 a F12-6). |
| 2026-10-22 | — | F12-7: análise do LinkedIn vai para a F09, depois desta task. |
| 2026-10-22 | — | F12-8: alvo só o Chrome por enquanto. |
