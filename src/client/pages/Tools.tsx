import { useCallback, useEffect, useState } from "react";
import type { ApiError, ImportResponse, PlanImportResponse } from "../../shared/api";
import type { HealthResponse } from "../../shared/health";
import { PLAN_FORMAT, RECIPE_FORMAT } from "../../shared/formats";
import { ApiRequestError, api } from "../api";
import styles from "./Tools.module.css";

/**
 * Página técnica provisional (/importar): estado de las piezas e importador de
 * JSON. Detecta el formato por el campo "format" (recipe@1 o plan@1).
 */
export function Tools() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    fetch("/api/health", { credentials: "same-origin" })
      .then(async (res) => {
        if (res.status !== 200 && res.status !== 503) throw new Error(`HTTP ${res.status}`);
        setHealth((await res.json()) as HealthResponse);
      })
      .catch((err: unknown) => setHealthError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(refresh, [refresh]);

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>Importar</h1>
      <ImportCard onImported={refresh} />
      <section className={`${styles.card} glass`} aria-labelledby="status-title">
        <h2 id="status-title">Estado</h2>
        {healthError && <p className={styles.fail}>✗ No se pudo consultar /api/health: {healthError}</p>}
        {health && (
          <ul className={styles.status}>
            <Check ok={health.d1.ok} label="D1" detail={health.d1.detail} />
            <li>
              <strong>Recetas:</strong> {health.d1.recipeCount ?? "?"}
            </li>
            <Check ok={health.r2.ok} label="R2" detail={health.r2.detail} />
            <li>
              <strong>Usuario:</strong>{" "}
              {health.access.mode === "disabled-local" ? "(Access desactivado en local)" : (health.access.email ?? "(sin email)")}
            </li>
          </ul>
        )}
      </section>
    </main>
  );
}

function Check({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <li>
      <span className={ok ? styles.ok : styles.fail}>{ok ? "✓" : "✗"}</span> <strong>{label}</strong>{" "}
      <span className={styles.detail}>{detail}</span>
    </li>
  );
}

type Result =
  | { kind: "recipe"; body: ImportResponse }
  | { kind: "plan"; body: PlanImportResponse }
  | { kind: "error"; message: string; errors?: ApiError["errors"] };

function ImportCard({ onImported }: { onImported: () => void }) {
  const [text, setText] = useState("");
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  let format: string | null = null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object" && "format" in parsed) format = String(parsed.format);
  } catch {
    // Aún no es JSON válido: se avisa al pulsar Importar.
  }

  async function submit() {
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch (err) {
      setResult({ kind: "error", message: `El texto no es JSON válido: ${err instanceof Error ? err.message : String(err)}` });
      return;
    }
    setBusy(true);
    try {
      if (format === PLAN_FORMAT) {
        setResult({ kind: "plan", body: await api.post<PlanImportResponse>("/plan/import", body) });
      } else if (format === RECIPE_FORMAT) {
        const query = replace ? "?replace=true" : "";
        setResult({ kind: "recipe", body: await api.post<ImportResponse>(`/recipes/import${query}`, body) });
      } else {
        setResult({ kind: "error", message: `Formato desconocido. Debe ser "${RECIPE_FORMAT}" o "${PLAN_FORMAT}".` });
        return;
      }
      onImported();
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setResult({ kind: "error", message: `${err.body.error} (HTTP ${err.status})`, errors: err.body.errors });
      } else {
        setResult({ kind: "error", message: err instanceof Error ? err.message : String(err) });
      }
    } finally {
      setBusy(false);
    }
  }

  const detected =
    format === PLAN_FORMAT ? "Menú (plan@1)" : format === RECIPE_FORMAT ? "Receta (recipe@1)" : text.trim() ? "Formato no reconocido" : "";

  return (
    <section className={`${styles.card} glass`} aria-labelledby="import-title">
      <h2 id="import-title">Pegar receta o menú</h2>
      <label className="visually-hidden" htmlFor="import-json">
        JSON a importar
      </label>
      <textarea
        id="import-json"
        className={styles.textarea}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder='{"format": "menu-familiar/plan@1", …}'
        rows={8}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
      />
      <p className={styles.hint} aria-live="polite">
        {detected || "Pega el JSON que te ha dado Claude."}
      </p>
      <div className={styles.row}>
        {format === RECIPE_FORMAT ? (
          <label className={styles.check}>
            <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
            Reemplazar si ya existe
          </label>
        ) : (
          <span />
        )}
        <button type="button" className="pill-button pill-button--primary" onClick={submit} disabled={busy || !text.trim()}>
          {busy ? "Importando…" : "Importar"}
        </button>
      </div>
      <div className={styles.result} aria-live="polite">
        {result?.kind === "recipe" && (
          <p>
            <span className={styles.ok}>✓</span> {result.body.replaced ? "Reemplazada" : "Importada"}: {result.body.id}. Ingredientes
            nuevos: {result.body.created_ingredients.join(", ") || "ninguno"}.
          </p>
        )}
        {result?.kind === "plan" && (
          <p>
            <span className={styles.ok}>✓</span> Menú importado: {result.body.meals} comidas. Recetas nuevas:{" "}
            {result.body.created_recipes.join(", ") || "ninguna"}.
            {result.body.existing_recipes.length > 0 && <> Ya existían (sin cambios): {result.body.existing_recipes.join(", ")}.</>}
          </p>
        )}
        {result?.kind === "error" && (
          <>
            <p>
              <span className={styles.fail}>✗</span> {result.message}
            </p>
            {result.errors && (
              <ul>
                {result.errors.map((e, i) => (
                  <li key={i}>
                    <code>{e.field || "(raíz)"}</code>: {e.message}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </section>
  );
}
