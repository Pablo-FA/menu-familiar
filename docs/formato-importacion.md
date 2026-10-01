# Formatos de importación

La app no se alimenta escribiendo recetas a mano. El flujo es:

1. Pablo pasa a Claude (claude.ai) el enlace de una receta.
2. Claude la extrae, la adapta a la familia (2 adultos y 2 niñas de 9 y 6 años) y devuelve un bloque JSON en el formato de este documento.
3. Pablo pega el JSON en la app, que lo valida y lo importa.

Este documento es la referencia de ese contrato. Si cambia de forma incompatible, se sube la versión (`@2`) en lugar de modificar la `@1`.

---

## `menu-familiar/recipe@1`: una receta

Ejemplo completo: [`ejemplos/katsukare.json`](ejemplos/katsukare.json).

```json
{
  "format": "menu-familiar/recipe@1",
  "id": "katsukare",
  "title": "Katsukarē (curry japonés con pollo empanado)",
  "minutes": 40,
  "protein": "ave",
  "suits": "lunch",
  "kcal_adult": 800,
  "kcal_estimated": true,
  "source_url": "https://www.nomecomesnada.es/katsukare-o-curry-japones/",
  "adaptation_notes": "Cantidades estimadas (la fuente no las da). …",
  "freezer_note": "La salsa se congela bien; se puede hacer doble ración de curry.",
  "tags": ["japonesa", "curry", "empanado"],
  "ingredients": [
    { "text": "2 zanahorias", "name": "zanahoria", "quantity": 2, "unit": "ud", "estimated": true, "aisle": "verdura-fruta", "pantry": false },
    { "text": "600 ml de agua", "name": "agua", "quantity": 600, "unit": "ml", "estimated": false, "aisle": "otros", "pantry": true },
    { "text": "Sal", "name": "sal", "quantity": null, "unit": null, "estimated": true, "aisle": "despensa", "pantry": true }
  ],
  "steps": [
    { "text": "Pica fina la cebolla y la zanahoria; trocea las setas en trozos grandes." },
    { "text": "Incorpora las pastillas de curry y hierve removiendo hasta que espese.", "timer_seconds": 600 }
  ]
}
```

### Campos de la receta

| Campo | Tipo | Obligatorio | Notas |
| --- | --- | --- | --- |
| `format` | texto | sí | Exactamente `"menu-familiar/recipe@1"`. |
| `id` | texto | sí | Slug estable: minúsculas, números y guiones (`katsukare`, `lentejas-con-chorizo`). Identifica la receta para siempre; reimportar con el mismo `id` es reemplazarla. |
| `title` | texto | sí | Nombre visible. |
| `minutes` | entero > 0 | sí | Tiempo total aproximado. |
| `protein` | lista | sí | `verdura` · `legumbre` · `pescado` · `carne` · `ave` · `huevo`. |
| `suits` | lista | sí | `lunch` (comida) · `dinner` (cena) · `both`. |
| `kcal_adult` | entero > 0 o `null` | no | Calorías por ración de adulto. |
| `kcal_estimated` | booleano | no (`false`) | `true` si las calorías las ha estimado Claude. |
| `source_url` | URL http(s) o `null` | no | Receta original. |
| `adaptation_notes` | texto o `null` | no | Qué se ha cambiado respecto a la fuente y por qué; qué es estimado; variantes. |
| `freezer_note` | texto o `null` | no | Si se congela bien y cómo. |
| `tags` | lista de textos | no (`[]`) | Máximo 20. |
| `course` | lista | no (`"main"`) | Tipo de plato: `main` (plato principal) · `side` (pan, guarnición) · `breakfast` · `drink`. Solo los `main` se pueden planificar como comida o cena. |
| `ingredients` | lista | sí (≥ 1) | En el orden en que se muestran. |
| `steps` | lista | sí (≥ 1) | En orden. |

No se admiten campos que no estén en esta tabla: una errata (`"minutos"`) da error en vez de ignorarse en silencio.

### Campos de cada ingrediente

| Campo | Tipo | Obligatorio | Notas |
| --- | --- | --- | --- |
| `text` | texto | sí | Lo que se lee en la receta: `"2 zanahorias"`, `"Sal"`. |
| `name` | texto | sí | Nombre del ingrediente en el catálogo, en singular y genérico: `"zanahoria"`. Su slug (`zanahoria`) es la clave del catálogo; tildes y mayúsculas no importan (`"Jamón"` y `"jamon"` son el mismo). |
| `quantity` | número > 0 o `null` | no (`null`) | Para sumar en la lista de la compra. |
| `unit` | lista o `null` | no (`null`) | `g` · `kg` · `ml` · `l` · `ud` · `cda` · `cdta` · `pizca`. Cantidad y unidad van juntas: o las dos o ninguna. |
| `estimated` | booleano | no (`false`) | `true` si la cantidad la ha estimado Claude porque la fuente no la daba. |
| `aisle` | lista | sí | Sección del súper: `verdura-fruta` · `carne-pescado` · `huevos-lacteos` · `conservas` · `cereales-pan` · `despensa` · `congelados` · `otros`. |
| `pantry` | booleano | no (`false`) | Despensa fija (sal, aceite, arroz…): algo que normalmente hay en casa. |

