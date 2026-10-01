import path from "node:path";

const nextConfig = {
  distDir: process.env.LOCAL_TEST_FRONTEND === "true" ? ".next-local-test" : ".next",
  outputFileTracingRoot: path.resolve("."),
  // The browser calls /api on the same frontend URL. Next.js forwards it to
  // the local Express server, so a single ngrok tunnel is enough for demos.
  async rewrites() {
    const apiTarget = process.env.API_PROXY_TARGET || "http://localhost:5000";
    return [{ source: "/api/:path*", destination: `${apiTarget}/:path*` }];
  },
};

export default nextConfig;
