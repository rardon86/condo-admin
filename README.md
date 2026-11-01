# Administración de Complejos Residenciales y Recreativos

Sistema web responsive para administrar condominios, residenciales y complejos recreativos.

**Incluye (v0.1):**
- Gestión de cuenta: crear cuenta (con su complejo), actualizar perfil, cambiar contraseña, cerrar sesiones, varios complejos por cuenta y usuarios con roles.
- Registro de **ingresos** y **egresos** por categoría, con anulación auditada.
- **Informe mensual de gastos** (por categoría, proveedor, comparativos e imprimible).
- **Estados financieros**: estado de resultados, balance general y flujo de efectivo (contabilidad de partida doble).
- **Análisis y proyecciones** mensuales y anuales, autonomía de caja y tendencia.
- **Servicios** del complejo con costo y precio, registro de servicios brindados y rentabilidad.
- **Control de marcación** del personal con ubicación GPS, geocercas, reporte de horas y costo de mano de obra.
- Panel principal con KPIs (saldo, balance mensual, cobranza, salud financiera, autonomía, proyección).

Arquitectura y decisiones: [`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md) · Despliegue: [`docs/DESPLIEGUE_AWS.md`](docs/DESPLIEGUE_AWS.md)

## Estructura

```
apps/
  api/      API NestJS + Drizzle + PostgreSQL
  web/      Frontend React + Vite + Tailwind
infra/      AWS CDK (VPC, RDS, ECS Fargate, S3, CloudFront)
docs/       Arquitectura y despliegue
.github/    CI (pruebas, build, migraciones) y despliegue a AWS
```

## Correr en local

Requisitos: Node 22+, Docker.

```bash
npm install                      # instala API y web (genera package-lock.json → súbelo al repo)
docker compose up -d db          # PostgreSQL en localhost:5432
cp apps/api/.env.example apps/api/.env

npm run db:generate              # primera vez: genera la migración inicial desde el esquema (súbela al repo)
npm run build -w apps/api
npm run db:migrate
npm run db:seed                  # opcional: datos demo → demo@residencial.app / Demo1234

npm run dev:api                  # http://localhost:3000/api
npm run dev:web                  # http://localhost:5173
```

Pruebas: `npm test` · Verificación de tipos: `npm run typecheck`

## Flujo de trabajo con Git

- `main` → producción (despliegue automático cuando `DEPLOY_ENABLED=true`).
- `develop` → integración. Trabajar en ramas `feature/<tema>` y abrir Pull Request; CI debe pasar.
- Cambios de base de datos: editar `apps/api/src/db/schema.ts` → `npm run db:generate` → subir la migración junto con el código.
