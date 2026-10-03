# Menú familiar

App web personal para planificar el menú familiar. La usa una sola persona desde iPhone, iPad, Windows y Mac.

**Estado actual: paso 6 (Recetas).** La pestaña **Recetas** muestra el recetario en una galería con buscador (por título e ingrediente), filtros y cuatro órdenes. Cada receta tiene ficha con historial de valoraciones y notas, «Añadir al menú», «Cocinar ahora» (sin planificar), cambio de portada, editor completo, «Mejorar con Claude» y archivar. Las recetas nuevas se adaptan con Claude a partir de un enlace y se pegan con vista previa. Antes: **paso 5 (Compra)**, con la lista por secciones del súper, despensa y funcionamiento sin conexión; **paso 4 (Planificador)**; **paso 3 (modo cocina)**.

## Stack

| Pieza | Qué es |
| --- | --- |
| Cloudflare Worker `menu-familiar` | Un único Worker sirve el frontend (static assets) y la API bajo `/api`. |
| Frontend | Vite + React + TypeScript (strict), con `@cloudflare/vite-plugin`. |
| API | [Hono](https://hono.dev) (ligero, pensado para Workers). |
| D1 (binding `DB`) | Base de datos SQLite `menu-familiar`. Migraciones en [`migrations/`](migrations). |
| R2 (binding `PHOTOS`) | Bucket `menu-familiar-photos` para las fotos de las recetas. |
| Cloudflare Access | Protege toda la app (solo tu email). Además, el Worker valida el JWT de Access en cada petición a `/api` ([`src/worker/access.ts`](src/worker/access.ts)). |
| Workers Builds | Cada push a `main` aplica las migraciones pendientes y despliega. Sin GitHub Actions ni tokens en GitHub. |
| zod | Validación de los datos que entran en la API, con mensajes en español. |
| Estilos | CSS plano: variables de tema en `src/client/styles/tokens.css`, componentes base (`.glass`, `.glass-bar`, `.chip`, `.chip-photo`, `.pill-button`) en `base.css` y CSS Modules por pantalla. Iconos de trazo de `lucide-react`. |

URL: `https://menu-familiar.<tu-subdominio>.workers.dev`.

### Estructura

```
src/client/        Frontend React: pages/ (pantallas), components/, styles/ (tokens.css y base.css)
src/worker/        Worker: API Hono, validación de Access, recetas, plan, fotos
src/shared/        Tipos, esquemas zod y reglas (fechas, tema, aviso de valoración) compartidos
public/            manifest.webmanifest e iconos (placeholder) de la PWA
migrations/        Migraciones de D1 (SQL, numeradas)
docs/              Formato de importación y ejemplos (docs/ejemplos/*.json)
scripts/deploy.sh  Comando de despliegue de Workers Builds
test/              Tests (vitest dentro del runtime de Workers, con D1 local)
wrangler.jsonc     Configuración del Worker y de los bindings
```

### Comandos

| Comando | Qué hace |
| --- | --- |
| `npm run dev` | Servidor local (Vite + runtime de Workers simulado, con D1 y R2 locales). |
| `npm run build` | Genera tipos, hace typecheck y compila frontend + Worker en `dist/`. |
| `npm run typecheck` | Solo typecheck. |
| `npm run lint` | ESLint. |
| `npm test` | Tests con vitest dentro del runtime de Workers, contra una D1 local en memoria con las migraciones aplicadas. |
| `npm run check` | Lint + build. |
| `npm run db:migration:new -- <nombre>` | Crea una migración nueva vacía. |
| `npm run db:migrate:local` | Aplica las migraciones a la D1 local. |
| `npm run deploy` | Lo que ejecuta Workers Builds: crea la D1 si no existe, aplica migraciones en remoto y despliega. |

---

## Modelo de datos

Definido en [`migrations/0002_modelo_datos.sql`](migrations/0002_modelo_datos.sql):

| Tabla | Para qué |
| --- | --- |
| `ingredients` | Catálogo compartido de ingredientes (clave: slug del nombre), con sección del súper y si es de despensa fija. |
| `recipes` | Recetas, ya adaptadas a 4 raciones. Etiquetas como array JSON; portada como clave de R2. Se archivan, no se borran. |
| `recipe_ingredients` | Líneas de ingrediente de cada receta, en orden, con cantidad, unidad y si es estimada. |
| `recipe_steps` | Pasos en orden, con temporizador opcional. |
| `plan_meals` | Menú: un registro por fecha y franja (comida o cena). |
| `cook_logs` | Cada vez que se cocina una receta: estrellas y nota. Sin registros, la receta es "nueva". |
| `shopping_lists`, `shopping_items` | Lista de la compra activa (una sola) y sus líneas, con estado, sincronización por campo y `client_id` para las creadas sin conexión (migración `0005`). |
| `recipes.cover_thumb_key` | Miniatura de la portada para la galería (migración `0006`). |
| `shopping_ops` | Ids de operaciones de la cola del móvil ya aplicadas (para que reenviar no duplique). |

Las listas que pueden crecer (secciones, proteínas, unidades) se validan en la API ([`src/shared/recipe-format.ts`](src/shared/recipe-format.ts); las secciones, en [`src/shared/aisles.ts`](src/shared/aisles.ts)) y no con `CHECK` en la base de datos, para poder añadir un valor sin migración.

## API

Toda bajo `/api` y protegida por Access.

| Método y ruta | Qué hace |
| --- | --- |
| `GET /api/health` | Estado de D1 (incluye número de recetas), R2 y usuario. |
| `POST /api/recipes/import` | Importa una receta `recipe@1`. `?replace=true` para reemplazar una existente. |
| `GET /api/recipes` | Listado ligero (sin archivadas; `?include_archived=true` para incluirlas), con `course`, `suits`, `photo_url`, `thumb_url`, veces cocinada, `last_cooked`, `avg_stars`, `ingredient_names`, `has_freezer` y `created_at`. La galería busca y filtra en el cliente: el recetario es pequeño (decenas de recetas) y así funciona al instante y sin red. |
| `GET /api/recipes/:id` | Receta completa con ingredientes, pasos en orden e historial de cocinados (`history`: fecha, franja, estrellas y nota). |
| `POST /api/recipes/preview` | Qué pasaría al importar una `recipe@1`, sin escribir nada (resumen, recuentos, ingredientes nuevos, si ya existe y errores). |
| `PUT /api/recipes/:id` | Sustitución completa desde el editor (`recipe@1` con el mismo id), atómica; conserva foto, archivo y valoraciones. |
| `PATCH /api/recipes/:id` | `{ archived }`: archivar o recuperar. |
| `GET /api/recipes/:id/export` | La receta en `recipe@1` (para «Mejorar con Claude»). |
| `POST /api/plan/import` | Importa un menú `plan@1`: primero las recetas nuevas que traiga y después las comidas, todo en un lote atómico. |
| `PUT /api/plan/:fecha/:franja` | Planifica una franja (`lunch`/`dinner`): `{ status, recipe_id?, note? }`. |
| `GET /api/day/:fecha` | `{ date, lunch, dinner }`, cada franja con estado, nota y receta completa (con `photo_url`, `last_stars`, `times_cooked`). |
| `GET /api/rating-prompt` | Comida pendiente de valorar, o `null` (regla en [`src/shared/rating-prompt.ts`](src/shared/rating-prompt.ts)). |
| `POST /api/rating-prompt/skip` | Pospone el aviso: `{ date, slot }`. |
| `POST /api/cook-logs` | Registra que se ha cocinado: `{ recipe_id, plan_meal_date?, plan_meal_slot?, cooked_at?, stars?, note? }`. |
| `PATCH /api/cook-logs/:id` | Completa una valoración: `{ stars?, note? }`. |
| `POST /api/recipes/:id/photo` | Nueva portada (cuerpo: JPEG, máx. 10 MB). Se guarda en R2 como `recipes/{id}/{timestamp}.jpg` y se borran la anterior y su miniatura. No cambia `updated_at`. |
| `POST /api/recipes/:id/photo/thumb?cover=` | Miniatura de 480 px de la portada actual (`….thumb.jpg`), para la galería; 409 si la portada ha cambiado. |
| `GET /api/plan?from&to` | Franjas de un rango (máx. 62 días) con receta resumida y valoración. |
| `POST /api/plan/batch` | Escribe varias franjas en una transacción (mover, intercambiar, deshacer). |
| `POST /api/plan/preview` | Qué cambiaría un `plan@1`, sin escribir: añadidos, sustituciones, recetas nuevas, errores. |
| `GET /api/claude-context?week=` | Contexto `contexto@1` de la semana para planificar con Claude. |
| `GET /api/photos/<clave>` | Sirve una foto de R2 con caché inmutable; 404 si no existe. |
| `GET /api/shopping` | Lista activa con sus líneas y los cambios del menú desde que se creó (`changes`), o `null`. |
| `GET /api/shopping/candidates?from&to` | Comidas planificadas con receta del rango y cuántas cosas quedan sin comprar en la lista actual. |
| `POST /api/shopping` | Crea la lista: `{ from, to, excluded, carry }`. Sustituye a la anterior en la misma transacción. |
| `POST /api/shopping/update` | Actualiza la lista con el menú actual; devuelve la lista y `{ added, removed, changed }`. |
| `PATCH /api/shopping/items/:id` | `{ bought?, status?, aisle?, quantity_text? }`. Cambiar la sección la cambia también en el catálogo. |
| `POST /api/shopping/items` | Añade a mano: `{ name, quantity_text?, aisle, ingredient_id? }`. |
| `DELETE /api/shopping/items/:id` | Solo lo añadido a mano (el resto: «En casa»). |
| `POST /api/shopping/ops` | Cola del móvil: `[{ id, item_id, op, fields, at }]`, en orden e idempotente por `id`; gana la escritura más reciente por línea y campo. |
| `GET /api/ingredients?q=` | Hasta 10 ingredientes del catálogo, sin distinguir tildes. |

Formatos de importación: [docs/formato-importacion.md](docs/formato-importacion.md).

## Pantallas y reglas

- **Hoy** (`/`): muestra una comida a pantalla completa. Antes de las 17:00 (hora de Madrid) la comida y después la cena; si esa franja no tiene receta y la otra sí, la otra. El botón sol/luna alterna entre comida y cena.
- **Tema**: con el sistema en modo oscuro, siempre oscuro. Si no, en Hoy la comida usa el tema claro y la cena el oscuro; en el resto de pantallas, claro hasta las 17:00 y oscuro después. Regla en [`src/shared/theme.ts`](src/shared/theme.ts).
- **Aviso de valoración**: al abrir la app (nunca en el modo cocina), si la comida planificada más reciente ya pasada no tiene estrellas (no se registró o se dejó para "valorar después"), tiene menos de 2 días y hoy no se ha respondido ya a ningún aviso. Cerrarlo sin guardar lo pospone al día siguiente.
- **Modo cocina** (`/cocinar/:fecha/:franja`): un paso a pantalla completa, con las cantidades que usa (de `uses` o detectadas en el texto), temporizadores simultáneos (guardados como hora de fin, sobreviven a recargas), hoja de ingredientes para marcar y gestos laterales. El progreso se guarda en `localStorage` (`cocina:{fecha}:{franja}`) durante 12 h. Pide Wake Lock para que no se apague la pantalla.
- **Al terminar**: foto de portada (cámara o galería, reducida a 1600 px y JPEG 0,82 en el móvil), estrellas opcionales y nota. "Valorar después" registra que se ha cocinado sin estrellas, y el aviso del día siguiente lo pregunta.
- **Tipos de plato** (`course`): solo los `main` se pueden planificar como comida o cena.
- **Planificador** (`/planificador?semana=AAAA-MM-DD`): semana de lunes a domingo; el domingo abre la siguiente. El contador de huecos cuenta desde hoy; las semanas terminadas no lo llevan. Equilibrio con mínimos semanales (legumbre 4, pescado 3; en `src/shared/balance.ts`). Selector de recetas con buscador, filtros y tres órdenes; acciones sobre cada hueco; mover/intercambiar; valorar comidas pasadas. URL del proyecto de Claude en `src/client/config.ts`.
- **Recetas** (`/recetas`): galería en dos columnas con buscador (título e ingredientes, sin tildes), chips (franja, ≤ 45 min, proteína, sin estrenar, para congelar, panes y guarniciones, archivadas) y orden (mejor valoradas, añadidas hace poco, hace más tiempo, A–Z). Filtros, orden y posición se recuerdan al volver de una ficha. Reglas en [`src/shared/gallery.ts`](src/shared/gallery.ts).
- **Ficha** (`/receta/:id`): portada, «Añadir al menú» (14 días, con Deshacer), «Cocinar ahora» (`/cocinar/receta/:id`: el cocinado se registra sin comida del plan; progreso en `cocina:receta:{id}`), estadísticas, «Lo que dijisteis», congelar, ingredientes, pasos y adaptación. Menú …: cambiar portada, editar, mejorar con Claude, pegar receta de Claude y archivar.
- **Editor** (`/receta/:id/editar`): pantalla completa (no una hoja) para que el teclado de iOS no tape el campo con foco. Datos, ingredientes y pasos; valida con el esquema de `recipe@1` y guarda con `PUT /api/recipes/:id`. Para dictar se usa el micrófono del teclado.
- **Miniaturas**: al subir una portada el móvil sube también una de 480 px; las portadas anteriores la generan al abrir su ficha (migración `0006`).
- **Compra** (`/compra`): ver [Lista de la compra](docs/formato-importacion.md#lista-de-la-compra). Secciones en el orden de la tienda (`src/shared/aisles.ts`); las completas se pliegan. Tocar una línea la marca; deslizar a la izquierda muestra «Sección» y «En casa» (o «Quitar» si se añadió a mano); sin gesto, el botón «Acciones» de cada línea (aparece con el foco de teclado o VoiceOver) hace lo mismo. Caché de la lista y cola de cambios en `localStorage` (`mf.shopping.*`).
- **Sin conexión**: service worker mínimo ([`src/sw/sw.js`](src/sw/sw.js), generado en el build por [`scripts/vite-sw.ts`](scripts/vite-sw.ts)): navegación primero por red (3 s) con el `index.html` guardado de reserva, `/assets/*` desde caché, `/api` nunca. Solo guarda respuestas 200 del mismo origen, así que las redirecciones al login de Access pasan y no se guardan. Cada build crea una caché nueva y borra la anterior.
- **Importar** (`/importar`): pegar un JSON `recipe@1` o `plan@1` (se detecta solo) y estado técnico.

## Instalar en el iPhone

Abre la app en Safari, inicia sesión en Access y usa **Compartir > Añadir a pantalla de inicio**. Para que el modo cocina mantenga la pantalla encendida hace falta iOS 18.4 o posterior (antes, Wake Lock no funcionaba en apps instaladas). Los temporizadores suenan con el móvil en silencio (se pide la sesión de audio "playback" al sonar), pero solo si la app está abierta: iOS congela las apps web en segundo plano y no pueden avisar hasta que vuelves. Se abre a pantalla completa (`display: standalone`), con el contenido bajo la Dynamic Island respetando las áreas seguras. Los iconos son provisionales.

## Importar recetas

El formato está en [docs/formato-importacion.md](docs/formato-importacion.md). Recetas (`recipe@1`) y menús (`plan@1`) se importan igual. Con Access delante, una petición desde fuera del navegador necesitaría credenciales extra, así que la forma recomendada es la **herramienta técnica de la página principal**, que usa tu sesión:

1. Abre la app e inicia sesión.
2. Ve a `/importar`, pega el JSON (por ejemplo, el contenido de [`docs/ejemplos/katsukare.json`](docs/ejemplos/katsukare.json)) y pulsa **Importar**. La página detecta sola si es una receta o un menú.
3. Si la receta ya existe, marca **Reemplazar si ya existe** para sustituirla (se conservan la portada y las valoraciones).

Funciona igual desde el iPhone. Es provisional: se sustituirá por la interfaz definitiva.

Alternativa sin la herramienta: en el navegador donde tengas la sesión abierta, consola de desarrollador sobre la app y:

```js
await fetch("/api/recipes/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(RECETA) }).then((r) => r.json());
```

Si algún día hace falta importar desde un script (sin navegador), la opción es un *service token* de Access (Zero Trust > Access controls > Service credentials) enviado en las cabeceras `CF-Access-Client-Id` y `CF-Access-Client-Secret`, más una política **Service Auth** en la aplicación. No está configurado.

## Puesta en marcha en Cloudflare (pasos manuales)

Ya está hecha (27-09-2026). Queda documentada por si hay que repetirla (por ejemplo, en otra cuenta). Los nombres en **negrita** son los del panel, en inglés; Cloudflare los cambia a menudo, así que pueden variar un poco.

**Datos de esta instalación** (no son secretos):

| | |
| --- | --- |
| URL | `https://menu-familiar.pablo-f-aneas.workers.dev` |
| Team domain de Access | `shrill-field-6efd.cloudflareaccess.com` |
| D1 | `menu-familiar` (Europa occidental) |
| R2 | `menu-familiar-photos` |

### 0. Antes de empezar

1. **El código tiene que estar en `main`**, que debe ser la rama por defecto del repositorio (GitHub > **Settings** > **General** > **Default branch**).
2. **R2 activado en la cuenta**: **Storage & databases** > **R2 object storage**. Si ofrece activarlo, plan gratuito (pide tarjeta, no cobra dentro de la capa gratuita). Si ya muestra **Create bucket**, está activo; no crees nada, el bucket lo crea el despliegue.

### 1. Conectar el repositorio (Workers Builds)

1. **Workers & Pages** > **Create application** > importar repositorio de GitHub. Autoriza la app de Cloudflare (basta con **Only select repositories** > `menu-familiar`).
2. Configuración:
   - **Project name**: `menu-familiar` (igual que `name` en `wrangler.jsonc`).
   - **Build command**: `npm run build`
   - **Deploy command**: `npm run deploy` (cuidado: el campo viene relleno con `npx wrangler deploy`; tiene que quedar `npm`, no `npx`).
   - **Root directory**: `/`.
   - **API token**: el que crea automáticamente (**menu-familiar build token**).
3. Todo esto se puede cambiar después en el Worker > **Settings** > **Builds** > **Build configuration**.

### 2. Permiso de D1 en el token de Workers Builds

La documentación de Cloudflare dice que el token automático no incluye D1, pero en esta instalación **ya venía con D1 · Edit**. Si un build falla al crear la D1 o al aplicar migraciones por falta de permisos: perfil > **My Profile** > **API Tokens** > **menu-familiar build token** > **Edit** > añadir **Account · D1 · Edit** > **Update token**, y **Retry build**.

El primer despliegue correcto crea solo, sin copiar ningún ID: la D1 `menu-familiar` (vía [`scripts/deploy.sh`](scripts/deploy.sh)), la migración `0001_app_meta.sql` y el bucket R2 `menu-familiar-photos`. Hasta hacer los pasos 3 y 4, `/api/health` responde **500 "Access no está configurado"** (el Worker falla cerrado).

### 3. Activar Cloudflare Access (solo tu email)

1. **Activar Zero Trust**: menú izquierdo > **Zero Trust** > **Get started**, plan **Free** (pide tarjeta, no cobra). Si el botón no hace nada, es el navegador (bloqueador, extensión): en esta instalación funcionó al cambiar de navegador / ventana privada. Cloudflare asignó un *team name* aleatorio (`shrill-field-6efd`); vale igual.
2. **Código por email**: **Zero Trust** > **Integrations** > **Identity providers** > **Add new identity provider** > **One-time PIN**.
3. **Proteger el Worker**: **Workers & Pages** > `menu-familiar` > pestaña **Access** > **Protect this Worker behind Access** > **All traffic** > política **Cloudflare account** > **Apply Access**. (El asistente solo ofrece "cuenta de Cloudflare" o "dominio de email"; se afina en el punto siguiente.)
4. **Restringir a tu email**: **Zero Trust** > **Access controls** > **Applications** > la aplicación de `menu-familiar`:
   - **Policies**: la política "Cloudflare account members" no se puede editar. Crea una nueva (**Action: Allow**, **Include** > **Emails** = tu email) y después quita la antigua. Debe quedar solo la tuya.
   - **Login methods**: marca **One-time PIN**.
   - Copia el **Application Audience (AUD) Tag**.

> Alternativa si el Worker no tiene pestaña **Access**: en **Zero Trust** > **Access controls** > **Applications** > **Add an application** > **Self-hosted**, dominio `menu-familiar.<tu-subdominio>.workers.dev`, política **Emails** = tu email, login **One-time PIN**.

### 4. Variables de entorno del Worker

**Ojo, hay dos sitios con nombre parecido.** Las variables van en **Settings** > **Runtime variables and secrets** (pestaña **Production**), **no** en **Builds** > **Variables and secrets** (esas solo existen durante la compilación y la app no las ve).

1. **Add variable**, tipo **Variable** (no hace falta *Secret*):
   - `ACCESS_TEAM_DOMAIN` = `<team-name>.cloudflareaccess.com`
   - `ACCESS_AUD` = el AUD Tag del paso 3.
2. **Deploy**.

El panel mostrará un aviso sugiriendo copiarlas a `wrangler.jsonc` "para mantener los despliegues sincronizados". No hace falta: `"keep_vars": true` en `wrangler.jsonc` hace que los despliegues desde GitHub las conserven. No son secretos (el AUD viaja dentro de cada JWT), pero así no están en el código.

### 5. Comprobar que todo funciona

1. Abre la URL en una ventana privada: Access pide el email y envía un código.
2. Tras entrar: **Menú familiar**, **✓ D1**, **✓ R2** y tu email.
3. Tras un push a `main`, en **Deployments** aparece un despliegue nuevo y la página sigue mostrando los dos ✓ (esto confirma también que las variables se conservan).

### 6. Desactivar los despliegues de prueba (previews)

Por defecto, Workers Builds compila cada push a una rama que no sea `main` (por ejemplo, las ramas `claude/...` en las que trabaja Claude). Aquí no sirven para nada, así que están apagados:

- Worker > **Settings** > **Builds** > pestaña **Previews Base** > interruptor **Builds for Preview branches** desactivado.
- Además, `"preview_urls": false` en `wrangler.jsonc`: aunque se reactivaran, no generarían URLs (el panel lo indica con el aviso "Preview URLs are disabled"). Y Access en modo **All traffic** también las protegería.
- Ojo: en la pestaña **Production**, el desplegable **Branch control** es la rama de *producción*; tiene que ser `main`.

---

## Seguridad

- **Dos capas.** Access bloquea en el borde a cualquiera que no sea tu email. Además, el Worker valida en cada petición a `/api` el JWT de Access (cabecera `Cf-Access-Jwt-Assertion`, o la cookie `CF_Authorization` como respaldo): firma contra los certificados de `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`, emisor, AUD y caducidad. Sin token válido responde **401**; si faltan `ACCESS_TEAM_DOMAIN` o `ACCESS_AUD` responde **500** y no deja pasar a nadie.
- **Desarrollo local.** La validación solo se puede desactivar con `DEV_DISABLE_ACCESS=true` en `.dev.vars` (que no se sube ni se despliega) **y** si la petición llega a `localhost`/`127.0.0.1`. En `workers.dev` no tiene efecto aunque alguien definiera la variable.
- **Previews desactivados.** Builds de ramas que no son `main` apagados, `"preview_urls": false` en `wrangler.jsonc`, y Access en modo **All traffic** protegería también las previews.
- **Sin secretos en el repo.** `.dev.vars` y `.env*` están en `.gitignore`; solo se versiona `.dev.vars.example`. El token de Cloudflare vive en Workers Builds, no en GitHub.
- La `/` y los ficheros estáticos no pasan por el Worker (los sirve la plataforma), así que para ellos la protección es solo Access. No contienen datos: todos los datos salen de `/api`.
- **Sesión caducada.** El cliente pide `/api` con `redirect: "manual"`: la redirección al login de Access (o un 401 del Worker) se reconoce como «sesión caducada» y no como falta de red. En Compra sale «Sesión caducada · Toca para entrar», que recarga la página para que Access pida el código; la cola de cambios del móvil se conserva y se envía después.
- **Service worker y caché en el móvil.** El service worker nunca guarda `/api` ni redirecciones (las de Access incluidas). La última lista de la compra sí se guarda en `localStorage` del iPhone para abrirla sin red; no sale del dispositivo.

---

## Desarrollo local

Requiere Node 22.

```sh
npm install
cp .dev.vars.example .dev.vars   # desactiva Access en local
npm run db:migrate:local         # crea la D1 local en .wrangler/
npm run dev                      # http://localhost:5173
```

D1 y R2 son simulaciones locales (en `.wrangler/state`), no tocan los datos reales.

Importar el ejemplo en local (Access está desactivado en `localhost`):

```sh
curl -X POST -H "Content-Type: application/json" --data-binary @docs/ejemplos/katsukare.json http://localhost:5173/api/recipes/import
curl http://localhost:5173/api/recipes/katsukare
```

Para probar la validación real del JWT en local, deja `DEV_DISABLE_ACCESS` vacío y rellena `ACCESS_TEAM_DOMAIN` y `ACCESS_AUD` en `.dev.vars`: `/api/health` devolverá 401 sin token.

## Añadir una migración

```sh
npm run db:migration:new -- nombre_descriptivo   # crea migrations/000N_nombre_descriptivo.sql
# edita el SQL
npm run db:migrate:local                         # pruébala en local
```

Al hacer push a `main`, Workers Builds la aplica en remoto **antes** de desplegar el código. Si la migración falla, no se despliega nada. Nunca edites una migración ya aplicada: crea otra nueva.

## Copias de seguridad

Necesitas Node y haber iniciado sesión una vez con `npx wrangler login` en el ordenador donde las hagas.

### D1

```sh
npx wrangler d1 export menu-familiar --remote --output backup-menu-familiar-$(date +%F).sql
```

Genera un `.sql` con esquema y datos. Para restaurarlo en una base vacía: `npx wrangler d1 execute <base> --remote --file backup.sql`.

Además, D1 tiene **Time Travel**: puedes volver la base a un momento reciente sin copia previa (`npx wrangler d1 time-travel info menu-familiar` y `npx wrangler d1 time-travel restore menu-familiar --timestamp <fecha>`). El plazo disponible depende del plan; consúltalo en la documentación de D1.

### R2 (fotos)

Wrangler solo descarga objetos de uno en uno, así que para una copia completa usa [rclone](https://rclone.org):

1. Panel > **R2 Object Storage** > **Manage API tokens** > **Create API token** con permiso **Object Read only** sobre el bucket `menu-familiar-photos`. Guarda el *Access Key ID*, el *Secret Access Key* y el endpoint `https://<account-id>.r2.cloudflarestorage.com`.
2. `rclone config` > nuevo remoto `r2`, tipo **Amazon S3**, proveedor **Cloudflare**, con esas credenciales y endpoint.
3. `rclone sync r2:menu-familiar-photos ./backup-fotos`

(Los objetos bajo `_health/` son de la comprobación de estado y se pueden ignorar o borrar.)
