import type { ApiError } from "../shared/api";
import { isSessionExpired, SessionExpiredError } from "../shared/session";

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiError,
  ) {
    super(body.error);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  // redirect: "manual": la redirección al login de Access no se sigue (sería un error de
  // CORS indistinguible de no tener red); se reconoce y se lanza SessionExpiredError.
  const init: RequestInit = { method, credentials: "same-origin", redirect: "manual" };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`/api${path}`, init);
  if (isSessionExpired(res)) throw new SessionExpiredError();
  if (res.status === 204) return undefined as T;
  const json: unknown = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw new ApiRequestError(res.status, json as ApiError);
  return json as T;
}

export const api = {
  get: <T,>(path: string) => request<T>("GET", path),
  post: <T,>(path: string, body: unknown) => request<T>("POST", path, body),
  put: <T,>(path: string, body: unknown) => request<T>("PUT", path, body),
  patch: <T,>(path: string, body: unknown) => request<T>("PATCH", path, body),
  delete: <T,>(path: string) => request<T>("DELETE", path),
};
