# F03 · Correções da auditoria (2026-10-10)

Correções dos achados das duas auditorias da F03 (plano × implementação e revisão adversarial), mais a proteção de dados motivada pelo incidente da instância do dono (banco recriado do zero e `data/uploads` ausente no `make dev` de 2026-10-10; causa não encontrada no código; ver F03 §8). Tudo em TDD: para cada item, o teste listado é escrito primeiro e precisa falhar pelo motivo certo antes da correção.

Status: **plano**, aguardando o dono.

Regras de execução: só na instância `claude` (`scripts/claude-env.sh`); nenhuma migration nova sem aviso (L1 não precisa de migration); um commit por lote, verde em `lint`, `typecheck`, `test` e nos e2e do lote; a instância do dono recebe o código pelo hot reload, por isso **L1 vai primeiro** (proteção de dados antes de qualquer outra mudança).

---

## Lote L1 · Proteção de dados (prioridade máxima)

| # | Problema | Correção | Teste antes |
|---|----------|----------|-------------|
| 1 | O backup de `15e275b` só roda antes de migration pendente e fica dentro de `data/`; não teria salvo o incidente | **Backup no boot do api**, no máximo um por dia, além do backup pré-migration: `VACUUM INTO` de um banco que já tem dados de usuário (`user` com linha ou `schema_migrations` não vazio), gravado **fora da pasta de dados**, em `NARNIA_BACKUP_DIR` (padrão: `./backups` na raiz do projeto, montado em `/backups`; na instância `claude`, `./.claude-data/backups`; no e2e, desligado). Mantém 7 diários + 5 pré-migration. Inclui cópia dos `uploads` (só arquivos novos desde o último backup, por sha). `backups/` no `.gitignore` e no `.dockerignore`. | core: `backupOnBoot` cria um arquivo no primeiro boot do dia e nenhum no segundo; banco vazio não gera; poda mantém 7; `uploads` copiados por sha sem duplicar. api: o boot chama `backupOnBoot` antes de `migrate`. lançador (bats): `NARNIA_BACKUP_DIR` resolve para `./backups` na instância padrão e para `./.claude-data/backups` na `claude`. |
| 2 | Banco recriado do zero sem aviso: se o arquivo some, o boot cria um vazio e segue como se nada tivesse acontecido | **Detecção de banco novo com histórico**: se o banco nasce vazio mas existem backups ou logs de requisições anteriores na instância, o api grava uma notificação crítica "Seu banco foi recriado; há backup de <data>" com o caminho do backup e um comando de restauração. Restauração manual pelo lançador: `./start.sh restore <arquivo>` (para a stack, copia, sobe). | core: banco vazio + pasta de backups com arquivo → `detectFreshDatabase` devolve o backup mais recente; sem backups → nada. api: notificação criada no boot. bats: `restore` recusa arquivo inexistente e, com a stack parada, substitui o banco e preserva uma cópia do atual. |
| 3 | Rota `DELETE /api/snapshots` aceita caminho igual à pasta de dados (`relative === ""`) e faria `rm -r` em `./data` | Guarda estrita: o caminho resolvido precisa estar **dentro de `<dados>/snapshots/`** e não ser ela mesma; senão 400. | api: `path` = pasta de dados, `"."`, `"snapshots"`, `"../x"` e link simbólico para fora → 400 e nada removido. |
| 4 | `make dev-down` ignora `NARNIA_INSTANCE` e derruba a instância do dono quando chamado pelo Claude | `dev-down` passa a chamar `./start.sh dev-down` (novo subcomando que usa `DEV_COMPOSE`, com `-p` da instância). | bats: com `NARNIA_INSTANCE=claude`, o comando montado contém `-p narnia-claude`; sem instância, não contém `-p`. |
| 5 | Diagnóstico do próximo incidente | `./start.sh doctor` passa a mostrar: caminho do banco, tamanho do banco e do WAL, se algum processo mantém o banco **apagado** aberto (`/proc/<pid>/fd` com `(deleted)`), data do último backup e da última requisição registrada. | api (`doctor`): fd fake com `(deleted)` → aviso; backups ausentes → aviso. |

Verificação do lote: unitários e bats verdes; prova na instância `claude`: apagar `./.claude-data/dev/narnia.sqlite*` com a stack no ar, `doctor` acusa banco apagado aberto, reiniciar a instância → notificação crítica com o backup do boot → `restore` → dados de volta.

## Lote L2 · Defeitos que afetam o uso

| # | Problema | Correção | Teste antes |
|---|----------|----------|-------------|
| 6 | Editar proposta "já existe" na revisão grava `editedData` mas não atualiza o fato (`proposals.ts:284-306`) | Aceitar com edição sobre `match = existing` chama `factRepo.update` com os campos editados, grava `fact_source` e incrementa `facts_version` (cartões invalidados). | core: proposta existing + edição de título → fato com título novo, nova fonte, `facts_version` +1. api: review devolve o fato atualizado. e2e: f03-05 ganha passo "editar existente". |
| 7 | "Ingestão concluída" nunca se resolve sozinha; o sino não zera | `ingestion.done` é **informativa**: não entra em `countUnresolved` e é resolvida ao abrir a execução ou após 7 dias. | core: `countUnresolved` ignora `ingestion.done`; abrir a execução resolve. web: contador do sino não inclui concluídas. |
| 8 | Unidade "% da janela" vira mil tokens (F03-40) | A API expõe `pctToTokens` por modelo (aprendido) e a janela atual; `BudgetInput` converte % → tokens com ele; sem conversão aprendida, a opção % fica desabilitada com dica "disponível após a primeira execução". | web: % com conversão → tokens corretos; sem conversão → opção desabilitada. api: `GET /api/settings/ingest` inclui `pctToTokens`. |
| 9 | Onboarding do F01 fora da autoconfirmação (F03-13) e do "já lido" | `StepSource` usa `autoConfirm` e mostra `previousRuns` como `FileSource`. | web: estimativa abaixo de 10 mil segue sozinha; acima pede clique; arquivo já lido mostra o aviso com link. e2e: F01/E2E-01 continua verde com a autoconfirmação. |
| 10 | "Gerar outro código" no login do GitHub emite erro falso do fluxo anterior | Cada fluxo tem id; ao matar o anterior, o `close` dele é ignorado (não chama `onDone`). | api: iniciar dois fluxos seguidos → só o segundo emite evento; o primeiro não emite erro. |