`aisle` y `pantry` solo se usan si el ingrediente **no existe todavía** en el catálogo. Si ya existe, manda el catálogo y se ignoran.

### Campos de cada paso

| Campo | Tipo | Obligatorio | Notas |
| --- | --- | --- | --- |
| `text` | texto | sí | |
| `timer_seconds` | entero > 0 o `null` | no (`null`) | Para ofrecer un temporizador en el modo cocina. |
| `timer_label` | texto o `null` | no (`null`) | Nombre corto del temporizador: `"Patatas"`, `"Horno"` (máx. 30). Si falta, se llama "Paso N". |
| `uses` | lista de textos o `null` | no (`null`) | Ingredientes que usa el paso, con el mismo `name` que en `ingredients` (tildes y mayúsculas no importan). Deben ser de la receta. Si falta, el modo cocina los deduce buscando los nombres en el texto del paso. |

### Qué hace la app al importar

`POST /api/recipes/import` (y la herramienta técnica de la página principal):

- Valida el JSON. Si algo falla responde **400** con la lista de errores, cada uno con la ruta del campo (`ingredients[3].unit`) y un mensaje en español. No escribe nada.
- Ingredientes cuyo slug no está en el catálogo: se crean con su `name`, `aisle` y `pantry`. La respuesta los enumera en `created_ingredients`.
- Si ya existe una receta con ese `id`: **409**, salvo con `?replace=true`. Al reemplazar se sustituyen los datos, los ingredientes y los pasos, pero se conservan la foto de portada, el estado de archivo y los registros de cocinado (valoraciones).
- Todo se escribe en un único lote atómico de D1: o se guarda la receta entera o nada.
- Respuesta: **201** si es nueva, **200** si se ha reemplazado.

### Instrucciones para Claude al generar el JSON

- Marca con `"course": "side"` lo que no es un plato (panes, guarniciones), `"breakfast"` o `"drink"` según corresponda.
- En los pasos con tiempo de espera, pon `timer_seconds` y un `timer_label` corto ("Arroz", "Horno").
- Pon `uses` en los pasos donde se añaden ingredientes con cantidad, sobre todo si el texto no los nombra igual que en la lista ("las verduras").

- Cantidades para 4 raciones (2 adultos y 2 niñas); no hay escalado en la app.
- Marca `"estimated": true` en cada cantidad que no venga de la fuente, y `"kcal_estimated": true` si calculas las calorías.
- Explica en `adaptation_notes` qué has adaptado y qué has estimado.
- Usa nombres de ingrediente genéricos y en singular para que coincidan con el catálogo (`"huevo"`, no `"huevos camperos L"`; el detalle va en `text`).
- Si no hay cantidad razonable (sal, aceite para freír), `quantity` y `unit` a `null`.
- Devuelve solo el JSON, sin comentarios (JSON no admite comentarios).

---

## Planificar con Claude (flujo desde el Planificador)

1. **Planificar con Claude** (botón ✦ o tarjeta "Faltan N comidas"): la app copia al portapapeles una instrucción corta y, en un bloque ```json, el contexto de la semana visible (`menu-familiar/contexto@1`, abajo) y abre el proyecto de Claude. Ahí se pega y Claude responde con un `plan@1`.
2. **Pegar menú**: la app lee el portapapeles (en iOS hay que tocar la burbuja "Pegar"; si no se puede, abre un cuadro para pegarlo a mano) y busca el `plan@1` en el texto: vale el JSON solo, un bloque ```json o el JSON en medio de otro texto.
3. **Revisión**: antes de escribir nada, la app enseña qué cambiaría (`POST /api/plan/preview`): comidas que se añaden, las que sustituyen a otra (en ámbar), recetas nuevas que se añadirían al recetario y errores. Cada comida lleva una casilla, marcada por defecto.
4. **Aplicar**: solo se aplican las comidas marcadas (y las recetas nuevas que usan). Se puede **deshacer** justo después: las franjas vuelven a lo que tenían; las recetas nuevas se quedan en el recetario.

## `menu-familiar/contexto@1`: lo que la app le pasa a Claude

Lo genera `GET /api/claude-context?week=AAAA-MM-DD` (el lunes) y se copia en JSON compacto. Los campos `null` y las listas vacías se omiten.

