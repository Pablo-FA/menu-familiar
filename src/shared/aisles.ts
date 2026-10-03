/**
 * Secciones del súper, en el orden en que se recorre la tienda.
 *
 * Es la única fuente de verdad: para cambiar el orden de la tienda, cámbialo aquí
 * (la lista de la compra, los selectores y la validación de recipe@1/plan@1 salen
 * de esta lista). Añadir o reordenar secciones no requiere migración.
 */
export const AISLE_LIST = [
  { id: "pan", label: "Pan" },
  { id: "yogures", label: "Yogures" },
  { id: "desayuno", label: "Cereales, galletas y café" },
  { id: "frutos-secos", label: "Frutos secos" },
  { id: "cosmetica", label: "Belleza y cosmética" },
  { id: "limpieza", label: "Limpieza" },
  { id: "bebidas", label: "Bebidas" },
  { id: "harinas-huevos", label: "Harinas y huevos" },
  { id: "conservas", label: "Conservas" },
  { id: "precocinados", label: "Precocinados" },
  { id: "arroces", label: "Arroces" },
  { id: "embutidos-quesos", label: "Embutidos, quesos y salchichas" },
  { id: "carne-legumbres", label: "Carne, legumbres y especias" },
  { id: "fruta-verdura", label: "Fruta y verdura" },
  { id: "congelados", label: "Congelados" },
  { id: "pescado", label: "Pescado y marisco" },
  { id: "pasta-salsas", label: "Pasta, tomate frito y salsas" },
  { id: "leche", label: "Leche" },
  { id: "otros", label: "Otros" },
] as const;

export type Aisle = (typeof AISLE_LIST)[number]["id"];

export const AISLES = AISLE_LIST.map((a) => a.id) as unknown as readonly [Aisle, ...Aisle[]];

export const AISLE_LABEL = Object.fromEntries(AISLE_LIST.map((a) => [a.id, a.label])) as Record<Aisle, string>;

/** Posición en la tienda (0 = primera). Las desconocidas van al final, con "otros". */
export function aisleOrder(aisle: string): number {
  const i = AISLES.indexOf(aisle as Aisle);
  return i === -1 ? AISLES.length - 1 : i;
}

export function isAisle(value: string): value is Aisle {
  return (AISLES as readonly string[]).includes(value);
}

/** Secciones de la versión anterior (8), aún aceptadas al importar, y su equivalente. */
export const LEGACY_AISLE_MAP = {
  "verdura-fruta": "fruta-verdura",
  "carne-pescado": "carne-legumbres",
  "huevos-lacteos": "leche",
  "cereales-pan": "pan",
  conservas: "conservas",
  congelados: "congelados",
  despensa: "otros",
  otros: "otros",
} as const satisfies Record<string, Aisle>;

export type LegacyAisle = keyof typeof LEGACY_AISLE_MAP;

/** Valores válidos en recipe@1 y plan@1: las 19 secciones y las 8 antiguas. */
export const ACCEPTED_AISLES = [...new Set<string>([...AISLES, ...Object.keys(LEGACY_AISLE_MAP)])] as [string, ...string[]];

/**
 * Reglas para deducir la sección a partir del slug del ingrediente. Gana la primera
 * que coincide, así que el orden importa (p. ej. "garbanzo-cocido" va a conservas
 * antes de que "garbanzo" lo mande a legumbres, y "nuez-moscada" a especias antes
 * de que "nuez" lo mande a frutos secos).
 *
 * Coincidencia: la palabra clave tiene que empezar al principio de un tramo del slug
 * ("lata" no coincide con "platano"), y se ignora la "s" final de cada tramo
 * ("garbanzos-cocidos" coincide con "garbanzo-cocido"). La migración 0005 repite
 * estas mismas reglas en SQL; un test comprueba que dan lo mismo.
 */
