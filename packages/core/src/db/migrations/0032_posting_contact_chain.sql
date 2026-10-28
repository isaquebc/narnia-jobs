-- F07/M6 · cadeia de contatos: quem está do outro lado (papel), quando falou, o resumo e quem indicou quem. A ordem da
-- cadeia é a data do contato (depois a criação).
alter table posting_contact add column role text
  check (role in ('recruiter', 'hiring_manager', 'referral', 'interviewer', 'other'));
alter table posting_contact add column contacted_on text;
alter table posting_contact add column summary text;
alter table posting_contact add column referred_by_id text references posting_contact (id) on delete set null;
