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
