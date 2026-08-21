const fs = require("node:fs");
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");
const { withUniwindConfig } = require("uniwind/metro");

// Metro, for a pnpm workspace whose packages ship raw TypeScript.
//
// Two things this file exists for, both consequences of `packages/*` having no
// build step (see the repo README): Metro has to watch and resolve outside
// this directory, and it has to understand the import style those packages
// are written in.

const config = getDefaultConfig(__dirname);
const workspaceRoot = path.resolve(__dirname, "../..");
const packagesRoot = path.join(workspaceRoot, "packages");

// The workspace root, so edits in packages/* trigger a rebuild, and both
// node_modules trees, because pnpm puts a package's own dependencies under
// its own directory and hoists nothing.
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.join(__dirname, "node_modules"),
  path.join(workspaceRoot, "node_modules"),
];

// `import "./zero-options.js"` from a file that is actually `zero-options.ts`.
//
// That is how every file in packages/* is written, because the server type
// checks under NodeNext and TypeScript requires the runtime specifier there.
// esbuild and Vite both map it back; Metro does not. Its candidate loop takes
// the specifier whole and appends extensions to it (metro-resolver's
// `resolveSourceFileForExt`), so it looks for `zero-options.js`, then
// `zero-options.js.ts`, then `zero-options.js.tsx`, and never for
// `zero-options.ts`. Every shared package fails to resolve without this.
//
// Scoped to packages/*: app code has no reason to write specifiers this way,
// and a blanket rewrite would silently mask a genuinely missing `.js` asset.
const resolveRequest = (context, moduleName, platform) => {
  if (
    moduleName.startsWith(".") &&
    moduleName.endsWith(".js") &&
    context.originModulePath.startsWith(packagesRoot)
  ) {
    const base = path.resolve(path.dirname(context.originModulePath), moduleName.slice(0, -3));
    for (const ext of [".ts", ".tsx"]) {
      if (fs.existsSync(base + ext)) {
        return context.resolveRequest(context, base + ext, platform);
      }
    }
  }
  return context.resolveRequest(context, moduleName, platform);
};
config.resolver.resolveRequest = resolveRequest;

// withUniwindConfig has to be the outermost wrapper.
module.exports = withUniwindConfig(config, {
  cssEntryFile: "./global.css",
  dtsFile: "./uniwind-types.d.ts",
});
