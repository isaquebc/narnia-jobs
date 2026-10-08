import { v7 as uuidv7 } from "uuid";

/** Identificadores UUID v7, ordenáveis por tempo (decisão F01-19). */
export function newId(): string {
  return uuidv7();
}
