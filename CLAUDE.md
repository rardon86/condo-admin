# CLAUDE.md — condo-admin (AROR · Administración de Complejos)

SaaS de **AROR Consulting** para administrar complejos **residenciales y recreativos**: finanzas con contabilidad de partida doble, servicios del complejo, personal con marcación por GPS y un portal de solo consulta para propietarios. Se va a comercializar: trátalo como producto, no como prototipo.

- Repo: `github.com/rardon86/condo-admin` (público). Producción: https://d36f7q0ioij685.cloudfront.net (AWS us-east-1).
- Idioma: **todo en español** (UI, mensajes de error de la API, comentarios, commits, docs). El dueño (Ricardo) escribe informal.
- Zona horaria de negocio por defecto: `America/El_Salvador`, moneda USD.

## Comandos

```bash
npm install                    # monorepo con workspaces: apps/api, apps/web (infra/ es aparte: npm install --prefix infra)
docker compose up -d db        # PostgreSQL 16 en localhost:5432 (app/app, db residencial)
cp apps/api/.env.example apps/api/.env
npm run build -w apps/api && npm run db:migrate && npm run db:seed   # demo (pass Demo1234): admin demo@residencial.app · propietaria residente@residencial.app o 7000-0001 · 7000-0029 = dueño de C-29 y C-30
npm run dev:api                # http://localhost:3000/api
npm run dev:web                # http://localhost:5173 (Vite proxy /api → :3000)

npm run typecheck              # API + web (lo que exige CI)
npm test                       # node --test + tsx sobre apps/api/test/*.test.ts (lógica pura, sin BD)
npm run db:generate            # genera migración desde apps/api/src/db/schema.ts
node scripts/audit-gate.mjs    # auditoría de dependencias (igual que CI)
```

`db:migrate` y `db:seed` corren desde `dist/` → compila la API antes.

`apps/api/.env` (ignorado por git) se carga con `process.loadEnvFile` **solo fuera de producción**; ahí van también `SUPERADMIN_USERNAME`/`SUPERADMIN_PASSWORD` para tener el superusuario en local. Nunca subas contraseñas al repo (es público).

## Estructura

```
apps/api/src
  main.ts                 bootstrap: helmet, body 1 MB, trust proxy 2, timeouts, prefijo /api
  config/env.ts           variables validadas con Zod (falla al arrancar si faltan / son inseguras)
  db/schema.ts            ÚNICA fuente del modelo de datos (Drizzle)
  db/{client,migrate,seed}.ts
  common/                 auth.guard (guard global), auth.decorators (@Public @NoTenant @SuperAdmin @Roles),
                          zod.pipe, money (centavos), dates (tz), geo (Haversine/geocercas), shifts, forecast (Holt), image (logos), audit,
                          fees (reglas puras de cuotas), statement (estado de cuenta), receipts (recibo único), phone (teléfono = usuario)
  modules/
    auth        registro de propietarios (teléfono obligatorio), login (correo, usuario o teléfono), refresh, /me, contraseña, logo público
    complexes   ajustes del proyecto (incl. cuotas y recargos), saldo inicial, usuarios internos (rol/quitar),
                propietarios: alta por teléfono, aprobar, desactivar, eliminar, asignar propiedades (/current/residents)
    platform    SOLO superusuario: proyectos (+ admin, logo, ELIMINAR con confirmación) y empleados (+ asignación a proyectos)
    units       propiedades (crear sin dueño, eliminar sin historia) + vínculo con propietarios (owners.ts)
    users       SOLO superusuario: usuarios, superusuarios, activar/desactivar, contraseña, accesos por proyecto (/admin/users)
    catalogs    catálogos por proyecto (tipos de propiedad, categorías de avisos) — guardan el `code`
    fees        cuotas: cargos, pagos con recibo, saldo a favor, recargos por mora, generación automática (FeesScheduler)
    ledger      catálogo de cuentas + LedgerService (asientos, reversos, saldos)
    movements   ingresos / egresos (generan asiento; se anulan, nunca se borran)
    services    catálogo de servicios con costo/precio y servicios brindados
    staff       empleados del proyecto (lectura), geocercas, marcación y reporte de horas
    community   avisos, consultas/reclamos (tickets), portal del propietario
    reports     dashboard, informe mensual de gastos, estados financieros, proyecciones, estado de cuenta por propiedad
apps/api/drizzle/         migraciones versionadas (NO editar las ya aplicadas)
apps/api/test/            pruebas de dominio y seguridad
apps/web/src
  App.tsx                 enrutado por rol (sin sesión / pendiente / propietario / interno / superusuario)
  lib/api.ts              fetch con Bearer + X-Complex-Id, refresh automático ante 401
  lib/auth.tsx            contexto de sesión, `can(role, action)` (solo UI; la API decide)
  lib/theme.ts            tema oscuro/claro + colores de gráficos (CHART, tooltipStyle)
  lib/catalogs.ts         useCatalog(key) → opciones activas + traductor código→nombre
  lib/xlsx.ts             downloadXlsx: genera .xlsx real en el navegador (fflate)
  components/             ui.tsx (Button, Card, Kpi, Table, Modal…), Layout (menú con secciones plegables), Brand, ProjectLogo, LogoField, ExcelButton
  pages/                  una página por pantalla
apps/web/public/          brand/aror-logo*.png, favicon.png, theme-init.js
infra/lib/residencial-stack.ts   CDK: VPC, RDS, ECS Fargate+ALB, S3+CloudFront, WAF, Secrets Manager
.github/workflows/        ci.yml, deploy.yml, migrations.yml, deps.yml
docs/                     ARQUITECTURA.md, SEGURIDAD.md, DESPLIEGUE_AWS.md
```

