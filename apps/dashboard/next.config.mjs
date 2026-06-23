/** @type {import('next').NextConfig} */
const nextConfig = {
  // 워크스페이스 패키지(ESM dist)를 Next 번들 파이프라인에서 트랜스파일.
  transpilePackages: ["@qa/governance", "@qa/shared"],
  // pg는 번들하지 않고 Node에서 직접 require (네이티브/동적 require 회피).
  serverExternalPackages: ["pg"],
};

export default nextConfig;
