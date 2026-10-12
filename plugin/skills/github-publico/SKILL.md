---
name: github-publico
description: Revisão do perfil público do GitHub com orientação de atualizações, a partir dos relatórios da ingestão do GitHub. Uso: /narnia-jobs:github-publico [login].
---

1. `file_list` e veja os repositórios já analisados; para cada um relevante ao cargo-alvo, leia o relatório com `file_get_digest` (`repoId`), não o código. `profile_get_card` dá o cargo-alvo e o que o perfil já destaca.
2. Se não houver relatórios do GitHub, ou estiverem antigos, proponha `ingest_github` em modo público (o usuário confirma o orçamento na tela da execução) e pare até a análise terminar.
3. Avalie como um recrutador sênior que abre o GitHub do candidato: repositórios fixados e a ordem deles, README do perfil, descrição e tópicos de cada repositório, README de cada projeto (o que faz, como rodar, resultado), sinais de abandono (forks sem mudança, projetos vazios) e o que não aparece mas está no currículo. Cite o relatório de onde tirou cada ponto.
4. Entregue uma lista curta e priorizada de atualizações concretas para o usuário fazer no GitHub, com o texto sugerido quando couber. Nada é gravado: o que for fato novo de carreira vai pela ingestão do GitHub, com revisão.
