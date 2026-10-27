import path from "node:path";

const nextConfig = {
  outputFileTracingRoot: path.resolve("."),
  async rewrites() {
    const appEnvironment = process.env.APP_ENV || "local";
    const environmentTarget = appEnvironment === "staging"
      ? process.env.API_PROXY_TARGET_STAGING
      : process.env.API_PROXY_TARGET;

    if (appEnvironment === "staging" && !environmentTarget) {
      throw new Error("APP_ENV=staging requires API_PROXY_TARGET_STAGING. Refusing to use the production backend.");
    }

    const apiTarget = environmentTarget || "http://localhost:5000";
    return [{ source: "/api/:path*", destination: `${apiTarget}/:path*` }];
  },
};

export default nextConfig;
