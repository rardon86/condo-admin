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
npm run build -w apps/api && npm run db:migrate && npm run db:seed   # demo: demo@residencial.app / residente@residencial.app, pass Demo1234
npm run dev:api                # http://localhost:3000/api
npm run dev:web                # http://localhost:5173 (Vite proxy /api → :3000)

npm run typecheck              # API + web (lo que exige CI)
npm test                       # node --test + tsx sobre apps/api/test/*.test.ts (lógica pura, sin BD)
npm run db:generate            # genera migración desde apps/api/src/db/schema.ts
node scripts/audit-gate.mjs    # auditoría de dependencias (igual que CI)
```

`db:migrate` y `db:seed` corren desde `dist/` → compila la API antes.

## Estructura

```
apps/api/src
  main.ts                 bootstrap: helmet, body 1 MB, trust proxy 2, timeouts, prefijo /api
  config/env.ts           variables validadas con Zod (falla al arrancar si faltan / son inseguras)
  db/schema.ts            ÚNICA fuente del modelo de datos (Drizzle)
  db/{client,migrate,seed}.ts
  common/                 auth.guard (guard global), auth.decorators (@Public @NoTenant @SuperAdmin @Roles),
                          zod.pipe, money (centavos), dates (tz), geo (Haversine/geocercas), shifts, forecast (Holt), image (logos), audit
  modules/
    auth        registro de propietarios, login (correo o usuario), refresh, /me, contraseña, logo público
    complexes   ajustes del proyecto, saldo inicial, usuarios internos, aprobación de propietarios
    platform    SOLO superusuario: proyectos (+ admin, logo) y empleados (+ asignación a proyectos)
    ledger      catálogo de cuentas + LedgerService (asientos, reversos, saldos)
    movements   ingresos / egresos (generan asiento; se anulan, nunca se borran)
    services    catálogo de servicios con costo/precio y servicios brindados
    staff       empleados del proyecto (lectura), geocercas, marcación y reporte de horas
    community   avisos, consultas/reclamos (tickets), portal del propietario
    reports     dashboard, informe mensual de gastos, estados financieros, proyecciones
apps/api/drizzle/         migraciones versionadas (NO editar las ya aplicadas)
apps/api/test/            pruebas de dominio y seguridad
apps/web/src
  App.tsx                 enrutado por rol (sin sesión / pendiente / propietario / interno / superusuario)
  lib/api.ts              fetch con Bearer + X-Complex-Id, refresh automático ante 401
  lib/auth.tsx            contexto de sesión, `can(role, action)` (solo UI; la API decide)
  lib/theme.ts            tema oscuro/claro + colores de gráficos (CHART, tooltipStyle)
  components/             ui.tsx (Button, Card, Kpi, Table, Modal…), Layout (menú plegable), Brand, ProjectLogo, LogoField
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
- Propietarios se auto-registran (`POST /auth/register` con proyecto + código de unidad) → membresía `PENDING` hasta que un admin la aprueba y asigna unidad.
- Los proyectos y empleados los crea **solo el superusuario** (`/admin/*`). Un empleado es global y se asigna a N proyectos (`employee_assignments`); al asignarlo con usuario, se le crea/quita membresía `STAFF` automáticamente (`PlatformService.syncStaffMemberships`, nunca rebaja un rol superior).

**Contabilidad de partida doble.** Todo dinero entra al libro por `LedgerService.post()` (valida que cuadre). Ingreso: Debe 1100 Caja / Haber cuenta 4xxx. Egreso: Debe 5xxx / Haber 1100. Estados financieros, saldo de caja, KPIs y proyecciones se **derivan del libro**; no agregues campos "saldo".
- Nada contable se edita ni borra: se **anula** (`voidedAt` + asiento de reversión con `ledger.reverse`) y se audita (`AuditService`).
- Cuentas `x000` son de agrupación (no reciben movimientos). Códigos de sistema en `SYSTEM_ACCOUNTS`.
- Saldo inicial = asiento `sourceType: 'OPENING'` (se reemplaza al cambiarlo).

**Dinero**: `NUMERIC(14,2)` en BD, **centavos enteros** en memoria (`toCents`, `centsToDb`, `fromCents`). Nunca sumes floats.

**Fechas**: contables como `'YYYY-MM-DD'` sin zona. "Hoy" y rangos de días se calculan en la zona del complejo (`todayIn`, `zonedStartOfDay`).

**Marcación**: la hora válida es la del servidor; la del dispositivo se guarda como evidencia (desfase > 5 min se señala). Geocerca más cercana con tolerancia por precisión GPS (máx. +50 m). `require_geofence` rechaza fuera de zona; si no, acepta y señala. No se permite doble IN/OUT seguido.

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

## Base de datos y migraciones

- Flujo: editar `schema.ts` → `npm run db:generate` → revisar el SQL → commitear junto con el código. CI falla si el esquema y `apps/api/drizzle` no coinciden.
- Al empujar a una rama `feat/**`, el workflow `migrations.yml` genera y sube la migración automáticamente si faltó.
- **No reescribas migraciones aplicadas.** Producción migra sola al arrancar (`RUN_MIGRATIONS=true`).
- Historia: `0000_init` tiene `when` forzado a `1700000000000` porque el primer despliegue generó la migración dentro de la imagen; `0001` incluye un `INSERT` manual que conserva la asignación de empleados al eliminar `employees.complex_id`. Si un cambio requiere mover datos, edita el SQL generado de la migración nueva y pruébalo contra Postgres con datos.
- Cambios destructivos (DROP/RENAME) → en dos despliegues (añadir, migrar datos, luego quitar).

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
- Superusuario: `SUPERADMIN_USERNAME` (por defecto `ricardo`) + contraseña desde Secrets Manager; se crea al arrancar **solo si no existe** y nunca se resetea.

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

## Pendiente (prioridad sugerida)

1. **Cuotas mensuales y morosidad**: cargos por unidad (cuenta 1200 por cobrar), estado de cuenta del propietario, recargos, tasa de cobranza real. Es lo más usado por un administrador.
2. **Correo (Amazon SES)**: verificación de cuenta, recuperación de contraseña, notificación de avisos/respuestas de tickets.
3. **Alarmas útiles** (5xx, CPU alta sostenida, conexiones/espacio RDS, bloqueos del WAF) con notificación por correo; logs del WAF; GuardDuty.
4. **Sesión en cookies HttpOnly + SameSite** y MFA opcional para admins/superusuario.
5. Presupuesto anual por categoría y real vs. presupuesto.
6. Comprobantes adjuntos (S3 con URL firmada) en ingresos/egresos.
7. Planilla: convertir horas aprobadas en egreso 5100.
8. Exportar informes a Excel/PDF con membrete; evaluar facturación electrónica (DTE) de El Salvador.
9. Amenidades con reservas, caseta (visitas/paquetes), portal más completo (ver imagen de referencia original).
10. Marcación: PWA offline, selfie opcional, modo kiosco.
11. Migrar a Zod 4 (ver Dependencias) antes de 2027-01-31.
12. Producción robusta: dominio propio + ACM, RDS Multi-AZ, 2 NAT, acotar permisos del rol de despliegue, pruebas E2E (Playwright) y pentest antes de vender.

Nota: el rediseño visual (tema, login, menú plegable) se compiló y desplegó pero **no se ha validado con capturas**; revísalo en navegador (escritorio y móvil, ambos temas) antes de pulirlo.