export const AISLE_RULES: readonly (readonly [Aisle, readonly string[]])[] = [
  ["harinas-huevos", ["huevo", "harina", "levadura", "maicena", "bicarbonato", "azucar", "pan-rallado", "panko"]],
  [
    "conservas",
    [
      "garbanzo-cocido", "alubia-cocida", "lenteja-cocida", "bote", "lata", "conserva", "tomate-triturado",
      "tomate-troceado", "tomate-tamizado", "piquillo", "aceituna", "alcaparra", "atun", "sardina", "anchoa",
      "maiz", "leche-de-coco", "caldo",
    ],
  ],
  ["congelados", ["congelad", "gyoza"]],
  [
    "pasta-salsas",
    [
      "pasta", "espagueti", "macarron", "fideo", "noodle", "tallarin", "lasana", "tomate-frito", "salsa", "ketchup",
      "mayonesa", "mostaza", "miso", "vinagre",
    ],
  ],
  ["yogures", ["yogur", "kefir"]],
  ["leche", ["leche", "nata", "mantequilla"]],
  [
    "embutidos-quesos",
    [
      "queso", "mozzarella", "gorgonzola", "parmesano", "feta", "halloumi", "ricotta", "burrata", "mascarpone",
      "jamon", "chorizo", "salchicha", "bacon", "beicon", "panceta", "mortadela", "salami", "morcilla", "sobrasada",
      "fuet",
    ],
  ],
  [
    "pescado",
    [
      "salmon", "merluza", "bacalao", "gamba", "langostino", "mejillon", "calamar", "sepia", "dorada", "lubina",
      "rape", "pulpo", "almeja", "pescado",
    ],
  ],
  [
    "carne-legumbres",
    [
      // carne
      "pollo", "pechuga", "muslo", "contramuslo", "cerdo", "ternera", "vacuno", "cordero", "conejo", "pavo",
      "solomillo", "lomo", "costilla", "carne",
      // legumbres
      "lenteja", "alubia", "judion", "garbanzo",
      // especias
      "comino", "pimenton", "curry", "oregano", "canela", "pimienta", "curcuma", "nuez-moscada", "garam-masala",
      "laurel", "clavo", "cardamomo", "cayena", "especia",
    ],
  ],
  ["arroces", ["arroz"]],
  ["frutos-secos", ["nuez", "almendra", "avellana", "pistacho", "anacardo", "pinon", "cacahuete", "pasa", "datil"]],
  ["desayuno", ["cereal", "avena", "galleta", "cafe", "cacao", "mermelada"]],
  ["pan", ["pan", "tortilla-de-trigo", "piadina", "wrap"]],
  ["bebidas", ["vino", "cerveza"]],
];

/** Slug preparado para comparar: "-" delante y sin la "s" final de cada tramo. */
export function aisleMatchKey(slug: string): string {
  return `-${`${slug}-`.replaceAll("s-", "-")}`;
}

/**
 * Sección para un ingrediente nuevo: la primera regla que coincide con su slug; si
 * ninguna, el equivalente de la sección antigua que traía; si no, "otros".
 */
export function guessAisle(slug: string, legacy?: string | null): Aisle {
  const key = aisleMatchKey(slug);
  for (const [aisle, keywords] of AISLE_RULES) {
    if (keywords.some((k) => key.includes(`-${k}`))) return aisle;
  }
  if (legacy && legacy in LEGACY_AISLE_MAP) return LEGACY_AISLE_MAP[legacy as LegacyAisle];
  if (legacy && isAisle(legacy)) return legacy;
  return "otros";
}

/**
 * Sección con la que se guarda un ingrediente nuevo importado. Las secciones nuevas se
 * respetan; las que solo existían en la lista antigua (y "otros", que suele significar
 * "no sé") se convierten con guessAisle.
 */
export function importAisle(slug: string, aisle: string): Aisle {
  if (aisle !== "otros" && isAisle(aisle)) return aisle;
  return guessAisle(slug, aisle);
}
