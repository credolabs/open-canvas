/** @type {import('next').NextConfig} */
const nextConfig = {
  productionBrowserSourceMaps: true,
  webpack: (config, { isServer, dev }) => {
    if (!isServer) {
      config.output.globalObject = 'self';
    }
    
    return config;
  },
};

export default nextConfig;
