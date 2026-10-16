import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PostingLinks } from "../../src/features/chat/ChatPage";

/** F06/M5 e F05/M5 · links da mensagem do recrutador: vaga, análise, "Criar CV", documentos e o botão sugerido. */
const call = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  args: "{}",
  durationMs: 10,
  isError: false,
  ...extra,
});

describe("F06/M5 · PostingLinks", () => {
  it("conversa da análise aberta e vaga salva viram links", () => {
    render(
      <PostingLinks
        message={{
          toolCalls: [
            call("posting_create", { postingId: "p1" }),
            call("posting_open_analysis", { sessionId: "s9" }),
          ],
        }}
      />,
    );
    expect(screen.getByRole("link", { name: "Abrir a conversa da análise" })).toHaveAttribute(
      "href",
      "/chat/s9",
    );
    expect(screen.getByRole("link", { name: "Abrir a vaga" })).toHaveAttribute("href", "/vagas/p1");
    expect(screen.queryByRole("link", { name: "Criar CV para esta vaga" })).toBeNull();
  });

  it("mensagem que gravou a análise mostra 'Criar CV para esta vaga', que abre o Gerar na vaga (F05)", () => {
    render(<PostingLinks message={{ toolCalls: [call("analysis_save", { postingId: "p1" })] }} />);
    expect(screen.getByRole("link", { name: "Criar CV para esta vaga" })).toHaveAttribute(
      "href",
      "/vagas/p1?gerar=cv",
    );
  });

  it("documentos gerados viram links e o botão sugerido pelo recrutador substitui o 'Criar CV'", () => {
    render(
      <PostingLinks
        message={{
          toolCalls: [
            call("analysis_save", { postingId: "p1" }),
            call("cv_generate", {
              documents: [
                { id: "d1", kind: "cv", url: "/vagas/p1?doc=d1" },
                { id: "d2", kind: "cover_letter", url: "/vagas/p1?doc=d2" },
              ],
            }),
            call("ui_suggest_action", {
              action: { label: "Gerar a carta", url: "/vagas/p1?gerar=cover_letter&perfil=x" },
            }),
          ],
        }}
      />,
    );
    expect(screen.getByRole("link", { name: "Abrir o currículo" })).toHaveAttribute(
      "href",
      "/vagas/p1?doc=d1",
    );
    expect(screen.getByRole("link", { name: "Abrir a carta" })).toHaveAttribute(
      "href",
      "/vagas/p1?doc=d2",
    );
    expect(screen.getByRole("link", { name: "Gerar a carta" })).toHaveAttribute(
      "href",
      "/vagas/p1?gerar=cover_letter&perfil=x",
    );
    expect(screen.queryByRole("link", { name: "Criar CV para esta vaga" })).toBeNull();
  });

  it("sem tools da vaga, nada", () => {
    const { container } = render(<PostingLinks message={{ toolCalls: [call("fact_search")] }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
