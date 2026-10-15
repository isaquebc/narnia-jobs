import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PostingLinks } from "../../src/features/chat/ChatPage";

/** F06/M5 · links da vaga na mensagem do recrutador e o botão "Criar CV para esta vaga" (em breve). */
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
    expect(screen.queryByRole("button", { name: "Criar CV para esta vaga" })).toBeNull();
  });

  it("mensagem que gravou a análise mostra 'Criar CV para esta vaga' desabilitado (em breve)", () => {
    render(<PostingLinks message={{ toolCalls: [call("analysis_save", { postingId: "p1" })] }} />);
    expect(screen.getByRole("button", { name: "Criar CV para esta vaga" })).toBeDisabled();
  });

  it("sem tools da vaga, nada", () => {
    const { container } = render(<PostingLinks message={{ toolCalls: [call("fact_search")] }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
