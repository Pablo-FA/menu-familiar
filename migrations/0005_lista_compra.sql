-- Migración 0005: lista de la compra (paso 5).
--
-- 1. Secciones nuevas del súper (19, en el orden de la tienda; ver src/shared/aisles.ts).
--    El catálogo existente se re-secciona con las mismas reglas que guessAisle: gana la
--    primera regla cuya palabra clave empieza un tramo del slug (sin la "s" final de
--    cada tramo); si ninguna coincide, se usa el equivalente de la sección antigua.
--    Se hace en SQL (y no en el Worker) para que sea una sola vez, en el despliegue y de
--    forma determinista. test/shopping-rules.test.ts comprueba que este UPDATE da lo
--    mismo que guessAisle. Generado a partir de AISLE_RULES; si cambian las reglas, los
--    ingredientes ya existentes no se tocan (para eso está «Sección» en la lista).
UPDATE ingredients SET aisle = CASE
    WHEN k LIKE '%-huevo%' OR k LIKE '%-harina%' OR k LIKE '%-levadura%' OR k LIKE '%-maicena%'
      OR k LIKE '%-bicarbonato%' OR k LIKE '%-azucar%' OR k LIKE '%-pan-rallado%' OR k LIKE '%-panko%'
      THEN 'harinas-huevos'
    WHEN k LIKE '%-garbanzo-cocido%' OR k LIKE '%-alubia-cocida%' OR k LIKE '%-lenteja-cocida%' OR k LIKE '%-bote%'
      OR k LIKE '%-lata%' OR k LIKE '%-conserva%' OR k LIKE '%-tomate-triturado%' OR k LIKE '%-tomate-troceado%'
      OR k LIKE '%-tomate-tamizado%' OR k LIKE '%-piquillo%' OR k LIKE '%-aceituna%' OR k LIKE '%-alcaparra%'
      OR k LIKE '%-atun%' OR k LIKE '%-sardina%' OR k LIKE '%-anchoa%' OR k LIKE '%-maiz%'
      OR k LIKE '%-leche-de-coco%' OR k LIKE '%-caldo%'
      THEN 'conservas'
    WHEN k LIKE '%-congelad%' OR k LIKE '%-gyoza%'
      THEN 'congelados'
    WHEN k LIKE '%-pasta%' OR k LIKE '%-espagueti%' OR k LIKE '%-macarron%' OR k LIKE '%-fideo%'
      OR k LIKE '%-noodle%' OR k LIKE '%-tallarin%' OR k LIKE '%-lasana%' OR k LIKE '%-tomate-frito%'
      OR k LIKE '%-salsa%' OR k LIKE '%-ketchup%' OR k LIKE '%-mayonesa%' OR k LIKE '%-mostaza%'
      OR k LIKE '%-miso%' OR k LIKE '%-vinagre%'
      THEN 'pasta-salsas'
    WHEN k LIKE '%-yogur%' OR k LIKE '%-kefir%'
      THEN 'yogures'
    WHEN k LIKE '%-leche%' OR k LIKE '%-nata%' OR k LIKE '%-mantequilla%'
      THEN 'leche'
    WHEN k LIKE '%-queso%' OR k LIKE '%-mozzarella%' OR k LIKE '%-gorgonzola%' OR k LIKE '%-parmesano%'
      OR k LIKE '%-feta%' OR k LIKE '%-halloumi%' OR k LIKE '%-ricotta%' OR k LIKE '%-burrata%'
      OR k LIKE '%-mascarpone%' OR k LIKE '%-jamon%' OR k LIKE '%-chorizo%' OR k LIKE '%-salchicha%'
      OR k LIKE '%-bacon%' OR k LIKE '%-beicon%' OR k LIKE '%-panceta%' OR k LIKE '%-mortadela%'
      OR k LIKE '%-salami%' OR k LIKE '%-morcilla%' OR k LIKE '%-sobrasada%' OR k LIKE '%-fuet%'
      THEN 'embutidos-quesos'
    WHEN k LIKE '%-salmon%' OR k LIKE '%-merluza%' OR k LIKE '%-bacalao%' OR k LIKE '%-gamba%'
      OR k LIKE '%-langostino%' OR k LIKE '%-mejillon%' OR k LIKE '%-calamar%' OR k LIKE '%-sepia%'
      OR k LIKE '%-dorada%' OR k LIKE '%-lubina%' OR k LIKE '%-rape%' OR k LIKE '%-pulpo%'
      OR k LIKE '%-almeja%' OR k LIKE '%-pescado%'
      THEN 'pescado'
    WHEN k LIKE '%-pollo%' OR k LIKE '%-pechuga%' OR k LIKE '%-muslo%' OR k LIKE '%-contramuslo%'
      OR k LIKE '%-cerdo%' OR k LIKE '%-ternera%' OR k LIKE '%-vacuno%' OR k LIKE '%-cordero%'
      OR k LIKE '%-conejo%' OR k LIKE '%-pavo%' OR k LIKE '%-solomillo%' OR k LIKE '%-lomo%'
      OR k LIKE '%-costilla%' OR k LIKE '%-carne%' OR k LIKE '%-lenteja%' OR k LIKE '%-alubia%'
      OR k LIKE '%-judion%' OR k LIKE '%-garbanzo%' OR k LIKE '%-comino%' OR k LIKE '%-pimenton%'
      OR k LIKE '%-curry%' OR k LIKE '%-oregano%' OR k LIKE '%-canela%' OR k LIKE '%-pimienta%'
      OR k LIKE '%-curcuma%' OR k LIKE '%-nuez-moscada%' OR k LIKE '%-garam-masala%' OR k LIKE '%-laurel%'
      OR k LIKE '%-clavo%' OR k LIKE '%-cardamomo%' OR k LIKE '%-cayena%' OR k LIKE '%-especia%'
      THEN 'carne-legumbres'
    WHEN k LIKE '%-arroz%'
      THEN 'arroces'
    WHEN k LIKE '%-nuez%' OR k LIKE '%-almendra%' OR k LIKE '%-avellana%' OR k LIKE '%-pistacho%'
      OR k LIKE '%-anacardo%' OR k LIKE '%-pinon%' OR k LIKE '%-cacahuete%' OR k LIKE '%-pasa%'
      OR k LIKE '%-datil%'
      THEN 'frutos-secos'
    WHEN k LIKE '%-cereal%' OR k LIKE '%-avena%' OR k LIKE '%-galleta%' OR k LIKE '%-cafe%'
      OR k LIKE '%-cacao%' OR k LIKE '%-mermelada%'
      THEN 'desayuno'
    WHEN k LIKE '%-pan%' OR k LIKE '%-tortilla-de-trigo%' OR k LIKE '%-piadina%' OR k LIKE '%-wrap%'
      THEN 'pan'
    WHEN k LIKE '%-vino%' OR k LIKE '%-cerveza%'
      THEN 'bebidas'
    ELSE CASE ingredients.aisle
        WHEN 'verdura-fruta' THEN 'fruta-verdura'
        WHEN 'carne-pescado' THEN 'carne-legumbres'
        WHEN 'huevos-lacteos' THEN 'leche'
        WHEN 'cereales-pan' THEN 'pan'
        WHEN 'conservas' THEN 'conservas'
        WHEN 'congelados' THEN 'congelados'
        WHEN 'despensa' THEN 'otros'
        WHEN 'otros' THEN 'otros'
        ELSE ingredients.aisle
      END
  END
