import { createHash } from "node:crypto";
import { PERSONA_DEFAULTS, type Persona } from "@narnia-jobs/shared";
import type { Repos } from "../db";
import { getCard } from "../profile/cards";
import { buildPersona } from "../profile/persona";
import { factIndexText } from "./fact-index";

/**
 * Contexto do recrutador geral (F06-8): ele atende o usuário inteiro, não um perfil. O prompt leva os cartões de todos
 * os perfis não arquivados (com o id, para chamar o recrutador especializado de um deles) e o ativo marcado; a
 * persona (idioma, mercado, tom) vem do perfil ativo, ou do primeiro, ou dos padrões quando ainda não há perfil.
 * O hash junta os hashes dos cartões: muda quando qualquer perfil muda, entra ou sai.
 */
export interface RecruiterContext {
  persona: Persona;
  text: string;
  hash: string;
  profileIds: string[];
}

const NO_PROFILE_TEXT =
  "Nenhum perfil cadastrado ainda: o usuário não concluiu o primeiro uso. Não invente dados; oriente a concluir o primeiro uso.";

export function recruiterContext(repos: Repos): RecruiterContext {
  const profiles = repos.profiles.list();
  const active = repos.profiles.active();
  const base = active ?? profiles[0] ?? null;
  const persona: Persona = base
    ? buildPersona(base)
    : {
        specialty: "carreira",
        targetLevel: "senior",
        market: "BR",
        language: "pt-BR",
        ...PERSONA_DEFAULTS,
      };
  if (profiles.length === 0) {
    return { persona, text: NO_PROFILE_TEXT, hash: hashOf([NO_PROFILE_TEXT]), profileIds: [] };
  }
  const parts: string[] = [];
  const hashes: string[] = [];
  for (const p of profiles) {
    const card = getCard(repos, p.id);
    const mark = p.id === active?.id ? " · perfil ativo" : "";
    parts.push(`### ${p.name} · id ${p.id}${mark}\n${card.text}`);
    hashes.push(`${p.id}:${card.hash}${mark}`);
  }
  // R2 (F04-fix-fundamentacao): todos os fatos numa linha cada, além dos cartões; o hash muda quando um fato muda
  const index = factIndexText(repos);
  parts.push(index);
  hashes.push(hashOf([index]));
  return {
    persona,
    text: parts.join("\n\n"),
    hash: hashOf(hashes),
    profileIds: profiles.map((p) => p.id),
  };
}

function hashOf(parts: string[]): string {
  return createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 16);
}
