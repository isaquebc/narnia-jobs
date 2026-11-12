import { describe, expect, it } from "vitest";
import {
  assessMailRisk,
  authVerdict,
  createRepos,
  lookalikeOf,
  migrate,
  openDatabase,
  parseMail,
  prefilterMail,
  registrableDomain,
} from "../../src";
import { AUTH_OK, rawMail } from "./fixtures";

/**
 * F14/M3 · risco do e-mail e confiabilidade do remetente (F14-13, §2.7), com e-mails sintéticos: autenticação, domínio
 * que imita plataforma, marca no nome, Reply-To, anexos e links perigosos, golpe de vaga, lista da pessoa (confiar só
 * vale com autenticação ok) e histórico; e o pré-filtro (vaga, fora do assunto, dúvida).
 */
function repos() {
  const db = openDatabase(":memory:");
  migrate(db);
  return createRepos(db);
}
const assess = async (o: Parameters<typeof rawMail>[0], r = repos()) =>
  assessMailRisk(await parseMail(rawMail(o)), r.mailSenders);
const AT = "2026-11-11T12:00:00.000Z";

describe("F14/M3 · domínios", () => {
  it("domínio registrável com sufixos de dois níveis", () => {
    expect(registrableDomain("mail.linkedin.com")).toBe("linkedin.com");
    expect(registrableDomain("noreply.glassdoor.com.br")).toBe("glassdoor.com.br");
    expect(registrableDomain("acme.example")).toBe("acme.example");
  });

  it("domínios que imitam plataformas; nomes comuns e as próprias plataformas não", () => {
    expect(lookalikeOf("linkedln.com")).toBe("linkedin");
    expect(lookalikeOf("l1nkedin.com")).toBe("linkedin");
    expect(lookalikeOf("glassdor.com")).toBe("glassdoor");
    expect(lookalikeOf("linkedin-vagas.com")).toBe("linkedin");
    expect(lookalikeOf("mail.linkedin.com")).toBeNull();
    expect(lookalikeOf("glassdoor.com.br")).toBeNull();
    expect(lookalikeOf("orders.com")).toBeNull();
    expect(lookalikeOf("acme.example")).toBeNull();
  });
});

