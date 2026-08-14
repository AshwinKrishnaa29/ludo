# Multi-arch: builds for linux/arm64 (Oracle free tier) and linux/amd64.
FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY tsconfig.base.json ./
COPY packages ./packages
COPY services/game ./services/game
RUN npm ci --ignore-scripts
RUN npm run build --workspace @ludo/shared \
 && npm run build --workspace @ludo/kit \
 && npm run build --workspace @ludo/engine \
 && npm run build --workspace @ludo/game
RUN npm prune --omit=dev

FROM node:22-alpine AS runtime
WORKDIR /repo
ENV NODE_ENV=production
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /repo/node_modules ./node_modules
COPY --from=build --chown=app:app /repo/packages ./packages
COPY --from=build --chown=app:app /repo/services/game ./services/game
USER app
WORKDIR /repo/services/game
CMD ["node", "dist/index.js"]
