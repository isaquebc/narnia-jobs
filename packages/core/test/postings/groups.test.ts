import type { Posting } from "@narnia-jobs/shared";
import { describe, expect, it } from "vitest";
import { descriptionKey, groupPostings } from "../../src/postings/groups";

/** Pedido do dono 2026-11-12: vagas iguais (mesma empresa e cargo, links diferentes) num card só. */
const p = (id: string, o: Partial<Posting> = {}) =>
  ({
    id,
    company: "Acme",
    title: "Senior Software Engineer",
    jdText: null,
    groupSplit: false,
    ...o,
  }) as Posting;

describe("vagas iguais em grupo", () => {
  it("mesma empresa e cargo, sem descrição: um grupo, com a primeira da lista na frente", () => {
    const g = groupPostings([
      p("a"),
      p("b", { company: "ACME Ltda." }),
      p("c", { title: "Senior Software Engineer (Remote)" }),
      p("x", { company: "Globex" }),
    ]);
    expect(g.get("a")).toBe("a");
    expect(g.get("b")).toBe("a");
    expect(g.get("x")).toBeUndefined();
  });

  it("descrição igual com outra formatação junta; descrição diferente nas duas separa (mesmo com uma sem descrição no meio)", () => {
    expect(descriptionKey("Requisitos:\n- Java, Spring")).toBe(
      descriptionKey("requisitos java spring"),
    );
    const g = groupPostings([
      p("a", { jdText: "Requisitos:\n- Java e Spring" }),
      p("b", { jdText: "REQUISITOS — Java e Spring." }),
      p("c"),
      p("d", { jdText: "Requisitos: Python e Django" }),
    ]);
    expect(g.get("b")).toBe("a");
    expect(g.get("c")).toBe("a");
    expect(g.get("d")).toBeUndefined();
  });

  it("vaga separada pela pessoa, empresa genérica ou sem empresa nunca entram", () => {
    const g = groupPostings([
      p("a"),
      p("b", { groupSplit: true }),
      p("c", { company: "Confidencial" }),
      p("d", { company: "Confidencial" }),
      p("e", { company: null }),
      p("f", { company: null }),
    ]);
    expect(g.size).toBe(0);
  });
});