describe("F14/M3 · risco", () => {
  it("plataforma com DKIM alinhado e DMARC ok: confiável", async () => {
    const r = await assess({ from: "LinkedIn <jobalerts-noreply@linkedin.com>" });
    expect(r).toMatchObject({ level: "trusted", trustedBy: "platform" });
    expect(r.sender).toMatchObject({ kind: "platform", platform: "linkedin" });
  });

  it("empresa desconhecida autenticada: neutro; recrutador em webmail: neutro", async () => {
    expect((await assess({ from: "RH Acme <rh@acme.example>" })).level).toBe("neutral");
    const w = await assess({ from: "Ana <ana.recrutadora@gmail.com>" });
    expect(w.level).toBe("neutral");
    expect(w.sender.kind).toBe("webmail");
  });

  it("DMARC falhou, SPF e DKIM falharam: risco alto", async () => {
    const f1 = await assess({
      from: "LinkedIn <jobs-noreply@linkedin.com>",
      auth: "mx.google.com; dkim=fail header.i=@linkedin.com; spf=softfail smtp.mailfrom=x@spam.example; dmarc=fail (p=REJECT) header.from=linkedin.com",
    });
    expect(f1.level).toBe("high");
    expect(f1.reasons.join()).toMatch(/DMARC falhou/);
    const f2 = await assess({
      from: "RH <rh@acme.example>",
      auth: "mx.google.com; spf=fail smtp.mailfrom=rh@acme.example",
    });
    expect(f2.level).toBe("high");
  });

  it("sem autenticação: nunca confiável, mas não é quarentena por isso", async () => {
    const r = await assess({ from: "LinkedIn <jobs-noreply@linkedin.com>", auth: null });
    expect(r.level).toBe("neutral");
    expect(r.reasons).toContain("sem resultado de autenticação do Gmail");
  });

  it("domínio que imita, marca no nome com outro domínio e Reply-To de plataforma em outro domínio: alto", async () => {
    expect((await assess({ from: "Vagas <jobs@linkedln.com>" })).reasons.join()).toMatch(
      /imita linkedin/,
    );
    expect((await assess({ from: "LinkedIn Vagas <vagas@acme.example>" })).reasons.join()).toMatch(
      /cita linkedin/,
    );
    const reply = await assess({
      from: "LinkedIn <jobs-noreply@linkedin.com>",
      replyTo: "rh@outra.example",
    });
    expect(reply.level).toBe("high");
    const companyReply = await assess({ from: "RH <rh@acme.example>", replyTo: "ana@gmail.com" });
    expect(companyReply.level).toBe("neutral");
    expect(companyReply.reasons.join()).toMatch(/Reply-To/);
  });

  it("anexo perigoso, link para IP ou punycode e golpe de vaga: alto; .ics e .pdf não", async () => {
    expect(
      (
        await assess({
          attachments: [{ filename: "vaga.html", type: "text/html", content: "<script>" }],
        })
      ).level,
    ).toBe("high");
    expect((await assess({ html: '<a href="http://192.168.0.10/vaga">ver</a>' })).level).toBe(
      "high",
    );
    expect(
      (await assess({ html: '<a href="https://xn--lnkedin-9xa.com/jobs">ver</a>' })).level,
    ).toBe("high");
    const scam = await assess({
      subject: "Vaga home office",
      html: "<p>Pague a taxa de inscrição via PIX</p>",
    });
    expect(scam.level).toBe("high");
    expect(scam.reasons.join()).toMatch(/golpe/);
    const ok = await assess({
      attachments: [
        { filename: "convite.ics", type: "text/calendar", content: "BEGIN:VCALENDAR" },
        { filename: "descricao.pdf", type: "application/pdf", content: "%PDF" },
      ],
    });
    expect(ok.level).toBe("neutral");
  });

  it("link encurtado é só observação", async () => {
    const r = await assess({ html: '<a href="https://bit.ly/abc">ver</a>' });
    expect(r.level).toBe("neutral");
    expect(r.reasons.join()).toMatch(/encurtado/);
  });

  it("lista da pessoa: bloqueado é alto; confiável só vale com autenticação ok; domínio cobre os endereços", async () => {
    const r = repos();
    r.mailSenders.setOverride("rh@acme.example", "blocked", "manual", AT);
    expect((await assess({ from: "RH <rh@acme.example>" }, r)).reasons).toContain(
      "remetente bloqueado por você",
    );
    r.mailSenders.setOverride("@globex.example", "trusted", "manual", AT);
    expect(await assess({ from: "Talentos <talentos@globex.example>" }, r)).toMatchObject({
      level: "trusted",
      trustedBy: "list",
    });
    const spoof = await assess(
      {
        from: "Talentos <talentos@globex.example>",
        auth: "mx.google.com; spf=fail; dmarc=fail header.from=globex.example",
      },
      r,
    );
    expect(spoof.level).toBe("high");
    expect(spoof.reasons).toContain(
      "remetente confiável, mas a autenticação não confirma o domínio",
    );
  });

  it("histórico: 3 e-mails bons sem recusa viram confiável; recusas repetidas viram alto", async () => {
    const r = repos();
    for (let i = 0; i < 3; i++) r.mailSenders.bump("rh@acme.example", "ok", AT);
    expect((await assess({ from: "RH <rh@acme.example>" }, r)).trustedBy).toBe("history");
    for (let i = 0; i < 2; i++) r.mailSenders.bump("golpe@fake.example", "rejected", AT);
    expect((await assess({ from: "X <golpe@fake.example>" }, r)).level).toBe("high");
  });

  it("autenticação: DKIM alinhado pelo domínio registrável", () => {
    const v = authVerdict([AUTH_OK("e.linkedin.com")], "linkedin.com");
    expect(v).toMatchObject({ aligned: true, ok: true, spf: "pass", dmarc: "pass" });
  });
});

