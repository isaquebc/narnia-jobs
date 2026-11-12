import { describe, expect, it } from "vitest";
import { parseJobAlert, parseMail, unwrapLink } from "../../src";
import { rawMail } from "./fixtures";

/**
 * F14/M3 · leitores de alertas por código, com e-mails sintéticos no formato conhecido de cada plataforma (empresas
 * e vagas fictícias). Rastreio desembrulhado, link canônico, várias vagas por e-mail, botões ignorados.
 */
const alert = async (from: string, html: string) =>
  parseJobAlert(await parseMail(rawMail({ from, html })));

describe("F14/M3 · alertas de vagas", () => {
  it("LinkedIn: várias vagas, link /comm/ com rastreio vira o canônico, empresa · local", async () => {
    const html = `
      <table><tr><td>
        <a href="https://www.linkedin.com/comm/jobs/view/4012345678/?trackingId=abc%3D%3D&amp;refId=x&amp;midToken=AQ">
          <img src="logo.png" alt=""></a>
        <a href="https://www.linkedin.com/comm/jobs/view/4012345678/?trackingId=abc">Desenvolvedor Backend Sênior</a>
        <p>Acme Tecnologia · São Paulo, SP (Remoto)</p>
        <a href="https://www.linkedin.com/comm/jobs/view/4012345678/?trackingId=abc">Candidatura simplificada</a>
      </td></tr><tr><td>
        <a href="https://www.linkedin.com/comm/jobs/view/4099999999/">Engenheira de Dados</a>
        <p>Globex</p><p>Curitiba, PR</p>
      </td></tr></table>
      <a href="https://www.linkedin.com/comm/jobs/search/?keywords=backend">Ver todas as vagas</a>`;
    const a = await alert("LinkedIn <jobalerts-noreply@linkedin.com>", html);
    expect(a?.platform).toBe("linkedin");
    expect(a?.items).toEqual([
      {
        title: "Desenvolvedor Backend Sênior",
        company: "Acme Tecnologia",
        location: "São Paulo, SP (Remoto)",
        url: "https://www.linkedin.com/jobs/view/4012345678/",
        externalId: "4012345678",
      },
      {
        title: "Engenheira de Dados",
        company: "Globex",
        location: "Curitiba, PR",
        url: "https://www.linkedin.com/jobs/view/4099999999/",
        externalId: "4099999999",
      },
    ]);
  });

  it("Glassdoor: link de parceiro com jobListingId, embrulhado em redirecionamento de rastreio", async () => {
    const wrapped = `https://click.example/track?url=${encodeURIComponent("https://www.glassdoor.com.br/partner/jobListing.htm?pos=101&jobListingId=1009876543210&ao=1")}`;
    const html = `<div><a href="${wrapped}">Analista de Dados Pleno</a><div>Vitalis Saúde – Belo Horizonte, MG</div></div>`;
    const a = await alert("Glassdoor <noreply@glassdoor.com>", html);
    expect(a?.items).toEqual([
      {
        title: "Analista de Dados Pleno",
        company: "Vitalis Saúde",
        location: "Belo Horizonte, MG",
        url: "https://www.glassdoor.com.br/job-listing/j?jl=1009876543210",
        externalId: "1009876543210",
      },
    ]);
  });

  it("Coders: link da vaga pelo slug", async () => {
    const html = `<a href="https://coders.com.br/vagas/dev-frontend-react-acme?utm_source=email">Dev Frontend React</a><span>Acme | Remoto</span>`;
    const a = await alert("Coders <contato@coders.com.br>", html);
    expect(a?.items[0]).toMatchObject({
      title: "Dev Frontend React",
      company: "Acme",
      location: "Remoto",
      externalId: "dev-frontend-react-acme",
    });
  });

  it('correção 2026-11-11 · Coders: resumo diário sem link por vaga (cargo e "Empresa · via Fonte"); descadastrar não é vaga', async () => {
    const html = `<html><head><style>a { color: #44D62C; } .cod-card { width: 100% }</style></head><body>
      <div style="display:none">Dev Backend Sênior, Analista de Dados ‌ ‌ ‌</div>
      <h1>Resumo diário de vagas</h1><h2>Suas vagas de hoje</h2>
      <p>Olá, Pessoa,</p><p>Hoje encontramos 42 vagas que combinam com o seu perfil.</p>
      <h3>O que chegou</h3>
      <table>
        <tr><td><strong>Dev Backend Sênior (Node.js &amp; Go)</strong></td></tr>
        <tr><td>Globex · via LinkedInJobs</td></tr>
        <tr><td><strong>Analista de Dados – Python, SQL</strong></td></tr>
        <tr><td>Initech</td></tr>
        <tr><td><strong>Engenheiro(a) de Software Pleno | Remoto</strong></td></tr>
        <tr><td>Umbrella · via RemoteRocketship</td></tr>
      </table>
      <p>E mais 39 vagas no seu board.</p>
      <a href="https://app.coders.com.br/vagas">Ver as vagas no board</a>
      <p>Se o botão não funcionar, copie e cole este endereço no navegador:</p><p>https://app.coders.com.br/vagas</p>
      <p>Não quer mais receber o resumo de vagas? <a href="https://app.coders.com.br/api/board/vagas/descadastrar">Descadastrar</a></p>
    </body></html>`;
    const a = await alert("COD3RS <noreply@app.coders.com.br>", html);
    expect(a?.platform).toBe("coders");
    expect(a?.items.map((i) => [i.title, i.company, i.url])).toEqual([
      ["Dev Backend Sênior (Node.js & Go)", "Globex", null],
      ["Analista de Dados – Python, SQL", "Initech", null],
      ["Engenheiro(a) de Software Pleno | Remoto", "Umbrella", null],
    ]);
    expect(new Set(a?.items.map((i) => i.externalId)).size).toBe(3);
    // só o link de descadastrar: não vira vaga
    expect(
      await alert(
        "COD3RS <noreply@app.coders.com.br>",
        `<a href="https://app.coders.com.br/api/board/vagas/descadastrar">Descadastrar</a>`,
      ),
    ).toBeNull();
  });

  it("correção 2026-11-11 · formatos reais: LinkedIn com &middot;, card inteiro no link (vagas parecidas) e Glassdoor com empresa e nota no card", async () => {
    // LinkedIn (alerta): logo num link, cargo noutro, "Empresa &middot; Local" depois
    const li = await alert(
      "LinkedIn <jobalerts-noreply@linkedin.com>",
      `<table><tr><td><a href="https://www.linkedin.com/comm/jobs/view/4011111111/?trk=x"><img src="https://media.licdn.com/a.png" alt="Globex"></a></td>
       <td><a href="https://www.linkedin.com/comm/jobs/view/4011111111/?trk=y" style="color:#0a66c2">Senior Backend Engineer</a>
       <p>Globex &middot; Lisboa (Remote)</p></td></tr></table>`,
    );
    expect(li?.items).toEqual([
      expect.objectContaining({
        title: "Senior Backend Engineer",
        company: "Globex",
        location: "Lisboa (Remote)",
      }),
    ]);
    // LinkedIn (vagas parecidas): o cabeçalho cita a vaga vista (não é vaga nova); cada card inteiro é um link
    const similar = await alert(
      "LinkedIn <jobs-noreply@linkedin.com>",
      `<h1><a href="https://www.linkedin.com/comm/jobs/view/4022222222/">Jobs similar to <strong>Staff Engineer</strong> at <strong>Initech</strong></a></h1>
       <table><tr><td data-test-id="job-card"><a href="https://www.linkedin.com/comm/jobs/view/4033333333/?trk=c"><table><tr><td><img src="https://media.licdn.com/b.png" alt="Umbrella"></td></tr>
       <tr><td><p>Senior Full-Stack Engineer - Brazil</p></td></tr><tr><td><p>Umbrella &middot; Brazil (Remote)</p></td></tr><tr><td><p>Easy Apply</p></td></tr></table></a></td></tr></table>`,
    );
    expect(similar?.items).toEqual([
      expect.objectContaining({
        title: "Senior Full-Stack Engineer - Brazil",
        company: "Umbrella",
        location: "Brazil (Remote)",
        externalId: "4033333333",
      }),
    ]);
    // Glassdoor: o card inteiro é o link — empresa e nota, cargo, local, "Candidatura rápida", dias
    const gd = await alert(
      "Glassdoor <noreply@glassdoor.com>",
      `<a href="https://www.glassdoor.com.br/partner/jobListing.htm?jobListingId=1009999999999&amp;pos=1"><table><tr><td><img src="https://media.glassdoor.com/x.png" alt="avatar"></td>
       <td><span><span>Hooli</span><span>&nbsp;4.0 ★</span></span></td></tr></table>
       <table><tr><td><p>Engenheiro(a) de Software Full Stack Sênior</p></td></tr></table>
       <table><tr><td><p>Trabalho remoto</p></td></tr></table><table><tr><td><p>R$ 9 mil (estimativa da empresa)</p></td><td><p>Candidatura rápida</p></td><td><p>2 dia(s)</p></td></tr></table></a>
       <a href="https://www.glassdoor.com.br/partner/jobListing.htm?jobListingId=1008888888888"><table><tr><td><span><span>Vandelay</span></span></td></tr></table>
       <table><tr><td><p>Desenvolvedor(a) de Sistemas Pleno</p></td></tr></table><table><tr><td><p>Curitiba, Paraná</p></td><td><p>3 dia(s)</p></td></tr></table></a>`,
    );
    expect(gd?.items.map((i) => [i.title, i.company, i.location])).toEqual([
      ["Engenheiro(a) de Software Full Stack Sênior", "Hooli", "Trabalho remoto"],
      ["Desenvolvedor(a) de Sistemas Pleno", "Vandelay", "Curitiba, Paraná"],
    ]);
  });

  it("revisão · resumo da Coders com uma linha a mais numa vaga não desalinha as seguintes", async () => {
    const html = `<h3>O que chegou</h3><table>
      <tr><td>Dev Backend</td></tr><tr><td>Globex · via LinkedInJobs</td></tr>
      <tr><td>Analista de Dados</td></tr><tr><td>Initech · via Indeed</td></tr><tr><td>Remoto</td></tr>
      <tr><td>Engenheira de Software</td></tr><tr><td>Umbrella · via LinkedInJobs</td></tr>
      </table><p>E mais 3 vagas no seu board.</p>`;
    const a = await alert("COD3RS <noreply@app.coders.com.br>", html);
    expect(a?.items.map((i) => [i.title, i.company])).toEqual([
      ["Dev Backend", "Globex"],
      ["Analista de Dados", "Initech"],
      ["Engenheira de Software", "Umbrella"],
    ]);
  });

  it("remetente sem leitor ou sem links de vaga: null (vai ao modelo)", async () => {
    expect(
      await alert("RH <rh@acme.example>", `<a href="https://acme.example/vaga/1">Vaga</a>`),
    ).toBeNull();
    expect(
      await alert(
        "LinkedIn <jobalerts-noreply@linkedin.com>",
        `<a href="https://www.linkedin.com/feed/">Feed</a>`,
      ),
    ).toBeNull();
  });

  it("desembrulha até três níveis de rastreio", () => {
    const inner = "https://www.linkedin.com/jobs/view/4012345678/";
    const two = `https://a.example/r?u=${encodeURIComponent(`https://b.example/c?target=${encodeURIComponent(inner)}`)}`;
    expect(unwrapLink(two)?.href).toBe(inner);
  });
});

describe("F14/M3 · revisão: HTML hostil", () => {
  it("#12: milhares de <a> sem fechamento não travam (passada linear)", async () => {
    const html = `${'<a href="https://www.linkedin.com/comm/jobs/view/4012345678/">'.repeat(20000)}fim`;
    const t0 = Date.now();
    await alert("LinkedIn <jobalerts-noreply@linkedin.com>", html);
    expect(Date.now() - t0).toBeLessThan(3000);
  });
});
