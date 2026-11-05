# Relatório r1r2-busca-indice

2026-10-29T21:06:14.089Z · commit a737b92 · provider claude-code · 3 amostra(s)

- Conversas: 54 (0 com erro) · turnos: 63
- Latência por turno: p50 12,3 s · p95 70,1 s
- Tools por turno: 2,7 · buscas (fact_search) por turno: 0,7
- Tamanho médio da resposta: 1131 caracteres
- Tokens por conversa: 1979 · custo estimado por conversa: US$ 0.155
- Avaliadores de código: 96% · juiz: 71%
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
| pontos-fracos | 3 | 0 | 100% | 100% | 49,6 s | 2,0 |
| salario-de-mercado | 3 | 0 | 93% | 50% | 24,4 s | 0,0 |
| historia-livre | 3 | 0 | 100% | 100% | 5,8 s | 0,0 |
| valor-pesquisado | 3 | 0 | 92% | 50% | 16,4 s | 0,0 |
| especializado | 3 | 0 | 80% | 83% | 52,1 s | 2,3 |
| vaga-no-chat | 3 | 0 | 100% | 100% | 67,2 s | 2,7 |
| vaga-no-chat-com-assunto | 3 | 0 | 100% | 50% | 7,2 s | 0,0 |
| analise-de-vaga | 3 | 0 | 94% | 83% | 77,4 s | 1,7 |
| cv-pelo-chat | 3 | 0 | 100% | 100% | 5,8 s | 0,0 |
| feedback-do-cv | 3 | 0 | 93% | 50% | 28,1 s | 1,0 |
| corrigir-cargo | 3 | 0 | 100% | 50% | 7,1 s | 1,0 |
| formulario-reescrever | 3 | 0 | 100% | 0% | 10,5 s | 1,0 |
| formulario-fato-novo | 3 | 0 | 93% | 100% | 12,4 s | 1,0 |
| formulario-sem-vaga | 3 | 0 | 100% | 33% | 7,7 s | 0,0 |
| formulario-autodeclaracao | 3 | 0 | 100% | 83% | 5,0 s | 0,0 |
| analise-com-vaga-descartada | 3 | 0 | 100% | 67% | 70,3 s | 2,3 |
| candidatura-etapa-e-agenda | 3 | 0 | 87% | 83% | 17,3 s | 0,0 |
| candidaturas-listar | 3 | 0 | 89% | 100% | 7,9 s | 0,0 |
