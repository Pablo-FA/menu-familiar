-- Migración 0003: estado del aviso "¿qué tal estuvo?" (regla en src/shared/rating-prompt.ts).
--
-- * plan_meals.rating_skipped_at: última vez que se pospuso el aviso de esa comida
--   ("Ahora no", cerrar, tocar fuera o Escape). Es una columna y no una tabla aparte
--   porque el aviso es 1:1 con cada comida planificada.
-- * cook_logs.created_at: cuándo se registró la valoración (cooked_at es cuándo se
--   cocinó). Sirve para no preguntar más de una vez al día. SQLite no permite añadir
--   una columna con DEFAULT no constante, así que la rellena la API al insertar.
ALTER TABLE plan_meals ADD COLUMN rating_skipped_at TEXT;
ALTER TABLE cook_logs ADD COLUMN created_at TEXT;

UPDATE app_meta SET value = '3' WHERE key = 'schema_version';
