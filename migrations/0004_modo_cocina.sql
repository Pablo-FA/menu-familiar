-- Migración 0004: ajustes del modelo para el modo cocina.
--
-- * recipes.course: tipo de plato. Solo los 'main' se pueden planificar como comida o
--   cena; 'side' (panes, guarniciones), 'breakfast' y 'drink' quedan en el recetario.
--   Lista cerrada y estable: lleva CHECK.
-- * recipe_steps.uses: array JSON de ids de ingrediente (slugs del catálogo) que usa el
--   paso. Si es NULL, el modo cocina los deduce del texto del paso.
-- * recipe_steps.timer_label: nombre corto del temporizador ("Patatas", "Horno").
ALTER TABLE recipes ADD COLUMN course TEXT NOT NULL DEFAULT 'main'
  CHECK (course IN ('main', 'side', 'breakfast', 'drink'));
ALTER TABLE recipe_steps ADD COLUMN uses TEXT
  CHECK (uses IS NULL OR (json_valid(uses) AND json_type(uses) = 'array'));
ALTER TABLE recipe_steps ADD COLUMN timer_label TEXT;

-- Recetas que no son plato principal. No hace nada si todavía no existen.
UPDATE recipes SET course = 'side' WHERE id IN ('pan-harcha', 'english-muffins');

UPDATE app_meta SET value = '4' WHERE key = 'schema_version';
