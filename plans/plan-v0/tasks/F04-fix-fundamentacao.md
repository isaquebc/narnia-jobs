# F04 · Recrutador fundamentado: busca, fontes e revisão (2026-10-29)

Plano para que toda resposta do recrutador seja **baseada nos fatos do usuário e em fontes**, sem afirmar ausência de algo que está no perfil, sem número de mercado sem pesquisa, sem detalhe inventado da vaga e sem prometer gravar o que passa pela revisão. Motivado pelo gate do chat da F07 (juiz do recrutador em 73% de média, contra 98% dos avaliadores de código) e pelo uso real do dono: a busca volta incompleta, fatos que estão no perfil só aparecem quando ele pergunta mais a fundo ou repete o que já disse.

Status: **em andamento** (2026-10-29). Decisões FF-1 a FF-6 do dono (§5). Marcos R0 a R6 (§4).

---

## 1 · O que acontece e por quê

| # | Padrão (gate do chat, F07) | Exemplo real |
|---|---------------------------|--------------|
| A1 | Afirma ausência sem buscar | "mentoria não está no seu perfil" com "Mentoria (nível 4)" nos fatos |
| A2 | Afirmação de mercado sem fonte; faixa própria com número | "o teto de R$ 25 mil só aparece em multinacionais" |
| A3 | Detalhe inventado da vaga | "foco em pagamentos com alta disponibilidade" (a vaga não diz) |
| A4 | Não diz o resultado | depois da análise, só "deixei um botão para gerar o CV" |
| A5 | Promete gravar direto | "eu registro as respostas como fatos" (`mentions_review` 0/5 em `formulario-fato-novo`) |
| A6 | Respostas longas, várias opções no lugar de um próximo passo | — |

## 2 · Encaixe no código (o que existe hoje)

1. **A busca junta as palavras com "E".** `toFtsQuery` (`packages/core/src/db/repos/chat.ts`) transforma "Kafka mensageria RabbitMQ" em `"Kafka"* "mensageria"* "RabbitMQ"*`; no FTS5 isso exige todas as palavras no mesmo fato. Busca agrupada quase nunca acha nada, e o modelo aprendeu a buscar um termo por vez (várias chamadas por pergunta, e ainda perde fatos).
2. **Só prefixo, sem sinônimo nem tradução**: "mentoria" não acha "mentoring", "liderança" não acha "tech lead". O dicionário canônico das vagas (`canonicalTerm`) não é usado na busca de fatos.
3. **O recrutador não vê a lista dos fatos**: recebe o cartão do perfil e depende da busca. O juiz recebe todos (`knownFactsText`), por isso pega o "não está no perfil" que o recrutador nunca viu.
4. **Ranking**: `fact.search` já calcula a relevância de cada fato para o perfil ativo (`relevance()`); fatos são do usuário, o perfil é o viés (FF-6).
5. **Juiz holístico**: um rótulo (atende/parcial/não atende) para 5 critérios; qualquer detalhe derruba tudo, e parte da nota é ruído.

## 3 · Propostas

- **Busca (R1)**: termos com OU e ranking por quantos batem (bm25); várias consultas numa chamada (`queries: string[]`); expansão pelo dicionário canônico e pares pt/en; **apelidos aprendidos** (FF-1): quando a busca por um termo falha e o recrutador acha o fato por outro termo no mesmo turno, grava o par termo → fato (`fact_alias_add`), visível e removível em Meus dados; o apelido aponta para um fato que existe, nunca liga palavra a palavra.
- **Índice no contexto (R2)**: uma linha por fato, ordenado pela relevância do perfil ativo, com teto de tokens (prompt caching); o resto fica para a busca.
- **Testes (R3)**: casos novos por padrão (A1–A6); avaliadores por código (buscou antes de afirmar ausência, número de mercado só com pesquisa, diz o resultado da análise, tamanho); juiz quebrado em perguntas sim/não por critério e o objetivo passado para código (FF-4); calibração com matriz de confusão (VP, VN, FP, FN, precisão e recall por padrão) (FF-3).
- **Prompt (R4)**: revisão antes de gravar, tamanho, dizer o resultado.
- **Citação obrigatória (R5, FF-2)**: o recrutador cita o id que a tool devolveu (`[f:<id>]` fato, `[r:<id>]` pesquisa, `[v:<id>]` vaga); o código confere na hora se o id existe e veio de uma tool da conversa; afirmação sem citação fica marcada; os ids viram links. Revisão por modelo só nas avaliações.
- **RAG híbrido opcional (R6, FF-5)**: embeddings locais multilíngues (`multilingual-e5-small` ou `paraphrase-multilingual-MiniLM-L12`, ~120 MB, ONNX na CPU, baixado na ativação para `<dados>/models/`), vetores em tabela do SQLite com busca por força bruta (sem extensão nativa), fusão com a busca lexical (RRF); alerta para ativar quando o perfil passa do limite medido no benchmark; vetores derivados (fora do backup, refeitos ao restaurar e ao trocar de modelo).
- **Relatórios (FF-3)**: cada marco grava `evals/reports/<data>-<rótulo>.md` (latência p50/p95 por turno, tokens, custo, tools por turno, recall da busca, notas) e compara com o anterior.

## 4 · Marcos

| Marco | Entrega | Ataca |
|---|---|---|
| R0 | linha de partida: relatório de latência/custo/tools por turno, benchmark de recall da busca atual, notas atuais | — |
| R1 | busca com OU e ranking, várias consultas, dicionário pt/en, apelidos aprendidos | A1 |
| R2 | índice compacto no contexto (relevância do perfil, teto) | A1, A2, A3 |
| R3 | casos novos, avaliadores por código, juiz sim/não, calibração com matriz de confusão | todos (medição) |
| R4 | prompt: revisão, tamanho, resultado | A4, A5, A6 |
| R5 | citação obrigatória conferida por código | A1, A2, A3 |
| R6 | RAG híbrido opcional com alerta | A1 (perfis grandes) |

Gate do chat em todo marco que mexe em prompt ou tool (`--feature` para os casos novos).

## 5 · Decisões do dono

| Id | Decisão |
|---|---|
| FF-1 | Dicionário em camadas: canônico fixo + pares pt/en + apelidos aprendidos ligados a fatos (não sinônimos livres escritos pelo modelo) |
| FF-2 | Revisão em tempo de execução: A (garantir as referências: busca e índice) + D (citação obrigatória conferida por código); revisão por modelo só nas avaliações |
| FF-3 | Medir antes e depois: relatório por marco (latência, custo, tools, recall, notas); calibração do revisor/juiz com matriz de confusão |
| FF-4 | Ruído do juiz: perguntas sim/não por critério (5.1) e o que é objetivo passa para código (5.2) |
| FF-5 | RAG híbrido viável e opcional, com alerta para ativar (o sistema também será usado por terceiros) |
| FF-6 | Os fatos são do usuário; o perfil é o viés que decide o que se destaca: índice e busca mostram tudo, ordenado pela relevância do perfil ativo |

## 6 · Registro

| Data | Marco | O que foi feito |
|------|-------|-----------------|
| 2026-10-29 | — | Plano escrito com o dono (decisões FF-1 a FF-6). |
