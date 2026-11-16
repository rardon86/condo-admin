#!/bin/sh
# Crea deploy/.env con secretos aleatorios a partir de .env.example (no pisa uno existente).
set -e
cd "$(dirname "$0")"
if [ -f .env ]; then echo "deploy/.env ya existe; no se modifica."; exit 0; fi

printf 'Contraseña para el superusuario (mínimo 8 caracteres): '
stty -echo 2>/dev/null || true
read -r PASS
stty echo 2>/dev/null || true
echo
if [ ${#PASS} -lt 8 ]; then echo "La contraseña debe tener al menos 8 caracteres."; exit 1; fi

umask 077
sed -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -hex 24)|" \
    -e "s|^JWT_ACCESS_SECRET=.*|JWT_ACCESS_SECRET=$(openssl rand -hex 32)|" \
    -e "s|^JWT_REFRESH_SECRET=.*|JWT_REFRESH_SECRET=$(openssl rand -hex 32)|" \
    -e '/^SUPERADMIN_PASSWORD=/d' \
    .env.example > .env
# La contraseña va aparte para no interpretar caracteres especiales en sed
printf 'SUPERADMIN_PASSWORD=%s\n' "$PASS" >> .env
echo "Listo: deploy/.env creado. Revisa SITE_ADDRESS y SERVICE_HOURS antes de arrancar."