## Reglas del dominio (no romper)

**Multi-tenant por fila.** Toda tabla de negocio tiene `complex_id`. El cliente manda `X-Complex-Id`; `AuthGuard` valida membresía ACTIVA y deja `req.tenant = { complexId, role, unitId }`. **Toda** consulta filtra por `t.complexId` (usa `@Tenant() t`). El superusuario entra a cualquier proyecto como `ADMIN`.

**Roles** (`member_role`): `ADMIN` (y `OWNER`, valor heredado = ADMIN), `ACCOUNTANT`, `VIEWER` (junta), `STAFF`, `RESIDENT` (propietario). Además `users.is_super_admin`.
- **Denegación por defecto**: una ruta sin `@Roles(...)` solo admite `ROLES.INTERNAL`. Un propietario solo accede a rutas que incluyen `'RESIDENT'` explícitamente (`portal`, `announcements` GET, `tickets`). Al crear endpoints nuevos para propietarios, filtra además por `createdBy`/`unitId` propios.
- Propietarios se auto-registran (`POST /auth/register` con proyecto + código de propiedad + teléfono) → membresía `PENDING` (guarda la propiedad pedida en `memberships.unit_id`) hasta que un admin la aprueba; al aprobar se vincula esa propiedad en `unit_owners`. También los da de alta el admin en Propietarios.
- Los proyectos y empleados los crea **solo el superusuario** (`/admin/*`). Un empleado es global y se asigna a N proyectos (`employee_assignments`); al asignarlo con usuario, se le crea/quita membresía `STAFF` automáticamente (`PlatformService.syncStaffMemberships`, nunca rebaja un rol superior).

**Contabilidad de partida doble.** Todo dinero entra al libro por `LedgerService.post()` (valida que cuadre). Ingreso: Debe 1100 Caja / Haber cuenta 4xxx. Egreso: Debe 5xxx / Haber 1100. Estados financieros, saldo de caja, KPIs y proyecciones se **derivan del libro**; no agregues campos "saldo".
- Nada contable se edita ni borra: se **anula** (`voidedAt` + asiento de reversión con `ledger.reverse`) y se audita (`AuditService`).
- Cuentas `x000` son de agrupación (no reciben movimientos). Códigos de sistema en `SYSTEM_ACCOUNTS`.
- Saldo inicial = asiento `sourceType: 'OPENING'` (se reemplaza al cambiarlo).

**Dinero**: `NUMERIC(14,2)` en BD, **centavos enteros** en memoria (`toCents`, `centsToDb`, `fromCents`). Nunca sumes floats.

**Fechas**: contables como `'YYYY-MM-DD'` sin zona. "Hoy" y rangos de días se calculan en la zona del complejo (`todayIn`, `zonedStartOfDay`).

**Marcación**: la hora válida es la del servidor; la del dispositivo se guarda como evidencia (desfase > 5 min se señala). Geocerca más cercana con tolerancia por precisión GPS (máx. +50 m). `require_geofence` rechaza fuera de zona; si no, acepta y señala. No se permite doble IN/OUT seguido.

