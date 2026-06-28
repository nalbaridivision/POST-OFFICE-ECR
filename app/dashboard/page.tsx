"use client";

import { useState, useEffect } from "react";
import { useAuth, ROLE_LABELS } from "../../context/AuthContext";
import { useRouter } from "next/navigation";
import { db } from "../firebase";
import { collection, getDocs, query, where } from "firebase/firestore";
import BottomNav from "../../components/BottomNav";

// ── TYPES & HELPERS FOR ECR CARD ────────────────────────────────
interface ECRRecord {
  officeCode: string;
  officeName?: string;
  month: string;
  income: number;
  expenditure: number;
  ecr: number;
  status: "good" | "average" | "poor";
  heads?: Record<string, number>;
}

function ecrColor(ecr: number): string {
  if (ecr >= 100) return "#16A34A";
  if (ecr >= 80)  return "#D97706";
  return "#DC2626";
}

function ecrBg(ecr: number): string {
  if (ecr >= 100) return "#DCFCE7";
  if (ecr >= 80)  return "#FEF9C3";
  return "#FEE2E2";
}

function monthLabel(m: string): string {
  if (!m) return "";
  const [y, mo] = m.split("-");
  return new Date(+y, +mo - 1).toLocaleString("default", { month: "short", year: "numeric" });
}

// ── ECR CARD COMPONENT (Integrated with User Details) ───────────
interface OfficeECRCardProps {
  records: ECRRecord[];
  officeName: string;
  officeCode: string;
  userName: string;
  userId: string;
  designation: string;
  roleLabel: string;
}

