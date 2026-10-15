-- F06 · correção do teste do dono (2026-10-15): a validade da análise (F06-10) compara com a última mudança de
-- conteúdo da vaga, não com `updated_at` (que muda com o status e com a extração do modelo terminando depois da
-- análise). Conteúdo = edição do usuário (ou do recrutador pela tool) ou texto da vaga novo. Aditiva; as vagas
-- existentes partem da criação, então uma análise já gravada não aparece como desatualizada.
alter table posting add column content_updated_at text;
update posting set content_updated_at = created_at;