**Terminología**: en la UI y mensajes se dice **propiedad** (nunca "unidad"); en código y BD la tabla sigue siendo `units` / `unitId`.

**Cuotas (devengo)** — `FeesService`, reglas puras en `common/fees.ts`:
- Cargo (`charges`): Debe 1200 / Haber 4xxx (4100 cuota mensual, 4400 recargo, otra 4xxx para extraordinarias). Una cuota CUOTA vigente por propiedad y mes, un RECARGO vigente por cargo (índices únicos parciales → idempotente).
- Pago de cuotas = `movements` INCOME con `accountId` = 1200 y `receiptNumber` obligatorio: Debe 1100 / Haber 1200 (aplicado) + Haber 2200 (sobrante = saldo a favor). Se aplica FIFO por vencimiento (`payment_allocations`, con `appliedAt` = fecha de aplicación).
- Saldo a favor se aplica solo al emitir cargos (Debe 2200 / Haber 1200). Anular cargo pagado: reverso + Debe 1200 / Haber 2200. Anular pago (desde `/incomes/:id/void`): Debe 1200 (aplicado vigente) + Debe 2200 (resto) / Haber 1100 — **no** es un reverso simple.
- Todo bajo `pg_advisory_xact_lock` por proyecto. Ingreso suelto a 4100 está bloqueado (se cobra en Cuotas).
- Automático: `FeesScheduler` cada hora, solo proyectos con `autoGenerateFees`; desactivar con `FEES_SCHEDULER=false`. Ajustes del proyecto: día de vencimiento, recargo (NONE/FIXED/PERCENT), días de gracia.
- Estado de cuenta (`AccountStatementService`): saldo anterior + cargos − pagos del periodo; vencido = cargo con vencimiento pasado y saldo; muestra la fecha de aplicación (y recibo) de cada pago. El propietario ve los suyos en `GET /portal/statement?unitId=` (solo propiedades de `ownedUnitIds`; por defecto la primera).
- Recargo: una vez por cuota/extraordinaria vencida tras los días de gracia; solo lo emite el proceso automático (no hay botón en la UI; existe `POST /fees/late-fees/run`).
- Saldos anteriores al sistema: "Nuevo cargo" tipo Otro. Recomendado al cliente: crear una cuenta propia (p. ej. 4800 "Cuotas de periodos anteriores") para no inflar 4100 del mes de corte; confirmarlo con su contador.
- **Drizzle**: en subconsultas correlacionadas escribe la tabla explícita en el SQL (`"charges"."id"`); `${tabla.col}` puede salir sin calificar y apuntar a la tabla interna. Prefiere `leftJoin` + `groupBy`.

**Propiedad ↔ propietario** (muchos a muchos, `unit_owners`, helpers en `modules/units/owners.ts`): la propiedad se crea sin dueño y se le vinculan propietarios (usuarios con membresía RESIDENT del proyecto); un propietario puede tener varias y una propiedad varios dueños. `refreshOwnerSnapshot` copia nombre(s)/correo/teléfono a `units.owner_*` (lo que leen reportes). `units.owner_user_id` es OBSOLETO (se quitará en otro despliegue). `memberships.unit_id` = propiedad principal / la que pidió al registrarse. El portal resuelve las propiedades del usuario con `ownedUnitIds` (nunca por parámetro sin validar).
- **Propietarios ingresan con su teléfono**: `users.username` = solo dígitos (`common/phone.ts`); el login acepta el teléfono con guiones o espacios. El correo es opcional (`users.email` admite null).
- Alta de propietario/usuario interno **nunca reutiliza en silencio** una cuenta que ya pertenece al proyecto (antes un correo repetido movía la propiedad o rebajaba a un admin a propietario).
- Eliminar: propiedad solo sin cargos/pagos/servicios (si no, desactivar); propietario = se desvincula y pierde el acceso (cuenta desactivada si no le queda ningún proyecto); proyecto (solo superusuario, confirmando el nombre exacto) = borrado en cascada de todo lo suyo.

**Usuarios**: `users.active=false` bloquea login, refresh y guard. Cambiar contraseña, desactivar o quitar superusuario incrementa `tokenVersion`. Siempre debe quedar un superusuario activo y nadie se desactiva a sí mismo.

