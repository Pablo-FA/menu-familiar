import { useCallback, useEffect, useState } from "react";
import type { HealthResponse } from "../shared/health";
import { ImportTool } from "./ImportTool";

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "done"; health: HealthResponse };

async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch("/api/health", { credentials: "same-origin" });
  // 503 también trae el cuerpo con el detalle de cada pieza.
  if (res.status !== 200 && res.status !== 503) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(`HTTP ${res.status}${body?.error ? `: ${body.error}` : ""}`);
  }
  return (await res.json()) as HealthResponse;
}

function Check({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <li>
      <span className={ok ? "ok" : "fail"}>{ok ? "✓" : "✗"}</span> <strong>{label}</strong>{" "}
      <small>{detail}</small>
    </li>
  );
}

export function App() {
  const [state, setState] = useState<State>({ status: "loading" });

  const refresh = useCallback(() => {
    fetchHealth()
      .then((health) => setState({ status: "done", health }))
      .catch((err: unknown) =>
        setState({ status: "error", message: err instanceof Error ? err.message : String(err) }),
      );
  }, []);

  useEffect(refresh, [refresh]);

  return (
    <main>
      <h1>Menú familiar</h1>
      {state.status === "loading" && <p>Comprobando…</p>}
      {state.status === "error" && (
        <p>
          <span className="fail">✗</span> No se pudo consultar /api/health: {state.message}
        </p>
      )}
      {state.status === "done" && (
        <ul>
          <Check label="D1" ok={state.health.d1.ok} detail={state.health.d1.detail} />
          <li>
            <strong>Recetas:</strong> {state.health.d1.recipeCount ?? "?"}
          </li>
          <Check label="R2" ok={state.health.r2.ok} detail={state.health.r2.detail} />
          <li>
            <strong>Usuario:</strong>{" "}
            {state.health.access.mode === "disabled-local"
              ? "(Access desactivado en local)"
              : (state.health.access.email ?? "(sin email en el token)")}
          </li>
        </ul>
      )}
      {state.status === "done" && <ImportTool onImported={refresh} />}
    </main>
  );
}
