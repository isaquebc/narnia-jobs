# F13 · Análise de entrevista gravada

Entregável 13 do plan-v0. O usuário envia o vídeo de uma entrevista real, e o recrutador devolve transcrição por pessoa, medições de voz, áudio, rosto, câmera e iluminação, leitura das reações e anotações de quem entrevistou, e feedback do discurso com minuto e trecho. Depende de F04 (`plugin/`, MCP, chat), F06 (vaga e análise), F07 (candidatura e etapas), do gate de prompts (F04-avaliacoes M7) e do padrão de tarefas da F05. Não depende da F08.

Status: **plano aprovado pelo dono** (2026-11-09). Viabilidade medida em §8; nada implementado. Primeira a ser feita depois da F12 (decisão do dono, 2026-11-09), antes de F09, F08 e F10.

> **Regra de uso, em destaque no README e na documentação ao entregar (decisão do dono):** a análise existe só para a pessoa se desenvolver durante o processo seletivo. Nenhum vídeo, dado ou leitura pode ser publicado ou compartilhado. Cabe a quem usa respeitar a lei e as regras sobre a gravação e o consentimento dos presentes.

---

## 1 · Objetivo e resultado esperado

Com o serviço `media` ativo, o usuário consegue:

1. enviar o vídeo na etapa de uma candidatura ou de forma avulsa, escolhendo só o perfil;
2. acompanhar o processamento em segundo plano, podendo sair e voltar;
3. confirmar ou corrigir quem é quem;
4. abrir a página da entrevista, com vídeo, transcrição clicável, fichas dos presentes e feedback;
5. clicar numa dica e ver o trecho exato no vídeo;
6. continuar pelo chat ("como eu deveria ter respondido aquela pergunta?").

### Dentro do escopo
- Serviço `media` em Python, em perfil Docker separado, desligado por padrão.
- Upload em partes e retomável; reprodução com `Range`.
- Transcrição, separação de vozes, medições de voz, áudio e rosto, OCR dos nomes, candidatos a anotação, seleção de quadros.
- Cadeia de prompts do recrutador, com checagem por código de citações e tempos.
- Fichas por pessoa, reaproveitadas nas entrevistas do mesmo processo; entrevistas anteriores do processo entram no contexto.
- Skill `analisar-entrevista` e tools MCP `recording.*`; modo B em texto, com link para a página.
- Apagar só o vídeo ou a entrevista inteira.

### Fora do escopo (e para onde vai)
- Visual do relatório → conversa própria com o dono antes do M6 (F13-13); o conteúdo e a ordem já estão em §2.5.
- Classificador treinado de anotação → só com rótulos reais acumulados (F13-9).
- Gravar a chamada pelo produto → futuro; aqui o arquivo vem pronto.
- Áudio sem vídeo → avaliar depois do M3; o pipeline de voz serviria, sem as etapas visuais.

---

## 2 · Arquitetura deste entregável

### 2.1 Visão

```
Candidatura/etapa → upload em partes → api → <dados>/interviews/<id>/video
                         ↓ tarefa recording.analyze (fila "media", concorrência 1)
worker (orquestra) → media (Python; rede só com o worker, modelos em volume)
                         ↓ JSON por etapa, retomável
worker → cadeia do recrutador → checagens por código → página da entrevista
```

Sem o `media` ativo, a tela explica como ativar e nada é enviado.

### 2.2 Etapas do `media`

