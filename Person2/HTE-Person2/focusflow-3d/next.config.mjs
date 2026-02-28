/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    outputFileTracingIncludes: {
      '/api/*': ['./public/demo-cache/**/*'],
    },
  },
};

export default nextConfig;
