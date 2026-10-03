/**
 * Sesión de Cloudflare Access caducada frente a falta de red.
 *
 * Con la sesión caducada, Access no deja llegar la petición al Worker: responde con una
 * redirección a su página de login (*.cloudflareaccess.com). El cliente pide con
 * redirect: "manual", así que la ve como una respuesta "opaqueredirect" (estado 0) en vez
 * de seguirla, y entonces es «sesión caducada», no «sin conexión». Un 401 del propio
 * Worker (JWT ausente o no válido) significa lo mismo.
 */

export class SessionExpiredError extends Error {
  constructor() {
    super("La sesión ha caducado");
  }
}

export interface ResponseLike {
  type: string;
  status: number;
  url?: string;
  redirected?: boolean;
}

export function isSessionExpired(res: ResponseLike): boolean {
  if (res.type === "opaqueredirect") return true;
  if (res.status === 401) return true;
  // Por si el navegador siguió la redirección pese a redirect: "manual".
  if (res.redirected && res.url && /\.cloudflareaccess\.com\//.test(res.url)) return true;
  return false;
}

export type FailureKind = "session" | "offline" | "error";

/** Qué significa un fallo de petición: sesión caducada, sin red, o un error del servidor. */
export function failureKind(err: unknown, isHttpError: (err: unknown) => boolean): FailureKind {
  if (err instanceof SessionExpiredError) return "session";
  if (isHttpError(err)) return "error";
  return "offline";
}

export interface ConnectionState {
  /** La última petición falló por red. */
  networkFailed: boolean;
  /** La última petición chocó con el login de Access. */
  sessionExpired: boolean;
}

export const CONNECTED: ConnectionState = { networkFailed: false, sessionExpired: false };

/** Estado tras un fallo: la sesión caducada no cuenta como falta de red. Un error HTTP normal no cambia nada. */
export function afterFailure(state: ConnectionState, err: unknown, isHttpError: (err: unknown) => boolean): ConnectionState {
  const kind = failureKind(err, isHttpError);
  if (kind === "session") return { networkFailed: false, sessionExpired: true };
  if (kind === "offline") return { networkFailed: true, sessionExpired: false };
  return state;
}