| # | Etapa | Ferramenta | Saída | Observação |
|---|---|---|---|---|
| 1 | Validar | `ffprobe` | codecs, resolução, duração | gravação do navegador costuma vir sem duração no cabeçalho: calcular pelos pacotes |
| 2 | Extrair áudio | `ffmpeg` | WAV 16 kHz mono | |
| 3 | Transcrever | faster-whisper `large-v3` | palavras com tempo e confiança | |
| 4 | Separar vozes | pyannote `speaker-diarization-community-1` | turnos | sem token: aproximação por boca (F13-5) |
| 5 | Medir voz | librosa + transcrição | ritmo, pausas, entonação, volume, palavras de apoio | Parselmouth fora (GPLv3; projeto MIT) |
| 6 | Medir áudio | `ffmpeg` (`ebur128`, `astats`) | volume, ruído, picos por pessoa | áudio já misturado e comprimido |
| 7 | Medir rosto | MediaPipe Face Landmarker | sorriso, testa, boca, olhar, pose da cabeça, por rosto e por segundo | CPU serve |
| 8 | Layout e nomes | código + Tesseract | regiões por pessoa, nomes das etiquetas, trecho antes da reunião | sala de espera é ignorada |
| 9 | Ligar voz, rosto e nome | correlação de boca × turnos | pessoa ↔ falante | confirmação do usuário quando ambíguo |
| 10 | Eventos | código | reações e candidatos a anotação, sempre relativos ao padrão da própria pessoa | |
| 11 | Quadros | código | no máximo ~40 imagens dos eventos | só isso vai ao modelo |

Cada etapa grava seu JSON e é pulada ao retomar. GPU NVIDIA é opcional, por override do compose; sem ela, CPU.

**Licenças a confirmar antes do M1:** MediaPipe (código e modelo), librosa, pesos do pyannote `community-1`, faster-whisper e pesos do Whisper. Só entra o que for compatível com distribuição em projeto MIT.

### 2.3 Confiabilidade (F13-4)
Cada medição de rosto traz a porcentagem de tempo detectável e o tamanho do rosto. O feedback de sorriso **nunca é omitido**: quando a detecção é fraca, sai com alerta e a porcentagem. A cordialidade também é avaliada pela fala. Expressão é sempre fato observado + hipótese. O mínimo que dispara o alerta é calibrado no M3, considerando que modelos de rosto podem errar mais com barba, pouca luz e pele escura: o gabarito precisa cobrir essa diversidade.

### 2.4 Anotações (F13-8)
- **Confirmada:** a pessoa diz que está anotando (busca na transcrição, com checagem de que a frase é sobre o momento).
- **Provável:** cabeça baixa ou de lado, olhar para baixo sustentado ou rosto perdido por alguns segundos; o modelo revê o quadro.
- **Leitura:** dada pelo recrutador, a partir do que veio antes, da reação seguinte e da vaga: possivelmente favorável, possivelmente desfavorável ou indeterminada (padrão). Nunca um número.

### 2.5 Cadeia do recrutador e relatório
Prompts estruturados: (1) modelo barato separa perguntas e respostas; (2) Sonnet avalia cada resposta com vaga, CV enviado, dados e histórico do processo; (3) leitura dos quadros pela tool `Read`; (4) consolidação.

Ordem do relatório (aprovada pelo dono no teste, F13-14): veredito · o que não deveria ter dito · respostas erradas ou incompletas, com reescrita sem inventar experiência (`[completar]`) · o que funcionou · discurso e forma · sorriso e expressão · reações e anotações · câmera, iluminação e áudio · ficha de cada presente · três treinos · limitações.

**Checagem por código:** citação literal tem de existir na transcrição, no turno e na pessoa indicados; tempo tem de existir no vídeo; sem isso, o item é corrigido com o texto real ou removido, nos moldes do `assembleCv`. Sugestões de reescrita ficam em campo separado das citações.

### 2.6 Armazenamento e backup (F13-2)
`<dados>/interviews/<id>/video.*` fica **fora** do backup, porque a lista de pastas do `start.sh` não inclui `interviews/`. Resultado no banco e quadros em `<dados>/interview-frames/<id>/`, incluída na lista. Apagar só o vídeo mantém a análise, sem reprodução e sem refazer a parte visual.

---

## 3 · Dados deste entregável

Migração nova, só para frente:

