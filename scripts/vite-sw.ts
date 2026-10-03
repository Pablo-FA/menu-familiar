import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

/**
 * Genera /sw.js en el build del cliente a partir de src/sw/sw.js, con la versión del
 * build (hash de index.html y los assets) y la lista de assets a guardar al instalar.
 * Una versión nueva crea una caché nueva y borra la anterior.
 */
export function serviceWorker(): Plugin {
  return {
    name: "menu-familiar-sw",
    applyToEnvironment: (environment) => environment.name === "client",
    generateBundle(_options, bundle) {
      const assets = Object.keys(bundle)
        .filter((file) => file.startsWith("assets/"))
        .sort()
        .map((file) => `/${file}`);
      const html = bundle["index.html"];
      const hash = createHash("sha256").update(assets.join("\n"));
      if (html?.type === "asset") hash.update(html.source);
      const version = hash.digest("hex").slice(0, 12);
      const template = readFileSync(path.join(import.meta.dirname, "../src/sw/sw.js"), "utf8");
      const source = template
        .replace('const VERSION = "dev";', `const VERSION = ${JSON.stringify(version)};`)
        .replace("/* __SW_PRECACHE__ */ []", JSON.stringify(assets));
      if (source.includes('"dev"') || source.includes("__SW_PRECACHE__")) this.error("No se pudo generar sw.js");
      this.emitFile({ type: "asset", fileName: "sw.js", source });
    },
  };
}
