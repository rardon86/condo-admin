# Seguridad

Resumen de controles aplicados, organizados según OWASP Top 10 y las amenazas más comunes para una aplicación web en AWS.

## Inyección (SQL y otras)
- **Consultas parametrizadas siempre**: Drizzle ORM envía los valores como parámetros enlazados; no se concatena texto del usuario en SQL. Los fragmentos `sql\`` del código solo contienen constantes o parámetros.
- **Validación estricta de entradas** con Zod en cada endpoint (tipos, longitudes, formatos, UUID). Los campos no declarados se descartan (sin asignación masiva).
- **WAF** con reglas administradas de AWS para SQLi, entradas maliciosas conocidas (Log4j, etc.) y el conjunto común (OWASP).

## Autenticación y sesiones
- Contraseñas con **bcrypt (12 rondas)**; política mínima de 8 caracteres con letras y números.
- **Bloqueo temporal**: 5 intentos fallidos bloquean la cuenta 15 minutos. Tiempo de respuesta constante (no revela si un correo existe).
- **JWT** de acceso de 15 min y refresh de 7 días, algoritmo fijado a HS256, secretos de 64 caracteres en Secrets Manager. Cambiar contraseña o "cerrar todas las sesiones" invalida todos los tokens (versión de token).
- Superusuario inicial creado desde un secreto de GitHub → Secrets Manager; la contraseña nunca está en el repositorio.

## Control de acceso
- Multi‑proyecto: cada consulta se filtra por el proyecto y se verifica la membresía activa del usuario.
- **Denegación por defecto** para propietarios: solo acceden a rutas que los permiten explícitamente; ven únicamente sus propias consultas y los pagos de su unidad.
- Registros contables inmutables (se anulan con asiento de reversión) y **bitácora de auditoría**.

## Denegación de servicio (DoS) y abuso
| Capa | Control |
|---|---|
| CloudFront | Absorbe tráfico en el borde; AWS Shield Standard incluido |
| WAF | 1.500 solicitudes / 5 min por IP; 60 / 5 min en `/api/auth/*`; lista de reputación de IPs de AWS |
| ALB | Solo acepta tráfico desde CloudFront (lista de prefijos administrada): no se puede evitar el WAF |
| API | Límite de 300 solicitudes/min por IP (IP real vía `trust proxy` de 2 saltos); cuerpos ≤ 1 MB; tiempos máximos de solicitud (30 s) contra slow‑loris |
| Base de datos | `statement_timeout` de 15 s y pool limitado; listados con paginación y límites |
| ECS | Autoescalado por CPU (2–6 tareas) y reversión automática si un despliegue falla |

## Cabeceras y navegador
- **CSP** estricta en el frontend (`script-src 'self'`, sin scripts inline, `frame-ancestors 'none'`), HSTS de 2 años con preload, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy` (geolocalización solo para la propia app).
- La API responde `Cache-Control: no-store` y CSP `default-src 'none'`.
- Sin CORS en producción (frontend y API comparten dominio).
- React escapa todo el contenido; no se usa HTML sin sanitizar.

## Archivos subidos (logos)
- Solo PNG, JPEG o WebP (nunca SVG), ≤ 300 KB, y se verifica la **firma real del archivo** además del tipo declarado. Se sirven con `nosniff` y CSP propia.

## Datos y red
- RDS en subred aislada, cifrado en reposo, accesible solo desde la API, **TLS verificado** con los certificados de Amazon RDS. Backups de 14 días y protección contra borrado.
- S3 privado con acceso solo desde CloudFront (OAC) y TLS obligatorio.
- Secretos en AWS Secrets Manager; despliegue con OIDC (sin llaves de AWS en GitHub).

## Cadena de suministro
- `npm audit` en cada CI (falla con vulnerabilidades altas/críticas en dependencias de producción).
- Dependabot semanal para npm, GitHub Actions y la imagen Docker; escaneo de imágenes en ECR.

## Próximos pasos recomendados
1. Mover los tokens a cookies `HttpOnly` + `SameSite=Strict` (hoy en `localStorage`, mitigado por la CSP).
2. Verificación de correo y recuperación de contraseña con Amazon SES; MFA opcional para administradores.
3. Logs del WAF y alarmas de CloudWatch (5xx, bloqueos, CPU, conexiones de BD); AWS GuardDuty.
4. Pruebas de penetración antes de la comercialización.
