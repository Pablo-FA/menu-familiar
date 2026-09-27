-- Migración 0001: tabla de metadatos de la app.
-- Solo sirve para probar el circuito de migraciones; el modelo de datos real llega en el paso 1.
CREATE TABLE app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO app_meta (key, value) VALUES ('schema_version', '1');
