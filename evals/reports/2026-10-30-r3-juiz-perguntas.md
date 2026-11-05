# Relatório r3-juiz-perguntas

2026-10-30T05:07:26.089Z · commit 2b6c0b1 · provider claude-code · 3 amostra(s)

- Conversas: 72 (0 com erro) · turnos: 81
- Latência por turno: p50 10,7 s · p95 71,8 s
- Tools por turno: 2,7 · buscas (fact_search) por turno: 0,7
- Tamanho médio da resposta: 1145 caracteres
- Tokens por conversa: 1823 · custo estimado por conversa: US$ 0.145
- Avaliadores de código: 93% · juiz: 78%
- Recall da busca de fatos: 72%

## Recall da busca por tipo

| Tipo | Recall |
|---|---|
| exato | 100% |
| agrupado | 100% |
| traducao | 100% |
| sinonimo | 80% |
| semantico | 14% |

Faltaram:
- frontend: skill: React; experience: Full Stack
- banco-de-dados: skill: PostgreSQL; skill: SQLite
- desempenho: achievement: latência p95
- fintech: experience: Acme Pagamentos
- faculdade: education: Ciência da Computação
- pesquisa-academica: experience: iniciação científica
- api: skill: REST; skill: GraphQL

## Por caso

| Caso | Amostras | Erros | Avaliadores | Juiz | Turno p50 | Buscas/turno |
|---|---|---|---|---|---|---|
| pontos-fracos | 3 | 0 | 95% | 83% | 46,6 s | 1,7 |
| salario-de-mercado | 3 | 0 | 100% | 50% | 25,8 s | 0,0 |
| historia-livre | 3 | 0 | 100% | 83% | 5,5 s | 0,0 |
| valor-pesquisado | 3 | 0 | 100% | 67% | 19,0 s | 0,0 |
| especializado | 3 | 0 | 89% | 100% | 45,8 s | 2,0 |
| vaga-no-chat | 3 | 0 | 100% | 100% | 67,9 s | 2,0 |
| vaga-no-chat-com-assunto | 3 | 0 | 100% | 50% | 6,2 s | 0,0 |
| analise-de-vaga | 3 | 0 | 90% | 67% | 80,9 s | 2,3 |
| cv-pelo-chat | 3 | 0 | 100% | 83% | 6,9 s | 0,0 |
| feedback-do-cv | 3 | 0 | 93% | 100% | 20,0 s | 1,0 |
| corrigir-cargo | 3 | 0 | 100% | 67% | 7,7 s | 1,0 |
| formulario-reescrever | 3 | 0 | 100% | 100% | 9,7 s | 1,0 |
| formulario-fato-novo | 3 | 0 | 89% | 67% | 11,3 s | 1,0 |
| formulario-sem-vaga | 3 | 0 | 100% | 67% | 6,9 s | 0,0 |
| formulario-autodeclaracao | 3 | 0 | 100% | 100% | 5,0 s | 0,0 |
| analise-com-vaga-descartada | 3 | 0 | 100% | 50% | 72,5 s | 2,3 |
| candidatura-etapa-e-agenda | 3 | 0 | 100% | 100% | 18,6 s | 0,0 |
| candidaturas-listar | 3 | 0 | 100% | 100% | 5,8 s | 0,0 |
| fato-existente | 3 | 0 | 75% | 67% | 9,7 s | 1,3 |
| fato-ausente | 3 | 0 | 75% | 100% | 10,3 s | 1,0 |
| pretensao-sem-pesquisa | 3 | 0 | 67% | 50% | 24,4 s | 0,0 |
| vaga-o-que-pede | 3 | 0 | 67% | 67% | 11,7 s | 0,0 |
| fato-novo-no-chat | 3 | 0 | 89% | 83% | 10,5 s | 1,0 |
| pergunta-curta | 3 | 0 | 100% | 67% | 2,6 s | 0,0 |
