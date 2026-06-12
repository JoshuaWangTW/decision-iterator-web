import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Serve src/assets as static files under /assets/
  // The vendored dashboard-template is only used server-side via fs; no static serving needed.
};

export default nextConfig;
