import { render, screen } from "@testing-library/react";
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
