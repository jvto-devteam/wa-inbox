import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Flow Map dan Rules pindah jadi tab di /bot-control (audit 2026-10-31).
  async redirects() {
    return [
      { source: '/bot-control/flows', destination: '/bot-control', permanent: false },
      { source: '/bot-control/rules', destination: '/bot-control', permanent: false },
    ]
  },
};

export default nextConfig;
