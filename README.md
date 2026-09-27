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

Hazlos en este orden. Los nombres entre **negritas** son los de las opciones del panel (en inglés, que es como aparecen). Si alguno ha cambiado de nombre, el paso sigue siendo el mismo.

### 0. Antes de empezar

1. **El código tiene que estar en `main`.** Workers Builds despliega desde la rama de producción, así que fusiona en `main` la rama/PR de este paso antes de conectar el repositorio.
2. **R2 activado en la cuenta.** Si nunca has usado R2: en el panel ve a **R2 Object Storage** y actívalo (plan gratuito; Cloudflare pide un método de pago aunque no cobre dentro de la capa gratuita). Si R2 no está activado, el despliegue no podrá crear el bucket.
3. **Zero Trust activado.** Si nunca lo has usado: en el panel entra en **Zero Trust**, elige un *team name* (será `<team-name>.cloudflareaccess.com`) y el plan **Zero Trust Free** (también pide método de pago, sin cargo).

### 1. Conectar el repositorio (Workers Builds)

1. **Workers & Pages** > **Create application** > **Import a repository** (o *Connect to Git*). Autoriza la app de Cloudflare en GitHub para el repositorio `menu-familiar` si te lo pide.
2. Elige el repositorio `menu-familiar` y rellena:
   - **Project name**: `menu-familiar` (tiene que coincidir exactamente con `name` en `wrangler.jsonc`).
   - **Build command**: `npm run build`
   - **Deploy command**: `npm run deploy`
   - **Root directory**: vacío.
   - **API token**: deja **Create new token** (el automático).
3. Crea el proyecto. **El primer build fallará en el paso de D1**: es lo esperado hasta hacer el paso 2 (el token automático no tiene permiso sobre D1).
4. Si en el asistente no aparecían los comandos, ve al Worker > **Settings** > **Build** > **Build configuration** y pon los mismos valores.

### 2. Dar permiso de D1 al token de Workers Builds

El token que crea Workers Builds solo incluye *Account Settings (read)*, *Workers Scripts (edit)*, *Workers KV Storage (edit)* y *Workers R2 Storage (edit)*. Para crear la base de datos y aplicar migraciones necesita **D1: Edit**.

1. Arriba a la derecha, tu perfil > **My Profile** > **API Tokens**.
2. Localiza el token que ha creado Workers Builds (su nombre menciona `menu-familiar` / Workers Builds) > **Edit**.
3. En **Permissions**, añade una fila: **Account** · **D1** · **Edit**. Guarda (**Continue to summary** > **Update token**).
4. Vuelve al Worker > **Deployments** (o **Builds**) y pulsa **Retry build** en el build fallido (o haz cualquier push a `main`).

Con este build se crean solos, sin copiar ningún ID:

- La base de datos D1 **`menu-familiar`** (ubicación preferente Europa occidental), creada por [`scripts/deploy.sh`](scripts/deploy.sh).
- El bucket R2 **`menu-familiar-photos`**, aprovisionado por `wrangler deploy`.
- La migración `0001_app_meta.sql`.

En este momento la página ya carga, pero `/api/health` responde **500 "Access no está configurado"**: el Worker falla cerrado mientras falten las variables del paso 4. No hay datos expuestos.

### 3. Desactivar los preview builds

Así las ramas que no son `main` (por ejemplo las que uso yo, Claude, para trabajar) no generan despliegues de prueba.

1. Worker > **Settings** > **Build** > **Branch control**.
2. Comprueba que la rama de producción es `main` y **desmarca Enable Preview Builds**. Guarda.

Las URLs de versión/preview además están desactivadas en `wrangler.jsonc` (`"preview_urls": false`). Ver [Seguridad](#seguridad).

### 4. Activar Cloudflare Access (solo tu email)

1. **Workers & Pages** > `menu-familiar` > pestaña **Access** > **Protect this Worker behind Access**.
2. Elige **All traffic** (producción y previews).
3. En **Authentication policy** elige **Cloudflare account** (solo miembros de tu cuenta) y pulsa **Apply Access**. Lo afinamos en el punto siguiente: el asistente solo ofrece "cuenta de Cloudflare" o "dominio de email", y no queremos permitir todo `gmail.com`.
4. Activa el código por email: **Zero Trust** > **Integrations** > **Identity providers** > **Add new identity provider** > **One-time PIN**.
5. **Zero Trust** > **Access controls** > **Applications** > la aplicación creada para `menu-familiar` > **Configure**:
   - **Policies**: edita la política para que el **Include** sea **Emails** = tu email (y nada más).
   - **Login methods**: marca **One-time PIN**.
   - En **Additional settings**, copia el **Application Audience (AUD) Tag** (lo necesitas en el paso 5).
6. Tu **team domain** es `<team-name>.cloudflareaccess.com`. El *team name* está en **Zero Trust** > **Settings**. (También lo ves en la URL de la pantalla de login de Access.)

> Si tu panel no tiene la pestaña **Access** en el Worker, la alternativa equivalente es crear en **Zero Trust** > **Access controls** > **Applications** > **Add an application** > **Self-hosted** una aplicación con dominio `menu-familiar.<tu-subdominio>.workers.dev`, política **Emails** = tu email y login **One-time PIN**. El resto de pasos no cambia.

### 5. Variables de entorno del Worker

1. Worker > **Settings** > **Variables and Secrets** > **Add**:
   - `ACCESS_TEAM_DOMAIN` (tipo **Text**) = `<team-name>.cloudflareaccess.com`
   - `ACCESS_AUD` (tipo **Text**) = el AUD Tag del paso 4.
2. Pulsa **Deploy** para guardar. Los siguientes despliegues desde GitHub las conservan (`"keep_vars": true` en `wrangler.jsonc`).

No son secretos (el AUD viaja dentro de cada JWT), pero se configuran en el panel para no tenerlos en el código.

### 6. Comprobar que todo funciona

1. Abre `https://menu-familiar.<tu-subdominio>.workers.dev` en una ventana privada: Access debe pedirte el email y enviarte un código.
2. Tras entrar, la página debe mostrar **Menú familiar**, **✓ D1**, **✓ R2** y tu email.
3. Haz un cambio trivial en `main` y comprueba en **Deployments** que se despliega solo.

---

## Seguridad

- **Dos capas.** Access bloquea en el borde a cualquiera que no sea tu email. Además, el Worker valida en cada petición a `/api` el JWT de Access (cabecera `Cf-Access-Jwt-Assertion`, o la cookie `CF_Authorization` como respaldo): firma contra los certificados de `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`, emisor, AUD y caducidad. Sin token válido responde **401**; si faltan `ACCESS_TEAM_DOMAIN` o `ACCESS_AUD` responde **500** y no deja pasar a nadie.
- **Desarrollo local.** La validación solo se puede desactivar con `DEV_DISABLE_ACCESS=true` en `.dev.vars` (que no se sube ni se despliega) **y** si la petición llega a `localhost`/`127.0.0.1`. En `workers.dev` no tiene efecto aunque alguien definiera la variable.
- **URLs de preview: desactivadas.** `"preview_urls": false` en `wrangler.jsonc` y **Enable Preview Builds** desmarcado. Aun si se reactivasen, Access en modo **All traffic** también las protege.
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
