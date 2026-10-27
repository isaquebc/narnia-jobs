-- Formulário em várias etapas (F12/M6): cada etapa guarda o endereço, o título e os campos que a extensão leu nela;
-- a atual é a da aba (preencher só vale nela). Formulário antigo, sem etapas gravadas, vira a etapa 1 na leitura. Aditiva.
alter table application_form add column steps_json text not null default '[]';
alter table application_form add column current_step integer not null default 1;
