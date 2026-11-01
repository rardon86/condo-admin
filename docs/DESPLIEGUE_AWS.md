# Despliegue en AWS

Arquitectura: **CloudFront** (frontend en S3 + `/api/*` hacia ALB) → **ECS Fargate** (API) → **RDS PostgreSQL**. Todo se crea con AWS CDK (`infra/`) y se publica desde GitHub Actions (`.github/workflows/deploy.yml`).

Costo orientativo de arranque (us‑east‑1, 1 tarea, RDS t4g.micro, 1 NAT): **≈ 70–90 USD/mes**. El NAT Gateway es la partida más alta; se puede reducir más adelante.

## Requisitos (una sola vez)

1. Cuenta de AWS y AWS CLI configurado con un usuario administrador.
2. Inicializar CDK en la cuenta/región:
   ```bash
   cd infra && npm install
   npx cdk bootstrap aws://<ACCOUNT_ID>/us-east-1
   ```
3. **Proveedor OIDC de GitHub** (permite que GitHub Actions despliegue sin llaves guardadas):
   - IAM → Identity providers → Add provider → OpenID Connect
   - URL: `https://token.actions.githubusercontent.com` · Audience: `sts.amazonaws.com`
4. **Rol de despliegue** `github-deploy-residencial` con esta relación de confianza (cambia `TU_USUARIO/TU_REPO`):
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [{
       "Effect": "Allow",
       "Principal": { "Federated": "arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com" },
       "Action": "sts:AssumeRoleWithWebIdentity",
       "Condition": {
         "StringEquals": { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
         "StringLike": { "token.actions.githubusercontent.com:sub": [
           "repo:TU_USUARIO@ID_USUARIO/TU_REPO@ID_REPO:*",
           "repo:TU_USUARIO/TU_REPO:*"
         ] }
       }
     }]
   }
   ```
   GitHub puede emitir el `sub` con los IDs fijos de usuario y repo (formato `repo:usuario@123/repo@456:environment:prod`). El paso "Diagnóstico OIDC" del workflow imprime el valor exacto; cópialo a la condición.
   Permisos: para empezar, `AdministratorAccess` (CDK crea VPC, RDS, ECS…). Luego se puede acotar a asumir los roles `cdk-*` del bootstrap + ECR + S3 + CloudFront.

## Configurar el repositorio en GitHub

Settings → Secrets and variables → Actions:

| Tipo | Nombre | Valor |
|---|---|---|
| Secret | `AWS_DEPLOY_ROLE_ARN` | ARN del rol del paso 4 |
| Variable | `DEPLOY_ENABLED` | `true` (activa el workflow de despliegue) |
| Variable | `AWS_REGION` | `us-east-1` (opcional) |
| Variable | `DOMAIN_NAME` | `admin.tudominio.com` (opcional) |
| Variable | `CERTIFICATE_ARN` | Certificado ACM en us‑east‑1 para ese dominio (opcional) |

Settings → Environments → crear `prod` (y `staging` si lo usarás). Recomendado: exigir aprobación manual en `prod`.

## Qué hace cada despliegue

1. Crea/actualiza el repositorio ECR (`Residencial-prod-registry`).
2. Construye la imagen Docker de la API y la sube con el SHA del commit.
3. Despliega `Residencial-prod` (VPC, RDS, ECS, ALB, S3, CloudFront). La API **aplica migraciones al arrancar** (`RUN_MIGRATIONS=true`) y ECS revierte solo si el nuevo contenedor no pasa el health check (`/api/health`).
4. Compila el frontend, lo sube a S3 e invalida la caché de CloudFront.
5. Muestra la URL de la aplicación en el resumen del job.

## Primer despliegue manual (opcional, desde tu máquina)

```bash
cd infra
npx cdk deploy Residencial-prod-registry
# construir y subir la imagen (ver pasos del workflow), luego:
IMAGE_TAG=<tag> npx cdk deploy Residencial-prod
```

## Operación

- Logs: CloudWatch → Log groups → `Residencial-prod-Api…`
- Datos demo en un entorno de pruebas: ejecutar una tarea ECS con comando `node dist/db/seed.js`.
- Backups: RDS guarda 14 días en prod; `deletionProtection` activo.
- Siguiente paso de robustez: RDS Multi‑AZ, 2 NAT, WAF en CloudFront, alarmas (5xx, CPU, conexiones BD).
