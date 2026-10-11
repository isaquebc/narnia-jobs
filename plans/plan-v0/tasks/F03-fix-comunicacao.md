# F03 · Comunicação do andamento das ingestões (2026-10-11)

Plano para que o usuário entenda, a qualquer momento, **em que ponto a ingestão está, o que falta, se está viva e o que fazer quando algo dá errado**. Motivado pelo uso real do dono em 2026-10-11: repositórios aparecendo como "Concluído" enquanto a execução seguia em "Analisando", uma execução presa sem sinal na tela, "Tentar de novo" que não dizia o que refazia, "Reanalisar" que criava outra execução sem avisar e erros com texto técnico em inglês.

Status: **plano**, aguardando o dono (decisões em §4). TDD em todos os itens; só na instância `claude`.

---

## 1 · O que o usuário viu e por que confunde

| # | Situação real | Por que parece bug |
|---|---------------|--------------------|
| P1 | Lista de repositórios com "Concluído" e o topo da execução em "Analisando" | "Concluído" do repositório e "Analisando" da execução usam o mesmo vocabulário para coisas diferentes; nada diz que faltam síntese, reconciliação e conferência |
| P2 | Execução em "Analisando" por 10+ minutos sem mudança | não há indicação da etapa atual, de progresso nem de última atividade; impossível distinguir "trabalhando" de "parado" |
| P3 | Execução presa de verdade (tarefa morta num reinício do worker; o espelho do job continuou "rodando") | a tela diz "Analisando" para sempre e não oferece saída |
| P4 | "Tentar de novo" voltou a "Analisando", mas os repositórios com erro continuaram com erro | o botão não diz o que vai refazer (só a síntese) nem o que não vai |
| P5 | "Reanalisar" num repositório criou uma ingestão nova | nada avisou que seria outra execução, nem ligou a nova à anterior |
| P6 | Erro "Claude Code returned an error result: Reached maximum number of turns (1)" | mensagem técnica, em inglês, sem o que fazer |
| P7 | Sino com 6 pendências que não somem ao visitar | contagem não acompanha o que o usuário já viu (decisão pendente desde 2026-10-10) |
| P8 | Uma edição de código no meio da execução reiniciou o worker do dono e matou a tarefa | infraestrutura de dev, não da UI, mas o efeito aparece como P3 |

## 2 · Propostas

### C1 · Linha do tempo da execução (resolve P1, P2)
- Componente `RunTimeline` no topo da página da execução, sempre visível, com as etapas na ordem real:
  GitHub: **Preparar → Analisar repositórios (N de M) → Síntese → Reconciliar → Conferir propostas → Revisão**;
  CV/texto: **Ler → (OCR) → (Leitura pelo modelo) → Consolidar → Extrair fatos → Resumo → Reconciliar → Conferir → Revisão**.
- Cada etapa: pendente · em andamento (com barra e "x de y" quando houver) · concluída (com duração) · pulada (com motivo, ex. "conferência desligada") · erro (com ação).
- O status do topo passa a ser derivado e explícito: **"Analisando · etapa 5 de 6: conferindo 106 propostas"**, nunca só "Analisando".
- A mesma frase curta aparece na bandeja de atividades e na lista de execuções.
- Dados: a API devolve `timeline[]` calculado a partir de jobs + relatório (`GET /api/ingestions/:id`), sem tabela nova.

### C2 · Vocabulário sem ambiguidade (resolve P1)
| Hoje | Proposto | Onde |
|------|----------|------|
| repositório "Concluído" | **"Analisado"** | linha do repositório |
| repositório "Erro" | **"Falhou: <motivo curto>"** + ação | linha do repositório |
| execução "Concluída" (só após salvar a revisão) | **"Finalizada"** | topo, lista |
| execução em `review` | **"Pronta para revisão"** (destaque, botão "Revisar") | topo, lista, notificação |
| execução em `running` | **"Analisando · <etapa>"** | topo, lista, bandeja |
Regra: a palavra "Concluído/Finalizado" só existe no nível da execução e só no fim.

### C3 · Sinal de vida e detecção de travamento (resolve P2, P3)
- Toda tarefa ativa publica batimento (progresso ou "ainda trabalhando") a cada 15 s; a timeline mostra **"última atividade há 20 s"**.
- Sem batimento por **2 minutos** numa etapa ativa → a etapa vira **"Parece parada"** com "Tentar de novo esta etapa" e "Cancelar execução".
- A recuperação ao abrir (`healStuckRun`) passa a conferir também o **estado real do job na fila** (BullMQ: `failed`, ausente ou parado sem batimento), não só o espelho; sincroniza o espelho e marca a execução como erro com a tarefa guardada. Corrige o caso da execução `01a12a97` (fila diz "travado além do limite", espelho diz "rodando").
- Um verificador periódico no worker (a cada 1 min) faz a mesma reconciliação para execuções que ninguém abriu, e gera a notificação "Ingestão parada: <nome>".

