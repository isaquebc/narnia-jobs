# Tutorial do narnia-jobs

*[English version](en/tutorial.md)*

Do zero à primeira candidatura, em dez passos. Leva uns 30 minutos, mais o tempo da extração do seu currículo. Os nomes entre aspas e em **negrito** são os rótulos exatos da interface.

1. [Instalar e abrir](#1-instalar-e-abrir)
2. [Primeiro uso: o seu perfil a partir do currículo](#2-primeiro-uso-o-seu-perfil-a-partir-do-currículo)
3. [Completar os seus dados](#3-completar-os-seus-dados)
4. [Conversar com o recrutador](#4-conversar-com-o-recrutador)
5. [Analisar uma vaga](#5-analisar-uma-vaga)
6. [Gerar o currículo e a carta da vaga](#6-gerar-o-currículo-e-a-carta-da-vaga)
7. [Acompanhar as candidaturas](#7-acompanhar-as-candidaturas)
8. [O recrutador no Claude Code (modo B)](#8-o-recrutador-no-claude-code-modo-b)
9. [A extensão do Chrome](#9-a-extensão-do-chrome)
10. [Manutenção: backup, atualização e desligar](#10-manutenção-backup-atualização-e-desligar)

---

## 1. Instalar e abrir

Você precisa do **Docker** (Docker Desktop no Windows e no macOS; Docker Engine com Compose v2 no Linux) e de uma **assinatura do Claude com acesso ao Claude Code** (Pro ou Max). Leia antes a nota sobre [o uso da assinatura](../README.md#sobre-o-uso-da-assinatura-do-claude).

```bash
git clone https://github.com/isaquebc/narnia-jobs.git
cd narnia-jobs
./start.sh up        # Windows: .\start.ps1 up
```

Na primeira vez o `up` constrói as imagens (alguns minutos). No fim, ele imprime o endereço com o token de acesso:

```
  narnia-jobs está no ar:

    http://127.0.0.1:3100/?token=…
```

Agora faça o login da assinatura dentro do container, uma vez só:

```bash
./start.sh login
```

O CLI do Claude imprime uma URL. Abra, autorize e cole o código de volta no terminal. O login fica guardado num volume do Docker, renova sozinho e sobrevive a reinícios.

Abra o endereço impresso pelo `up` no navegador. Guarde-o: ele continua o mesmo depois de reiniciar (o token fica em `./data/.token`). Para conferir que está tudo certo a qualquer momento: `./start.sh doctor`.

## 2. Primeiro uso: o seu perfil a partir do currículo

Na primeira abertura aparece o **Primeiro uso**, em seis passos. Você pode sair no meio: ao voltar, ele retoma de onde parou.

1. **Provider.** Mostra se o Claude Code está logado (**Logado pela assinatura (login no container)**). Se aparecer **Não logado**, rode `./start.sh login` e clique em **Verificar de novo**.
2. **Currículo.** Na aba **Arquivo**, arraste um PDF, DOCX ou Markdown (até 10 MB), ou escreva a sua história na aba **Texto livre**. Para PDF, escolha as **Leituras do PDF**: **OCR das páginas** (para PDF escaneado, sem custo) e **Leitura do documento pelo modelo** (capta o layout, custa tokens). A **Estimativa antes de rodar** mostra os tokens de cada chamada. Clique em **Extrair**. Sem currículo? **Não tenho, começar do zero**.
3. **Extração.** As etapas aparecem uma a uma (leitura, fatos, resumo). Você pode navegar enquanto isso: o progresso fica na bandeja **Atividades**, no topo.
4. **Revisão.** Cada fato extraído vira uma proposta com o trecho do currículo de onde saiu. Aceite, edite ou recuse cada uma (ou **Aceitar todos**). Aqui você também confirma a sua identidade; o telefone é obrigatório.
5. **Perfil.** Crie o primeiro perfil, que é um alvo de cargo: cargo-alvo, nível, área, mercado, faixa salarial, contratos e locais aceitos. Quando não souber, marque "não sei" e o recrutador pesquisa depois.
6. **Descoberta** (opcional). Em **Começar entrevista**, o recrutador pergunta só o que a extração não conseguiu preencher (datas, métricas, nível), e as respostas voltam para a revisão. Ou **Pular e ir ao dashboard**.

> Nada é gravado nos seus dados sem passar pela revisão. Isso vale para tudo o que vier depois: outro CV, o GitHub, o que você contar no chat.

## 3. Completar os seus dados

**Outros perfis.** Em **Perfis** (menu lateral ou "Gerenciar perfis" no seletor do topo), crie um perfil do zero ou clone um existente. Cada perfil usa os mesmos fatos com outra ênfase:

- **Ênfases:** destacar, ocultar e ordenar experiências, projetos, skills, formação e idiomas.
- **Narrativa:** o seu pitch.
- **Recrutador:** a persona dele (tom, honestidade, rigor, senioridade e idioma das respostas).
- **Cartão:** o resumo curto que o recrutador recebe sobre o perfil, com o botão **Atualizar cartão**.

O seletor do topo troca o perfil ativo, e o dashboard sugere perfis; **Analisar possíveis perfis** usa o modelo sobre todo o seu histórico (mostra a estimativa antes).

**Mais dados.** Em **Ingestão**:

- **GitHub:** se o `gh` do seu computador está logado, o narnia-jobs reaproveita o login; senão, escolha **Login próprio do app**, clique em **Abrir GitHub** e cole o código mostrado. A análise **pública** lê só os repositórios públicos; a **privada** inclui os privados (o app só lê). Antes de rodar, a tela mostra o seu plano, o uso das janelas de 5 horas e semanal, a estimativa e um orçamento recomendado; o GitHub sempre pede confirmação.
- **Currículo:** outro CV (um mais antigo, em outro idioma). Reenviar o mesmo arquivo avisa que já foi lido.
- **Texto livre:** conte a sua história; o que for novo vira proposta.

Cada ingestão termina numa revisão. O sino no topo e a página **Pendências** reúnem tudo o que espera você: revisões, conflitos, sugestões de perfil, análises prontas.

## 4. Conversar com o recrutador

Menu › **Geral** › **Chat** › **Nova conversa**.

O recrutador conhece a sua carreira inteira e todos os perfis. Ele busca nos seus dados pelas ferramentas (os chips mostram quais usou) e cita a fonte do que afirma. Experimente:

- "Para qual dos meus perfis eu estou mais forte hoje? O que falta para o outro?"
- "Quanto paga uma vaga de backend sênior remota no Brasil?" (ele pesquisa e registra as fontes)
- "Esqueci de contar: em 2022 eu liderei a migração do monólito para microsserviços." Isso vira uma ingestão no painel da direita, com a revisão ali mesmo.
- "Meu cargo na Acme estava errado, era Staff." Ele propõe a alteração, e você confirma no cartão ao lado da conversa.

O rodapé mostra os tokens e o custo da conversa. Em **Configurações › Chat** ficam o modelo padrão, o teto de custo por conversa, quantas conversas ficam abertas e a lista de domínios confiáveis para pesquisa.

## 5. Analisar uma vaga

Menu › **Geral** › **Vagas** › **Nova vaga**. Cole o **Texto da vaga** ou o link dela (**ou o link da vaga**) e clique em **Salvar vaga**. Também dá para colar a vaga direto no chat.

- **Na hora, sem tokens:** uma heurística local extrai cargo, senioridade, local, contrato, faixa salarial e requisitos, e procura cada palavra-chave nos seus dados.
- **Em segundo plano:** um modelo extrai a vaga de novo e outro junta as duas versões. Cada campo mostra de onde veio, e o que você edita nunca é sobrescrito.
- **A análise** roda numa conversa própria: fit por perfil e o perfil recomendado, o que você atende (cada item ligado a um fato seu), lacunas, riscos, palavras-chave de ATS que faltam, perguntas prováveis e o que estudar.

Vaga repetida (mesma empresa, cliente, cargo e role) abre um aviso com as diferenças. Se os seus dados ou a vaga mudarem depois, a página avisa e oferece **Reanalisar**; nada é refeito sozinho.

Sites que exigem login ou bloqueiam robôs (o LinkedIn, por exemplo) pedem para colar o texto. Para esses, a [extensão do Chrome](#9-a-extensão-do-chrome) resolve.

## 6. Gerar o currículo e a carta da vaga

Na página da vaga, clique em **Gerar** e escolha o currículo, a carta ou os dois. O perfil recomendado pela análise já vem escolhido. Também dá para pedir no chat: "gera meu CV para esta vaga, com mais peso em liderança".

O que acontece até o PDF chegar (o andamento fica na bandeja **Atividades** e em **Processos**):

1. O modelo escreve só os textos e diz de qual fato seu cada linha veio. Empresa, cargo, datas e links vêm dos seus dados, e termo que você não tem nunca aparece.
2. O PDF é montado (até 2 páginas, no idioma da vaga) e passa por checagens: links que respondem, fonte, espaçamento, quebra de página, aderência a ATS de pelo menos 90%.
3. Um segundo modelo lê as páginas atrás de invenção, erro e problema visual. Reprovado, o documento é gerado de novo uma vez; se reprovar de novo, chega com o aviso **Não passou na revisão** e os motivos.

Cada geração ou edição é uma versão nova, que dá para baixar e comparar. **Editar** muda texto, ordem e seções sem gastar tokens do gerador. **Atualizar** gera de novo, com instruções opcionais; **Regerar com mensagem** abre uma conversa com o recrutador, que refaz o documento e manda o link. Os modelos (Clássico, Moderno, Compacto e os seus) ficam em **Configurações › Modelos de currículo**. Para criar o seu, veja [docs/templates-de-cv.md](templates-de-cv.md).

O currículo geral de cada perfil (sem vaga) fica em **Perfis** › o perfil › **Currículo**.

## 7. Acompanhar as candidaturas

Na página da vaga, clique em **Aplicar** quando se candidatar. Salvar a vaga não é se candidatar, então nada vira candidatura sozinho.

Em **Candidaturas**, o quadro tem as colunas **Aplicado**, **1ª Entrevista**, **Em processo**, **Oferta** e **Encerrado**, além das **Vagas salvas**. Arraste os cartões entre as colunas ou abra uma candidatura para:

- acompanhar as etapas do processo e a agenda: entrevistas, testes, prazos e retornos, com data, link e notas. **Adicionar ao Google Calendar** ou baixar o `.ics` (o Google é opcional: [docs/google-calendar.md](google-calendar.md));
- guardar notas e anexos;
- registrar os contatos (recrutador, quem indicou) e editar um contato depois;
- abrir uma conversa com o recrutador sobre aquela candidatura.

As encerradas ficam na coluna **Encerrado**; as arquivadas (por você ou sem atividade há 40 dias), em **Ver arquivadas**.

## 8. O recrutador no Claude Code (modo B)

O mesmo recrutador, com os mesmos dados e ferramentas, roda dentro do Claude Code do seu computador. Com o narnia-jobs no ar (`./start.sh up`):

```bash
./start.sh install-plugin     # Windows, com a stack do up no ar: .\start.ps1 install-plugin --prod
```

Isso registra o servidor MCP do narnia-jobs no Claude Code e instala o plugin. O token fica num arquivo só seu em `.plugin-build/`, então mantenha essa pasta. Reinicie o Claude Code e use:

| Comando | Faz |
|---------|-----|
| `/narnia-jobs:recrutador` | conversa com o recrutador |
| `/narnia-jobs:perfil <nome>` | troca o perfil ativo e recarrega o cartão |
| `/narnia-jobs:descoberta` | pergunta só o que falta no perfil |
| `/narnia-jobs:clarificar <execução>` | clarifica uma ingestão com perguntas objetivas |
| `/narnia-jobs:github-publico` | revisão do seu perfil público do GitHub |
| `/narnia-jobs:analisar-vaga` | cole a vaga: é salva e analisada |
| `/narnia-jobs:gerar-cv` | currículo do perfil ou da vaga, e a carta |
| `/narnia-jobs:candidaturas` | lista, move de coluna e atualiza as candidaturas (etapas, notas, contatos) |
| `/narnia-jobs:responder-candidatura` | ajusta as respostas de um formulário aberto pela extensão |

As telas grandes (revisão, análise completa, PDFs) continuam na interface web, e o recrutador devolve os links. **Configurações › Modo plugin (terminal)** mostra o endereço do MCP e o último uso. Rode o `install-plugin` de novo se a porta mudar ou se você mudar a persona.

## 9. A extensão do Chrome

A extensão leva vagas de qualquer site para o narnia-jobs e ajuda nos formulários de candidatura, numa janela ao lado. Ela só lê a página depois do seu clique e manda o conteúdo para a sua instância, no seu computador.

**Instalar** (o passo a passo com os endereços da sua instância também está em **Configurações › Extensão do navegador**):

1. Gere a extensão: `./start.sh extension` (Windows: `.\start.ps1 extension`).
2. Em `chrome://extensions`, ligue o **Modo do desenvolvedor**, clique em **Carregar sem compactação** e escolha a pasta `apps/extension/dist`.
3. Fixe o ícone do narnia-jobs na barra.
4. **Parear:** em **Configurações › Extensão do navegador**, clique em **Gerar código de pareamento** (vale 10 minutos, uma vez). Nas opções da extensão (botão direito no ícone › Opções), informe o endereço da instância e o código.

**Usar:** numa página de vaga, clique no ícone:

- **Analisar a vaga** salva a vaga, mostra o fit por perfil e gera o CV e a carta.
- **Ajudar no formulário** organiza as perguntas, sugere respostas com os seus dados e a vaga, deixa copiar, editar e ajustar no chat. Também **Preencher** os campos na página e anexar o CV da vaga.

Formulário em várias etapas: avance nele e clique no ícone a cada etapa. A extensão nunca envia o formulário, e as perguntas de autodeclaração (raça, gênero, deficiência) só são respondidas com o que você mesmo declarou.

Depois de cada atualização do narnia-jobs, clique em recarregar no cartão da extensão em `chrome://extensions`. Funciona só no Chrome e em navegadores baseados nele.

## 10. Manutenção: backup, atualização e desligar

- **Backups automáticos** em `./backups`: uma cópia do banco quando o app sobe (no máximo uma por dia) e outra antes de cada migração, mais os arquivos enviados. Ficam as 5 mais recentes (ajuste em Configurações › Backups). Para restaurar: `./start.sh restore backups/<arquivo>.sqlite`, que guarda o banco atual antes de trocar.
- **Atualizar:** `git pull && ./start.sh up`. Depois, recarregue a extensão e, se usa o terminal, rode `./start.sh install-plugin`.
- **Busca por sentido** (opcional): quando os seus fatos não cabem mais no contexto do recrutador, um aviso sugere ligar **Configurações › Busca por sentido**. Ela baixa um modelo local de 113 MB, uma vez, e o recrutador passa a achar fatos pelo assunto, e não só pelas palavras.
- **Desligar:** `./start.sh down` (os dados e o login ficam). Para remover tudo, veja [Desinstalar](../README.md#desinstalar).
- **Algo estranho?** `./start.sh doctor` e `./start.sh logs api`.

Mais detalhes de cada tela estão no [guia de uso](guia-de-uso.md).
