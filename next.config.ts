import type {NextConfig} from 'next';

const securityHeaders = [
  {key: 'x-content-type-options', value: 'nosniff'},
  {key: 'x-frame-options', value: 'DENY'},
  {key: 'referrer-policy', value: 'strict-origin-when-cross-origin'},
  {key: 'permissions-policy', value: 'camera=(), microphone=(), geolocation=(), payment=()'},
  {key: 'x-dns-prefetch-control', value: 'on'},
  // Only honoured by browsers over HTTPS; harmless on local http.
  {key: 'strict-transport-security', value: 'max-age=63072000; includeSubDomains'},
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  output: 'standalone',
  async headers() {
    return [{source: '/(.*)', headers: securityHeaders}];
  },
};

export default nextConfig;
