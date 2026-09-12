export function getPrimaryFrontendOrigin() {
  return (process.env.FRONTEND_ORIGIN || "http://localhost:3000")
    .split(",")
    .map((origin) => origin.trim())
    .find(Boolean);
}
