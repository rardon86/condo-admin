#!/bin/sh
# Respaldo diario de la base (formato pg_dump -Fc) en /backups; borra los de más de KEEP_DAYS días.
# Corre dentro del contenedor "backup" de docker-compose.yml.
while true; do
  f="/backups/residencial-$(date +%Y%m%d-%H%M).dump"
  if pg_dump -h db -U app -d residencial -Fc -f "$f.tmp"; then
    mv "$f.tmp" "$f"
    echo "Respaldo $f"
  else
    echo "ERROR en el respaldo"
  fi
  find /backups -name '*.dump' -mtime +"${KEEP_DAYS:-14}" -delete
  sleep 86400
done
