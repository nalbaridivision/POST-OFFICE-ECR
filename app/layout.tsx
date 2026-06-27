import type { Metadata } from "next";
import { AuthProvider } from "../context/AuthContext";

export const metadata: Metadata = {
  title: "ECR Analytics Portal",
  description: "India Post Office Performance Tracker",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{
        margin: 0, background: "#F0F4F8",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
      }}>
        <AuthProvider>
          <div style={{
            maxWidth: 480, margin: "0 auto",
            minHeight: "100vh", position: "relative"
          }}>
            {children}
          </div>
        </AuthProvider>
      </body>
    </html>
  );
}