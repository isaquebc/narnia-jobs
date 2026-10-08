# 06 · Decisões em aberto

Pontos que mudam o trabalho de forma material e dependem de você. Em cada um indico a opção que eu seguiria por padrão.

1. ~~Aceitar a mudança para "modo plugin"?~~ **Decidido em 2026-10-06: manter os dois modos** (wrapper local via Agent SDK como experiência principal; plugin do Claude Code como base e fallback). Ver `07-dois-modos.md`. Pendente apenas: confirmar que o uso é pessoal/local, o que mantém baixo o risco da política.

2. ~~Público do projeto.~~ **Decidido: open source.** Qualquer pessoa clona e roda localmente com a assinatura da IA que preferir. Consequências: abstração de provider é central, instalação por Docker tem de ser à prova de leigo, e o modo plugin (B) ganha peso como caminho seguro de política (ver `01 §1`).

3. ~~Stack.~~ **Decidido: TypeScript** em tudo (React + Node).

4. ~~Escopo do MVP.~~ **Decidido em 2026-10-07: não há corte fixo.** O release acontece quando o dono julgar que as features estão redondas. Em troca, **cada task precisa ser um entregável publicável por si só**: acabamento de produto incluído na definição de pronto de todas elas (critério em `tasks/README.md`).

5. ~~Idioma.~~ **Decidido: pt-BR com estrutura de i18n** desde o início (dicionários por idioma, nenhuma string fixa em componente). Documentos gerados seguem o idioma do perfil.

6. ~~Dados sensíveis opcionais.~~ **Decidido: os dados de carreira são obrigatórios** (faixa salarial, situação de trabalho/visto, tipos de contrato, localidades, disponibilidade). Sem eles o recrutador não cumpre o objetivo. Quando o usuário não souber responder (ex.: faixa salarial do cargo no seu mercado), o agente pesquisa na internet em **fontes confiáveis** e apresenta a referência. Ver `04 §A1/§A8` e `03 §5` (tool WebSearch).

7. ~~Exportação de PDF.~~ **Decidido: geração no servidor, por template, com bom padrão visual.** Três templates padrão para começar; o usuário pode subir o próprio template. Ver `03 §14`.

8. ~~Medidor de uso do plano.~~ **Decidido: medidor completo.** Script que lê os logs de sessão do Claude Code **e** logs próprios estruturados que o Narnia produz. O usuário pode "limpar o cache" (sessões e logs) por categoria ou por conversa. Ver `03 §15`.

9. ~~Nome do pacote/comando.~~ **Decidido: `narnia-jobs`** (pacote npm, comando, serviço do compose, volume).

Adicionadas em 2026-10-06 após a segunda leitura (ver `08-docker-calendar-voz.md`):

10. **Docker: decidido.** Compose com bind mount `./data` (gitignored) e volume nomeado para o login. Pendente só: aceitar que o modo B passe a exigir o container ligado (MCP via HTTP). *Padrão: sim.*

11. ~~Login no container.~~ **Decidido em 2026-10-07: os dois, com o volume como padrão.** Se `CLAUDE_CODE_OAUTH_TOKEN` existir no `.env`, o container usa o token (gerado por `claude setup-token` no host); senão, o lançador orienta `narnia-jobs login` (login interativo dentro do container, credencial no volume `claude-auth`). O `doctor` informa qual mecanismo está ativo.

12. ~~Google Calendar.~~ **Decidido em 2026-10-07: integração autenticada mantida como opcional**, com guia passo a passo para o usuário criar o próprio cliente OAuth e conectar em Configurações. Candidaturas funciona completa sem Google (link + `.ics`). Detalhes em `tasks/F07-candidaturas.md`.

13. ~~Voz: STT.~~ **Decidido: Whisper local desde o início**, dentro de um padrão de N provedores de STT (local, navegador, pagos). Ver `08 §3` revisado e `03 §16`.

14. ~~Voz TTS.~~ **Decidido: modelo local como padrão**, com `speechSynthesis` e serviços pagos como provedores alternativos, no mesmo padrão de N provedores. Ver `08 §3` e `03 §16`.

Adicionadas em 2026-10-06 (terceira leitura), já decididas, registradas aqui pelo impacto:

15. **Ingestão em segundo plano.** O usuário acompanha o progresso enquanto usa outras ferramentas; pode ter mais de uma sessão ativa por perfil. → fila de jobs persistida e bandeja de atividades (`03 §13`).
16. **Texto livre como fonte.** Em vez de arquivo, o usuário pode relatar a história profissional em texto; depois da ingestão, uma sessão de **clarificação** enriquece e objetiva os dados (`02 §F3`).
17. **Tempo.** Tudo salvo em UTC; exibido no fuso do usuário com `moment-timezone` (`03 §17`).
18. **Porta dinâmica.** Se a porta não estiver livre, o sistema tenta outra; o banco é mantido entre execuções (`03 §12`, `08 §1.2`).

19. **Obrigatórios sem resposta (F01-15), decidido em 2026-10-07:** valor provisório + `needs_research`. Para usuário no Brasil, piso de referência = salário mínimo necessário do DIEESE; valor abaixo gera alerta informativo (valor, mês, fonte). O usuário determina o salário; o sistema só mostra dados.

20. **Fundação técnica (bloco F01), decidido em 2026-10-07:** Turborepo; **tudo dockerizado, inclusive desenvolvimento** (o host só precisa de Docker); **TDD** em toda implementação e correção, e2e por fluxo (`09-metodologia-tdd.md`); Hono; SQL puro; **múltiplos containers** (api, worker, web, redis, e outros serviços conforme as tasks); **BullMQ com Redis** para filas e workers; leitura de PDF por **três métodos consolidados** (extração de texto, OCR e leitura do documento pelo modelo); tema claro/escuro com Tailwind; sem tela "em breve" (passo 6 omitido até F03). Demais itens do bloco (token de boot, `node:22-slim`, `unpdf`, `outputFormat`, `auth status`, zod-validator, UUID v7, cobertura 80%, `moment-timezone`) confirmados por ausência de objeção.

**Todas as decisões globais estão fechadas (2026-10-07).** Permanecem em aberto apenas as decisões técnicas das tasks F02–F11 (§5 de cada arquivo em `tasks/`), a serem resolvidas uma a uma antes de cada implementação.
