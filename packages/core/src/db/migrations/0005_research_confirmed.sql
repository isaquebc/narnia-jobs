-- Auditoria pós-F04 · bloco E1. Só para frente. Ver plans/plan-v0/tasks/F04-chat-recrutador.md §8.
-- Fonte fora da lista de domínios confiáveis usada porque o usuário confirmou na conversa (F04-5): fica registrada e
-- auditável em research_source, com o selo "confirmada pelo usuário".

alter table research_source add column user_confirmed integer not null default 0;
