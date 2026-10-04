# syntax=docker/dockerfile:1

# ---------------------------------------------------------------- build stage
FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# generate the Prisma client, then build the standalone server bundle
RUN npx prisma generate && npm run build

# --------------------------------------------------------------- runtime stage
FROM base AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# prisma CLI → runs migrations at container start
# tsx       → lets you run the TS seed scripts inside the container
RUN npm i -g prisma@6.19.3 tsx@4

# self-contained Next standalone output
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
# needed by `prisma migrate deploy` and the seed one-liners
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/lib ./lib
COPY --from=build /app/tsconfig.json ./tsconfig.json

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3000
# 40s start-period: the first boot also runs pending migrations
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:3000/api/health" || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
