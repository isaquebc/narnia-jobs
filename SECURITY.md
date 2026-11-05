# Segurança · Security

*English below.*

## Como relatar uma vulnerabilidade

**Não abra uma issue pública.** Use o relato privado do GitHub: aba **Security** do repositório › **Report a vulnerability**. Descreva o problema, como reproduzir e o impacto. A resposta inicial vem em até 7 dias; a correção e a divulgação são combinadas com você.

## Modelo de ameaça (o que o narnia-jobs protege)

O narnia-jobs roda **na sua máquina**, para uma pessoa só. Ele não tem contas de usuário nem servidor na nuvem.

- **Só `127.0.0.1`.** O lançador publica uma única porta (a da interface) e só no endereço local; nada fica acessível pela rede local. A porta do callback OAuth do Google Calendar (`8089`) também é só local.
- **Token de acesso local.** Toda chamada à API exige o token gerado no primeiro `up` (guardado em `data/.token`, permissão `0600`), entregue ao navegador por cookie. Ele impede que outros sites abertos no mesmo navegador usem a sua API local.
- **DNS rebinding.** O servidor só aceita o cabeçalho `Host` dos endereços locais esperados.
- **Extensão do Chrome.** Pareada por um código de uso único (10 minutos), com token de dispositivo revogável em Configurações. Lê a página só depois do seu clique, nunca envia formulários.
- **Navegador headless (`browser`).** Isolado numa rede só com o api e o worker; os PDFs são montados sem rede e com JavaScript desligado nos modelos de currículo do usuário.
- **Leitura de vagas por link.** Proteção contra SSRF: endereços internos e privados são recusados.
- **Ponte `/bridge/anthropic`** (avaliações no Phoenix, opcional). Aceita só a própria chave (nunca o token de boot) e escuta na rede dos containers e em `127.0.0.1`.
- **`make tunnel`** (opcional, para desenvolvimento) cria uma URL **pública** temporária com o token embutido: quem tiver a URL acessa os seus dados. Use só sabendo disso e encerre logo depois.

Fora do escopo: o que o modelo da Anthropic faz com o conteúdo enviado (segue a política da Anthropic), e o computador já comprometido por outro meio.

---

## Reporting a vulnerability

**Do not open a public issue.** Use GitHub private reporting: the repository's **Security** tab › **Report a vulnerability**. Describe the problem, how to reproduce it and its impact. You will get a first answer within 7 days; the fix and the disclosure are agreed with you.

## Threat model

narnia-jobs runs **on your machine**, for a single person, with no user accounts and no cloud server. It binds only to `127.0.0.1`; every API call requires the local boot token (stored in `data/.token`, mode `0600`, handed to the browser as a cookie) so other sites open in the same browser cannot use your local API; the `Host` header is checked against DNS rebinding; the Chrome extension is paired with a one-time code and a revocable device token; the headless browser lives on a network shared only with the api and the worker; job links are fetched with SSRF protection; the optional `/bridge/anthropic` (Phoenix evaluations) accepts only its own key. `make tunnel` (optional, for development) creates a temporary **public** URL with the token embedded: anyone with the URL can reach your data.