**Marcación — visibilidad**: el rol STAFF solo recibe hora y tipo de sus marcaciones (sin zona, distancia ni observaciones; con geocerca exigida, el rechazo es un mensaje genérico); la administración (FIN_READ) ve el detalle completo en `/attendance/entries` (zona, distancia, desfase de reloj, IP, dispositivo, quién marcó manual). La API permite marcar por otro empleado (admin), pero **no hay pantalla** para eso todavía.

**Ingresos**: el campo es **N.º de recibo físico** (`movements.receipt_number`, único por proyecto entre ingresos vigentes; si se anula, el número queda libre). El "pagador" ya no se usa en ingresos; `counterparty` queda para proveedor en egresos.

**Catálogos** (`catalog_items`, por proyecto): PROPERTY_TYPE y NEWS_CATEGORY; las columnas guardan el `code` (no se cambia; el nombre sí; se desactivan, no se borran). Proyectos nuevos los reciben con `CatalogsService.seed`. Cuentas contables: crear 4xxx/5xxx, renombrar y desactivar (las de sistema no se desactivan). Métodos de pago y tipos de consulta son fijos.

**Servicios brindados** congelan `unitCost/unitPrice` al registrarse; opcionalmente generan ingreso (4300) y costo (5700) en la misma transacción.

**Logos de proyecto**: base64 en `complexes.logo` (PNG/JPEG/WebP ≤ 300 KB, validado por firma de archivo; **nunca SVG**). Se sirven en `GET /api/public/projects/:id/logo?v=<logoUpdatedAt>` con caché larga. **No selecciones la columna `logo` en listados** (usa `getTableColumns(complexes)` sin `logo`).

## Convenciones de código

- Validación: cada body/query con un esquema Zod y `new ZodPipe(schema)`. Arreglos siempre con `.max()`. Mensajes en español.
- Consultas con Drizzle (parametrizadas). En `sql\`\`` solo constantes o `${columna}`/valores enlazados; **nunca** concatenar texto del usuario.
- Operaciones compuestas en `db.transaction`; los servicios aceptan `tx: Tx` para componerse (`createInTx`).
- Errores: excepciones de Nest con mensaje en español (el frontend muestra `message`).
- Frontend: TanStack Query para datos (`get/post/patch/del` de `lib/api`), formularios no controlados + `formData(e)`. Componentes de `components/ui.tsx`; no traer librerías de UI.
- **Tema**: oscuro por defecto (`data-theme` en `<html>`). Tailwind v4 redefine escalas bajo `[data-theme='dark']` (la escala `slate` está **invertida**: 50 = superficie, 900 = texto). Usa `bg-surface`, `bg-canvas`, `text-link`, `text-slate-*`, `brand-*` (esmeralda). **No uses `bg-white` ni colores hex** en páginas internas; gráficos con `CHART` de `lib/theme`. Barra lateral siempre medianoche (`bg-sidebar`). La pantalla de login usa colores fijos a propósito.
- CSP estricta en producción (`script-src 'self'`): **sin scripts inline** (por eso `public/theme-init.js`). Fuentes solo de Google Fonts.
- Responsive: tablas dentro de `<Table>` (scroll horizontal en la tarjeta), modales tipo hoja en móvil.
- **Excel**: todo reporte/listado lleva `<ExcelButton>` + `downloadXlsx` (`lib/xlsx.ts`, .xlsx real con `fflate`; montos como número en columnas `money`, título y fila de totales). Se genera en el navegador con los datos ya cargados.
- Menú lateral: secciones desplegables (estado en `localStorage` `menu-sections`; la sección de la página actual se abre sola).

## Base de datos y migraciones

- Flujo: editar `schema.ts` → `npm run db:generate` → revisar el SQL → commitear junto con el código. CI falla si el esquema y `apps/api/drizzle` no coinciden.
- Al empujar a una rama `feat/**`, el workflow `migrations.yml` genera y sube la migración automáticamente si faltó.
- **No reescribas migraciones aplicadas.** Producción migra sola al arrancar (`RUN_MIGRATIONS=true`).
- Historia: `0000_init` tiene `when` forzado a `1700000000000` porque el primer despliegue generó la migración dentro de la imagen; `0001` incluye un `INSERT` manual que conserva la asignación de empleados al eliminar `employees.complex_id`. Si un cambio requiere mover datos, edita el SQL generado de la migración nueva y pruébalo contra Postgres con datos.
- Cambios destructivos (DROP/RENAME) → en dos despliegues (añadir, migrar datos, luego quitar).
- Drizzle aplica todas las migraciones pendientes en **una sola transacción**: en una BD nueva, un valor de enum agregado en una migración anterior (p. ej. `RESIDENT` en 0001) no se puede usar en SQL de otra. Compara como texto (`role::text = 'RESIDENT'`) en los UPDATE de datos. Prueba siempre `db:migrate` contra una BD vacía y contra una con datos.

