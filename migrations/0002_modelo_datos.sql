-- Migración 0002: modelo de datos del menú familiar (paso 1).
--
-- Criterios:
-- * D1 aplica las claves foráneas siempre (PRAGMA foreign_keys = ON).
-- * Las listas "abiertas" (secciones del súper, proteínas, unidades) se validan en la
--   API con zod, no con CHECK: en SQLite cambiar un CHECK obliga a reconstruir la tabla,
--   y queremos poder añadir un valor sin migración. Solo llevan CHECK los valores que no
--   van a cambiar (booleanos 0/1, franjas, estados, estrellas).
-- * Fechas y marcas de tiempo como texto ISO 8601 (UTC).
-- * Las recetas no se borran: se archivan (archived = 1). Por eso las referencias a
--   recetas desde el menú y las valoraciones impiden borrarlas (NO ACTION).

-- Catálogo de ingredientes compartido entre recetas.
CREATE TABLE ingredients (
  id TEXT PRIMARY KEY,                -- slug del nombre: minúsculas, sin tildes, con guiones
  name TEXT NOT NULL,
  aisle TEXT NOT NULL,                -- sección del súper (ver src/shared/recipe-format.ts)
  pantry INTEGER NOT NULL DEFAULT 0 CHECK (pantry IN (0, 1))  -- despensa fija
);

CREATE TABLE recipes (
  id TEXT PRIMARY KEY,                -- slug estable, p. ej. "katsukare"
  title TEXT NOT NULL,
  minutes INTEGER NOT NULL CHECK (minutes > 0),
  protein TEXT NOT NULL,
  suits TEXT NOT NULL CHECK (suits IN ('lunch', 'dinner', 'both')),
  kcal_adult INTEGER CHECK (kcal_adult IS NULL OR kcal_adult > 0),
  kcal_estimated INTEGER NOT NULL DEFAULT 0 CHECK (kcal_estimated IN (0, 1)),
  source_url TEXT,
  adaptation_notes TEXT,
  freezer_note TEXT,
  tags TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags) AND json_type(tags) = 'array'),
  cover_photo_key TEXT,               -- clave del objeto en R2
  archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE recipe_ingredients (
  id INTEGER PRIMARY KEY,
  recipe_id TEXT NOT NULL REFERENCES recipes (id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  display_text TEXT NOT NULL,         -- texto visible, p. ej. "2 zanahorias"
  quantity REAL CHECK (quantity IS NULL OR quantity > 0),
  unit TEXT,                          -- g, kg, ml, l, ud, cda, cdta, pizca
  estimated INTEGER NOT NULL DEFAULT 0 CHECK (estimated IN (0, 1)),
  ingredient_id TEXT NOT NULL REFERENCES ingredients (id),
  UNIQUE (recipe_id, position)
);

CREATE INDEX idx_recipe_ingredients_ingredient ON recipe_ingredients (ingredient_id);

CREATE TABLE recipe_steps (
  recipe_id TEXT NOT NULL REFERENCES recipes (id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  text TEXT NOT NULL,
  timer_seconds INTEGER CHECK (timer_seconds IS NULL OR timer_seconds > 0),
  PRIMARY KEY (recipe_id, position)
);

-- Menú: un registro por día y franja. La "semana" es solo una vista de 7 días.
CREATE TABLE plan_meals (
  date TEXT NOT NULL,                 -- YYYY-MM-DD
  slot TEXT NOT NULL CHECK (slot IN ('lunch', 'dinner')),
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'away', 'empty')),
  recipe_id TEXT REFERENCES recipes (id),
  note TEXT,
  PRIMARY KEY (date, slot)            -- equivale a UNIQUE(date, slot)
);

CREATE INDEX idx_plan_meals_recipe ON plan_meals (recipe_id);

-- Cada vez que se cocina una receta. Sin registros, la receta es "nueva".
CREATE TABLE cook_logs (
  id INTEGER PRIMARY KEY,
  recipe_id TEXT NOT NULL REFERENCES recipes (id),
  plan_meal_date TEXT,
  plan_meal_slot TEXT,
  cooked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  stars INTEGER CHECK (stars IS NULL OR stars BETWEEN 1 AND 5),
  note TEXT,
  FOREIGN KEY (plan_meal_date, plan_meal_slot)
    REFERENCES plan_meals (date, slot) ON DELETE SET NULL
);

CREATE INDEX idx_cook_logs_recipe ON cook_logs (recipe_id, cooked_at);
CREATE INDEX idx_cook_logs_plan_meal ON cook_logs (plan_meal_date, plan_meal_slot);

CREATE TABLE shopping_lists (
  id INTEGER PRIMARY KEY,
  from_date TEXT NOT NULL,            -- YYYY-MM-DD
  to_date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (from_date <= to_date)
);

CREATE TABLE shopping_items (
  id INTEGER PRIMARY KEY,
  list_id INTEGER NOT NULL REFERENCES shopping_lists (id) ON DELETE CASCADE,
  ingredient_id TEXT REFERENCES ingredients (id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  quantity_text TEXT,
  aisle TEXT NOT NULL,
  pantry INTEGER NOT NULL DEFAULT 0 CHECK (pantry IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'buy' CHECK (status IN ('review', 'buy', 'home')),
  bought INTEGER NOT NULL DEFAULT 0 CHECK (bought IN (0, 1)),
  manual INTEGER NOT NULL DEFAULT 0 CHECK (manual IN (0, 1))
);

CREATE INDEX idx_shopping_items_list ON shopping_items (list_id);
CREATE INDEX idx_shopping_items_ingredient ON shopping_items (ingredient_id);

UPDATE app_meta SET value = '2' WHERE key = 'schema_version';
