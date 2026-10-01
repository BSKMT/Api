let appHandlerPromise;

export default async function handler(req, res) {
  if (!appHandlerPromise) {
    appHandlerPromise = import("../dist/main.js").then((m) => m.default);
  }
  const appHandler = await appHandlerPromise;
  return appHandler(req, res);
}
