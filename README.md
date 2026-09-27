# Menú familiar

App web personal para planificar el menú familiar. La usa una sola persona desde iPhone, iPad, Windows y Mac.

**Estado actual: paso 0 (esqueleto).** Solo hay una página que comprueba que todas las piezas funcionan (D1, R2 y Cloudflare Access). Todavía no hay recetas, menús ni lista de la compra.

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

URL: `https://menu-familiar.<tu-subdominio>.workers.dev`.

### Estructura

```
src/client/        Frontend React (página mínima de estado)
src/worker/        Worker: API Hono + validación de Access
src/shared/        Tipos compartidos entre Worker y cliente
migrations/        Migraciones de D1 (SQL, numeradas)
scripts/deploy.sh  Comando de despliegue de Workers Builds
test/              Pruebas de la validación del JWT
wrangler.jsonc     Configuración del Worker y de los bindings
```

### Comandos

| Comando | Qué hace |
| --- | --- |
| `npm run dev` | Servidor local (Vite + runtime de Workers simulado, con D1 y R2 locales). |
| `npm run build` | Genera tipos, hace typecheck y compila frontend + Worker en `dist/`. |
| `npm run typecheck` | Solo typecheck. |
| `npm run lint` | ESLint. |
| `npm test` | Pruebas de la validación del JWT de Access. |
| `npm run check` | Lint + build. |
| `npm run db:migration:new -- <nombre>` | Crea una migración nueva vacía. |
| `npm run db:migrate:local` | Aplica las migraciones a la D1 local. |
| `npm run deploy` | Lo que ejecuta Workers Builds: crea la D1 si no existe, aplica migraciones en remoto y despliega. |

---

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

### Pendiente: despliegues de prueba (previews)

Workers Builds puede crear un despliegue de prueba (*Preview*) por cada push a una rama que no sea `main`. `"preview_urls": false` en `wrangler.jsonc` desactiva las URLs de versión, y Access en modo **All traffic** protege también las previews, así que no quedan públicas. Queda por revisar en **Settings** > **Builds** (pestaña **Previews Base** / **Branch control**) si conviene desactivar los preview builds del todo.

## Seguridad

- **Dos capas.** Access bloquea en el borde a cualquiera que no sea tu email. Además, el Worker valida en cada petición a `/api` el JWT de Access (cabecera `Cf-Access-Jwt-Assertion`, o la cookie `CF_Authorization` como respaldo): firma contra los certificados de `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`, emisor, AUD y caducidad. Sin token válido responde **401**; si faltan `ACCESS_TEAM_DOMAIN` o `ACCESS_AUD` responde **500** y no deja pasar a nadie.
- **Desarrollo local.** La validación solo se puede desactivar con `DEV_DISABLE_ACCESS=true` en `.dev.vars` (que no se sube ni se despliega) **y** si la petición llega a `localhost`/`127.0.0.1`. En `workers.dev` no tiene efecto aunque alguien definiera la variable.
- **URLs de versión y previews.** `"preview_urls": false` en `wrangler.jsonc`, y Access en modo **All traffic** protege también las previews (ver "Pendiente" arriba).
- **Sin secretos en el repo.** `.dev.vars` y `.env*` están en `.gitignore`; solo se versiona `.dev.vars.example`. El token de Cloudflare vive en Workers Builds, no en GitHub.
- La `/` y los ficheros estáticos no pasan por el Worker (los sirve la plataforma), así que para ellos la protección es solo Access. No contienen datos: todos los datos salen de `/api`.

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

(El objeto `_health/check.txt` lo escribe el endpoint de salud; se puede ignorar.)
