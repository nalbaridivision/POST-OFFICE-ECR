"use client";

import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "../context/AuthContext";
import { useEffect, useState } from "react";
import { countUnread } from "../utils/messageService";

export default function BottomNav() {
  const router = useRouter();
  const pathname = usePathname();
  const { profile, logout } = useAuth();
  const [unread, setUnread] = useState(0);
  const role = profile?.role || "";

  // ── Role Visibility Logic ────────────────────────────────────────
  // Grouping roles to ensure both shorthand (co_admin) and standard (circle_admin) are caught
  const isCircleAdmin = ["co_admin", "circle_admin"].includes(role);
  const isDivisionAdmin = ["do_admin", "division_admin", "superadmin"].includes(role); 
  const isSubDivisionAdmin = ["subdivision_admin"].includes(role);
  const isOfficeUser = ["office_user", "ho_admin", "so_admin", "office"].includes(role);

  useEffect(() => {
    if (profile?.uid) {
      countUnread(profile.uid).then(setUnread).catch(()=>{});
    }
  }, [profile, pathname]);

  // Define tabs and strictly control their visibility using the `show` property
  const tabs = [
    {
      path: "/dashboard",
      icon: "🏠",
      label: "Home",
      show: true, // Everyone sees Home
    },
    {
      path: "/daily",
      icon: "📝", 
      label: "Daily",
      show: isDivisionAdmin || isOfficeUser
    },
    { 
      path: "/daily-report", 
      icon: "📈", 
      label: "D.Report",
      show: isDivisionAdmin || isSubDivisionAdmin || isOfficeUser 
    },
    {
      path: "/users",
      icon: "👥",
      label: "Users",
      show: isCircleAdmin || isDivisionAdmin || isSubDivisionAdmin
    },
    {
      path: "/hierarchy",
      icon: "🏢",
      label: "Offices",
      show: isCircleAdmin || isDivisionAdmin || isSubDivisionAdmin
    },
    {
      path: "/data",
      icon: "📊",
      label: "Income",
      show: isDivisionAdmin
    },
    {
      path: "/salary",
      icon: "💰",
      label: "Salary",
      show: isDivisionAdmin
    },
    {
      path: "/reports",
      icon: "📋",
      label: "Reports",
      show: true, // Everyone sees Reports
    },
    { 
      path: "/messages",     
      icon: "✉️",  
      label: "Messages",
      show: true 
    }
  ].filter(t => t.show);

  return (
    <nav style={{
      position: "fixed", bottom: 0, left: "50%",
      transform: "translateX(-50%)",
      width: "100%", maxWidth: 480,
      background: "#fff", borderTop: "1px solid #E2E8F0",
      display: "flex", zIndex: 100,
      paddingBottom: "env(safe-area-inset-bottom)"
    }}>
      {tabs.map(tab => (
        <button key={tab.path}
          onClick={() => router.push(tab.path)}
          style={{
            flex: 1, display: "flex", flexDirection: "column",
            alignItems: "center", padding: "10px 2px 8px",
            cursor: "pointer", border: "none", background: "none",
            color: pathname === tab.path ? "#1565C0" : "#A0AEC0",
            gap: 2, position: "relative",
          }}>
          <span style={{ fontSize: 18 }}>{tab.icon}</span>
          
          {/* Unread badge on messages */}
          {tab.path === "/messages" && unread > 0 && (
            <span style={{ position: "absolute", top: 6, right: "50%",
              marginRight: -16, background: "#DC2626", color: "#fff",
              fontSize: 9, fontWeight: 700, minWidth: 16, height: 16,
              borderRadius: "50%", display: "flex", alignItems: "center",
              justifyContent: "center", border: "2px solid #fff" }}>
              {unread > 9 ? "9+" : unread}
            </span>
          )}

          <span style={{ fontSize: 9, fontWeight: 500 }}>{tab.label}</span>
        </button>
      ))}
      <button onClick={logout} style={{ flex: 1, display: "flex",
        flexDirection: "column", alignItems: "center",
        padding: "10px 2px 8px", cursor: "pointer",
        border: "none", background: "none", color: "#A0AEC0", gap: 2 }}>
        <span style={{ fontSize: 18 }}>🚪</span>
        <span style={{ fontSize: 9, fontWeight: 500 }}>Logout</span>
      </button>
    </nav>
  );
}