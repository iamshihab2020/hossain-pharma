import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  // Workspace packages ship TypeScript-built ESM; Next transpiles them so they
  // participate in the same build rather than being treated as opaque deps.
  transpilePackages: ['@nexmarket/shared'],
};

export default config;