FROM (SELECT id AS slug, ('-' || replace(id || '-', 's-', '-')) AS k FROM ingredients) AS m
WHERE m.slug = ingredients.id;

-- 2. Lista de la compra.
-- Las dos tablas se rehacen (todavía no se usaban) para añadir columnas y, sobre todo,
-- AUTOINCREMENT: al sustituir la lista se borran todas las filas, y sin él SQLite
-- reutilizaría los ids. Una operación de la cola del móvil que apunte a una línea de
-- la lista anterior acabaría cambiando otra distinta de la lista nueva.
CREATE TABLE shopping_lists_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_date TEXT NOT NULL,            -- YYYY-MM-DD
  to_date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  -- Comidas que cubre la lista (para detectar cambios en el menú): [{date, slot, recipe_id}]
  meals_snapshot TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(meals_snapshot) AND json_type(meals_snapshot) = 'array'),
  -- Comidas del rango que se desmarcaron al crearla: [{date, slot}]
  excluded TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(excluded) AND json_type(excluded) = 'array'),
  meals_count INTEGER NOT NULL DEFAULT 0,
  CHECK (from_date <= to_date)
);

-- Sincronización sin conexión: gana la última escritura por línea y por campo.
-- * updated_at: última escritura en la línea (la mayor de field_updated_at).
-- * field_updated_at: {"bought": "…", "status": "…", …} instante de la última escritura de cada campo.
-- * client_id: id que da el móvil a una línea creada sin conexión (para no duplicarla al reintentar).
-- * carried: viene de la lista anterior («Pasar lo que no compraste»); «Actualizar» no la quita.
CREATE TABLE shopping_items_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  list_id INTEGER NOT NULL REFERENCES shopping_lists_new (id) ON DELETE CASCADE,
  ingredient_id TEXT REFERENCES ingredients (id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  quantity_text TEXT,
  aisle TEXT NOT NULL,
  pantry INTEGER NOT NULL DEFAULT 0 CHECK (pantry IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'buy' CHECK (status IN ('review', 'buy', 'home')),
  bought INTEGER NOT NULL DEFAULT 0 CHECK (bought IN (0, 1)),
  manual INTEGER NOT NULL DEFAULT 0 CHECK (manual IN (0, 1)),
  carried INTEGER NOT NULL DEFAULT 0 CHECK (carried IN (0, 1)),
  client_id TEXT,
  updated_at TEXT,
  field_updated_at TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(field_updated_at) AND json_type(field_updated_at) = 'object')
);

