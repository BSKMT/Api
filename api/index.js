export default async function handler(req, res) {
  const { default: appHandler } = await import("../dist/main.js");
  return appHandler(req, res);
}
