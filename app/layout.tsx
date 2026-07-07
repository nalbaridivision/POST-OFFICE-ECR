import type { Metadata, Viewport } from "next";
import { AuthProvider } from "../context/AuthContext";
import ServiceWorkerRegister from "./sw-register";

export const metadata: Metadata = {
  title: "ECR Analytics Portal",
  description: "India Post Office Performance Tracker",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "ECR Portal",
  },
};

export const viewport: Viewport = {
  themeColor: "#0D47A1",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="ECR Portal" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
        <meta name="theme-color" content="#0D47A1" />
      </head>
      <body style={{
        margin: 0,
        background: "#F0F4F8",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
      }}>
        <AuthProvider>
          <ServiceWorkerRegister />
          <div style={{
            maxWidth: 480,
            margin: "0 auto",
            minHeight: "100vh",
            position: "relative"
          }}>
            {children}
          </div>
        </AuthProvider>
      </body>
    </html>
  );
}
