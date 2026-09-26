import type { NextConfig } from "next";

// Standalone output lets us ship only the compiled bundle + prod node_modules
// to the memory-constrained VM, instead of running `npm install`/`next build`
// there. Image optimization is disabled since this app has no uploads/remote
// images, which also keeps `sharp` out of the dependency tree entirely.
const nextConfig: NextConfig = {
  output: "standalone",
  images: {
    unoptimized: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
