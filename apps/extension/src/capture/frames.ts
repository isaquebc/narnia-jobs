import type { FormField, FormSnapshot } from "./form";

/** O que o leitor devolve em cada quadro da aba (o de cima e os que a extensão pode ler). */
export interface FrameForm extends FormSnapshot {
  origin: string;
}

/**
 * Junta os campos de todos os quadros lidos (o de cima primeiro), renumerando as referências, e deixa em `frames` só as
 * origens que nenhum quadro conseguiu ler (falta permissão).
 */
export function mergeFrames(frames: FrameForm[]): FormSnapshot {
  const read = new Set(frames.map((f) => f.origin));
  const fields: FormField[] = frames
    .flatMap((f) => f.fields)
    .map((f, i) => ({ ...f, ref: `f${i + 1}` }));
  const blocked = [...new Set(frames.flatMap((f) => f.frames))].filter((o) => !read.has(o));
  return { fields, frames: blocked };
}
