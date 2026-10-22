-- Extensão do navegador (F12/M1, F12-9): dispositivos pareados (token persistente e revogável, só o hash) e o código
-- de pareamento de uso único mostrado em Configurações (só o hash; vale 10 minutos). Aditiva.
create table extension_device (
  id text primary key,
  name text not null,
  token_hash text not null unique,
  created_at text not null,
  last_seen_at text,
  revoked_at text
);

create table extension_pairing (
  code_hash text primary key,
  created_at text not null,
  expires_at text not null,
  used_at text
);
