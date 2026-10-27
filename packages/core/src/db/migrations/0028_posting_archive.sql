-- F07 (pedido do dono 2026-10-27): arquivar a vaga salva que não deu um bom fit, com o motivo. Arquivar só marca: a
-- vaga sai da lista e da coluna "Vagas salvas" e o motivo fica para o recrutador calibrar o fit das próximas.
alter table posting add column archived_at text;
alter table posting add column archive_reason text
  check (archive_reason in ('salary', 'seniority', 'stack', 'work_mode', 'location', 'contract', 'company', 'other'));
alter table posting add column archive_note text;
