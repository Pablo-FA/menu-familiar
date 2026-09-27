#!/bin/sh
# Comando de despliegue de Workers Builds (Settings > Build > Deploy command: npm run deploy).
# Se ejecuta después del Build command (npm run build).
#
# 1. Crea la base de datos D1 si aún no existe (solo pasa en el primer despliegue).
#    No se puede delegar en el aprovisionamiento automático de `wrangler deploy`
#    porque las migraciones tienen que aplicarse ANTES de desplegar, y para
#    entonces la base de datos ya debe existir.
# 2. Aplica las migraciones pendientes en remoto.
# 3. Despliega el Worker (el bucket R2 lo aprovisiona wrangler deploy si no existe).
#
# Si cualquier paso falla, el script se detiene y no se despliega nada.
set -eu

DB_NAME="menu-familiar"
# Ubicación preferente de la base de datos: Europa occidental.
DB_LOCATION="weur"

if npx wrangler d1 info "$DB_NAME" >/dev/null 2>&1; then
  echo "D1 '$DB_NAME' ya existe."
else
  echo "D1 '$DB_NAME' no existe: creándola…"
  npx wrangler d1 create "$DB_NAME" --location "$DB_LOCATION"
fi

npx wrangler d1 migrations apply DB --remote
npx wrangler deploy
