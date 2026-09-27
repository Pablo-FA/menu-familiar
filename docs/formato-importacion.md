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

### Qué hace la app al importar

`POST /api/recipes/import` (y la herramienta técnica de la página principal):

- Valida el JSON. Si algo falla responde **400** con la lista de errores, cada uno con la ruta del campo (`ingredients[3].unit`) y un mensaje en español. No escribe nada.
- Ingredientes cuyo slug no está en el catálogo: se crean con su `name`, `aisle` y `pantry`. La respuesta los enumera en `created_ingredients`.
- Si ya existe una receta con ese `id`: **409**, salvo con `?replace=true`. Al reemplazar se sustituyen los datos, los ingredientes y los pasos, pero se conservan la foto de portada, el estado de archivo y los registros de cocinado (valoraciones).
- Todo se escribe en un único lote atómico de D1: o se guarda la receta entera o nada.
- Respuesta: **201** si es nueva, **200** si se ha reemplazado.

### Instrucciones para Claude al generar el JSON

- Cantidades para 4 raciones (2 adultos y 2 niñas); no hay escalado en la app.
- Marca `"estimated": true` en cada cantidad que no venga de la fuente, y `"kcal_estimated": true` si calculas las calorías.
- Explica en `adaptation_notes` qué has adaptado y qué has estimado.
- Usa nombres de ingrediente genéricos y en singular para que coincidan con el catálogo (`"huevo"`, no `"huevos camperos L"`; el detalle va en `text`).
- Si no hay cantidad razonable (sal, aceite para freír), `quantity` y `unit` a `null`.
- Devuelve solo el JSON, sin comentarios (JSON no admite comentarios).

---

## `menu-familiar/plan@1`: un menú (todavía no implementado)

Formato que Claude devolverá más adelante para planificar varios días de una vez. **La app aún no lo acepta.**

```json
{
  "format": "menu-familiar/plan@1",
  "meals": [
    { "date": "2026-10-05", "slot": "lunch", "recipe_id": "katsukare" },
    { "date": "2026-10-05", "slot": "dinner", "status": "away" }
  ],
  "recipes": []
}
```

| Campo | Notas |
| --- | --- |
| `meals[].date` | `YYYY-MM-DD`. |
| `meals[].slot` | `lunch` · `dinner`. Cada par fecha + franja es único: importar un menú sobre un día ya planificado lo sustituye. |
| `meals[].recipe_id` | Receta planificada. Puede ser una existente o una incluida en `recipes`. |
| `meals[].status` | `planned` (por defecto si hay `recipe_id`) · `away` (fuera de casa) · `empty` (sin planificar). |
| `meals[].note` | Opcional. |
| `recipes` | Recetas nuevas en formato `recipe@1`, que se importan antes de planificar. |