### C4 · Ações que dizem o que fazem (resolve P4, P5)
- "Tentar de novo" vira um rótulo específico pela tarefa guardada: **"Refazer a síntese"**, **"Refazer a conferência"**, **"Refazer a preparação"**; abaixo, uma linha: "Os repositórios já analisados não serão refeitos."
- Repositório com falha ganha, na própria linha, **"Tentar este repositório de novo"**, que reenfileira só ele **na mesma execução** e refaz síntese/reconciliação/conferência ao final.
- "Reanalisar" (Evidências) abre confirmação: "Isto cria uma nova análise só deste repositório. A execução anterior não muda." A execução nova mostra "Reanálise de <repo> · origem: <execução anterior>" com link de volta, e a anterior ganha "Reanálises: <link>".

### C5 · Erros em linguagem simples (resolve P6)
- Mapa de erros conhecidos → mensagem em pt-BR + o que fazer; o texto técnico fica em "Detalhes técnicos" (recolhido):
  | Técnico | Mensagem |
  |---|---|
  | `Reached maximum number of turns` | "O modelo não conseguiu concluir a resposta no formato esperado. Tente de novo; se repetir, troque o modelo." |
  | `HTTP 5xx` / "GitHub instável" | "O GitHub está instável agora. Tentamos 3 vezes. Tente de novo em alguns minutos." |
  | `job stalled more than allowable limit` | "A tarefa foi interrompida (o serviço reiniciou). Tente de novo esta etapa." |
  | `not_authenticated` | "Conecte o GitHub para continuar." + botão |
  | `rate_limited` | "Limite de requisições do GitHub atingido. Disponível de novo às HH:mm." |
  | `Repositório vazio` | "Repositório sem nenhum commit; foi pulado." |
- Erros sem mapeamento: "Algo deu errado nesta etapa" + detalhes técnicos + "Tentar de novo".

### C6 · Sino coerente (resolve P7)
- Já proposto em 2026-10-10 e pendente com o dono: sugestões de perfil agrupadas numa notificação; contador conta só o que ainda não foi visto; pendência resolvida some sozinha. Execução "Pronta para revisão" vira a notificação principal da ingestão.

### C7 · Infraestrutura de dev que não derruba a instância do dono (resolve P8)
- Desligamento gracioso do worker: ao receber SIGTERM, para de pegar jobs novos e espera o ativo terminar por até 60 s (hoje o `tsx watch` mata em 5 s).
- Instância do dono rodando de uma cópia separada do código (worktree), atualizada só quando um marco fecha verde (decisão pendente desde 2026-10-09).

## 3 · Ordem, testes e verificação

| Lote | Itens | Testes antes (exemplos) |
|------|-------|------------------------|
| CM1 | C3 (fila real + verificador periódico + batimento) e C5 | api: espelho "active" com job `failed` na fila → execução erro; worker: verificador marca parada; core: mapa de erros |
| CM2 | C1 e C2 | api: `timeline[]` por fonte e estado; web: frase do topo "etapa x de y", rótulos novos, duração por etapa |
| CM3 | C4 | api: retry de um repositório na mesma execução; web: rótulo do botão pela tarefa; confirmação do "Reanalisar" e link entre execuções |
| CM4 | C6 e C7 | core/web: contador por não vistas e agrupamento; worker: SIGTERM espera o job ativo |

Verificação final: unitários, e2e da F03 atualizados (timeline e rótulos), e um cenário novo "execução parada": matar o worker no meio da síntese na instância `claude` → em até 2 min a tela mostra "Parece parada" → "Refazer a síntese" → "Pronta para revisão".

## 4 · Decisões para o dono

| # | Pergunta | Recomendação |
|---|----------|--------------|
| CM-1 | Vocabulário de C2 | adotar a tabela de C2 ("Analisado", "Pronta para revisão", "Finalizada") |
| CM-2 | Limite para "Parece parada" | 2 minutos sem sinal de vida |
| CM-3 | Sino (C6) | agrupar sugestões e contar só o não visto |
| CM-4 | Cópia separada para a instância do dono (C7) | sim, atualizada a cada marco verde |