## Dependencias

- `package-lock.json` es obligatorio (CI usa `npm ci`). El workflow `deps.yml` lo regenera en ramas `feat/**` al cambiar `package.json` (incluye `npm audit fix` y `npm dedupe`).
- `drizzle-orm` **debe quedar en la raíz** de `node_modules` (está como devDependency + `overrides` en el `package.json` raíz) o `drizzle-kit` falla con "Please install latest version of drizzle-orm".
- `overrides.multer` fuerza la versión corregida (dependencia de `@nestjs/platform-express`).
- **Zod se mantiene en v3** a propósito: en v4, `.default()` dentro de `.partial()` se aplica en los PATCH y, por ejemplo, `projectIds: []` desasignaría empleados. Hay excepción temporal en `.audit-allowlist.json` (vence 2027-01-31). Migrar a v4 requiere quitar defaults de los esquemas usados con `.partial()` y probar actualizaciones parciales.
- `scripts/audit-gate.mjs` bloquea vulnerabilidades altas/críticas de producción salvo excepciones con fecha en `.audit-allowlist.json`.

## Git, CI y despliegue

- Trabaja en ramas `feat/<tema>`; CI (`ci.yml`) corre en `feat/**`, `develop`, `main` y PRs: auditoría → typecheck → tests → migraciones al día → build → migrar + seed contra Postgres real → build de la imagen Docker.
- Integra con fast-forward a `main` cuando CI esté verde. **Push a `main` = despliegue a producción** (`deploy.yml`, ~15–25 min). Para cambios solo de docs usa `[skip ci]` en el commit.
- Despliegue: OIDC → `cdk bootstrap` → stack ECR → build/push imagen → stack principal (ECS aplica migraciones; rollback automático por circuit breaker) → `vite build` a S3 + invalidación de CloudFront.
- GitHub: secretos `AWS_DEPLOY_ROLE_ARN`, `SUPERADMIN_PASSWORD`; variables `DEPLOY_ENABLED=true`, `AWS_REGION`, opcionales `DOMAIN_NAME`, `CERTIFICATE_ARN`.
- El rol IAM confía en `sub` con IDs inmutables: `repo:rardon86@6201378/condo-admin@1441497135:*` (y la forma por nombre). El paso "Diagnóstico OIDC" imprime los claims si vuelve a fallar.
- Superusuario: `SUPERADMIN_USERNAME` (por defecto `ricardo`) + contraseña desde Secrets Manager; se crea al arrancar **solo si no existe** y nunca se resetea. Para cambiar la de producción: Mi cuenta o Plataforma → Usuarios.
- **Flujo acordado con Ricardo**: todo cambio se prueba primero en local (él revisa en http://localhost:5173) y **solo cuando él confirma** se hace commit → push de `feat/<tema>` → PR a `main` → esperar CI verde (push y PR; `deps.yml`/`migrations.yml` pueden agregar commits a la rama: integrar el último) → fast-forward a `main` → seguir `Deploy AWS` y verificar `/api/health` + que el bundle publicado traiga los textos nuevos.
- **Sin `gh` en esta PC**: el PR se abre con la API de GitHub usando la credencial que guarda Git Credential Manager (`git credential fill` → token en variable de entorno, nunca impreso). `bind_pr` de la app no funciona porque la sesión no corre dentro del repo.

## Entorno local (PC Windows de Ricardo)

- Repo en `C:\Users\Ricardo Ardon\Documents\ClaudeWorkspace\condo-admin`. Herramientas instaladas con winget: Git, Node 22 (LTS de la imagen), Docker Desktop (requiere WSL2; tras reiniciar la PC hay que abrir Docker Desktop antes de `docker compose up -d db`).
- Servidores de vista previa en `ClaudeWorkspace/.claude/launch.json` (fuera del repo): `api` y `web` con `npm --prefix condo-admin run dev:*`.
- `apps/api/.env` local trae `SUPERADMIN_USERNAME`/`SUPERADMIN_PASSWORD` (las del secreto de GitHub; no se copian aquí).
- Reiniciar la base con datos demo: `docker compose down -v && docker compose up -d db`, luego build + migrate + seed (el seed tarda ~50 s: genera 14 meses de cuotas y pagos).
- En Git Bash, los scripts `node -e` con backticks o `${}` se rompen: para TS/TSX usa el editor o heredocs con `'EOF'`.

## Historial de entregas (noviembre 2026)

| PR | Qué entró |
|---|---|
| [#12](https://github.com/rardon86/condo-admin/pull/12) | Estado de cuenta por propiedad (interno y portal), carga de `.env` local, X del menú móvil, impresión sin menú |
| [#13](https://github.com/rardon86/condo-admin/pull/13) | Módulo de cuotas (devengo, recibos, saldo a favor, recargos, generación automática), catálogos, gestión de usuarios (superusuarios, activar/desactivar), "propiedad" en vez de "unidad", dirección exacta, N.º de recibo, alta de propietarios por admin, visibilidad de marcación, Excel en todos los reportes, menú plegable. Migraciones 0003 y 0004 |
| [#14](https://github.com/rardon86/condo-admin/pull/14) | Propietarios muchos a muchos (`unit_owners`), ingreso por teléfono y correo opcional, eliminar proyectos/propiedades/propietarios, corrección del bug de correo repetido. Migración 0005 |

- **Bug corregido en #14 (revisar en producción)**: crear un propietario con un correo existente reutilizaba esa cuenta y le movía la propiedad (se "veía un solo propietario"); si era el correo de un administrador, lo convertía en propietario. Pedir a Ricardo que confirme en cada proyecto que ningún admin quedó como propietario.
- El rediseño visual (tema, login, menú) **ya se validó con capturas** en escritorio y móvil, ambos temas.

## Documentación para usuarios

- **Manual de primer uso** (para quien configura un complejo): https://claude.ai/artifact/HUbcWTMYrwbx2dzoz8Cn8i — ruta de configuración en 8 pasos, operación diaria, reportes, consideraciones y preguntas frecuentes. **Actualízalo** cuando cambie un flujo visible (propietarios, cuotas, roles…).

## Infraestructura AWS (infra/)

CloudFront (WAF + cabeceras de seguridad) → `/*` S3 privado (OAC) con función de reescritura SPA · `/api/*` → ALB (**solo acepta la prefix list de CloudFront**) → ECS Fargate 2–6 tareas (autoescalado CPU 65 %) en subred privada → RDS PostgreSQL 16 t4g.micro en subred aislada, cifrada, TLS verificado (`/app/rds-ca.pem` en la imagen), backups 14 días.
- No uses `errorResponses` de CloudFront para la SPA: convertía errores de la API en `index.html` 200. Ya se resuelve con la CloudFront Function.
- `trust proxy = 2` (CloudFront + ALB) para obtener la IP real; si cambias la cadena de proxies, ajusta este número.
- WAF: 1.500 req/5 min por IP, 60/5 min en `/api/auth/*`, reglas administradas (IP reputation, Common con `SizeRestrictions_BODY` en conteo por los logos, KnownBadInputs, SQLi).
- La alarma `TargetTracking…AlarmLow` en CloudWatch es normal (autoescalado con poco tráfico).
- Costo aprox.: 80–100 USD/mes (NAT ~35, WAF ~10–12, RDS, Fargate).

## Decisiones tomadas (y por qué)

| Decisión | Motivo |
|---|---|
| Monolito modular NestJS + monorepo | Un solo despliegue y transacciones simples; módulos por dominio separables después |
| Drizzle en vez de Prisma | SQL tipado sin binarios nativos; migraciones legibles |
| Partida doble | Estados financieros consistentes y auditables, sin lógica duplicada |
| Anular en vez de borrar | Pista de auditoría que exigen juntas y auditores |
| Multi-tenant por fila (no BD por cliente) | Barato y simple para muchos condominios pequeños; RLS de Postgres como siguiente barrera |
| Propietario = portal de solo consulta | Pedido explícito: ven avisos, sus pagos y sus consultas; nada de finanzas del complejo |
| Superusuario de plataforma crea proyectos y empleados | Modelo de negocio SaaS: AROR administra la plataforma; cada proyecto tiene su admin |
| Proyecciones con Holt (estacional con ≥ 24 meses) | Simple y explicable para series mensuales cortas |
| Tema oscuro medianoche/esmeralda por defecto, claro opcional | Pedido del dueño ("el blanco me mata los ojos"), sobrio y elegante |
| Logos en BD (base64) en vez de S3 | Pocos y pequeños; evita otro bucket y URLs firmadas por ahora |
| ECR en stack separado | El servicio ECS no puede crearse sin imagen previa |
| Tokens en `localStorage` | Simplicidad inicial; mitigado con CSP estricta. Pendiente pasar a cookies HttpOnly |
| Cuotas por devengo (cuenta 1200 por cobrar) | Estado de cuenta exacto por propiedad y morosidad real; la cuota es ingreso al emitirse y el pago solo cancela la deuda |
| Pagos aplicados a lo más antiguo (FIFO) | Estado de cuenta limpio y estándar de cobranza; se explica al propietario con su estado de cuenta |
| Generación automática apagada por defecto en proyectos existentes | Evitar emitir cuotas con propiedades/cuotas incompletas; el admin la activa al terminar la configuración |
| Propietario ↔ propiedad muchos a muchos | Pedido: un dueño con varias propiedades y copropietarios; la propiedad se crea primero y luego se vinculan dueños |
| Teléfono como usuario del propietario, correo opcional | Pedido: muchos propietarios no usan correo; el teléfono es único y fácil de recordar |
| Eliminar solo lo que no tiene historia; si no, desactivar | Conservar la pista contable; proyectos sí se eliminan (solo superusuario, escribiendo el nombre) |
| Excel generado en el navegador (fflate + XML propio) | Una sola dependencia pequeña sin vulnerabilidades; no hace falta endpoint por reporte |
| Catálogos por proyecto guardando el código | Renombrar sin tocar registros; desactivar en vez de borrar |

## Pendiente (prioridad sugerida)

0. **Inmediato (QA y piloto en curso)**: Ricardo hace pruebas y un piloto y reporta hallazgos con capturas; reproducirlos en local antes de corregir.
   - Quitar la columna obsoleta `units.owner_user_id` en un despliegue posterior (ya no se usa desde 0005).
   - Pantalla para que el admin marque entrada/salida por un empleado (la API ya lo permite).
   - PRs de Dependabot abiertos: seguros (rxjs, actions checkout/setup-node/configure-aws-credentials) vs. arriesgados (TypeScript 7, Vite 8, `@types/node` 26, imagen `node:26-alpine`); **recharts 3 rompe el typecheck** (hay que adaptar los gráficos). Ramas `feat/*` viejas ya integradas se pueden borrar.
1. ~~Cuotas mensuales y morosidad~~ (hecho). Siguiente: convenios de pago, notificación de mora por correo, carga masiva de saldos iniciales por propiedad (hoy: "Nuevo cargo" tipo Otro).
2. **Correo (Amazon SES)**: verificación de cuenta, recuperación de contraseña, notificación de avisos/respuestas de tickets.
3. **Alarmas útiles** (5xx, CPU alta sostenida, conexiones/espacio RDS, bloqueos del WAF) con notificación por correo; logs del WAF; GuardDuty.
4. **Sesión en cookies HttpOnly + SameSite** y MFA opcional para admins/superusuario.
5. Presupuesto anual por categoría y real vs. presupuesto.
6. Comprobantes adjuntos (S3 con URL firmada) en ingresos/egresos.
7. Planilla: convertir horas aprobadas en egreso 5100.
8. ~~Excel~~ (hecho en todos los reportes). Falta: PDF con membrete del proyecto; evaluar facturación electrónica (DTE) de El Salvador.
9. Amenidades con reservas, caseta (visitas/paquetes), portal más completo (ver imagen de referencia original).
10. Marcación: PWA offline, selfie opcional, modo kiosco.
11. Migrar a Zod 4 (ver Dependencias) antes de 2027-01-31.
12. Producción robusta: dominio propio + ACM, RDS Multi-AZ, 2 NAT, acotar permisos del rol de despliegue, pruebas E2E (Playwright) y pentest antes de vender.
13. Seguridad de cuentas: la contraseña del superusuario es débil; cambiarla y agregar MFA (ver punto 4).
