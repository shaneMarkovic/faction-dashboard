import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @torn/shared is imported as raw TypeScript from the workspace, so Next must
  // transpile it (rather than treating it as a prebuilt node_modules package).
  transpilePackages: ["@torn/shared"],
};

export default nextConfig;
