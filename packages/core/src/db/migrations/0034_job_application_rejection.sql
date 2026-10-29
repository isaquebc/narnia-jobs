-- Desclassificação (pedido do dono, 2026-10-29): a etapa em que a candidatura parou (nome, para sobreviver à edição do
-- pipeline) e a nota com o e-mail colado. Sair de Encerrado limpa os dois; a nota fica.
alter table job_application add column closed_stage text;
alter table job_application add column closed_entry_id text references job_application_entry (id) on delete set null;
