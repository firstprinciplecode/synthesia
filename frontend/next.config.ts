import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Keep defaults; use classic builder for stability
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  // Pin workspace root so Tailwind/PostCSS configs are resolved from /frontend
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