| Tabela | Conteúdo |
|---|---|
| `recorded_interview` | id, perfil, candidatura e etapa (opcionais), estado, duração, início da reunião, tem vídeo, modelos usados, `facts_version` |
| `recorded_interview_person` | entrevista, nome, origem do nome, é o candidato, ligação com contato da vaga, medições, confiabilidade, ficha |
| `recorded_interview_turn` | entrevista, pessoa, início, fim, texto, palavras, corrigido pelo usuário |
| `recorded_interview_event` | entrevista, pessoa, tempo, tipo, nível (confirmada, provável), leitura, motivo, quadro |
| `recorded_interview_report` | entrevista, versão, conteúdo JSON, avisos, `usage_event` |

Nome diferente de `interview_session`, que é da entrevista simulada (F08). Token do Hugging Face fica em arquivo 0600 no volume do `media`, nunca em banco, log, resposta da API ou exportação.

---

## 4 · Layouts deste entregável

Visual em aberto (F13-13). Telas necessárias: envio na etapa da candidatura e avulso; ativar o `media`, com o passo a passo do token e a regra de uso; progresso por etapa; confirmação de quem é quem; página da entrevista. A tela de envio traz a dica de fixar a própria câmera ou gravá-la em tamanho maior.

---

## 5 · Decisões deste entregável

| Id | Decisão | Estado |
|---|---|---|
| F13-1 | Análise e ficha completas de todos os presentes; nada publicável, em destaque no README e na documentação | Fechada (dono, 2026-11-09) |
| F13-2 | Vídeo guardado fora do backup; apagar só o vídeo ou tudo; o resto entra no backup | Fechada (dono, 2026-11-09) |
| F13-3 | Vídeo na candidatura, ligado à etapa; avulso como alternativa; página própria, com botão para o chat; entrevistas do processo entram no contexto | Fechada (dono, 2026-11-09) |
| F13-4 | Sorriso sempre reportado, com alerta e % de detecção | Fechada (dono, 2026-11-09) |
| F13-5 | pyannote como padrão, token pedido ao ativar; sem token, aproximação por boca e correção manual | Fechada (dono, 2026-11-09) |
| F13-6 | `media` em perfil Docker separado, desligado por padrão | Fechada (dono, 2026-11-09) |
| F13-7 | Tudo local, exceto transcrição, medições e quadros selecionados que vão ao modelo na assinatura | Fechada (dono, 2026-11-09, plano aprovado) |
| F13-8 | Anotações por fala e imagem; leitura como hipótese, indeterminada por padrão | Fechada (dono, 2026-11-09) |
| F13-9 | Sem classificador até haver rótulos; usuário poderá marcar o que descobriu depois | Fechada (dono, 2026-11-09) |
| F13-10 | Provedor GPU: override opcional do compose, documentado | Fechada (dono, 2026-11-09, plano aprovado) |
| F13-11 | Limites de tamanho e duração do upload | Em aberto (medir no M1) |
| F13-12 | Modelo de cada elo da cadeia | Em aberto (decidir no gate) |
| F13-13 | Visual do relatório | Em aberto (conversa com o dono) |
| F13-14 | Conteúdo e ordem do relatório (§2.5) mantidos como no teste do recrutador, que o dono aprovou; vira o caso de referência do gate (com fixture sintética, nunca a entrevista real) | Fechada (dono, 2026-11-09) |

---

## 6 · Marcos e cobertura

### 6.1 Marcos
- **M1** Serviço `media`, perfil Docker, licenças, tela de ativar, token, upload e reprodução.
- **M2** Áudio: etapas 1 a 6, transcrição por pessoa, correção de falante.
- **M3** Visão: etapas 7 a 11; calibração da confiabilidade.
- **M4** Dados, tarefa `recording.analyze`, retomada, backup, apagar.
- **M5** Cadeia do recrutador, checagem por código, skill, tools MCP, evals no gate.
- **M6** Página da entrevista, depois de F13-13.
- **M7** README, tutorial, regra de uso em destaque, teste manual.