```json
{ "format": "menu-familiar/contexto@1",
  "generated_at": "2026-10-04T19:30:00+02:00",
  "week": { "from": "2026-10-05", "to": "2026-10-11" },
  "empty_slots": [ { "date": "2026-10-06", "slot": "dinner" } ],
  "planned": [ { "date": "2026-10-05", "slot": "lunch", "status": "away" }, { "date": "2026-10-05", "slot": "dinner", "recipe_id": "crema-calabaza-miso" } ],
  "recent_meals": [ { "date": "2026-09-28", "slot": "dinner", "recipe_id": "crema-calabaza-curry", "stars": 4 } ],
  "recipes": [ { "id": "…", "title": "…", "minutes": 40, "protein": "verdura", "suits": "both", "kcal_adult": 450, "tags": ["…"], "freezer_note": "…", "times_cooked": 2, "last_cooked": "2026-09-28", "avg_stars": 4.5 } ],
  "ratings": [ { "date": "2026-10-02", "slot": "dinner", "recipe_id": "…", "stars": 3, "note": "…" } ] }
```

| Campo | Contenido |
| --- | --- |
| `generated_at` | Hora de Madrid con su desfase. |
| `week` | Lunes y domingo de la semana a planificar. |
| `empty_slots` | Huecos vacíos de la semana a partir de hoy (los que hay que rellenar). |
| `planned` | Lo ya planificado en la semana: receta o `"status": "away"` (fuera de casa), con `note` si la hay. |
| `recent_meals` | Comidas planificadas con receta de los 21 días anteriores al lunes, con `stars` si se valoraron. |
| `recipes` | Todas las recetas `main` no archivadas, con veces cocinada, última vez y media de estrellas. |
| `ratings` | Los 40 últimos registros de cocinado con estrellas o nota, del más reciente al más antiguo. |

## `menu-familiar/plan@1`: un menú

Para planificar varios días de una vez. Se pega en `/importar` igual que una receta (la página detecta el formato) o se envía a `POST /api/plan/import`.

```json
{
  "format": "menu-familiar/plan@1",
  "meals": [
    { "date": "2026-10-05", "slot": "lunch", "recipe_id": "katsukare" },
    { "date": "2026-10-05", "slot": "dinner", "status": "away", "note": "Cena en casa de los abuelos" },
    { "date": "2026-10-06", "slot": "lunch", "recipe_id": "lentejas-estofadas" }
  ],
  "recipes": [
    { "format": "menu-familiar/recipe@1", "id": "lentejas-estofadas", "…": "receta completa en formato recipe@1" }
  ]
}
```

| Campo | Obligatorio | Notas |
| --- | --- | --- |
| `format` | sí | Exactamente `"menu-familiar/plan@1"`. |
| `meals` | sí (1–62) | Una entrada por día y franja. No puede repetirse la misma fecha y franja. |
| `meals[].date` | sí | `AAAA-MM-DD`, fecha real. |
| `meals[].slot` | sí | `lunch` (comida) · `dinner` (cena). |
| `meals[].recipe_id` | según estado | Receta planificada: una que ya exista en la app o una incluida en `recipes`. Debe ser un plato principal (`course: "main"`). |
| `meals[].status` | no | `planned` · `away` (fuera de casa) · `empty` (sin planificar). Si falta: `planned` si hay `recipe_id`, `empty` si no. `planned` exige receta; `away` y `empty` no la llevan. |
| `meals[].note` | no | Texto libre corto. |
| `recipes` | no (`[]`) | Recetas nuevas en formato `recipe@1` (máximo 30). |

Una comida puede ser solo `{ "date": "…", "slot": "dinner", "status": "away" }` (fuera de casa, sin receta).

### Qué hace la app al importar un menú

- Desde el Planificador, **solo se aplican las comidas que Pablo deja marcadas** en la revisión; `/importar` aplica el plan entero.
- Rechaza las comidas que apuntan a recetas que no son plato principal (`course` distinto de `main`).
- Valida todo antes de escribir nada. Errores legibles con la ruta del campo (`meals[2].recipe_id`).
- Las recetas de `recipes` que **no existen** se crean con las mismas reglas que `recipe@1` (el catálogo manda, etc.). Las que **ya existen no se modifican**; la respuesta las enumera en `existing_recipes`. Para cambiar una receta existente, impórtala sola con "Reemplazar".
- Cada comida sustituye lo que hubiera planificado en esa fecha y franja.
- Recetas y comidas se escriben en un único lote atómico: o todo o nada.

### Instrucciones para Claude al generar un menú

- Reutiliza los `id` de recetas que ya estén en la app cuando repitas plato; incluye en `recipes` solo las nuevas.
- Marca con `"status": "away"` las comidas fuera de casa, en vez de omitirlas, para que la app no las muestre como vacías.
- Devuelve solo el JSON.
