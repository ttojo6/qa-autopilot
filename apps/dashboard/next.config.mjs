/** @type {import('next').NextConfig} */
const nextConfig = {
  // 워크스페이스 패키지(ESM dist)를 Next 번들 파이프라인에서 트랜스파일.
  transpilePackages: ["@qa/governance", "@qa/shared"],
};

export default nextConfig;
