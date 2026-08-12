# Build from the repo root: docker build -f apps/server/Dockerfile .
FROM node:24-slim AS build
RUN npm install -g pnpm@11.21.0
WORKDIR /repo
# Install with just the manifests first so layer caching survives src changes.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/server/package.json apps/server/
COPY packages/contracts/package.json packages/contracts/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter server...
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/server ./apps/server
RUN pnpm --filter server build

FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /repo/apps/server/dist ./dist
COPY --from=build /repo/apps/server/drizzle ./drizzle
USER node
EXPOSE 3001
CMD ["node", "dist/index.js"]
