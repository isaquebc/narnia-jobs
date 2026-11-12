import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MailReviewPage } from "../../src/features/mail/MailReviewPage";
import { renderWithProviders } from "../helpers";

/** F14/M5 · E-mails para revisar: motivo, escolher a vaga, ignorar e liberar a quarentena. */
const item = (o: Record<string, unknown>) => ({
  id: "m1",
  gmailId: "g1",
  status: "review",
  class: "application_received",
  from: "RH Acme <rh@acme.example>",
  fromAddr: "rh@acme.example",
  subject: "Recebemos sua candidatura",
  receivedAt: "2026-11-09T10:00:00.000Z",
  riskLevel: "trusted",
  riskReasons: [],
  summary: "Candidatura para Dev Backend.",
  reason: "duas vagas parecidas",
  company: "Acme",
  title: "Dev Backend",
  mailUrl: "https://mail.google.com/mail/u/0/#all/g1",
  suggestedPosting: null,
  needsConfirm: false,
  ...o,
});
const view = {
  review: [item({})],
  quarantine: [
    item({
      id: "q1",
      gmailId: "g2",
      status: "quarantine",
      class: "candidate",
      subject: "Vaga urgente",
      fromAddr: "rh@acme-vagas.example",
      riskLevel: "high",
      riskReasons: ["domínio parecido com acme.example"],
      reason: null,
    }),
  ],
};

describe("F14/M5 · e-mails para revisar", () => {
  it("mostra o motivo e liga a candidatura à vaga escolhida", async () => {
    const applyMail = vi.fn(async () => ({ status: "queued" }));
    const listPostings = vi.fn(async () => ({
      postings: [{ id: "p1", title: "Dev Backend", company: "Acme" }],
    }));
    renderWithProviders(<MailReviewPage />, {
      api: { getMailReview: async () => view, applyMail, listPostings } as never,
    });
    const card = await screen.findByRole("article", { name: "Recebemos sua candidatura" });
    expect(within(card).getByText("Motivo: duas vagas parecidas")).toBeInTheDocument();
    expect(within(card).getByText("Candidatura recebida")).toBeInTheDocument();
    await userEvent.click(within(card).getByRole("button", { name: "Escolher a vaga" }));
    // a busca já vem com a empresa do e-mail
    expect(within(card).getByLabelText("Buscar a vaga (empresa ou cargo)")).toHaveValue("Acme");
    await userEvent.click(await within(card).findByRole("button", { name: "Dev Backend · Acme" }));
    await waitFor(() => expect(applyMail).toHaveBeenCalledWith("m1", { postingId: "p1" }));
  });

  it("escolher a vaga: as com candidatura vêm primeiro, com o selo (as repetidas do feed não escondem a aplicada)", async () => {
    const listPostings = vi.fn(async () => ({
      postings: [
        ...Array.from({ length: 8 }, (_, i) => ({
          id: `f${i}`,
          title: "Dev Backend",
          company: "Acme",
          application: null,
        })),
        {
          id: "p9",
          title: "Dev Backend",
          company: "Acme",
          application: { id: "a1", column: "applied", archived: false },
        },
      ],
    }));
    renderWithProviders(<MailReviewPage />, {
      api: { getMailReview: async () => view, applyMail: vi.fn(), listPostings } as never,
    });
    const card = await screen.findByRole("article", { name: "Recebemos sua candidatura" });
    await userEvent.click(within(card).getByRole("button", { name: "Escolher a vaga" }));
    const options = await within(card).findAllByRole("button", { name: /^Dev Backend · Acme/ });
    expect(options[0]).toHaveTextContent("com candidatura");
    expect(options).toHaveLength(9);
  });

  it("quarentena: mostra por quê; confiar no remetente libera; ignorar", async () => {
    const putMailSender = vi.fn(async () => ({ quarantined: 1 }));
    const reprocessMailSender = vi.fn(async () => ({ reprocessed: 1 }));
    const ignoreMail = vi.fn(async () => ({}));
    renderWithProviders(<MailReviewPage />, {
      api: {
        getMailReview: async () => view,
        putMailSender,
        reprocessMailSender,
        ignoreMail,
      } as never,
    });
    const card = await screen.findByRole("article", { name: "Vaga urgente" });
    expect(
      within(within(card).getByRole("list", { name: "Por que ficou em quarentena" })).getByText(
        "domínio parecido com acme.example",
      ),
    ).toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: "Escolher a vaga" })).toBeNull();
    await userEvent.click(
      within(card).getByRole("button", { name: "Confiar no remetente e processar" }),
    );
    await waitFor(() =>
      expect(putMailSender).toHaveBeenCalledWith({
        value: "rh@acme-vagas.example",
        override: "trusted",
      }),
    );
    // confiar reavalia o risco dos e-mails do remetente (não libera sem reavaliar)
    await waitFor(() => expect(reprocessMailSender).toHaveBeenCalledWith("rh@acme-vagas.example"));
    const review = screen.getByRole("article", { name: "Recebemos sua candidatura" });
    await userEvent.click(within(review).getByRole("button", { name: "Ignorar" }));
    await waitFor(() => expect(ignoreMail).toHaveBeenCalledWith("m1"));
  });

  it("remetente sem confiança: aplicar à vaga sugerida, ou aplicar mesmo assim", async () => {
    const applyMail = vi.fn(async () => ({ status: "queued" }));
    renderWithProviders(<MailReviewPage />, {
      api: {
        getMailReview: async () => ({
          review: [
            item({
              needsConfirm: true,
              suggestedPosting: { id: "p9", title: "Dev Backend", company: "Acme" },
            }),
            item({ id: "m2", subject: "Outra", needsConfirm: true }),
          ],
          quarantine: [],
        }),
        applyMail,
      } as never,
    });
    const a = await screen.findByRole("article", { name: "Recebemos sua candidatura" });
    await userEvent.click(within(a).getByRole("button", { name: "Aplicar a Dev Backend · Acme" }));
    await waitFor(() => expect(applyMail).toHaveBeenCalledWith("m1", { postingId: "p9" }));
    const b = screen.getByRole("article", { name: "Outra" });
    await userEvent.click(within(b).getByRole("button", { name: "Aplicar mesmo assim" }));
    await waitFor(() => expect(applyMail).toHaveBeenCalledWith("m2", { confirm: true }));
  });

  it("ler de novo: confirma, devolve à fila e avisa que está lendo", async () => {
    const rereadMail = vi.fn(async () => ({
      mails: 1,
      applicationsRemoved: 0,
      postingsRemoved: 0,
      kept: [],
    }));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderWithProviders(<MailReviewPage />, {
      api: { getMailReview: async () => view, rereadMail } as never,
    });
    const card = await screen.findByRole("article", { name: "Recebemos sua candidatura" });
    await userEvent.click(within(card).getByRole("button", { name: "Ler de novo" }));
    expect(confirm).toHaveBeenCalled();
    expect(rereadMail).toHaveBeenCalledWith("m1");
    expect(await within(card).findByRole("status")).toHaveTextContent(
      "Lendo de novo; o resultado aparece em instantes.",
    );
    confirm.mockRestore();
  });

  it("caixa vazia", async () => {
    renderWithProviders(<MailReviewPage />, {
      api: { getMailReview: async () => ({ review: [], quarantine: [] }) } as never,
    });
    expect(await screen.findAllByText("Nada aqui.")).toHaveLength(2);
  });
});
