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
# The bundle is self-contained except for two native packages, which have to
# sit next to it: @napi-rs/canvas, which pdfjs pulls in through a runtime
# require() to polyfill DOMMatrix/Path2D and to render a PDF's first page for
# its thumbnail, and sharp, which the derivatives pass uses and which esbuild
# is told to leave external for the same reason. Flatten pnpm's symlink farm
# into a plain node_modules; the globs fail the build loudly if the store
# layout ever moves.
RUN mkdir -p /runtime/node_modules/@napi-rs /runtime/node_modules/@img && \
    cp -RL /repo/node_modules/.pnpm/@napi-rs+canvas@*/node_modules/@napi-rs/. /runtime/node_modules/@napi-rs/ && \
    cp -RL /repo/node_modules/.pnpm/sharp@*/node_modules/sharp /runtime/node_modules/sharp && \
    cp -RL /repo/node_modules/.pnpm/@img+sharp-lib*-linux*/node_modules/@img/. /runtime/node_modules/@img/ && \
    cp -RL /repo/node_modules/.pnpm/@img+sharp-linux*/node_modules/@img/. /runtime/node_modules/@img/

FROM node:24-slim
ENV NODE_ENV=production
# HEIC is what an iPhone actually sends, and sharp's prebuilt libvips carries
# AVIF but not HEIC (patent licensing). The distro's libvips does, and sharp
# picks a system libvips over its bundled one when SHARP_FORCE_GLOBAL_LIBVIPS
# is set. Without this the transcode throws, which the pipeline treats as a
# soft failure: the original is kept and the message says why (plan §6.2).
RUN apt-get update && \
    apt-get install -y --no-install-recommends libvips42t64 libheif1 libheif-plugin-libde265 && \
    rm -rf /var/lib/apt/lists/*
ENV SHARP_FORCE_GLOBAL_LIBVIPS=1
WORKDIR /app
COPY --from=build /runtime/node_modules ./node_modules
COPY --from=build /repo/apps/server/dist ./dist
COPY --from=build /repo/apps/server/drizzle ./drizzle
USER node
EXPOSE 3001
CMD ["node", "dist/index.js"]
