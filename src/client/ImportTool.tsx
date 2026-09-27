import { useState } from "react";
import type { ApiError, ImportResponse } from "../shared/api";

type Result =
  | { kind: "ok"; body: ImportResponse }
  | { kind: "error"; status: number; body: ApiError }
  | { kind: "invalid-json"; message: string };

/**
 * Herramienta técnica temporal: pegar un JSON recipe@1 y enviarlo a
 * POST /api/recipes/import. Usa la sesión de Access del navegador.
 * Se sustituirá por la interfaz definitiva.
 */
export function ImportTool({ onImported }: { onImported: () => void }) {
  const [text, setText] = useState("");
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  async function submit() {
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch (err) {
      setResult({ kind: "invalid-json", message: err instanceof Error ? err.message : String(err) });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/recipes/import${replace ? "?replace=true" : ""}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(body),
      });
      const json: unknown = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      if (res.ok) {
        setResult({ kind: "ok", body: json as ImportResponse });
        onImported();
      } else {
        setResult({ kind: "error", status: res.status, body: json as ApiError });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2>Importar receta (herramienta técnica)</h2>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder='{"format": "menu-familiar/recipe@1", ...}'
        rows={10}
        spellCheck={false}
      />
      <label>
        <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} /> Reemplazar si ya
        existe
      </label>
      <button type="button" onClick={submit} disabled={busy || text.trim() === ""}>
        {busy ? "Importando…" : "Importar"}
      </button>
      {result?.kind === "ok" && (
        <p>
          <span className="ok">✓</span> {result.body.replaced ? "Reemplazada" : "Importada"}: {result.body.id}.
          Ingredientes nuevos en el catálogo: {result.body.created_ingredients.join(", ") || "ninguno"}.
        </p>
      )}
      {result?.kind === "invalid-json" && (
        <p>
          <span className="fail">✗</span> El texto no es JSON válido: {result.message}
        </p>
      )}
      {result?.kind === "error" && (
        <div>
          <p>
            <span className="fail">✗</span> {result.body.error} (HTTP {result.status})
          </p>
          {result.body.errors && (
            <ul>
              {result.body.errors.map((e, i) => (
                <li key={i}>
                  <code>{e.field || "(raíz)"}</code>: {e.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