function OfficeECRCard({ records, officeName, officeCode, userName, userId, designation, roleLabel }: OfficeECRCardProps) {
  const sorted = [...records].sort((a, b) => a.month.localeCompare(b.month));
  const latest = sorted[sorted.length - 1];
  const prev   = sorted[sorted.length - 2];
  
  if (!latest) return (
    <div style={{ textAlign: "center", padding: "40px 20px", color: "#A0AEC0", background: "#fff", borderRadius: 12, border: "1px solid #E2E8F0" }}>
      <div style={{ fontSize: 44, marginBottom: 12 }}>📊</div>
      <div style={{ fontSize: 15, fontWeight: 600, color: "#718096" }}>No data yet</div>
      <div style={{ fontSize: 13, marginTop: 6 }}>Your office ECR will appear here once submitted by your Division.</div>
    </div>
  );

  const trend = prev ? latest.ecr - prev.ecr : 0;
  const trendLabel = trend > 0 ? `▲ +${trend.toFixed(1)}%` : trend < 0 ? `▼ ${Math.abs(trend).toFixed(1)}%` : "→ No change";
  const trendColor = trend > 0 ? "#16A34A" : trend < 0 ? "#DC2626" : "#718096";

  const shortfall    = Math.max(0, latest.expenditure - latest.income);
  const accsNeeded   = shortfall > 0 ? Math.ceil(shortfall / 219.23) : 0;
  const pliNeeded    = shortfall > 0 ? Math.ceil(shortfall / 0.04)   : 0;
  const rpliNeeded   = shortfall > 0 ? Math.ceil(shortfall / 0.12)   : 0;

  return (
    <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #E2E8F0", overflow: "hidden", marginBottom: 16 }}>
      
      {/* INTEGRATED HEADER: Reformatted to your specifications */}
      <div style={{ background: "linear-gradient(135deg, #1E3A8A, #1D4ED8)", padding: "16px 16px 14px", color: "#fff" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          
          {/* LEFT SIDE: Office and User Details */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>Office Name — {officeName || officeCode}</div>
            <div style={{ fontSize: 12, opacity: 0.9 }}>Office ID — {officeCode}</div>
            
            <div style={{ fontSize: 14, fontWeight: 600, marginTop: 8 }}>User Name — {userName}</div>
            <div style={{ fontSize: 12, opacity: 0.9 }}>Employee ID — {userId}</div>
          </div>

          {/* RIGHT SIDE: Status Badge & Month */}
          <div style={{ textAlign: "right", display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
            <div style={{ fontSize: 10, fontWeight: 700, background: "rgba(255,255,255,0.2)", padding: "4px 8px", borderRadius: 12, textTransform: "uppercase", marginBottom: 6 }}>
              {roleLabel}
            </div>
            <div style={{ fontSize: 11, opacity: 0.8 }}>
              {monthLabel(latest.month)} Performance
            </div>
          </div>

        </div>
      </div>

      <div style={{ padding: "20px 16px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16 }}>
          <div style={{
            width: 90, height: 90, borderRadius: "50%",
            background: `conic-gradient(${ecrColor(latest.ecr)} ${Math.min(latest.ecr, 100) * 3.6}deg, #F1F5F9 0deg)`,
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}>
            <div style={{ width: 70, height: 70, borderRadius: "50%", background: "#fff", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: ecrColor(latest.ecr), lineHeight: 1 }}>{latest.ecr.toFixed(1)}</div>
              <div style={{ fontSize: 10, color: "#718096" }}>ECR %</div>
            </div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <div style={{ flex: 1, background: "#F0FFF4", borderRadius: 8, padding: "8px 10px" }}>
                <div style={{ fontSize: 10, color: "#718096" }}>Income</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#16A34A" }}>₹{latest.income.toLocaleString("en-IN")}</div>
              </div>
              <div style={{ flex: 1, background: "#FFF5F5", borderRadius: 8, padding: "8px 10px" }}>
                <div style={{ fontSize: 10, color: "#718096" }}>Expenditure</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#DC2626" }}>₹{latest.expenditure.toLocaleString("en-IN")}</div>
              </div>
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: trendColor }}>{trendLabel} vs last month</div>
          </div>
        </div>

        {/* 3-month trend */}
        <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
          {sorted.slice(-3).map((r) => (
            <div key={r.month} style={{ flex: 1, background: ecrBg(r.ecr), borderRadius: 8, padding: "8px 6px", textAlign: "center" }}>
              <div style={{ fontSize: 10, color: "#718096", marginBottom: 2 }}>{monthLabel(r.month)}</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: ecrColor(r.ecr) }}>{r.ecr.toFixed(1)}%</div>
            </div>
          ))}
        </div>

        {/* Shortfall Section */}
        {shortfall > 0 && (
          <div style={{ background: "#FFF5F5", border: "1.5px solid #FC8181", borderRadius: 10, padding: 14, marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#C53030", marginBottom: 8, textTransform: "uppercase" }}>
              ⚠️ Shortfall — ₹{shortfall.toLocaleString("en-IN")}
            </div>
            <div style={{ fontSize: 12, color: "#7F1D1D", marginBottom: 8 }}>To reach <strong>100% ECR</strong>, you need ANY ONE of:</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {[
                { label: "📮 POSB Live A/C to open", value: `${accsNeeded.toLocaleString()} accounts` },
                { label: "🛡️ Additional PLI Premium", value: `₹${pliNeeded.toLocaleString()}` },
                { label: "🌾 Additional RPLI Premium", value: `₹${rpliNeeded.toLocaleString()}` },
              ].map(item => (
                <div key={item.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#FEE2E2", borderRadius: 6, padding: "8px 12px" }}>
                  <span style={{ fontSize: 12, color: "#7F1D1D" }}>{item.label}</span>
                  <strong style={{ fontSize: 15, color: "#B91C1C" }}>{item.value}</strong>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* POSB/PLI/RPLI current */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          {[
            { label: "POSB Live", value: `${latest.heads?.posb_live || 0} a/c`, color: "#1D4ED8" },
            { label: "PLI", value: `₹${((latest.heads?.pli_premium || 0)/1000).toFixed(0)}K`, color: "#0F766E" },
            { label: "RPLI", value: `₹${((latest.heads?.rpli_premium || 0)/1000).toFixed(0)}K`, color: "#7C3AED" },
          ].map(m => (
            <div key={m.label} style={{ background: "#F7FAFC", borderRadius: 8, padding: "8px 10px", textAlign: "center" }}>
              <div style={{ fontSize: 10, color: "#718096", marginBottom: 2 }}>{m.label}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: m.color }}>{m.value}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── MAIN DASHBOARD COMPONENT ─────────────────────────────────────────
export default function Dashboard() {
  const { profile, user, loading } = useAuth();
  const router = useRouter();
  
  // State for ECR Report rendering
  const [myRecords, setMyRecords] = useState<ECRRecord[]>([]);
  const [loadingReport, setLoadingReport] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.push("/");
  }, [loading, user]);

  const isLowerOffice = ["ho_admin", "so_admin", "office_user"].includes(profile?.role || "");

  useEffect(() => {
    if (profile && isLowerOffice && (profile.officeId || profile.officeCode)) {
      fetchMyData();
    }
  }, [profile, isLowerOffice]);

  async function fetchMyData() {
    setLoadingReport(true);
    try {
      const q = query(
        collection(db, "ecr"), 
        where("officeCode", "==", profile?.officeId || profile?.officeCode)
      );
      const snap = await getDocs(q);
      setMyRecords(snap.docs.map(d => d.data() as ECRRecord));
    } catch (e) {
      console.error("Error fetching dashboard data:", e);
    } finally {
      setLoadingReport(false);
    }
  }

  if (!profile) return null;

  const roleColor: Record<string, string> = {
    superadmin: "#6B21A8", circle_admin: "#1D4ED8",
    division_admin: "#0F766E", subdivision_admin: "#15803D", office_user: "#854D0E",
  };

  // ── 1. RENDER DIRECT ECR CARD FOR HO, SO, BO ──
  if (isLowerOffice) {
    return (
      <div style={{ paddingBottom: 80, background: "#F0F4F8", minHeight: "100vh", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
        <div style={{ padding: "16px 12px" }}>
          
          <div style={{ fontSize: 13, fontWeight: 700, color: "#A0AEC0", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 12, marginTop: 4 }}>
            My Dashboard
          </div>
          
          {loadingReport ? (
            <div style={{ textAlign: "center", padding: "40px", color: "#A0AEC0", background: "#fff", borderRadius: 12, border: "1px solid #E2E8F0" }}>
              Loading Report...
            </div>
          ) : (
            <OfficeECRCard 
              records={myRecords} 
              officeName={profile?.officeName || ""} 
              officeCode={profile?.officeId || profile?.officeCode || ""}
              userName={profile?.name || ""}
              userId={profile?.employeeId || ""}
              designation={profile?.designation || ""}
              roleLabel={ROLE_LABELS[profile?.role || ""] || profile?.role}
            />
          )}
        </div>
        <BottomNav />
      </div>
    );
  }

  // ── 2. RENDER MENU DASHBOARD FOR HIGHER ADMINS ──
  return (
    <div style={{ paddingBottom: 80, background: "#F0F4F8", minHeight: "100vh", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      {/* Admin Header */}
      <div style={{
        background: "linear-gradient(135deg, #0D47A1, #1E88E5)",
        padding: "20px 16px 24px", color: "#fff"
      }}>
        <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>
          {ROLE_LABELS[profile.role] || profile.role}
        </div>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 2px" }}>
          {profile.name}
        </h1>
        <div style={{ fontSize: 13, opacity: 0.85 }}>
          {profile.designation || "ECR Analytics Portal"}
        </div>
      </div>

      <div style={{ padding: "16px 12px" }}>
        
        {/* Admin Role Badge */}
        <div style={{
          background: "#fff", borderRadius: 12, padding: "12px 16px",
          marginBottom: 16, border: "1px solid #E2E8F0",
          display: "flex", alignItems: "center", gap: 12
        }}>
          <div style={{
            width: 44, height: 44, borderRadius: "50%",
            background: roleColor[profile.role] || "#334155",
            display: "flex", alignItems: "center",
            justifyContent: "center", fontSize: 20
          }}>
            {profile.role === "superadmin" ? "👑" :
             profile.role === "circle_admin" ? "🔵" :
             profile.role === "division_admin" ? "🟢" : "🏪"}
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#1A202C" }}>
              {ROLE_LABELS[profile.role]}
            </div>
            <div style={{ fontSize: 12, color: "#718096" }}>
              ID: {profile.employeeId}
              {profile.circleCode && ` · Circle: ${profile.circleCode}`}
              {profile.divisionCode && ` · Div: ${profile.divisionCode}`}
            </div>
          </div>
        </div>

        {/* Alert Box */}
        <div style={{
          background: "#FFFBEB", border: "1px solid #FCD34D",
          borderRadius: 12, padding: "12px 16px", marginBottom: 16
        }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#92400E", marginBottom: 4 }}>
            ⚠️ System Notice
          </div>
          <div style={{ fontSize: 13, color: "#78350F" }}>
            Welcome to ECR Portal. Upload office hierarchy and create users to get started.
          </div>
        </div>

        {/* Quick Actions */}
        <div style={{ fontSize: 11, fontWeight: 700, color: "#A0AEC0",
          textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 10 }}>
          Quick Actions
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {[
            { icon: "👥", label: "Manage Users",   path: "/users",          color: "#EBF8FF", border: "#BEE3F8" },
            { icon: "🏢", label: "Upload Offices", path: "/hierarchy",      color: "#F0FFF4", border: "#9AE6B4" },
            { icon: "📊", label: "Enter Data",     path: "/data",           color: "#FAF5FF", border: "#D6BCFA" },
            { icon: "📈", label: "View Reports",   path: "/reports",        color: "#FFF5F5", border: "#FEB2B2" },
            { icon: "🔧", label: "Fix ECR Data",   path: "/admin/fix-ecr",  color: "#FFF5F5", border: "#FECACA" },
           ].map(item => (
            <button key={item.path}
              onClick={() => router.push(item.path)}
              style={{
                gridColumn: (item as any).span ? `span ${(item as any).span}` : "auto",
                background: item.color, border: `1px solid ${item.border}`,
                borderRadius: 12, padding: "16px 12px", cursor: "pointer",
                display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
                boxShadow: "0 2px 4px rgba(0,0,0,0.02)"
              }}>
              <span style={{ fontSize: 28 }}>{item.icon}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: "#2D3748" }}>
                {item.label}
              </span>
            </button>
          ))}
        </div>

      </div>
      <BottomNav />
    </div>
  );
}
