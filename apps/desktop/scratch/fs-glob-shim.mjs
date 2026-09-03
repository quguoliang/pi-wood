export async function resolve(specifier, context, next) {
  if (specifier === "node:fs") return { url: "nodeshim:fs", shortCircuit: true };
  return next(specifier, context);
}
export async function load(url, context, next) {
  if (url === "nodeshim:fs") {
    return {
      format: "module",
      shortCircuit: true,
      source: `export * from "fs";\nexport const globSync = (...a) => [];\nexport const glob = async (...a) => [];\n`,
    };
  }
  return next(url, context);
}
