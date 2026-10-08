import { normalizeFreeText } from "./free-text";

/** Remove a marcação e mantém o conteúdo (títulos viram linhas, listas viram linhas com "- "). */
export function extractMarkdownText(markdown: string): { text: string } {
  let t = markdown.replace(/\r\n/g, "\n");
  t = t.replace(/```[\s\S]*?```/g, (block) => block.replace(/```[^\n]*\n?/g, ""));
  t = t.replace(/`([^`]+)`/g, "$1");
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, "");
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  t = t.replace(/^\s{0,3}#{1,6}\s+/gm, "");
  t = t.replace(/^\s{0,3}>\s?/gm, "");
  t = t.replace(/(\*\*|__)(.*?)\1/g, "$2");
  t = t.replace(/(^|[^*\w])(\*|_)([^*_\n]+)\2(?=[^*\w]|$)/g, "$1$3");
  t = t.replace(/^\s*[-*+]\s+/gm, "- ");
  t = t.replace(/^\s*(\d+)\.\s+/gm, "$1. ");
  t = t.replace(/^\s*([-*_])\s*(\1\s*){2,}$/gm, "");
  return { text: normalizeFreeText(t) };
}
