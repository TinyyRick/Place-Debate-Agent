import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      // 小程序 H5 构建产物部署在 /app（见 npm run build:app）
      { source: "/app", destination: "/app/index.html" },
    ];
  },
};

export default nextConfig;
