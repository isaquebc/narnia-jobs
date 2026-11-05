-- Vetores da busca por sentido (F04-fix-fundamentacao, R6, FF-5, 2026-11-04): derivados do índice `fact_fts` (o
-- texto que a busca por termos usa), um por fato e modelo. O hash do texto diz quando refazer; vetor de outro modelo é
-- ignorado e refeito. Só existe com a busca por sentido ligada.
create table fact_vector (
  kind       text not null,
  fact_id    text not null,
  model      text not null,
  text_hash  text not null,
  vec        blob not null,
  primary key (kind, fact_id, model)
);
