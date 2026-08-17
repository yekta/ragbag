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

# The bundle is self-contained except for three packages esbuild is told to
# leave external (build.mjs):
#
#   @napi-rs/canvas  native. pdfjs polyfills DOMMatrix/Path2D through it, and
#                    rasterize-pdf.ts renders a PDF's first page with it
#   sharp            native. the image derivatives pass
#   heic-decode      a 1.4 MB emscripten build of libheif, loaded as a module
#
# Installed here with npm rather than copied out of pnpm's store, because the
# closure is not just each package and its platform binary: sharp also needs
# @img/colour, detect-libc and semver at runtime, and it imports them at module
# load, so a missing one is a crash at container boot. npm resolves the whole
# tree (optional platform packages included) from the version the workspace
# already settled on, so this cannot silently miss one and cannot drift from
# the lockfile either.
RUN mkdir -p /runtime && cd /runtime && npm init -y > /dev/null && \
    npm install --omit=dev --no-audit --no-fund \
      "sharp@$(node -p "require('/repo/apps/server/node_modules/sharp/package.json').version")" \
      "@napi-rs/canvas@$(node -p "require('/repo/apps/server/node_modules/@napi-rs/canvas/package.json').version")" \
      "heic-decode@$(node -p "require('/repo/apps/server/node_modules/heic-decode/package.json').version")"

FROM node:24-slim
ENV NODE_ENV=production
# Deliberately NO apt packages here, and HEIC still transcodes.
#
# The tempting version of this (install libvips and libheif, set
# SHARP_FORCE_GLOBAL_LIBVIPS) cannot work: that variable is read by sharp's
# INSTALL script, not at runtime, and it demands libvips >= 8.18.3, which no
# Debian or Ubuntu release ships. sharp therefore always runs against the
# libvips it bundles, whose libheif has AV1 but not HEVC.
#
# So HEVC comes from `heic-decode` instead, which is libheif compiled to WASM
# (see src/ingest/derivatives.ts). It needs nothing from the base image, which
# is why it works in local dev and in the acceptance proofs as well as here,
# and why this stage is back to plain node with three packages beside it.
WORKDIR /app
COPY --from=build /runtime/node_modules ./node_modules
COPY --from=build /repo/apps/server/dist ./dist
COPY --from=build /repo/apps/server/drizzle ./drizzle
USER node
EXPOSE 3001
CMD ["node", "dist/index.js"]
