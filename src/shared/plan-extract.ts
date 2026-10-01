import { PLAN_FORMAT } from "./formats";

/**
 * Busca un plan@1 en un texto pegado: JSON puro, un bloque ```json o el JSON en medio de
 * otro texto. Devuelve el primer objeto con "format": "menu-familiar/plan@1", o null.
 */
export function extractPlan(text: string): unknown {
  const candidates: string[] = [];
  for (const match of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) if (match[1]) candidates.push(match[1]);
  candidates.push(text);

  for (const candidate of candidates) {
    const found = findPlanObject(candidate);
    if (found) return found;
  }
  return null;
}

function isPlan(value: unknown): boolean {
  return typeof value === "object" && value !== null && (value as { format?: unknown }).format === PLAN_FORMAT;
}

/** Prueba a parsear cada objeto {…} equilibrado del texto, de fuera adentro. */
function findPlanObject(text: string): unknown {
  try {
    const whole: unknown = JSON.parse(text.trim());
    if (isPlan(whole)) return whole;
  } catch {
    // No es JSON puro: se buscan objetos dentro.
  }
  for (let start = text.indexOf("{"); start !== -1; start = text.indexOf("{", start + 1)) {
    const end = matchingBrace(text, start);
    if (end === -1) continue;
    try {
      const value: unknown = JSON.parse(text.slice(start, end + 1));
      if (isPlan(value)) return value;
    } catch {
      // Sigue buscando.
    }
  }
  return null;
}

/** Índice de la llave que cierra la que abre en `start`, respetando cadenas JSON. */
function matchingBrace(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return i;
  }
  return -1;
}
