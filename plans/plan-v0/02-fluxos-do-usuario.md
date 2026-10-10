# 02 · Fluxos do usuário

Convenções: **Usuário base** = a pessoa real (dados compartilhados). **Perfil** = uma "lente" sobre o usuário base (ex.: Engenheiro de Software Sênior, Project Manager). **Recrutador** = o agente principal, cujo viés muda com o perfil ativo. **Feature** = módulo isolado com página própria e um conjunto declarado de dados que precisa.

---

## F1 · Primeiro uso (onboarding)

```
abrir localhost (container já no ar)
  └─ 1. Provider ─────────── detecta `claude` logado no container? se não, mostra o comando de login (Codex "em breve")
       └─ 2. Currículo ─────── upload de um CV pronto (PDF/DOCX/MD) OU texto livre contando a história profissional; OPCIONAL
            └─ 3. Extração ───── texto extraído localmente → modelo extrai fatos + gera o registro de contexto do arquivo
                 └─ 4. Revisão ────── usuário confere e corrige cada fato; identidade e contato pré-preenchidos (propostas de identidade não entram na lista: viram o formulário, F01-59); só avança com todas as propostas decididas (F01-60)
                      │              (telefone com país + DDD é obrigatório, mesmo que o CV não tenha)
                      └─ 5. Primeiro perfil ─ sugerido a partir do CV: cargo-alvo, senioridade, mercado, idioma
                           └─ 6. Mais fontes (opcional; existe a partir do F03) ─ GitHub | export do LinkedIn | depois
                                └─ 7. Entrevista de descoberta (opcional; existe a partir do F04)
                                     └─ Dashboard do perfil
No F01 o wizard tem os passos 1–5 e vai direto ao dashboard; os passos 6 e 7 são adicionados pelas tasks F03 e F04, sem tela "em breve".
```

Regras:
- Passo 1 falha com instrução acionável se o CLI no container não estiver logado (`docker compose run --rm narnia-jobs claude auth login`). Nada avança sem provider funcional.
- Passo 2 é o primeiro input do sistema: um currículo já feito ou um relato em texto livre. Dele extraímos tudo que der. Sem nada, o passo 4 vira formulário vazio.
- A extração roda como **job em segundo plano**: o wizard mostra o progresso, mas o usuário pode navegar (bandeja de atividades no shell) e voltar.
- Passo 3 é a primeira chamada ao modelo. Antes de confirmar, o usuário vê a estimativa de tokens. Além dos fatos, o modelo produz o **registro de contexto do arquivo** (resumo + pontos principais), para que ninguém precise reabrir o PDF depois (ver `04 §A9`).
- Passo 4 é obrigatório: nenhum fato extraído vira dado sem passar pelos olhos do usuário. Campos obrigatórios faltantes (telefone, cidade, e-mail) bloqueiam o avanço.
- Passo 5 é formulário puro, pré-preenchido por heurística + fatos aceitos. Zero tokens.
- Passo 7 só pergunta o que a extração **não** conseguiu preencher (sem datas, sem métricas, sem senioridade declarada etc.).

## F2 · Troca de perfil

```
[Seletor de perfil no topo] → escolher "Project Manager"
  → recrutador recarrega: nova persona (system prompt), novo subconjunto de dados exposto via tools
  → chat anterior fica arquivado por perfil (histórico é por perfil)
  → features mostram dados/saídas apenas deste perfil
```

Criar perfil novo: a partir de um existente (clona ênfases, narrativa e persona; a carreira é pedida de novo, F02-8) ou do zero. O usuário base **não** é duplicado: o perfil apenas marca o que enfatizar, ocultar e como narrar.

Implementado em F02 (2026-10-08):
- **Seletor no topo do shell** com o perfil ativo; a troca avisa todas as abas abertas (`profile.switched`) e nunca perde um formulário não salvo (confirmação). Dashboard mostra o cartão resumido, contadores de ênfase e pendências do perfil ativo.
- **Perfis** (`/perfis`): ativar, renomear, clonar, **arquivar** (nunca o ativo) e desarquivar com "mostrar arquivados"; apagar só perfil arquivado, em F10 (F02-6).
- **Ênfases** por experiência, projeto, skill, formação e idioma: destacar, normal, ocultar; ordem por arraste ou botões; prévia do cartão. Por conquista entra em F05 (F02-3).
- **Narrativa** (pitch) e **Recrutador**: persona derivada do perfil com padrões tom direto, honestidade máxima, rigor alto e recrutador sempre sênior, todos ajustáveis por seletor com restaurar padrão (F02-7).
- **Cartão do perfil** (~300 tokens, com resumo objetivo heurístico): estado válido/desatualizado, "atualizado em" no fuso do usuário e botão **Atualizar cartão**; invalidação automática em qualquer escrita (F02-1).
- **Sugestões de perfil**: heurísticas automáticas (banner no dashboard, zero tokens) e o botão **Analisar possíveis perfis**, que leva todo o histórico ao modelo depois de um alerta com estimativa de tokens e confirmação (F02-5); aceitar abre o formulário pré-preenchido e dispensar persiste.