describe("F14/M3 · pré-filtro", () => {
  const pre = async (o: Parameters<typeof rawMail>[0]) =>
    prefilterMail(await parseMail(rawMail(o)));

  it("canais de vaga do LinkedIn e ATS: vaga; notificações do LinkedIn sem assunto de vaga: fora do assunto", async () => {
    expect(
      (
        await pre({
          from: "LinkedIn <jobalerts-noreply@linkedin.com>",
          subject: "Dev Backend: 12 novas",
        })
      ).decision,
    ).toBe("candidate");
    expect(
      (await pre({ from: "Acme <no-reply@greenhouse.io>", subject: "Obrigado" })).decision,
    ).toBe("candidate");
    expect(
      (
        await pre({
          from: "LinkedIn <notifications-noreply@linkedin.com>",
          subject: "Ana comentou seu post",
        })
      ).decision,
    ).toBe("ignored");
    expect(
      (
        await pre({
          from: "Glassdoor <noreply@glassdoor.com>",
          subject: "Novos posts na comunidade",
        })
      ).decision,
    ).toBe("ignored");
    expect(
      (await pre({ from: "Glassdoor <noreply@glassdoor.com>", subject: "Vagas de Dev Backend" }))
        .decision,
    ).toBe("candidate");
  });

  it("convite com .ics: vaga; empresa com assunto de vaga: vaga; sem sinal: dúvida para o modelo", async () => {
    const ics = await pre({
      from: "RH <rh@acme.example>",
      subject: "Conversa",
      attachments: [{ filename: "invite.ics", type: "text/calendar", content: "BEGIN:VCALENDAR" }],
    });
    expect(ics).toMatchObject({ decision: "candidate", hasCalendar: true });
    expect((await pre({ from: "RH <rh@acme.example>", subject: "Sua candidatura" })).decision).toBe(
      "candidate",
    );
    expect((await pre({ from: "RH <rh@acme.example>", subject: "Próximos passos" })).decision).toBe(
      "unknown",
    );
  });
});

describe("F14/M3 · revisão: autenticação que não pode ser forjada", () => {
  it("#1: dmarc=pass dentro do comentário do ARC não vale; o dmarc=fail de fora vale", async () => {
    const r = await assess({
      from: "LinkedIn <jobs-noreply@linkedin.com>",
      auth: "mx.google.com; dkim=pass header.i=@evil.example header.s=s; arc=pass (i=1 spf=pass spfdomain=linkedin.com dkim=pass dkdomain=linkedin.com dmarc=pass fromdomain=linkedin.com); spf=pass (google.com: x) smtp.mailfrom=bounce@evil.example; dmarc=fail (p=REJECT sp=REJECT dis=QUARANTINE) header.from=linkedin.com",
    });
    expect(r.level).toBe("high");
    expect(r.auth.dmarc).toBe("fail");
  });

  it("#3: só o primeiro cabeçalho, e só se for do mx.google.com", () => {
    expect(
      authVerdict(
        ["spam.example; dmarc=pass", "mx.google.com; dmarc=pass header.from=x.example"],
        "x.example",
      ).present,
    ).toBe(false);
    expect(authVerdict(["relay.mx.google.com.evil.example; dmarc=pass"], "x.example").present).toBe(
      false,
    );
  });

  it("#2: SPF e DKIM de outro domínio não confirmam o remetente da lista nem o do histórico", async () => {
    const r = repos();
    r.mailSenders.setOverride("@acme.example", "trusted", "manual", AT);
    for (let i = 0; i < 3; i++) r.mailSenders.bump("rh@globex.example", "ok", AT);
    const evil = () =>
      "mx.google.com; dkim=pass header.i=@evil.example header.s=s; spf=pass smtp.mailfrom=bounce@evil.example";
    const listed = await assess({ from: "RH <rh@acme.example>", auth: evil() }, r);
    expect(listed.level).toBe("high");
    const hist = await assess({ from: "RH <rh@globex.example>", auth: evil() }, r);
    expect(hist.level).toBe("neutral");
    expect(hist.trustedBy).toBeNull();
  });

  it("#2: sufixos públicos: acme.ind.br é o domínio, não ind.br", () => {
    expect(registrableDomain("rh.acme.ind.br")).toBe("acme.ind.br");
    expect(registrableDomain("acme.github.io")).toBe("acme.github.io");
  });

  it("#5: empresa pequena só com SPF alinhado: neutro, não quarentena", async () => {
    const r = await assess({
      from: "RH <rh@acme.example>",
      auth: "mx.google.com; spf=pass smtp.mailfrom=rh@acme.example",
    });
    expect(r.level).toBe("neutral");
    expect(r.auth.aligned).toBe(true);
    const soft = await assess({
      from: "RH <rh@acme.example>",
      auth: "mx.google.com; spf=neutral smtp.mailfrom=rh@acme.example",
    });
    expect(soft.level).toBe("neutral");
  });
});

