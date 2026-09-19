import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The vanilla prototype is a static folder in `public/legacy`. Next normalises
  // `/legacy/` to `/legacy`, which matches no route, so point it at the real file.
  // Keeping the prototype under `/legacy/...` keeps its relative asset paths valid.
  async redirects() {
    return [
      {
        source: "/legacy",
        destination: "/legacy/index.html",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
