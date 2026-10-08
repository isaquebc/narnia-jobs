export type DetectedLanguage = "pt" | "en" | "unknown";

const PT = new Set([
  "de",
  "da",
  "do",
  "das",
  "dos",
  "e",
  "em",
  "com",
  "para",
  "uma",
  "um",
  "não",
  "que",
  "na",
  "no",
  "como",
  "os",
  "as",
  "trabalhei",
  "experiência",
  "formação",
  "liderei",
  "pela",
  "pelo",
  "são",
  "mais",
]);
const EN = new Set([
  "the",
  "and",
  "of",
  "to",
  "in",
  "with",
  "for",
  "an",
  "is",
  "was",
  "led",
  "worked",
  "experience",
  "education",
  "skills",
  "at",
  "on",
  "by",
  "from",
  "that",
]);

/** Detecção simples por stopwords (suficiente para escolher prompts/formatos; o modelo refina depois). */
export function detectLanguage(text: string): DetectedLanguage {
  const words = text.toLowerCase().match(/[a-zà-ú]+/g) ?? [];
  let pt = 0;
  let en = 0;
  for (const w of words) {
    if (PT.has(w)) pt++;
    if (EN.has(w)) en++;
  }
  if (pt === 0 && en === 0) return "unknown";
  if (pt === en) return "unknown";
  return pt > en ? "pt" : "en";
}
