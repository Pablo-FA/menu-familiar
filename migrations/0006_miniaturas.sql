-- Migración 0006: miniatura de la portada (paso 6).
--
-- La galería de Recetas muestra muchas portadas a la vez; con fotos de 1600 px el iPhone
-- tendría que decodificar decenas de imágenes grandes. Al subir una portada, el móvil
-- sube también una miniatura de 480 px. Las portadas anteriores la generan la primera
-- vez que se abre su ficha. Mientras no la tengan, la galería usa la foto completa.
ALTER TABLE recipes ADD COLUMN cover_thumb_key TEXT;

UPDATE app_meta SET value = '6' WHERE key = 'schema_version';
