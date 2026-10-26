/**
 * F12-23: suposição do roleplay → frase de motivação em primeira pessoa (api e janela).
 */
/** Verbo da suposição ("você quer") → primeira pessoa ("quero"). */
const FIRST_PERSON: Record<string, string> = {
  quer: "quero",
  gosta: "gosto",
  prefere: "prefiro",
  valoriza: "valorizo",
  busca: "busco",
  procura: "procuro",
  tem: "tenho",
  pensa: "penso",
  sente: "sinto",
  curte: "curto",
  acredita: "acredito",
  está: "estou",
  é: "sou",
  "se interessa": "me interesso",
  "se identifica": "me identifico",
  "se importa": "me importo",
  "se vê": "me vejo",
};

/**
 * Suposição do roleplay (fala com a pessoa: "Que você quer trabalhar com saúde.") como frase de motivação em primeira
 * pessoa ("Quero trabalhar com saúde."), para guardar no perfil quando ela aceita (F12-23). Sem verbo conhecido, troca só
 * os possessivos; a pessoa pode editar a frase depois.
 */
export function assumptionAsMotivation(assumption: string): string {
  let t = assumption.trim().replace(/^que\s+/i, "");
  const you = /^você\s+/i.exec(t);
  if (you) {
    t = t.slice(you[0].length);
    const verb = Object.keys(FIRST_PERSON)
      .sort((a, b) => b.length - a.length)
      .find((v) => t.toLowerCase().startsWith(`${v} `));
    if (verb) t = `${FIRST_PERSON[verb]}${t.slice(verb.length)}`;
  }
  t = t
    .replace(/\bsua\b/g, "minha")
    .replace(/\bseu\b/g, "meu")
    .replace(/\bsuas\b/g, "minhas")
    .replace(/\bseus\b/g, "meus")
    .replace(/\bte\b/g, "me");
  if (!/[.!?]$/.test(t)) t += ".";
  return t.charAt(0).toUpperCase() + t.slice(1);
}
