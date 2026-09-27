import { describe, expect, it } from "vitest";
import { slugify } from "../src/shared/slug";

describe("slugify", () => {
  it("pasa a minúsculas y quita tildes y diéresis", () => {
    expect(slugify("Jamón")).toBe("jamon");
    expect(slugify("PECHUGA de Pollo")).toBe("pechuga-de-pollo");
    expect(slugify("Pingüino")).toBe("pinguino");
    expect(slugify("Preparado de curry japonés suave")).toBe("preparado-de-curry-japones-suave");
  });

  it("convierte la ñ en n", () => {
    expect(slugify("Ñoras")).toBe("noras");
  });

  it("colapsa espacios y signos en un solo guion y recorta los extremos", () => {
    expect(slugify("  aceite   de oliva (virgen extra)  ")).toBe("aceite-de-oliva-virgen-extra");
    expect(slugify("sal/pimienta")).toBe("sal-pimienta");
  });

  it("devuelve vacío si no hay letras ni números", () => {
    expect(slugify("¡¿?!")).toBe("");
  });
});