INSERT INTO shopping_lists_new (id, from_date, to_date, created_at)
  SELECT id, from_date, to_date, created_at FROM shopping_lists;

-- Las líneas de listas antiguas siguen la sección de su ingrediente.
INSERT INTO shopping_items_new (id, list_id, ingredient_id, name, quantity_text, aisle, pantry, status, bought, manual)
  SELECT id, list_id, ingredient_id, name, quantity_text,
         COALESCE((SELECT aisle FROM ingredients WHERE id = shopping_items.ingredient_id), CASE aisle
           WHEN 'verdura-fruta' THEN 'fruta-verdura'
           WHEN 'carne-pescado' THEN 'carne-legumbres'
           WHEN 'huevos-lacteos' THEN 'leche'
           WHEN 'cereales-pan' THEN 'pan'
           WHEN 'despensa' THEN 'otros'
           ELSE aisle
         END),
         pantry, status, bought, manual
  FROM shopping_items;

DROP TABLE shopping_items;
DROP TABLE shopping_lists;
ALTER TABLE shopping_lists_new RENAME TO shopping_lists;
ALTER TABLE shopping_items_new RENAME TO shopping_items;

CREATE INDEX idx_shopping_items_list ON shopping_items (list_id);
CREATE INDEX idx_shopping_items_ingredient ON shopping_items (ingredient_id);
CREATE UNIQUE INDEX idx_shopping_items_client ON shopping_items (client_id) WHERE client_id IS NOT NULL;

-- Operaciones ya aplicadas (POST /api/shopping/ops es idempotente por id de operación).
CREATE TABLE shopping_ops (
  id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

UPDATE app_meta SET value = '5' WHERE key = 'schema_version';