## F3 · Ingestão de dados

```
Ingestão
  ├─ escolher fonte: CV (PDF/DOCX/MD) | texto livre (história profissional, relato, notas) | GitHub (usuário, org ou repos) | LinkedIn (ZIP de export)
  ├─ escolher profundidade: ◉ Rápida  ○ Equilibrada  ○ Profunda   (ver 03-arquitetura §Profundidade)
  ├─ escolher alvo: aplica a "usuário base" (padrão) + sugerir tags para quais perfis
  ├─ pré-processamento LOCAL (sem tokens): extrair texto, listar repos, ler READMEs, estatísticas de linguagem
  ├─ estimativa: "~N mil tokens, ~M chamadas" → confirmar
  ├─ extração pelo modelo → fatos candidatos (experiência, projeto, skill, conquista) com fonte e confiança
  ├─ registro de contexto do arquivo: resumo (~200–400 tokens) + pontos principais + índice de seções, gravado junto do arquivo
  └─ REVISÃO (obrigatória): tela de diff
        ├─ novo ✚  / conflito ⚠ (ex.: datas divergentes do CV) / já existente =
        ├─ aceitar · editar · rejeitar, individualmente ou em lote
        └─ gravar → cada fato guarda `fonte`, `confiança`, `verificado_pelo_usuario`
```

**Como ficou na F03 (2026-10-09).** LinkedIn adiado (`tasks/README.md`, itens adiados). Fontes: GitHub, CV adicional e texto livre ("Conte a sua história de carreira e de vida").
- **GitHub**, primeiro campo: **análise pública** (só repositórios públicos, funciona sem login; sem login as métricas ficam indisponíveis porque a API de contribuições exige autenticação) ou **privada** (inclui privados com cadeado, exige o GitHub conectado). Conexão pelo `gh`: reaproveita o login do `gh` do computador ou faz o login próprio do app por código de dispositivo (código, copiar, "Abrir GitHub" em nova aba, sem terminal). Seleção agrupada (Pessoais expandido, organizações recolhidas), 10 mais recentes pré-marcados por grupo, forks e arquivados destacados, aviso acima de 10 no total.
- **Antes de rodar**: modelo, profundidade, **diagnóstico do plano** (assinatura, uso das janelas de 5 h e semanal, renovação), orçamento recomendado (mil, milhão ou % da janela) e estimativa por repositório. GitHub sempre pede confirmação; CV e texto seguem sozinhos abaixo de 10 mil tokens (configurável).
- **Durante**: um job por repositório, com fatia igual do orçamento; ao passar de 125%, **freio**: a execução para em "aguardando decisão" com notificação e o diálogo mostra gasto × estimado, restante da janela e custo para terminar (continuar com orçamento extra, encerrar com o feito, deixar para depois, que fica em Pendências).
- **Depois**: relatório da execução e relatório por repositório salvos com o commit analisado; nova execução no mesmo repositório usa o diff desde esse commit; sem mudança, oferece segunda rodada (aprofundar ou cobrir o que ficou de fora). "Já lido" por hash para CV e texto, com link para a execução anterior.
- **Revisão**: novo / já existe / conflito; conflito aceito bloqueia salvar até escolher manter atual, usar novo ou editar; selo de verificação anti-alucinação (sustentada, parcial, sem suporte, com o trecho citado), que nunca apaga nada; tags de perfil por linha e em lote.
- **Pendências e notificações**: sino com contador no cabeçalho e página Pendências; revisão pendente, conflitos, execução aguardando decisão, concluída, erro, sugestões de perfil e análise de perfis concluída; a pendência some sozinha quando é resolvida.
- **Evidências**: repositórios analisados com relatório, métricas, resumo (digest) editável, histórico de análises e reanálise; snapshots permitem reexecutar sem rede.

Toda ingestão roda em **segundo plano** (fila de jobs persistida). O usuário vê o progresso na bandeja de atividades do shell e continua usando o resto do sistema; pode haver várias ingestões e várias sessões de chat ativas ao mesmo tempo, por perfil.

### F3.1 · Sessão de clarificação
Depois que uma ingestão termina (especialmente de texto livre), o sistema oferece **"Clarificar esta ingestão"**: abre uma sessão de chat com a skill `clarificar`, que recebe o digest e as propostas, identifica lacunas e ambiguidades (datas, métricas, nomes de empresa, nível de responsabilidade) e faz perguntas objetivas. Cada resposta vira proposta nova ou correção, que volta para a tela de revisão. Objetivo: transformar relato em dados objetivos e verificados.

Regra do registro de contexto: a partir daí, agente e features consultam `file.get_digest` em vez de reabrir o arquivo. O texto completo continua disponível por `file.get_text(trecho)` para citações, mas nunca entra inteiro no contexto de novo.

Regra de honestidade: fatos não verificados pelo usuário aparecem com selo "extraído" e o recrutador é instruído a confirmar antes de usar em documentos finais.

## F4 · Conversa com o recrutador

