import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

/**
 * Validación del JWT de Cloudflare Access.
 *
 * Access ya bloquea en el borde a quien no esté autorizado, pero el Worker
 * vuelve a comprobar el token en cada petición a /api para no depender solo
 * de la configuración del panel.
 * Referencia: https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/
 */

export interface AccessConfig {
  teamDomain: string | undefined;
  aud: string | undefined;
}

export type AccessResult =
  | { ok: true; email: string | null }
  | { ok: false; status: 401 | 500; error: string };

const JWT_HEADER = "Cf-Access-Jwt-Assertion";
const JWT_COOKIE = "CF_Authorization";

// Un JWKS remoto por team domain; jose cachea las claves y las refresca solo.
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

/** Acepta "equipo.cloudflareaccess.com" o "https://equipo.cloudflareaccess.com/". */
export function normalizeTeamDomain(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  return trimmed.startsWith("https://") ? trimmed : `https://${trimmed}`;
}

function getJwks(issuer: string) {
  let jwks = jwksCache.get(issuer);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
    jwksCache.set(issuer, jwks);
  }
  return jwks;
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=") || null;
  }
  return null;
}

/**
 * Access envía el token en la cabecera Cf-Access-Jwt-Assertion. Como respaldo
 * se acepta la cookie CF_Authorization, que contiene el mismo JWT firmado; en
 * ambos casos se verifica firma, emisor, audiencia y caducidad.
 */
function extractToken(request: Request): string | null {
  return request.headers.get(JWT_HEADER) ?? readCookie(request.headers.get("Cookie"), JWT_COOKIE);
}

export async function verifyAccess(request: Request, config: AccessConfig): Promise<AccessResult> {
  if (!config.teamDomain || !config.aud) {
    // Fallar cerrado: sin configuración no se deja pasar a nadie.
    return { ok: false, status: 500, error: "Access no está configurado (faltan ACCESS_TEAM_DOMAIN o ACCESS_AUD)" };
  }

  const token = extractToken(request);
  if (!token) {
    return { ok: false, status: 401, error: "Falta el token de Cloudflare Access" };
  }

  const issuer = normalizeTeamDomain(config.teamDomain);
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, getJwks(issuer), {
      issuer,
      audience: config.aud,
      algorithms: ["RS256"],
    }));
  } catch {
    return { ok: false, status: 401, error: "Token de Cloudflare Access no válido" };
  }

  const email = typeof payload.email === "string" ? payload.email : null;
  return { ok: true, email };
}

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * La validación solo se puede desactivar en local: hace falta la variable
 * DEV_DISABLE_ACCESS=true (en .dev.vars, que no se despliega) Y que la
 * petición llegue a localhost. En workers.dev el hostname nunca es local,
 * así que aunque alguien definiera la variable en producción no tendría efecto.
 */
export function isLocalBypass(request: Request, flag: string | undefined): boolean {
  if (flag !== "true") return false;
  return LOCAL_HOSTNAMES.has(new URL(request.url).hostname);
}
