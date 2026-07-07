"use client";

import { useEffect } from "react";

export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window !== "undefined" && "serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        navigator.serviceWorker
          .register("/sw.js", { scope: "/" })
          .then((reg) => {
            console.log("SW registered:", reg.scope);
          })
          .catch((err) => {
            console.log("SW failed:", err);
          });
      });
    }
  }, []);
  return null;
}
