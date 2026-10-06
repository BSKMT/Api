// Suppress Node.js DEP0169 deprecation warning triggered by Express internal url.parse()
process.on("warning", (warning) => {
  if (warning.name === "DeprecationWarning" && warning.code === "DEP0169") {
    return;
  }
  process.stderr.write(`${warning.name}: ${warning.message}\n`);
});

let appHandlerPromise;

export default async function handler(req, res) {
  const urlPath = (req.url || "").split("?")[0];
  if (
    req.method === "GET" &&
    (urlPath === "" ||
      urlPath === "/" ||
      urlPath === "/api/index.js" ||
      urlPath === "/index.js")
  ) {
    res.setHeader("Content-Type", "application/json");
    res.statusCode = 200;
    return res.end(
      JSON.stringify({
        status: "ok",
        name: "BSKMT API",
        timestamp: new Date().toISOString(),
      }),
    );
  }

  if (!appHandlerPromise) {
    appHandlerPromise = import("../dist/main.js").then((m) => m.default);
  }
  const appHandler = await appHandlerPromise;
  return appHandler(req, res);
}
