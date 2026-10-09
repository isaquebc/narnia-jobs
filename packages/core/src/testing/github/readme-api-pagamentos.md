# API de pagamentos

Serviço em Node.js 22 e PostgreSQL que processa cobranças, estornos parciais e conciliação por webhook.

## Rodar

```
pnpm install && pnpm dev
```

## Arquitetura

Hono, filas BullMQ e migrations em SQL puro.