### 6.2 Testes unitários (TDD)
Duração sem cabeçalho; junção de palavras e turnos; retomada por etapa; alerta de confiabilidade; eventos relativos ao padrão da pessoa; detecção de sala de espera; checagem de citações e tempos (citação alterada, pessoa errada, tempo inexistente); backup sem `interviews/` e com o resto; apagar só o vídeo; token nunca em log.

### 6.3 E2e
Com `media` falso: ativar, enviar, retomar upload, acompanhar, corrigir pessoa, clicar na dica e ir ao trecho, apagar, abrir o chat; tela sem o `media`.

### 6.4 Fixtures e gate
Nenhuma gravação real no repositório: vídeo sintético curto ou de licença aberta, com vozes geradas. Prompts novos passam pelo gate de prompts com casos sintéticos, que precisam incluir resposta errada, tangente, anotação e detecção fraca.

### 6.5 Teste manual (M7)
Com gravações reais do dono, sem versionar: Teams, Meet e Zoom, grade e miniatura, GPU e CPU, pt-BR e inglês.

### 6.6 Definição de pronto
Critério de entregável publicável de `README.md` desta pasta, mais a regra de uso em destaque e o gate de prompts aprovado.

---

## 7 · Riscos específicos

| Risco | Mitigação |
|---|---|
| Leitura errada de expressão tomada como fato | observado separado de hipótese; alerta e porcentagem |
| Viés dos modelos de rosto | gabarito diverso; alerta; nunca concluir só pelo rosto |
| Citação alterada pelo modelo | checagem por código (§2.5) |
| Correção técnica errada do modelo | certeza declarada, sem tom de fato |
| Processamento longo em CPU | fila, retomada, progresso por etapa, GPU opcional |
| Imagem e modelos grandes | perfil opcional; aviso do espaço antes de ativar |
| Dado sensível de terceiros | regra de uso, tudo local, apagar por entrevista; fora de logs e do Phoenix por padrão |
| Muitas pessoas na chamada ou tela compartilhada | etapas 8 e 9 reportam a limitação; correção manual |

---

## 8 · Registro de execução

### Teste de viabilidade (2026-11-09)
Uma gravação real do dono (54 min, Teams, 2 pessoas, H.264 + Opus, 1920×904, sem duração no cabeçalho), processada só na máquina dele. Nem o vídeo nem os resultados entram no repositório. CPU apenas: o Docker ainda não tinha acesso à GPU.

| Etapa | Resultado |
|---|---|
| Transcrição (`large-v3`, 16 núcleos) | 21 min; 3,9% das palavras com baixa confiança |
| Separação de vozes (`community-1`, 18 núcleos) | 16 min; encontrou os 2 falantes sem informar quantos; erra frases curtas nas trocas |
| Rosto em tela cheia (~393 px, 1 quadro/s) | 98,9% detectado; 105 s |
| Rosto em miniatura (~32×37 px) | 47,5% detectado; ampliar não ajudou (repetição 33%, Lanczos 45%) e os sorrisos mudavam conforme o método |
| Boca × turnos | identifica qual falante é o rosto grande (0,042 × 0,008), mas sozinho não separa as falas |
| Anotações | 2 confirmadas pela fala; cabeça baixa visível nos quadros; 17 episódios de olhar para baixo ≥ 4 s, sem gabarito |
| Recrutador (Sonnet, transcrição + medições + 18 quadros) | ~5 min, ~125 mil tokens; relatório aprovado pelo dono; nenhuma citação inventada, mas pequenas edições em trechos ditos literais |

Tecnicamente, `faster-whisper` 1.2.1 com PyAV 19 quebra ao decodificar (`metadata_errors`): passar o áudio já em memória ou fixar a versão. MediaPipe 1.2.2 precisa de `libegl1` e `libgles2` na imagem. Não testados: entonação, OCR dos nomes, GPU.
