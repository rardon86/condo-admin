#!/bin/sh
# Trae la última versión de main y reconstruye. Las migraciones de la base se aplican solas al arrancar la API.
set -e
cd "$(dirname "$0")"
git pull --ff-only
docker compose up -d --build
docker image prune -f >/dev/null
docker compose ps