## Lote L3 · Precisão do orçamento e do GitHub

| # | Problema | Correção | Teste antes |
|---|----------|----------|-------------|
| 11 | Aprendizado %→tokens com amostra contaminada | Amostra por **chamada**, não por execução: lê o uso do plano imediatamente antes e depois de cada chamada ao modelo (evento estável do stream), atribui ao modelo daquela chamada, descarta quando há outra chamada em voo, quando o `resets_at` mudou (janela renovou) ou quando o delta é ≤ 0; média móvel por modelo. | core: amostra com renovação descartada; amostra com concorrência descartada; atribuição por modelo. worker: síntese e revisor geram amostras nos próprios modelos. |
| 12 | Freio passa de 125% com 2 repositórios em paralelo | Reserva antes de iniciar: cada repositório reserva a sua fatia; não inicia se `usado + reservado > 125%`; checagem também após cada chamada (para antes da próxima chamada do mesmo repositório). | worker: dois repositórios em paralelo com orçamento para 1,2 fatias → o segundo não inicia; uso final ≤ 125% + 1 chamada. |
| 13 | Falta o clone de fallback (F03-4) para árvore truncada | Árvore truncada → `gh repo clone -- --depth 1 --filter=blob:none` em pasta temporária, lista de arquivos completa, leitura só dos escolhidos, pasta removida ao fim. | core (exec fake): truncada → clone chamado com os argumentos certos e pasta temporária removida; não truncada → não clona. |
| 14 | Snapshot regrava o arquivo inteiro a cada resposta (O(n²)) | Um arquivo por resposta (chave = hash da requisição) dentro do diretório do escopo; índice em memória por execução; `snapshot.size` atualizado no fim. | core: 100 respostas → 100 escritas pequenas, sem releitura do escopo; leitura sem rede continua funcionando (f03-11). |
| 15 | Teto de snapshots sem aviso e sem LRU | Ao passar do teto: notificação "snapshots acima do teto" e lista em Configurações ordenada por último uso, com "apagar os mais antigos até caber". | core: `lru` ordena por `last_used_at`; acima do teto gera notificação; abaixo resolve. web: botão apaga até caber. |
| 16 | Execuções paradas (aguardando confirmação/decisão, pausadas) fora da bandeja (§2.9-11) | `ActivityTray` lista também execuções nesses estados, com ação "abrir"; `awaiting_confirmation` gera pendência. | web: execução em `awaiting_decision` aparece na bandeja; core: `awaiting_confirmation` gera notificação. |

## Lote L4 · Plano e documentação

| # | Item | Ação |
|---|------|------|
| 17 | F03-41 sem dono | Registrar em `F10-gestao-de-dados.md`: seletor de modelo para CV e texto (rota do F01 aceita `model`, padrão por profundidade). |
| 18 | README | Linha "Estado" (F01–F03 implementados), seção de dados com `./backups`, `./start.sh restore` e `doctor`; aviso de que apagar `data/` apaga os dados mas não os backups. |
| 19 | CLAUDE.md | Backups (`./backups` do dono nunca é tocado pelo Claude), `restore` só a pedido do dono. |
| 20 | F03 §8 | Uma linha por lote com commits e "teste antes: sim". |

---

## Ordem e verificação final

1. L1 → L2 → L3 → L4, um commit por lote (L1 pode ter dois: core/api e lançador).
2. Ao fim: `scripts/claude-env.sh lint|typecheck|test|build`, bats e Pester, `scripts/claude-env.sh e2e` completo.
3. Prova de L1 na instância `claude` (apagar banco com a stack no ar → `doctor` → notificação → `restore`).

## Impacto na instância do dono

- L1 chega pelo hot reload e cria `./backups` na raiz no próximo boot do api (o primeiro backup só acontece depois que houver dados).
- `./start.sh restore` e o `doctor` novo só valem após reiniciar o lançador (`make dev`).
- Nenhuma migration nova; nenhum dado existente é alterado.

## Decisões para o dono

| # | Pergunta | Recomendação |
|---|----------|--------------|
| FX-1 | Onde ficam os backups do dono | `./backups` na raiz do projeto (fora de `data/`, ignorado pelo git); configurável por `NARNIA_BACKUP_DIR` para um disco externo ou pasta sincronizada |
| FX-2 | Retenção | 7 diários + 5 pré-migration; uploads copiados por sha (sem duplicar) |
| FX-3 | `ingestion.done` | informativa: não conta no sino; resolvida ao abrir a execução ou em 7 dias |
| FX-4 | Unidade "%" sem conversão aprendida | opção desabilitada com dica, em vez de converter por aproximação |
