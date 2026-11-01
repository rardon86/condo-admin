# Imagen multi-etapa de la API (se publica en Amazon ECR y corre en ECS Fargate)
FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci -w apps/api --include-workspace-root=false || npm install -w apps/api
COPY apps/api apps/api
# Si las migraciones aún no se versionaron, se generan desde el esquema (no requiere BD)
RUN test -d apps/api/drizzle || (cd apps/api && npx drizzle-kit generate)
RUN npm run build -w apps/api && npm prune --omit=dev -w apps/api

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
# Certificados de Amazon RDS para verificar el TLS de la base de datos
ADD --chmod=644 https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /app/rds-ca.pem
ENV DATABASE_SSL_CA=/app/rds-ca.pem
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/apps/api/drizzle ./drizzle
COPY --from=build /repo/apps/api/package.json ./
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://localhost:3000/api/health || exit 1
CMD ["node", "dist/main.js"]
