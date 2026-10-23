import { describe, expect, it } from "vitest";
import { mergeFrames } from "../src/capture/frames";

/** F12/M3 · formulário em quadros: campos de todos os quadros lidos, e as origens que ficaram sem leitura. */
const field = (ref: string, label: string) => ({
  ref,
  control: "text" as const,
  label,
  name: null,
  placeholder: null,
  help: null,
  section: null,
  required: false,
  maxLength: null,
  options: [],
  autocomplete: null,
});

describe("F12/M3 · mergeFrames", () => {
  it("junta na ordem, renumera e tira das pendentes as origens que foram lidas", () => {
    const r = mergeFrames([
      {
        origin: "https://acme.example",
        fields: [field("f1", "Nome")],
        frames: ["https://boards.greenhouse.io", "https://ads.example"],
      },
      {
        origin: "https://boards.greenhouse.io",
        fields: [field("f1", "E-mail"), field("f2", "CV")],
        frames: [],
      },
    ]);
    expect(r.fields.map((f) => [f.ref, f.label])).toEqual([
      ["f1", "Nome"],
      ["f2", "E-mail"],
      ["f3", "CV"],
    ]);
    expect(r.frames).toEqual(["https://ads.example"]);
  });
});
