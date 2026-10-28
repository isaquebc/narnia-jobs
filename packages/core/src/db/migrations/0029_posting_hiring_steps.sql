-- F07/M2: etapas do processo seletivo lidas da descrição da vaga (lista de nomes; vazia quando a vaga não diz). Ao
-- aplicar, viram o pipeline da candidatura no lugar do padrão.
alter table posting add column hiring_steps_json text not null default '[]';
