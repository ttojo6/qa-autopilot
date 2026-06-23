import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "qa-autopilot · Governance Console",
  description: "AI 수정 제안 검토·승인 콘솔",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <div className="wrap">{children}</div>
      </body>
    </html>
  );
}
