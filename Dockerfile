# ---- Build stage ----
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---- Production stage ----
FROM node:22-alpine AS production

WORKDIR /app

ENV NODE_ENV=production
ENV ALLOW_JSON_STORE=true

# Run as non-root
RUN addgroup -g 1001 -S appgroup && \
    adduser  -u 1001 -S appuser -G appgroup

# Bake a .env stub so dotenv loads valid values at startup.
# In production (NODE_ENV=production) dotenv.config() is skipped entirely,
# so these values are only used in dev.  For Docker, real secrets come from
# -e / --env-file flags.
RUN printf '%s\n%s\n%s\n%s\n' \
  "JWT_SECRET=placeholder-jwt-secret-change-in-prod-32chars" \
  "APPLICANT_JWT_SECRET=placeholder-app-jwt-secret-change-32chars" \
  "DOTENVX_API_KEY=disabled" \
  "ALLOW_JSON_STORE=true" \
  > .env

COPY --from=builder --chown=appuser:appgroup /app/dist        ./dist
COPY --from=builder --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:appgroup /app/package.json ./package.json
# EJS templates (rendered by the dashboard router) and static assets (CSS/images)
# are resolved relative to the project root at runtime, so they must ship in the image.
COPY --from=builder --chown=appuser:appgroup /app/views        ./views
COPY --from=builder --chown=appuser:appgroup /app/public       ./public
# .env was created above by the RUN instruction; no separate copy needed

# Disable dotenv.config() in production — Docker sets env via -e / --env-file.
# Replacing the call with a no-op comment leaves the import in place (avoids
# breaking any compile-time-only import chains or type-only usages).
RUN sed -i 's/dotenv\.config();/\/\/ dotenv skipped in production/g' dist/index.js && \
    sed -i 's/dotenv\.config();/\/\/ dotenv skipped in production/g' dist/models/store.js

# App user needs a writable /app/data for the JSON store.
RUN mkdir -p /app/data && chown appuser:appgroup /app/data

USER appuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "dist/index.js"]
