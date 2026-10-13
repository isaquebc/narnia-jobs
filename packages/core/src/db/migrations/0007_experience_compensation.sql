-- Campos novos da experiência (pedido do dono, 2026-10-13): carga horária semanal separada do tipo de contrato,
-- salário com valor, período (hourly/monthly/yearly) e moeda, benefícios da lista e benefícios livres. Aditiva.
alter table experience add column weekly_hours real;
alter table experience add column salary_amount real;
alter table experience add column salary_period text check (salary_period in ('hourly', 'monthly', 'yearly'));
alter table experience add column salary_currency text;
alter table experience add column benefits_json text not null default '[]';
alter table experience add column benefits_other_json text not null default '[]';
