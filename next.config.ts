import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["imapflow", "mailparser", "nodemailer", "exceljs", "pino"],
  experimental: {
    serverActions: { bodySizeLimit: "15mb" }, // contact sheets are uploaded through a server action
  },
};

export default nextConfig;
