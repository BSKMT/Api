// Suppress Node.js DEP0169 deprecation warning triggered by Express internal url.parse()
process.on("warning", (warning) => {
  if (warning.name === "DeprecationWarning" && warning.code === "DEP0169") {
    return;
  }
  process.stderr.write(`${warning.name}: ${warning.message}\n`);
});

let appHandlerPromise;

export default async function handler(req, res) {
  if (!appHandlerPromise) {
    appHandlerPromise = import("../dist/main.js").then((m) => m.default);
  }
  const appHandler = await appHandlerPromise;
  return appHandler(req, res);
}
