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
    { "text": "2 zanahorias", "name": "zanahoria", "quantity": 2, "unit": "ud", "estimated": true, "aisle": "fruta-verdura", "pantry": false },
    { "text": "600 ml de agua", "name": "agua", "quantity": 600, "unit": "ml", "estimated": false, "aisle": "otros", "pantry": true },
    { "text": "Sal", "name": "sal", "quantity": null, "unit": null, "estimated": true, "aisle": "otros", "pantry": true }
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
| `aisle` | lista | sí | Sección del súper (ver [Secciones del súper](#secciones-del-súper)). |
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
- Ingredientes cuyo slug no está en el catálogo: se crean con su `name`, `aisle` y `pantry` (las secciones antiguas se convierten; ver abajo). La respuesta los enumera en `created_ingredients`.
- Si ya existe una receta con ese `id`: **409**, salvo con `?replace=true`. Al reemplazar se sustituyen los datos, los ingredientes y los pasos, pero se conservan la foto de portada, el estado de archivo y los registros de cocinado (valoraciones).
- Todo se escribe en un único lote atómico de D1: o se guarda la receta entera o nada.
- Respuesta: **201** si es nueva, **200** si se ha reemplazado.

### Vista previa sin escribir: `POST /api/recipes/preview`

Mismo cuerpo que importar. No escribe nada y responde siempre **200** con:

- `summary`: id, título, minutos, proteína, franja (`suits`), tipo (`course`), calorías, `adaptation_notes` y la portada si la receta ya existe (o `null` si hay errores);
- `ingredients_count`, `steps_count` y `timers_count`;
- `new_ingredients`: los que se crearían en el catálogo, con la sección que tendrán (ya convertida con `guessAisle` si traían una antigua);
- `exists`: si ya hay una receta con ese `id` (entonces importar exige `?replace=true`);
- `errors`: los mismos errores de validación que daría importar.

### Receta nueva desde la app: «Adaptar una receta de internet» → «Pegar receta de Claude»

En **Recetas → +**:

1. **Adaptar una receta de internet**: se pega el enlace y «Abrir en Claude» copia este texto y abre el proyecto de Claude:

   ```
   Adapta esta receta para Menú familiar y devuélvemela en formato menu-familiar/recipe@1 dentro de un bloque ```json: https://…
   ```

2. **Pegar receta de Claude**: cuando Claude responde, se copia su respuesta y se toca esta tarjeta. La app lee el portapapeles (o abre un cuadro para pegarlo a mano) y busca la primera `recipe@1`: vale el JSON solo, un bloque ```json o el JSON con texto alrededor.
3. **Receta de Claude**: vista previa (`POST /api/recipes/preview`) con el resumen, los recuentos, los ingredientes nuevos con su sección, la adaptación y los errores. Si ya existe una receta con ese `id`, sale «Ya tienes esta receta» y hay que activar «Reemplazar» (se conservan la foto y las valoraciones).
4. **Añadir al recetario** (o **Reemplazar receta**) la importa y abre su ficha.

`/importar` sigue disponible como herramienta técnica.

### Mejorar con Claude (desde la ficha)

En la ficha de una receta, **… → Mejorar con Claude** copia este texto y abre el proyecto:

````
Quiero cambiar esta receta de Menú familiar: [escribe o dicta aquí el cambio]. Devuélvemela completa en formato menu-familiar/recipe@1 con el mismo id, dentro de un bloque ```json.

```json
{ …la receta actual en recipe@1 (GET /api/recipes/:id/export)… }
```
````

Se cambia el hueco entre corchetes por lo que se quiera (también dictándolo en la app de Claude). La vuelta es la misma que para una receta nueva: **Pegar receta de Claude** (en la galería o en el menú … de la ficha). Como el `id` es el mismo, sale «Ya tienes esta receta» y se reemplaza con el interruptor.

La exportación da exactamente la receta guardada: importarla con `?replace=true` deja la receta igual (los nombres de ingrediente son los del catálogo y `uses` va con esos nombres).

### Editor de la app

**… → Editar receta** abre el editor (datos, ingredientes y pasos). Guarda con `PUT /api/recipes/:id`, que recibe la receta completa en `recipe@1` (con el mismo `id`) y aplica la misma validación y el mismo lote atómico que importar con `?replace=true`: se conservan la portada, el estado de archivo y las valoraciones; los ingredientes nuevos se crean en el catálogo con su sección y despensa.

### Secciones del súper

En el orden en que se recorre la tienda (la lista de la compra sigue este orden). La única fuente de verdad es [`src/shared/aisles.ts`](../src/shared/aisles.ts): para cambiar el orden, se cambia ahí.

| # | `aisle` | Sección |
| --- | --- | --- |
| 1 | `pan` | Pan |
| 2 | `yogures` | Yogures |
| 3 | `desayuno` | Cereales, galletas y café |
| 4 | `frutos-secos` | Frutos secos |
| 5 | `cosmetica` | Belleza y cosmética |
| 6 | `limpieza` | Limpieza |
| 7 | `bebidas` | Bebidas |
| 8 | `harinas-huevos` | Harinas y huevos |
| 9 | `conservas` | Conservas |
| 10 | `precocinados` | Precocinados |
| 11 | `arroces` | Arroces |
| 12 | `embutidos-quesos` | Embutidos, quesos y salchichas |
| 13 | `carne-legumbres` | Carne, legumbres y especias |
| 14 | `fruta-verdura` | Fruta y verdura |
| 15 | `congelados` | Congelados |
| 16 | `pescado` | Pescado y marisco |
| 17 | `pasta-salsas` | Pasta, tomate frito y salsas |
| 18 | `leche` | Leche |
| 19 | `otros` | Otros |

**Valores antiguos.** Se siguen aceptando las 8 secciones de la primera versión: `verdura-fruta`, `carne-pescado`, `huevos-lacteos`, `conservas`, `cereales-pan`, `despensa`, `congelados` y `otros`. Al crear un ingrediente nuevo con una de las que solo existían antes (o con `otros`), la app deduce la sección con `guessAisle`: reglas por palabras clave sobre el slug del ingrediente (gana la primera que coincide; p. ej. `huevo` → Harinas y huevos, `garbanzo-cocido` → Conservas, `comino` → Carne, legumbres y especias). Si ninguna regla coincide, usa la equivalente: `verdura-fruta` → `fruta-verdura`, `carne-pescado` → `carne-legumbres`, `huevos-lacteos` → `leche`, `cereales-pan` → `pan`, `despensa` → `otros`. Si el ingrediente ya está en el catálogo, manda el catálogo. La migración `0005` re-seccionó el catálogo existente con las mismas reglas.

### Instrucciones para Claude al generar el JSON

- Marca con `"course": "side"` lo que no es un plato (panes, guarniciones), `"breakfast"` o `"drink"` según corresponda.
- En los pasos con tiempo de espera, pon `timer_seconds` y un `timer_label` corto ("Arroz", "Horno").
- Pon `uses` en los pasos donde se añaden ingredientes con cantidad, sobre todo si el texto no los nombra igual que en la lista ("las verduras").

- Cantidades para 4 raciones (2 adultos y 2 niñas); no hay escalado en la app.
- Marca `"estimated": true` en cada cantidad que no venga de la fuente, y `"kcal_estimated": true` si calculas las calorías.
- Explica en `adaptation_notes` qué has adaptado y qué has estimado.
- Usa las 19 secciones nuevas en `aisle`.
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

---

## Lista de la compra

No tiene formato de importación: se genera en la app (pestaña **Compra**) a partir del menú. Reglas en [`src/shared/shopping.ts`](../src/shared/shopping.ts).

**Generación.** Se eligen unas fechas y, de las comidas planificadas con receta en ese rango, se pueden desmarcar las que no hagan falta (lo congelado). No se escala: las recetas ya son para 4. Las cantidades se agrupan por ingrediente y se suman por familia de unidad: g y kg en gramos (desde 1000, en kg con un decimal: "1,5 kg"), ml y l igual, `ud` redondeado hacia arriba, y `cda`, `cdta` y `pizca` cada una por su lado. Las familias que no se pueden sumar se unen con " + " ("2 ud + 200 g"); las cantidades `null` no suman; "≈" delante si alguna parte es estimada. Solo hay una lista activa: crear otra sustituye a la anterior, y se puede pasar a la nueva lo que quedó sin comprar.

**Estados de cada línea.**

- *Comprar* (`buy`): ingredientes que no son de despensa (`pantry: false`) y lo añadido a mano. Se marcan al echarlos al carro.
- *Revisar en casa* (`review`): de despensa con cantidad (p. ej. 300 g de arroz): «¿Queda suficiente?» → Hay / Comprar.
- *En casa* (`home`): de despensa sin cantidad (sal, aceite), el agua, y lo que se marque como «En casa».

Si el menú cambia después de crear la lista (una comida nueva, quitada o con otra receta, o una receta de la lista editada: «Lentejas caseras: la receta ha cambiado»), la app lo avisa y «Actualizar la lista» añade lo nuevo, recalcula cantidades (sin tocar lo que ya decidiste) y quita lo que ya no hace falta, salvo lo comprado, lo añadido a mano y lo que se pasó de la lista anterior. Mover una línea de sección se recuerda en el catálogo para las próximas listas.

**Sin conexión.** La app se abre sin red (service worker) y pinta la última lista guardada en el móvil. Lo que se marca se aplica al momento y se guarda en una cola en el móvil, que se envía en orden al recuperar la conexión; si dos cambios chocan, gana el más reciente por línea y por campo. Crear o actualizar la lista necesita conexión.

