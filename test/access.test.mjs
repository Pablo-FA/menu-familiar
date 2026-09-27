// Pruebas de la validación del JWT de Access (src/worker/access.ts).
// Se ejecutan con el test runner de Node, que carga el .ts quitando los tipos.
import assert from "node:assert/strict";
import { before, test } from "node:test";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { isLocalBypass, normalizeTeamDomain, verifyAccess } from "../src/worker/access.ts";

const TEAM = "https://equipo.cloudflareaccess.com";
const AUD = "aud-de-prueba";
const CONFIG = { teamDomain: "equipo.cloudflareaccess.com/", aud: AUD };

let privateKey;
let foreignKey;

before(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  foreignKey = (await generateKeyPair("RS256")).privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256" };
  // Sustituye la descarga de certificados del equipo de Access.
  globalThis.fetch = async (url) => {
    assert.equal(String(url), `${TEAM}/cdn-cgi/access/certs`);
    return Response.json({ keys: [jwk] });
  };
});

function sign(key, { iss = TEAM, aud = AUD, exp = "1h" } = {}) {
  return new SignJWT({ email: "yo@example.com" })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(iss)
    .setAudience(aud)
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(key);
}

function request(headers = {}, url = "https://menu-familiar.ejemplo.workers.dev/api/health") {
  return new Request(url, { headers });
}

async function statusFor(token) {
  const result = await verifyAccess(request({ "Cf-Access-Jwt-Assertion": token }), CONFIG);
  return result.ok ? 200 : result.status;
}

test("acepta un token válido en la cabecera y devuelve el email", async () => {
  const result = await verifyAccess(request({ "Cf-Access-Jwt-Assertion": await sign(privateKey) }), CONFIG);
  assert.deepEqual(result, { ok: true, email: "yo@example.com" });
});

test("acepta un token válido en la cookie CF_Authorization", async () => {
  const cookie = `otra=1; CF_Authorization=${await sign(privateKey)}`;
  const result = await verifyAccess(request({ Cookie: cookie }), CONFIG);
  assert.deepEqual(result, { ok: true, email: "yo@example.com" });
});

test("401 si falta el token", async () => {
  const result = await verifyAccess(request(), CONFIG);
  assert.equal(result.ok ? 200 : result.status, 401);
});

test("401 si el token no es válido", async () => {
  assert.equal(await statusFor("no-es-un-jwt"), 401);
  assert.equal(await statusFor(await sign(foreignKey)), 401, "firmado con otra clave");
  assert.equal(await statusFor(await sign(privateKey, { aud: "otra-app" })), 401, "otro AUD");
  assert.equal(await statusFor(await sign(privateKey, { iss: "https://otro.cloudflareaccess.com" })), 401, "otro emisor");
  assert.equal(await statusFor(await sign(privateKey, { exp: "-1m" })), 401, "caducado");
});

test("500 (falla cerrado) si falta la configuración", async () => {
  const token = await sign(privateKey);
  const result = await verifyAccess(request({ "Cf-Access-Jwt-Assertion": token }), { teamDomain: undefined, aud: AUD });
  assert.equal(result.ok ? 200 : result.status, 500);
});

test("el bypass local solo funciona con la variable y en localhost", () => {
  assert.equal(isLocalBypass(request({}, "http://localhost:5173/api/health"), "true"), true);
  assert.equal(isLocalBypass(request({}, "http://127.0.0.1:5173/api/health"), "true"), true);
  assert.equal(isLocalBypass(request({}, "http://localhost:5173/api/health"), undefined), false);
  assert.equal(isLocalBypass(request(), "true"), false, "nunca en workers.dev");
});

test("normaliza el team domain", () => {
  assert.equal(normalizeTeamDomain("equipo.cloudflareaccess.com"), TEAM);
  assert.equal(normalizeTeamDomain(" https://equipo.cloudflareaccess.com/ "), TEAM);
});
