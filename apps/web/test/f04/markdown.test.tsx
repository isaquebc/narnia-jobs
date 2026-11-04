import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Markdown } from "../../src/features/chat/Markdown";

describe("F04/M4 · Markdown seguro do chat", () => {
  it("renderiza parágrafos, negrito, itálico, código, listas e títulos", () => {
    const { container } = render(
      <Markdown
        text={
          "## Pontos\n\nSeu **ponto forte** é *Go* e `Kubernetes`.\n\n- um\n- dois\n\n1. a\n2. b\n\n```\ncodigo\n```"
        }
      />,
    );
    expect(screen.getByRole("heading", { name: "Pontos" })).toBeInTheDocument();
    expect(container.querySelector("strong")?.textContent).toBe("ponto forte");
    expect(container.querySelector("em")?.textContent).toBe("Go");
    expect(container.querySelector("code")?.textContent).toBe("Kubernetes");
    expect(container.querySelectorAll("ul li")).toHaveLength(2);
    expect(container.querySelectorAll("ol li")).toHaveLength(2);
    expect(container.querySelector("pre")?.textContent).toContain("codigo");
  });

  it("nunca injeta HTML e só cria links http(s) e caminhos internos", () => {
    const { container } = render(
      <Markdown
        text={
          '<img src=x onerror="alert(1)"> [ok](https://ibge.gov.br) [ruim](javascript:alert(1)) veja /ingestao/01a12a6f-653a-7687-9cdf-bf3584cb8a9d'
        }
      />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<img");
    const ext = screen.getByRole("link", { name: "ok" });
    expect(ext).toHaveAttribute("href", "https://ibge.gov.br");
    expect(ext).toHaveAttribute("target", "_blank");
    expect(ext).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.queryByRole("link", { name: "ruim" })).toBeNull();
    expect(screen.getByRole("link", { name: /ingestao\/01a12a6f/ })).toHaveAttribute(
      "href",
      "/ingestao/01a12a6f-653a-7687-9cdf-bf3584cb8a9d",
    );
  });
});

describe("R5 · citações no texto do recrutador", () => {
  const citations = [
    {
      kind: "f" as const,
      ref: "a1b2c3",
      valid: true,
      label: "Acme Pagamentos · Engenheira",
      detail: "Experiência · 2023-02–atual",
      url: null,
    },
    {
      kind: "v" as const,
      ref: "00ff11",
      valid: true,
      label: "Initech · Backend",
      detail: "Vaga salva",
      url: "/vagas/0190-00ff11",
    },
    {
      kind: "r" as const,
      ref: "abcdef",
      valid: true,
      label: "Salários",
      detail: "Pesquisa · glassdoor.com.br",
      url: "https://www.glassdoor.com.br/s",
    },
    { kind: "f" as const, ref: "000000", valid: false, label: null, detail: null, url: null },
  ];

  it("troca a citação por um número; o balão mostra o fato, a vaga ou a fonte", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <Markdown
        text="Na Acme [f:a1b2c3] e na vaga [v:00ff11]. Média R$ 14 mil [r:abcdef]. De novo [f:a1b2c3]."
        citations={citations}
      />,
    );
    expect(container.textContent).not.toContain("[f:");
    const marks = screen.getAllByRole("button", { name: /^Fonte \d/ });
    expect(marks.map((b) => b.textContent)).toEqual(["1", "2", "3", "1"]);
    await user.click(marks[0] as HTMLElement);
    expect(screen.getByRole("dialog")).toHaveTextContent("Acme Pagamentos · Engenheira");
    expect(screen.getByRole("dialog")).toHaveTextContent("Experiência · 2023-02–atual");
    await user.click(marks[1] as HTMLElement);
    expect(screen.getByRole("link", { name: /Initech/ })).toHaveAttribute(
      "href",
      "/vagas/0190-00ff11",
    );
    await user.click(marks[2] as HTMLElement);
    const ext = screen.getByRole("link", { name: /Salários/ });
    expect(ext).toHaveAttribute("href", "https://www.glassdoor.com.br/s");
    expect(ext).toHaveAttribute("target", "_blank");
  });

  it("citação que não confere fica marcada; sem a conferência (resposta chegando), só o número", () => {
    const { rerender } = render(<Markdown text="Algo [f:000000]." citations={citations} />);
    expect(screen.getByRole("button", { name: "Fonte não encontrada" })).toHaveTextContent("?");
    rerender(<Markdown text="Algo [f:a1b2c3]." />);
    expect(screen.getByRole("button", { name: /^Fonte 1/ })).toHaveTextContent("1");
  });

  it("lista as frases sem citação embaixo da resposta", async () => {
    const user = userEvent.setup();
    render(<Markdown text="Espere uns R$ 20 mil." uncited={["Espere uns R$ 20 mil."]} />);
    await user.click(screen.getByRole("button", { name: "1 frase sem fonte" }));
    expect(screen.getByRole("list", { name: "Frases sem fonte" })).toHaveTextContent(
      "Espere uns R$ 20 mil.",
    );
  });
});
