# Despliegue en un servidor propio (EC2, Hostinger VPS u otro Linux)

Todo corre con Docker Compose en un solo servidor:

```
Internet ──► Caddy (web + HTTPS automático, puertos 80/443)
               ├─ /*      → la web (React compilada)
               └─ /api/*  → API (NestJS) ──► PostgreSQL 16 (volumen local, sin puerto publicado)
             backup: copia diaria de la base en deploy/backups
```

Archivos: `deploy/docker-compose.yml`, `deploy/Caddyfile`, `deploy/.env` (secretos, no se sube a git),
`apps/api/Dockerfile`, `apps/web/Dockerfile`.

## 1. Servidor

| Opción | Recomendado | Costo aprox. |
|---|---|---|
| Hostinger **VPS KVM 1** o superior (no sirve el hosting compartido: no corre Docker) | 1 vCPU, 4 GB RAM, Ubuntu 24.04 | 5–8 USD/mes |
| AWS **EC2 t4g.small** (ARM) o t3.small | 2 GB RAM, Ubuntu 24.04, disco 20 GB gp3 | 13–17 USD/mes |

- Con 2 GB de RAM o menos, activa swap antes de compilar (paso 2): compilar la web usa ~1 GB.
- Firewall (Hostinger: panel → Firewall; EC2: Security Group): abre **22** (SSH, idealmente solo tu IP), **80** y **443**. Nada más (la base no se expone).

## 2. Preparar el servidor (una sola vez)

Conéctate por SSH (`ssh root@IP` en Hostinger, `ssh -i llave.pem ubuntu@IP` en EC2) y ejecuta:

```bash
# Docker oficial + plugin compose
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER   # luego sal y vuelve a entrar por SSH

# Swap de 2 GB (solo si el servidor tiene 2 GB de RAM o menos)
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Hora del servidor (informativo; la app usa America/El_Salvador por su cuenta)
sudo timedatectl set-timezone America/El_Salvador
```

## 3. Instalar la aplicación

```bash
git clone https://github.com/rardon86/condo-admin.git
cd condo-admin/deploy
sh generar-env.sh        # pide la contraseña del superusuario y genera los demás secretos en deploy/.env
nano .env                # revisa SITE_ADDRESS y SERVICE_HOURS
docker compose up -d --build
```

La primera compilación tarda 5–10 minutos. Al arrancar, la API crea las tablas y el superusuario (`SUPERADMIN_USERNAME`).

Comprueba:

```bash
docker compose ps                         # api, db, web y backup "Up"
curl http://localhost/api/health          # {"status":"ok",...}
```

Abre `http://IP-DEL-SERVIDOR` y entra con tu superusuario. **Cambia la contraseña** en Mi cuenta si usaste una temporal.

## 4. Dominio y HTTPS (necesario para la marcación con GPS)

Los navegadores solo dan la ubicación en sitios HTTPS, así que el personal no puede marcar sin dominio.

1. En el proveedor del dominio crea un registro **A**: `app.tudominio.com` → IP del servidor (en EC2 usa una **Elastic IP** para que no cambie).
2. Espera a que resuelva (`ping app.tudominio.com` debe mostrar la IP).
3. En `deploy/.env` pon `SITE_ADDRESS=app.tudominio.com` y ejecuta `docker compose up -d`.

Caddy obtiene y renueva solo el certificado de Let's Encrypt (gratis). Desde ese momento `http://` redirige a `https://`.

## 5. Horario de servicio

`SERVICE_HOURS=09:00-18:00` en `deploy/.env` (zona `TZ`). Fuera de ese horario la API responde 503 y la web muestra
"Fuera de horario" sin cerrar la sesión. Déjalo vacío para 24 h. Tras cambiarlo: `docker compose up -d api`.
En un servidor propio el costo es fijo: el horario no ahorra dinero, solo restringe el uso.

## 6. Actualizar a una nueva versión

```bash
cd ~/condo-admin/deploy
sh actualizar.sh         # git pull + reconstruir; las migraciones se aplican solas
```

La API queda fuera unos segundos mientras se reinicia.

## 7. Respaldos

- Cada día (y cada vez que arranca el contenedor `backup`) se guarda `deploy/backups/residencial-AAAAMMDD-HHMM.dump`; se conservan `BACKUP_KEEP_DAYS` días.
- **Copia los respaldos fuera del servidor** con regularidad (si el disco se pierde, se pierden también). Desde tu PC:

  ```bash
  scp -r usuario@IP:~/condo-admin/deploy/backups ./respaldos-aror
  ```

- Respaldo manual inmediato: `docker compose restart backup`.
- **Restaurar** un respaldo (reemplaza los datos actuales):

  ```bash
  docker compose stop api
  docker compose exec -T db pg_restore -U app -d residencial --clean --if-exists --no-owner < backups/residencial-AAAAMMDD-HHMM.dump
  docker compose start api
  ```

## 8. Operación diaria

```bash
docker compose ps                    # estado
docker compose logs -f api           # registros de la API (Ctrl+C para salir)
docker compose logs --tail 100 web   # registros de Caddy (certificado, accesos)
docker compose restart api           # reiniciar la API
df -h && docker system df            # espacio en disco
```

Los logs de cada contenedor rotan solos (5 archivos de 10 MB).

## 9. Seguridad

- `deploy/.env` tiene permisos 600 y nunca se sube al repositorio.
- La base no publica puertos; solo la API la ve por la red interna de Docker.
- Caddy envía las mismas cabeceras de seguridad que tenía CloudFront (CSP, HSTS, X-Frame-Options…). La API confía en
  exactamente 1 proxy (`TRUST_PROXY=1`) para tomar la IP real del cliente.
- Recomendado: SSH solo con llave (desactivar contraseña), `sudo apt install unattended-upgrades` para parches automáticos
  y `fail2ban`.
- A diferencia de AWS no hay WAF; la API mantiene su propio límite de intentos de inicio de sesión.

## 10. Apagar AWS (cuando el servidor nuevo esté funcionando)

1. En GitHub → Settings → Secrets and variables → Actions → Variables: pon `DEPLOY_ENABLED` en `false`
   (así un push a `main` ya no despliega en AWS).
2. En la consola de AWS (us-east-1) → CloudFormation: elimina el stack **Residencial-prod** y después **Residencial-prod-registry**.
   - La base RDS tiene protección contra borrado: desactívala antes (RDS → la instancia → Modificar → quitar "Protección contra eliminación").
   - Al borrar, AWS guarda una instantánea final de la base (cobra unos centavos al mes por GB); bórrala en RDS → Instantáneas si no la necesitas.
   - El bucket S3 de la web y el repositorio ECR quedan retenidos: vacíalos y bórralos a mano.
3. Revisa en Billing → Facturas al mes siguiente que ya no haya cargos.
