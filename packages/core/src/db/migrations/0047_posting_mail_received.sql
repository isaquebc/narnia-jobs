-- Pedido do dono 2026-11-12 (F14): a vaga do e-mail mostra a data e a hora em que o e-mail chegou, além da data em que
-- foi salva. As vagas que já vieram de e-mail ganham a data do e-mail delas.
update posting
   set source_ref_json = json_set(
         source_ref_json,
         '$.receivedAt',
         (select m.received_at from mail_message m
           where m.gmail_id = json_extract(posting.source_ref_json, '$.gmailId'))
       )
 where source = 'email'
   and source_ref_json is not null
   and json_extract(source_ref_json, '$.gmailId') is not null
   and exists (select 1 from mail_message m where m.gmail_id = json_extract(posting.source_ref_json, '$.gmailId'));
