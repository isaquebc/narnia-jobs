import { seedFixture } from "@narnia-jobs/core";
import type { ApplicationFormView, ProfileMotivation } from "@narnia-jobs/shared";
import { afterEach, describe, expect, it } from "vitest";
import { makeTestApp, type TestApp } from "./helpers";

/**
 * F12-23 · motivações do perfil (pedido do dono, 2026-10-26): a pessoa decide as frases (aceita, edita ou recusa; a
 * recusada fica e outra é sugerida no lugar), revisa antes das respostas do formulário e decide as suposições do
 * roleplay na janela (aceita vira motivação; recusada refaz a resposta da pergunta).
 */
describe("F12-23 · motivações do perfil pela api", () => {
  let t: TestApp | undefined;
  afterEach(() => t?.cleanup());

  const setup = () => {
    t = makeTestApp();
    const { profileId } = seedFixture(t.repos, "engineer");
    return { app: t, profileId };
  };
  const json = (body: unknown) => ({
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const list = async (app: TestApp, profileId: string) =>
    (await (await app.api(`/api/profiles/${profileId}/motivations`)).json()) as {
      items: ProfileMotivation[];
      reviewed: boolean;
      suggesting: boolean;
    };
  const tasks = (app: TestApp, type: string) => app.queue.tasks.filter((x) => x.type === type);

  it("lista, pede sugestões (na fila), escreve, edita e recusa (a recusada fica e pede outra no lugar)", async () => {
    const { app, profileId } = setup();
    expect(await list(app, profileId)).toEqual({ items: [], reviewed: false, suggesting: false });
    expect(
      (await app.api(`/api/profiles/${profileId}/motivations/suggest`, { method: "POST" })).status,
    ).toBe(202);
    expect(tasks(app, "profile.motivations").map((x) => x.payload)).toEqual([{ profileId }]);
    expect((await list(app, profileId)).suggesting).toBe(true);

    const own = await app.api(`/api/profiles/${profileId}/motivations`, {
      method: "POST",
      ...json({ text: "Quero trabalhar perto do produto." }),
    });
    expect(own.status).toBe(201);
    expect(((await own.json()) as { motivation: ProfileMotivation }).motivation).toMatchObject({
      status: "accepted",
      source: "user",
    });
    const s = app.repos.profileMotivations.add({
      profileId,
      text: "Gosto de ser dona dos serviços.",
      status: "suggested",
      source: "model",
    });
    const edited = await app.api(`/api/profiles/${profileId}/motivations/${s.id}`, {
      method: "PATCH",
      ...json({ text: "Gosto de cuidar dos serviços de ponta a ponta." }),
    });
    expect(((await edited.json()) as { motivation: ProfileMotivation }).motivation).toMatchObject({
      text: "Gosto de cuidar dos serviços de ponta a ponta.",
      status: "accepted",
    });
    const r = app.repos.profileMotivations.add({
      profileId,
      text: "Quero trabalhar em startup.",
      status: "suggested",
      source: "model",
    });
    app.queue.tasks.length = 0;
    await app.api(`/api/profiles/${profileId}/motivations/${r.id}`, {
      method: "PATCH",
      ...json({ status: "refused" }),
    });
    expect(app.repos.profileMotivations.get(r.id)?.status).toBe("refused");
    expect(tasks(app, "profile.motivations").map((x) => x.payload)).toEqual([
      { profileId, count: 1 },
    ]);
    expect(app.events).toContainEqual({ type: "profile.motivations.updated", profileId });
    // de outro perfil ou inexistente
    expect(
      (
        await app.api(`/api/profiles/${profileId}/motivations/nao-existe`, {
          method: "PATCH",
          ...json({ status: "accepted" }),
        })
      ).status,
    ).toBe(404);
    expect((await app.api("/api/profiles/nao-existe/motivations")).status).toBe(404);
  });

  it("revisar: marca o perfil e retoma as respostas dos formulários que esperavam por ele", async () => {
    const { app, profileId } = setup();
    const p = app.repos.postings.create({ title: "Backend Sr", company: "Acme" });
    const f = app.repos.applications.create({
      captureId: "c1",
      postingId: p.id,
      profileId,
      url: "https://acme.example/aplicar",
      title: "Candidatura",
      fields: [],
    });
    app.repos.applications.setAnswersStatus(f.id, "motivations");
    const view = (await (await app.api(`/api/applications/${f.id}`)).json()) as {
      application: ApplicationFormView;
    };
    expect(view.application).toMatchObject({
      answersStatus: "motivations",
      answersProfileId: profileId,
    });
    const r = await app.api(`/api/profiles/${profileId}/motivations/review`, { method: "POST" });
    expect(r.status).toBe(200);
    expect((await list(app, profileId)).reviewed).toBe(true);
    expect(tasks(app, "application.answer").map((x) => x.payload)).toEqual([
      { applicationId: f.id },
    ]);
    expect(app.repos.applications.get(f.id)?.answersStatus).toBe("answering");
  });

  it("suposição do roleplay: aceitar vira motivação (em primeira pessoa ou no texto dela); recusar guarda e refaz a pergunta", async () => {
    const { app, profileId } = setup();
    const p = app.repos.postings.create({ title: "Backend Sr", company: "Vitalis" });
    const f = app.repos.applications.create({
      captureId: "c1",
      postingId: p.id,
      profileId,
      url: "https://vitalis.example/aplicar",
      title: "Candidatura",
      fields: [],
    });
    app.repos.applications.setQuestions(f.id, [
      {
        id: "q1",
        question: "Why Vitalis?",
        kind: "long_text",
        options: [],
        required: true,
        maxChars: null,
        section: null,
        profileField: null,
        topic: null,
        source: "model",
        fieldRefs: ["f1"],
      },
    ]);
    app.repos.applications.addAnswers(f.id, [
      {
        questionId: "q1",
        answer: "I want to bring my payments work to health.",
        origins: [],
        gap: null,
        assumptions: [
          "Que você quer trabalhar com saúde.",
          "Que você gosta de ser dona dos serviços.",
          "Que o trabalho remoto pesa na sua escolha.",
        ],
        source: "roleplay",
      },
    ]);
    const decide = (body: unknown) =>
      app.api(`/api/applications/${f.id}/answers/q1/assumptions`, {
        method: "POST",
        ...json(body),
      });
    expect((await decide({ index: 0, action: "accept" })).status).toBe(200);
    expect(
      (await decide({ index: 2, action: "accept", text: "Prefiro trabalho remoto." })).status,
    ).toBe(200);
    app.queue.tasks.length = 0;
    const refused = await decide({ index: 1, action: "refuse" });
    const view = ((await refused.json()) as { application: ApplicationFormView }).application;
    expect(view.questions[0]?.assumptionStatus).toEqual(["accepted", "refused", "accepted"]);
    expect(
      app.repos.profileMotivations
        .list(profileId)
        .map((m) => [m.text, m.status, m.source, m.assumption]),
    ).toEqual([
      [
        "Quero trabalhar com saúde.",
        "accepted",
        "assumption",
        "Que você quer trabalhar com saúde.",
      ],
      [
        "Prefiro trabalho remoto.",
        "accepted",
        "assumption",
        "Que o trabalho remoto pesa na sua escolha.",
      ],
      [
        "Gosto de ser dona dos serviços.",
        "refused",
        "assumption",
        "Que você gosta de ser dona dos serviços.",
      ],
    ]);
    expect(tasks(app, "application.answer").map((x) => x.payload)).toEqual([
      { applicationId: f.id, questionIds: ["q1"] },
    ]);
    expect((await decide({ index: 9, action: "accept" })).status).toBe(422);
    expect(
      (
        await app.api(`/api/applications/${f.id}/answers/qx/assumptions`, {
          method: "POST",
          ...json({ index: 0, action: "accept" }),
        })
      ).status,
    ).toBe(404);
  });

  it("forma de tratamento no cadastro: feminino, masculino ou neutro (valor desconhecido é recusado)", async () => {
    const { app } = setup();
    const put = (address: string) =>
      app.api("/api/user/address", { method: "PUT", ...json({ address }) });
    expect((await put("feminino")).status).toBe(200);
    expect(app.repos.users.get()?.pronouns).toBe("feminino");
    expect((await put("neutro")).status).toBe(200);
    expect(app.repos.users.get()?.pronouns).toBe("neutro");
    expect((await put("ela")).status).toBe(400);
  });
});
