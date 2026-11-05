# Tutorial: sua primeira contribuição

Este tutorial leva você da ideia ao pull request aceito, passo a passo. A referência completa do ambiente, das
convenções e das avaliações dos prompts está no [CONTRIBUTING](../CONTRIBUTING.md); aqui está o caminho prático.
English version: [docs/en/contributing.md](en/contributing.md).

## Como o repositório funciona

- A branch `main` é protegida: ninguém envia commits direto para ela. Toda mudança entra por **pull request**, com o
  **CI verde** e a **aprovação do mantenedor**.
- Você trabalha num **fork** (a sua cópia do repositório no GitHub), numa branch sua, e abre o pull request do fork
  para a `main` daqui.
- Só precisa de **Docker** com Compose v2 e do **git**. Node, pnpm e todas as ferramentas rodam em containers.

## 1. Escolha ou abra uma issue

Antes de escrever código, veja as [issues](https://github.com/isaquebc/narnia-jobs/issues):

- **Bug:** abra com o modelo "Problema", com os passos para reproduzir e a saída de `./start.sh doctor`, se for o caso.
- **Ideia ou mudança de comportamento:** abra com o modelo "Ideia" e espere uma resposta antes de começar.
  Assim você não investe num caminho que não vai entrar.
- **Correção pequena** (erro de digitação, link quebrado): pode ir direto ao pull request.
- **Falha de segurança:** nunca numa issue pública; use o [relato privado](../SECURITY.md).

Comente na issue que vai trabalhar nela, para ninguém duplicar o esforço.

## 2. Faça o fork e clone

No GitHub, clique em **Fork**. Depois:

```bash
git clone https://github.com/<seu-usuario>/narnia-jobs.git
cd narnia-jobs
git remote add upstream https://github.com/isaquebc/narnia-jobs.git
```

O `origin` é o seu fork; o `upstream` é o repositório original, de onde você puxa as novidades.

## 3. Suba o ambiente de desenvolvimento

```bash
NARNIA_PROVIDER=mock ./start.sh dev
```

Abra `http://127.0.0.1:5173/?token=dev-token`. Com `NARNIA_PROVIDER=mock`, o app responde com dados fictícios e não
gasta a sua assinatura do Claude; para testar com o modelo de verdade, rode sem a variável e faça o login uma vez
(`./start.sh login`). O código tem hot reload: salvou, a tela atualiza.

Confira que tudo passa antes de mexer em algo:

```bash
./start.sh lint && ./start.sh typecheck && ./start.sh test   # em Linux e macOS: make check
```

No Windows, troque `./start.sh` por `.\start.ps1` (o app não foi testado de ponta a ponta no Windows; relatos são
bem-vindos).

## 4. Crie uma branch

```bash
git switch main
git pull upstream main
git switch -c fix/descricao-curta      # ou feat/..., docs/..., chore/...
```

Uma branch por assunto. Um pull request pequeno é revisado mais rápido.

## 5. Escreva o teste antes do código

O projeto segue **TDD** ([metodologia](../plans/plan-v0/09-metodologia-tdd.md)):

1. Escreva o teste que mostra o problema ou o comportamento novo, perto do código que muda
   (`packages/core/test/`, `apps/api/test/`, `apps/web/src/**/*.test.tsx`…).
2. Rode e veja **falhar**. Para rodar só um pacote: `./start.sh test --filter=@narnia-jobs/core`.
3. Escreva o mínimo de código que faz o teste passar.
4. Melhore o código com os testes verdes.

Bug corrigido sem teste de regressão volta. Se a mudança é na interface ou num fluxo inteiro, veja também os cenários
de ponta a ponta em `apps/e2e` (`./start.sh e2e`, ou `./start.sh e2e --ui-only --grep "E2E-19"` para um só).

Lembretes que o CI e a revisão cobram:

- **Nenhum dado pessoal real** em código, testes, fixtures ou commits. Use nomes fictícios: Acme, Globex, Initech,
  Ana Maria Exemplo.
- **Textos da interface** sempre em `apps/web/src/i18n/pt-BR.ts`.
- **Comportamento mudou:** atualize o README, o [tutorial](tutorial.md) (as duas línguas) e o
  [guia de uso](guia-de-uso.md).

## 6. Mudou um prompt? Rode o gate

Os prompts (a persona do recrutador, o subagente, as skills e as chamadas estruturadas em `plugin/` e
`packages/providers`) são avaliados contra o modelo real antes de entrar:

```bash
NARNIA_PROVIDER=claude-code ./start.sh evals prompts --gate    # ou: evals chat --gate
```

A mudança precisa ser **melhor** que a versão aprovada, num julgamento cego por pares. A rodada consome a sua
assinatura; cole o resumo final no pull request. Os detalhes estão no
[CONTRIBUTING](../CONTRIBUTING.md#gate-de-prompts). Se não puder rodar, diga isso no pull request: o mantenedor roda
antes do merge.

## 7. Faça o commit

Formato `tipo(escopo): mensagem`, em português, com o porquê no corpo:

```bash
git add -A
git commit -m "fix(vagas): link com parâmetros de rastreio não duplica a vaga

O critério de duplicata comparava a URL inteira; agora ignora utm_* e ref."
```

Tipos: `feat`, `fix`, `docs`, `test`, `chore`. O escopo é a área (`vagas`, `chat`, `cv`, `web`, `lançador`…). Se não
escreve em português, mande em inglês: a revisão ajusta.

## 8. Rode tudo e envie

```bash
./start.sh lint --write     # corrige a formatação
./start.sh lint && ./start.sh typecheck && ./start.sh test
./start.sh test:sh          # se mudou start.sh ou start.ps1
./start.sh e2e              # se mudou a interface ou um fluxo
git push -u origin fix/descricao-curta
```

## 9. Abra o pull request

O GitHub mostra o botão **Compare & pull request** depois do push. O modelo do pull request pede:

- o que muda, em uma ou duas frases, com `Closes #123` para fechar a issue;
- como foi testado, marcando o que você rodou;
- a lista de conferência (dados fictícios, textos no dicionário, docs).

No primeiro pull request, o CI espera a liberação do mantenedor (regra do GitHub para quem contribui pela primeira
vez). Depois roda sozinho: lint, typecheck, testes, build, testes dos lançadores, imagens, e2e e a checagem de dados
pessoais, mais o smoke dos lançadores em Linux, macOS e Windows.

## 10. Revisão e merge

- **CI vermelho:** abra o job que falhou no pull request, corrija e faça push na mesma branch; o pull request
  atualiza sozinho.
- **Pedido de mudança:** responda cada comentário, corrija e faça push. Marque a conversa como resolvida quando
  terminar: o merge só sai com todas resolvidas.
- **A `main` andou:** traga as novidades com `git pull --rebase upstream main` e `git push --force-with-lease`.

Aprovado e verde, o mantenedor faz o merge. Depois, limpe:

```bash
git switch main
git pull upstream main
git push origin main
git branch -d fix/descricao-curta
```

## Usa o Claude Code?

O `CLAUDE.md` e a pasta `.claude/` configuram o agente do mantenedor, que testa numa instância separada
(`scripts/claude-env.sh`, dados em `./.claude-data`, portas 5174 e 3200). Se o seu agente seguir essas regras, os
testes dele nunca tocam os seus dados de uso em `./data`. Revise o que ele escreveu antes de abrir o pull request:
você responde pela contribuição.

Obrigado por contribuir.
