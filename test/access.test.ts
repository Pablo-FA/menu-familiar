// Pruebas de la validación del JWT de Access (src/worker/access.ts).
import { SignJWT, exportJWK, generateKeyPair, type CryptoKey } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isLocalBypass, normalizeTeamDomain, verifyAccess } from "../src/worker/access";

const TEAM = "https://equipo.cloudflareaccess.com";
const AUD = "aud-de-prueba";
const CONFIG = { teamDomain: "equipo.cloudflareaccess.com/", aud: AUD };

let privateKey: CryptoKey;
let foreignKey: CryptoKey;
const realFetch = globalThis.fetch;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  foreignKey = (await generateKeyPair("RS256")).privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256" };
  // Sustituye la descarga de certificados del equipo de Access.
  globalThis.fetch = async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url !== `${TEAM}/cdn-cgi/access/certs`) throw new Error(`fetch inesperado: ${url}`);
    return Response.json({ keys: [jwk] });
  };
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

function sign(key: CryptoKey, { iss = TEAM, aud = AUD, exp = "1h" } = {}) {
  return new SignJWT({ email: "yo@example.com" })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(iss)
    .setAudience(aud)
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(key);
}

function request(headers: Record<string, string> = {}, url = "https://menu-familiar.ejemplo.workers.dev/api/health") {
  return new Request(url, { headers });
}

async function statusFor(token: string) {
  const result = await verifyAccess(request({ "Cf-Access-Jwt-Assertion": token }), CONFIG);
  return result.ok ? 200 : result.status;
}

describe("verifyAccess", () => {
  it("acepta un token válido en la cabecera y devuelve el email", async () => {
    const result = await verifyAccess(request({ "Cf-Access-Jwt-Assertion": await sign(privateKey) }), CONFIG);
    expect(result).toEqual({ ok: true, email: "yo@example.com" });
  });

  it("acepta un token válido en la cookie CF_Authorization", async () => {
    const cookie = `otra=1; CF_Authorization=${await sign(privateKey)}`;
    expect(await verifyAccess(request({ Cookie: cookie }), CONFIG)).toEqual({ ok: true, email: "yo@example.com" });
  });

  it("401 si falta el token", async () => {
    const result = await verifyAccess(request(), CONFIG);
    expect(result.ok ? 200 : result.status).toBe(401);
  });

  it("401 si el token no es válido", async () => {
    expect(await statusFor("no-es-un-jwt")).toBe(401);
    expect(await statusFor(await sign(foreignKey))).toBe(401); // firmado con otra clave
    expect(await statusFor(await sign(privateKey, { aud: "otra-app" }))).toBe(401);
    expect(await statusFor(await sign(privateKey, { iss: "https://otro.cloudflareaccess.com" }))).toBe(401);
    expect(await statusFor(await sign(privateKey, { exp: "-1m" }))).toBe(401); // caducado
  });

  it("500 (falla cerrado) si falta la configuración", async () => {
    const token = await sign(privateKey);
    const result = await verifyAccess(request({ "Cf-Access-Jwt-Assertion": token }), { teamDomain: undefined, aud: AUD });
    expect(result.ok ? 200 : result.status).toBe(500);
  });
});

describe("isLocalBypass", () => {
  it("solo funciona con la variable y en localhost", () => {
    expect(isLocalBypass(request({}, "http://localhost:5173/api/health"), "true")).toBe(true);
    expect(isLocalBypass(request({}, "http://127.0.0.1:5173/api/health"), "true")).toBe(true);
    expect(isLocalBypass(request({}, "http://localhost:5173/api/health"), undefined)).toBe(false);
    expect(isLocalBypass(request(), "true")).toBe(false); // nunca en workers.dev
  });
});

describe("normalizeTeamDomain", () => {
  it("acepta el dominio con o sin https y barra final", () => {
    expect(normalizeTeamDomain("equipo.cloudflareaccess.com")).toBe(TEAM);
    expect(normalizeTeamDomain(" https://equipo.cloudflareaccess.com/ ")).toBe(TEAM);
  });
});
