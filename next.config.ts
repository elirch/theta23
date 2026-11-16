import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The retired financial application lived at these paths. Send any stale
  // bookmarks to the new workspace instead of a bare 404.
  async redirects() {
    return [
      { source: "/index.html", destination: "/", permanent: true },
      { source: "/admin.html", destination: "/", permanent: true },
    ];
  },
};

export default nextConfig;
