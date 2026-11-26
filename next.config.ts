import type { NextConfig } from "next";
import { LEGACY_REDIRECTS } from "./src/lib/new/legacy-routes";

const nextConfig: NextConfig = {
  // Flow Map dan Rules pindah jadi tab di /bot-control (audit 2026-10-31).
  async redirects() {
    return [
      { source: '/bot-control/flows', destination: '/bot-control', permanent: false },
      { source: '/bot-control/rules', destination: '/bot-control', permanent: false },
      // Aplikasi baru menggantikan yang lama di root (2026-11-26): alamat lama dialihkan ke padanannya.
      ...LEGACY_REDIRECTS,
    ]
  },
};

export default nextConfig;