describe("F14/M3 · revisão: plataformas legítimas não vão para a quarentena", () => {
  it("#4: Greenhouse pelo greenhouse-mail.io, links do Workday e do SuccessFactors", async () => {
    expect((await assess({ from: "Acme <no-reply@us.greenhouse-mail.io>" })).level).toBe("trusted");
    const wd = await assess({
      from: "Acme <rh@acme.example>",
      html: '<a href="https://acme.wd5.myworkdayjobs.com/pt-BR/careers/job/123">vaga</a><a href="https://career5.successfactors.eu/x">x</a>',
    });
    expect(wd.level).toBe("neutral");
  });

  it('#6: "Squad Pix" no título não é golpe; pedido de PIX é; plataforma autenticada vira só observação', async () => {
    expect(
      (
        await assess({
          from: "RH <rh@acme.example>",
          html: "<p>Engenheiro(a) de Software – Squad Pix</p>",
        })
      ).level,
    ).toBe("neutral");
    expect(
      (
        await assess({
          from: "RH <rh@acme.example>",
          html: "<p>Pague a taxa via PIX para garantir a vaga</p>",
        })
      ).level,
    ).toBe("high");
    const li = await assess({
      from: "LinkedIn <jobalerts-noreply@linkedin.com>",
      html: "<p>Analista – renda extra</p>",
    });
    expect(li.level).toBe("trusted");
    expect(li.reasons.join()).toMatch(/golpe/);
  });

  it("#13: href sem aspas e com entidade numérica também é conferido", async () => {
    expect((await assess({ html: "<a href=http://192.168.0.10/x>ver</a>" })).level).toBe("high");
    expect(
      (await assess({ html: '<a href="&#104;ttps://xn--lnkedin-9xa.com/">ver</a>' })).level,
    ).toBe("high");
  });

  it("#16: @subdomínio vale para os endereços dos subdomínios dele", async () => {
    const r = repos();
    r.mailSenders.setOverride("@mail.acme.example", "trusted", "manual", AT);
    expect((await assess({ from: "X <x@a.mail.acme.example>" }, r)).trustedBy).toBe("list");
  });

  it("#10: mensagens repassadas pelo LinkedIn vão ao modelo", async () => {
    expect(
      prefilterMail(
        await parseMail(
          rawMail({
            from: "LinkedIn <messages-noreply@linkedin.com>",
            subject: "Maria enviou uma mensagem",
          }),
        ),
      ).decision,
    ).toBe("unknown");
  });

  it("correção 2026-11-11: confirmação do Indeed e alertas de uma vaga do Glassdoor em português são de vaga", async () => {
    const d = async (from: string, subject: string) =>
      prefilterMail(await parseMail(rawMail({ from, subject }))).decision;
    expect(
      await d("Indeed <indeedapply@indeed.com>", "Inscrição via Indeed: Analista de Dados Sênior"),
    ).toBe("candidate");
    for (const subject of [
      "Programador Junior, Curitiba na empresa Globex: uma ótima opção para você",
      "[1234] Pessoa Desenvolvedora Fullstack Jr (Híbrido - Recife)",
      "A Initech está contratando ANALISTA DE SISTEMAS",
      "Umbrella, Hooli e Acme: Candidatar-se agora",
      "ESTAGIO TI REMOTO na empresa Clínica Exemplo",
      "Software Engineer | Back-End | Remote Work na empresa Globex",
    ])
      expect(await d("Glassdoor <noreply@glassdoor.com>", subject), subject).toBe("candidate");
    // comunidade e notícias da plataforma continuam fora
    expect(await d("Glassdoor <noreply@glassdoor.com>", "Novidades da sua comunidade")).toBe(
      "ignored",
    );
  });
});
