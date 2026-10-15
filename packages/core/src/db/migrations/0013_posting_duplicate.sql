-- F06 · M4 · resultado da comparação de duplicata (F06-9). Aditiva. Ver plans/plan-v0/tasks/F06-analisar-vaga.md §2.
-- JSON com a vaga candidata (mesmo hash), a resposta do modelo (mesma vaga?, certeza, diferenças) e a decisão do
-- usuário no modal (null enquanto ele não decide; update | new | cancel).
alter table posting add column duplicate_json text;
