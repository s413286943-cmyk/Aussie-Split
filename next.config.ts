import type { NextConfig } from "next";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const buildRelease = process.env.AUSSIE_BUILD_RELEASE
  || process.env.VERCEL_GIT_COMMIT_SHA
  || process.env.VERCEL_DEPLOYMENT_ID
  || process.env.VERCEL_URL
  || randomUUID();

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.resolve(projectRoot),
  env: {
    AUSSIE_BUILD_RELEASE: buildRelease,
  },
};

export default nextConfig;
