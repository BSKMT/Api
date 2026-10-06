import url from "node:url";

// 1. Remove Node's native warning listener that writes DEP0169 directly to stderr
process.removeAllListeners("warning");
process.on("warning", (warning) => {
  if (
    warning.name === "DeprecationWarning" &&
    (warning.code === "DEP0169" || warning.message.includes("url.parse()"))
  ) {
    return;
  }
  process.stderr.write(`${warning.name}: ${warning.message}\n`);
});

// 2. Monkey-patch url.parse to suppress process.emitWarning during internal parse calls
const originalUrlParse = url.parse;
url.parse = function patchedUrlParse(...args) {
  const origEmitWarning = process.emitWarning;
  process.emitWarning = (warning, ...rest) => {
    if (
      (typeof warning === "string" && warning.includes("url.parse()")) ||
      rest[1] === "DEP0169"
    ) {
      return;
    }
    return origEmitWarning.call(process, warning, ...rest);
  };
  try {
    return originalUrlParse.apply(this, args);
  } finally {
    process.emitWarning = origEmitWarning;
  }
};

let appHandlerPromise;

export default async function handler(req, res) {
  const rawPath = (req.url || "")
    .split("?")[0]
    .toLowerCase()
    .replace(/\/+$/, "");
  const matchedPath = String(req.headers["x-matched-path"] || "").toLowerCase();

  const isRoot =
    rawPath === "" ||
    rawPath === "/" ||
    rawPath === "/api" ||
    rawPath === "/api/index.js" ||
    rawPath === "/index.js" ||
    matchedPath === "/" ||
    matchedPath === "" ||
    matchedPath === "/api";

  if (req.method === "GET" && isRoot) {
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