```
Chat (perfil ativo: Eng. de Software Sênior)
  ├─ recrutador abre com contexto mínimo: "cartão do perfil" (~300 tokens) já no prompt
  ├─ para detalhes, usa tools (MCP): evidence.search, experience.get, skills.list, applications.list ...
  ├─ chips "contexto carregado" mostram ao usuário o que foi puxado (transparência + custo)
  ├─ recrutador pode propor ação → botão que abre a feature já parametrizada ("Gerar CV para esta vaga")
  └─ medidor de uso da sessão (tokens in/out, custo equivalente) sempre visível
```

Sessões: cada perfil pode ter **várias conversas ativas** (abas), cada uma com propósito/categoria (carreira, clarificação, feature). Trocar de aba não encerra a outra; o uso é contabilizado por sessão e por categoria.

Persona: recrutador(a) sênior especialista em contratar para o cargo/área do perfil, no nível do perfil. Honestidade total: aponta lacunas, exageros e riscos; não inventa experiências; marca o que é inferência. Quando o usuário não sabe responder um dado obrigatório (ex.: faixa salarial do cargo na sua cidade), o recrutador **pesquisa na internet em fontes confiáveis** (pesquisas salariais, sites oficiais, grandes job boards), cita a fonte e propõe um valor para o usuário confirmar.

## F5 · Features (módulos isolados)

Cada feature declara `dataScopes` (quais fatias dos dados precisa) e ganha só essas tools. Candidatas iniciais, em ordem de prioridade sugerida:

| # | Feature | Entrada | Saída | Dados que carrega |
|---|---------|---------|-------|-------------------|
| 1 | Gerador de CV | perfil + (opcional) descrição da vaga + **template** (3 padrão ou enviado pelo usuário) | PDF gerado no servidor com padrão visual do template (+ DOCX), versões salvas | identidade, experiências, projetos, skills, educação |
| 2 | Análise de vaga | descrição da vaga colada/URL | fit %, lacunas, perguntas prováveis, palavras-chave ATS | cartão do perfil, skills, experiências |
| 3 | Rastreador de candidaturas | manual + saída da #2 | kanban (interesse → aplicado → entrevista → oferta/recusa), notas; **entrevistas viram eventos no Google Calendar** quando a conta Google está conectada (MVP: link "adicionar ao calendário" + `.ics`, sem autenticação) | candidaturas, calendário (MCP do Google) |
| 4 | Simulador de entrevista **por voz** | vaga (da #3) + tipo (técnica/comportamental/sistema) | conversa falada mãos livres (microfone ativo, detecção de fala, resposta do Claude em voz), transcrição, feedback por resposta, resumo; modo texto como fallback | perfil, candidatura, experiências |
| 5 | Carta de apresentação / mensagem a recrutador | candidatura | texto curto no idioma do perfil | cartão do perfil, candidatura |
| 6 | Otimização de LinkedIn | export ou texto atual | headline, sobre, experiências reescritas | perfil, experiências |

Fluxo genérico de feature:
```
abrir feature → parâmetros (formulário) → estimativa de tokens → executar (stream) → revisar/editar saída → salvar (ligado ao perfil e, se houver, à candidatura)
```

### F5.1 · Candidaturas + Google Calendar
```
Configurações → Integrações → "Conectar Google"
  ├─ guia: criar cliente OAuth no Google Cloud (redirect http://localhost:8089/callback)
  ├─ colar client ID + secret → `narnia-jobs google connect` registra o MCP oficial do Google e abre o login
  └─ estado: ✔ conectado (tools create_event, list_events, suggest_time disponíveis para a skill `candidaturas`)
Kanban → mover para "Entrevista" → informar data/hora/link
  ├─ conectado: skill cria o evento (com descrição da vaga e link da candidatura) e confirma
  └─ não conectado: botão "Adicionar ao Google Calendar" (link pré-preenchido) + baixar `.ics`
```

### F5.2 · Entrevista por voz
```
abrir Entrevista → escolher candidatura e tipo → aviso de privacidade (áudio via navegador) → [Iniciar]
  ├─ microfone fica ativo; detecção de fala decide quando você começou e terminou de falar (sem segurar botão)
  ├─ sua fala vira texto → Claude responde em stream → voz sintetizada frase a frase
  ├─ se você começa a falar, a voz do Claude para (barge-in)
  ├─ transcrição rola na tela; [pausar] [modo texto] [encerrar]
  └─ encerrar → feedback consolidado + gravação da sessão (texto) na candidatura
```

## F6 · Gestão de dados

- Ver e editar qualquer fato, com sua fonte.
- Exportar tudo (JSON + arquivos) e apagar tudo (confirmação dupla).
- **Medidor de uso** completo (por dia, janela, modelo, categoria, sessão) e **limpar cache** por categoria ou por conversa: apaga a sessão do Claude Code correspondente, os logs próprios e o histórico, mantendo os dados do usuário.
- Horários sempre exibidos no fuso do usuário; armazenados em UTC.
- Mostrar o caminho da pasta de dados no host (bind mount do Docker); nada fica dentro do container nem é versionado.
- Tokens de terceiros (GitHub) ficam em arquivo de config com permissão restrita, fora do repositório.
