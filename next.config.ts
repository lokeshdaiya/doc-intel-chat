import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  // Loaded from node_modules at runtime: they spawn worker threads and read their own files.
  serverExternalPackages: ["officeparser", "tesseract.js"],
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
