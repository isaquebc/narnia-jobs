# 05 · Layout das páginas

Wireframes em ASCII. Desktop primeiro (uso local), mas o shell deve degradar bem até ~1024px. Tema claro/escuro desde o início.

---

## L0 · Shell (comum a tudo após o onboarding)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ▣ Narnia Jobs      [▼ Eng. de Software Sênior ]      ● Claude Code · Sonnet  │
├──────────────┬───────────────────────────────────────────────┬───────────────┤
│ ▸ Chat       │                                               │ Contexto      │
│ ▸ Meus dados │                                               │ ───────────── │
│ ▸ Ingestão   │                                               │ cartão perfil │
│ ─────────    │              ÁREA PRINCIPAL                   │ 3 experiências│
│ Features     │                                               │ 12 skills     │
│ ▸ Gerar CV   │                                               │               │
│ ▸ Analisar   │                                               │ Uso da sessão │
│   vaga       │                                               │ ▇▇▇▁▁ 18k tok │
│ ▸ Candidat.  │                                               │ ≈ US$ 0,07    │
│ ▸ Entrevista │                                               │               │
│ ─────────    │                                               │               │
│ ⚙ Config     │                                               │               │
└──────────────┴───────────────────────────────────────────────┴───────────────┘
```
- Seletor de perfil no topo: trocar recarrega persona e dados. Último item do menu: "+ novo perfil".
- Painel direito ("Contexto") é recolhível e mostra o que o agente carregou e o uso de tokens.
- **Bandeja de atividades** (ícone ⟳ no topo, com contador): lista jobs em andamento (ingestões, clarificações, gerações de CV) com progresso, erro, cancelar e "abrir"; persiste entre páginas.
- **Abas de sessão** no Chat: várias conversas ativas por perfil, cada uma com categoria e uso próprio.
- Todo horário exibido no fuso do usuário (indicado no rodapé, ex.: "America/Sao_Paulo").
- Indicador do provider/modelo no canto: clique abre troca rápida de modelo.

## L1 · Onboarding (wizard, tela cheia; 5 passos no F01, o 6º e 7º entram com F03 e F04)

Implementação (M5): Tailwind v4 com tema claro/escuro; componentes shadcn/ui só sobre Radix Dialog, Tooltip, Switch e Tabs; `<select>` nativo em vez de Radix Select (F01-55); todos os textos vêm de `apps/web/src/i18n/pt-BR.ts`, com teste que proíbe literais pt-BR fora do dicionário. O estado do wizard é gravado em `onboarding/state` a cada avanço, por isso ele é retomável (F01-61).

```
┌──────────────────────────────────────────────────────────────────┐
│   ①──②──③──④──⑤              Passo 1 · Provider                 │
│                                                                  │
│   ◉ Claude Code      ✔ no container (2.1.x)   ✖ não logado       │
│       rode no terminal: docker compose run --rm narnia-jobs claude auth login  │
│       [verificar de novo]                                        │
│   ○ Codex            em breve                                    │
│                                                                  │
│   ℹ Usaremos sua assinatura. Nenhum dado sai do seu PC           │
│     além das mensagens enviadas ao modelo.                       │
│                                                     [Continuar →]│
└──────────────────────────────────────────────────────────────────┘
```

Passo 2 · Currículo (primeiro input, opcional):
```
┌──────────────────────────────────────────────────────────────┐
│   Já tem um currículo pronto? Vamos extrair tudo dele.       │
│   ┌──────────────────────────────────────────────────────┐   │
│   │        arraste PDF / DOCX / MD aqui ou [escolher]     │   │
│   └──────────────────────────────────────────────────────┘   │
│   Estimativa após upload: ~6k tokens · 1 chamada · Haiku     │
│                     [Não tenho, começar do zero]  [Extrair →]│
└──────────────────────────────────────────────────────────────┘
```
Passo 3 · Extração: barra de progresso + prévia do **registro de contexto** (resumo e pontos principais) assim que pronto.
Passo 4 · Revisão (reutiliza a tela de revisão de L3) com identidade/contato no topo, pré-preenchidos:
```
│ Nome  [Ana M. ...        ]   E-mail [anaexemp@...        ] ● do CV │
│ Telefone * [+55 ▼] [DDD 11] [9 9999-9999]   ⚠ não estava no CV     │
│ Cidade * [São Paulo] País * [Brasil ▼]  Remoto ◉ sim ○ híbrido ○ não │
```
Passo 5 · Primeiro perfil, pré-sugerido ("parece um perfil de Eng. de Software Sênior · backend; ajuste se quiser").
Passo 6 · Mais fontes (GitHub/LinkedIn) só aparece a partir do F03 (sem tela "em breve"); reutiliza L3 em modo compacto, pulável. Passo 7 (descoberta) entra com F04 e reutiliza L2.

## L2 · Chat com o recrutador

```
┌───────────────────────────────────────────────────────────────┐
│ Recrutador · especialista em Eng. de Software · nível sênior  │
├───────────────────────────────────────────────────────────────┤
│ 🧑 Olhe meu perfil e me diga o que está fraco.                │
│                                                               │
│ 🤖 Puxei suas 3 experiências e 12 skills.  [experience.list] │
│    Pontos fracos, com franqueza:                              │
│    1. Nenhuma conquista tem métrica ...                       │
│    2. ...                                                     │
│    ┌─────────────────────────┐ ┌──────────────────────────┐   │
│    │ ✚ Adicionar métricas    │ │ ▶ Gerar CV com isso      │   │
│    └─────────────────────────┘ └──────────────────────────┘   │
├───────────────────────────────────────────────────────────────┤
│ [ Escreva...                                   ] [📎] [Enviar]│
│ sessão: 18k tokens · histórico por perfil · [nova conversa]   │
└───────────────────────────────────────────────────────────────┘
```
- Chamadas de tool aparecem como chips discretos e expansíveis.
- Botões de ação sugeridos pelo agente abrem a feature já preenchida.

## L3 · Ingestão

```
┌─ Fonte ───────────────────────────────────────────────────────┐
│ [📄 CV]  [✎ Texto livre]  [ GitHub]  [in LinkedIn export]    │
│ texto livre: área grande "conte sua história profissional..." │
├─ GitHub ──────────────────────────────────────────────────────┤
│ usuário/org: [ exemplo             ]  token (opcional): [••••]│
│ repos: ☑ todos  ☐ escolher...   excluir forks ☑  arquivados ☐ │
├─ Profundidade ────────────────────────────────────────────────┤
│   Rápida ●────────○────────○ Profunda                         │
│   metadados + README        + commits, arquivos-chave         │
│   ≈ 6k tokens · 1 chamada   ≈ 60k tokens · ~15 chamadas       │
├───────────────────────────────────────────────────────────────┤
│ Estimativa: ~22k tokens, ~5 chamadas, modelo: Haiku           │
│                                       [Pré-visualizar] [Rodar]│
└───────────────────────────────────────────────────────────────┘
```

Tela de revisão (após rodar):
```
┌─ Revisar 14 fatos extraídos ─────────────── [aceitar todos ✔]─┐
│ ✚ Projeto  "api-gateway"  Go · 2023–2024   fonte: github       │
│    "Gateway com rate limiting..."       [✔ aceitar][✎][✖]     │
│ ⚠ Experiência  "Acme" 2021–2023  conflito: CV diz 2020–2023    │
│    ◉ manter CV  ○ usar novo  ○ editar     [✔][✎][✖]           │
│ = Skill "Docker" já existe → adiciona evidência (3 repos)     │
│ ...                                                            │
│ sugerir para perfis: ☑ Eng. Software  ☐ Project Manager        │
│                        [Clarificar com o recrutador] [Salvar 12]│
└────────────────────────────────────────────────────────────────┘
```

Cartão de arquivo (aba Evidências), mostrando o registro de contexto em vez do PDF:
```
┌ cv_2025.pdf · 2 págs · pt-BR · enviado 06/10/2026 ───────────── [abrir original] ┐
│ Resumo: currículo de engenheiro de software com 7 anos de experiência em ...     │
│ Pontos principais: Acme (2021–2023, Sênior) · Globex (2018–2021, Pleno) · ...    │
│ Seções: Resumo · Experiência · Formação · Skills · Idiomas            [✎ editar] │
│ Fatos gerados a partir deste arquivo: 14 (12 aceitos, 2 rejeitados)              │
└──────────────────────────────────────────────────────────────────────────────────┘
```

## L4 · Meus dados

```
┌ [Identidade] [Experiências] [Projetos] [Skills] [Formação] [Preferências] [Evidências] ┐
│ Experiências (3)                                            [+ adicionar] │
│ ┌──────────────────────────────────────────────────────────────────────┐ │
│ │ Acme · Eng. de Software Sênior · 2021–2023 · CLT        ● verificado │ │
│ │  • Reduziu latência p95 em 40% ...          ✎                         │ │
│ │  • (sem métrica) Liderou migração ...       ⚠ recrutador sugere métrica│ │
│ │  tech: Go, Kubernetes, Postgres        fonte: cv_2025.pdf             │ │
│ └──────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
```
Selo por fato: ● verificado · ◐ extraído (não confirmado). Filtro "mostrar só não verificados".

## L5 · Feature: Gerar CV

```
┌─ Parâmetros ──────────────────┬─ Prévia ──────────────────────────────────┐
│ Perfil: Eng. Software Sênior  │  (prévia renderizada do PDF, template aplicado) │
│ Template: ◉ Clássico ○ Moderno│                                            │
│   ○ Compacto ○ Meu template ▲ │  # Ana M. ...                              │
│ Vaga (opcional):              │  Senior Backend Engineer · São Paulo (rem.)│
│ [ colar descrição / escolher  │                                            │
│   candidatura ▼ ]             │  ## Experiência                            │
│ Idioma: ◉ pt-BR ○ en-US       │  **Acme** — Eng. de Software Sênior ...    │
│ Tamanho: ○ 1 pág ◉ 2 págs     │  - Reduziu latência p95 em 40% ...         │
│ Modelo: [Sonnet ▼]            │                                            │
│ Estimativa: ~9k tokens        │  (editável inline, Markdown)               │
│ [Gerar]                       │                                            │
│                               │  [Exportar PDF] [DOCX] [Salvar versão v3]  │
│ Versões: v1 · v2 · v3 ●       │  ⚠ 2 fatos não verificados usados          │
└───────────────────────────────┴────────────────────────────────────────────┘
```

## L6 · Feature: Analisar vaga

```
┌─ Vaga ────────────────────────┬─ Resultado ───────────────────────────────┐
│ [ cole a descrição ou URL ]   │ Fit geral: 72%  ▇▇▇▇▇▇▇▁▁▁                │
│                               │ ✔ Atende: Go, Kubernetes, liderança técn. │
│ Candidatura: ○ nova ◉ ligar a │ ✖ Lacunas: Kafka (nenhuma evidência)      │
│   [Acme — Staff Eng ▼]        │ ⚠ Risco: senioridade pedida > declarada   │
│ [Analisar]                    │ Palavras-chave ATS ausentes: ...          │
│                               │ Perguntas prováveis: ...                  │
│                               │ [▶ Gerar CV para esta vaga] [▶ Simular]   │
└───────────────────────────────┴───────────────────────────────────────────┘
```

## L7 · Feature: Candidaturas (kanban)

```
┌ Interesse (4) ┬ Aplicado (3) ┬ Entrevista (2) ┬ Oferta (0) ┬ Encerrado (5) ┐
│ ┌───────────┐ │ ┌──────────┐ │ ┌────────────┐ │            │               │
│ │ Acme      │ │ │ Globex   │ │ │ Initech    │ │            │               │
│ │ Staff Eng │ │ │ Sr Eng   │ │ │ Sr Backend │ │            │               │
│ │ fit 72%   │ │ │ CV v3    │ │ │ 🗓 09/10   │ │            │               │
│ └───────────┘ │ └──────────┘ │ └────────────┘ │            │               │
└───────────────┴──────────────┴────────────────┴────────────┴───────────────┘
```
Cartão aberto: detalhes da vaga, documentos gerados, análise, notas, ações rápidas e a seção de agenda:
```
│ Agenda                                                                         │
│ 🗓 Entrevista técnica · 09/10 14:00 (America/Sao_Paulo) · meet.google.com/...   │
│    Google conectado:  ✔ evento criado  [abrir no Google Calendar]              │
│    sem conexão:       [Adicionar ao Google Calendar] [baixar .ics]             │
│ [+ agendar etapa]                                                              │
```

## L8 · Feature: Entrevista por voz

```
┌ Initech · Sr Backend · entrevista técnica            ⏱ 08:32   ▇▇▁▁ 11k tok ┐
│                                                                              │
│                 ╭─────────────────────────╮                                  │
│                 │   ◉  ouvindo você...     │   ← estado: ouvindo / pensando / │
│                 ╰─────────────────────────╯      falando (anel animado)      │
│                                                                              │
│  🤖 "Me conte sobre um incidente de produção que você liderou."              │
│  🧑 "Em 2022 a gente teve uma queda do gateway que..."         (transcrição) │
│  🤖 "Boa. Qual foi a métrica que você usou para..."                          │
│                                                                              │
│  [⏸ pausar]  [⌨ modo texto]  [■ encerrar]        🎙 mic: Padrão ▼  voz: pt-BR ▼│
│  ℹ áudio processado pelo navegador (Chrome/Edge); nada de áudio é gravado    │
└──────────────────────────────────────────────────────────────────────────────┘
```
Tela inicial: escolher candidatura e tipo, teste de microfone (barra de nível), aviso de privacidade, [Iniciar]. Tela final: feedback consolidado por competência, pontos fortes, o que treinar, link para a transcrição salva na candidatura.

## L9 · Configurações

```
Provider        ◉ Claude Code  ○ Codex (em breve)     estado: ✔ logado no container  [como logar]
Modelo padrão   chat: [Sonnet ▼]  ingestão: [Haiku ▼]  documentos: [Sonnet ▼]
Limite por sessão  [ 50k tokens ]  avisar em 80% ☑
Pasta de dados  ./data  (bind mount → /data no container)   [como mudar: NARNIA_DATA_DIR]
Dados           [Exportar tudo] [Apagar tudo]
Integrações     GitHub token [••••••] [testar]
                Google Calendar  ✖ não conectado   [Conectar Google…]  → guia: criar cliente OAuth,
                                 colar client ID/secret, login via `claude mcp login`
Voz             STT: ◉ Whisper local (navegador) ○ Whisper (servidor) ○ Web Speech ○ serviço pago [+]
                TTS: ◉ Piper pt-BR (local) ○ Kokoro en (local) ○ voz do sistema ○ serviço pago [+]   [testar]
Uso do plano    hoje ▇▇▇▁▁ 142k tok · janela 5h ▇▇▁▁▁ 38% · semana ▇▁▁▁▁        [ver detalhes]
                por categoria: carreira 61% · ingestão 24% · CV 9% · entrevista 6%
                [Limpar cache ▼ por categoria | por conversa]
Templates de CV Clássico · Moderno · Compacto · [+ enviar template .zip]
Porta           3102 (escolhida automaticamente; intervalo 3100–3199)      fuso: America/Sao_Paulo
Aparência       ○ claro ◉ escuro ○ sistema   idioma da UI: [pt-BR ▼]
```
