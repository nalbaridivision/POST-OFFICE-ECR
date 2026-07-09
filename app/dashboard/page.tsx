"use client";

import { useAuth, ROLE_LABELS } from "../../context/AuthContext";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { db } from "../firebase";
import { collection, getDocs, query, where } from "firebase/firestore";
import { countUnread } from "../../utils/messageService";
import BottomNav from "../../components/BottomNav";

export default function Dashboard() {
  const { profile, user } = useAuth();
  const router = useRouter();

  const [unreadCount,  setUnreadCount]  = useState(0);
  const [chartData,    setChartData]    = useState<any[]>([]);
  const [loadingChart, setLoadingChart] = useState(false);
  const [showCharts,   setShowCharts]   = useState(false); // ← charts hidden by default

  useEffect(() => {
    if (!user) { router.push("/"); return; }
    if (profile?.uid) {
      countUnread(profile.uid).then(setUnreadCount).catch(() => {});
      fetchChartData();
    }
  }, [user, profile]);

  async function fetchChartData() {
    if (!profile) return;
    setLoadingChart(true);
    try {
      const now    = new Date();
      const months: string[] = [];
      for (let i = 2; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        months.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`);
      }

      const col  = collection(db, "ecr");
      const role = profile.role || "";
      let q;
      if      (role === "superadmin")       q = query(col);
      else if (role === "circle_admin")     q = query(col, where("circleCode",   "==", (profile as any).circleCode));
      else if (role === "region_admin")     q = query(col, where("regionId",     "==", (profile as any).regionId));
      else if (role === "division_admin")   q = query(col, where("divisionCode", "==", (profile as any).divisionCode));
      else if (role === "subdivision_admin")q = query(col, where("subDivCode",   "==", (profile as any).subDivCode));
      else q = query(col, where("officeCode", "==",
        (profile as any).officeId || (profile as any).officeCode));

      const snap = await getDocs(q);
      const ecrs = snap.docs.map(d => d.data());

      const data = months.map(month => {
        const monthEcrs = ecrs.filter((r:any) => r.month === month);
        const avg       = monthEcrs.length
          ? monthEcrs.reduce((a:number,r:any) => a+(r.ecr||0),0)/monthEcrs.length : 0;
        const totalInc  = monthEcrs.reduce((a:number,r:any) => a+(r.income||0),0);
        const totalExp  = monthEcrs.reduce((a:number,r:any) => a+(r.expenditure||0),0);
        const good      = monthEcrs.filter((r:any) => r.ecr>=100).length;
        const poor      = monthEcrs.filter((r:any) => r.ecr<80).length;
        return { month, avg, totalInc, totalExp, good, poor, count: monthEcrs.length };
      });
      setChartData(data);
    } catch(e) { console.error(e); }
    finally { setLoadingChart(false); }
  }

  if (!profile) return null;

  const p = profile as any;

  const roleColor: Record<string,string> = {
    superadmin:        "#6B21A8",
    circle_admin:      "#1D4ED8",
    region_admin:      "#0369A1",
    division_admin:    "#0F766E",
    subdivision_admin: "#15803D",
    ho_admin:          "#854D0E",
    so_admin:          "#92400E",
    office_user:       "#7F1D1D",
  };

  const roleIcon: Record<string,string> = {
    superadmin:        "👑",
    circle_admin:      "🔵",
    region_admin:      "🟣",
    division_admin:    "🟢",
    subdivision_admin: "🏢",
    ho_admin:          "🏤",
    so_admin:          "📮",
    office_user:       "🏪",
  };

  const isAdminLevel = ["superadmin","circle_admin","region_admin",
    "division_admin","subdivision_admin"].includes(p.role);

  const ecrColor = (v:number) => v>=100?"#16A34A":v>=80?"#D97706":"#DC2626";
  const ecrBg    = (v:number) => v>=100?"#DCFCE7":v>=80?"#FEF9C3":"#FEE2E2";

  const cur  = chartData[chartData.length - 1];
  const prev = chartData[chartData.length - 2];
  const diff = cur && prev ? cur.avg - prev.avg : 0;
  const maxAvg = chartData.length ? Math.max(...chartData.map(d=>d.avg), 100) : 100;
  const maxInc = chartData.length ? Math.max(...chartData.map(d=>d.totalInc), 1) : 1;

  const monthShort = (m:string) => {
    if (!m) return "";
    const [y,mo] = m.split("-");
    return new Date(+y,+mo-1).toLocaleString("default",{month:"short",year:"2-digit"});
  };

  // ── Quick action tiles ─────────────────────────────────────────
  const allActions = [
    { icon:"👥", label:"Manage Users",   path:"/users",         color:"#EBF8FF", border:"#BEE3F8", adminOnly:true,  superOnly:false },
    { icon:"🏢", label:"Upload Offices", path:"/hierarchy",     color:"#F0FFF4", border:"#9AE6B4", adminOnly:true,  superOnly:false },
    { icon:"📊", label:"Enter Income",   path:"/data",          color:"#FAF5FF", border:"#D6BCFA", adminOnly:true,  superOnly:false },
    { icon:"💰", label:"Expenditure",    path:"/salary",        color:"#FFF5F5", border:"#FEB2B2", adminOnly:true,  superOnly:false },
    { icon:"📈", label:"ECR Reports",    path:"/reports",       color:"#EBF8FF", border:"#BEE3F8", adminOnly:false, superOnly:false },
    { icon:"📝", label:"Daily Entry",    path:"/daily",         color:"#F0FFF4", border:"#9AE6B4", adminOnly:false, superOnly:false },
    { icon:"📋", label:"Daily Report",   path:"/daily-report",  color:"#FFFBEB", border:"#FDE68A", adminOnly:true,  superOnly:false },
    { icon:"✉️",  label:"Messages",       path:"/messages",      color:"#FAF5FF", border:"#D6BCFA", adminOnly:false, superOnly:false },
    { icon:"🏘️", label:"Village Data", path:"/village-data",     color:"#FFFBEB", border:"#FDE68A", adminOnly:false, superOnly:false },
    // ← Chart button — only for admin levels
    { icon:"📉", label:"ECR Progress",   path:"__charts__",     color:"#ECFDF5", border:"#6EE7B7", adminOnly:true,  superOnly:false },
    { icon:"🔧", label:"Fix ECR Data",   path:"/admin/fix-ecr", color:"#FFF5F5", border:"#FECACA", adminOnly:false, superOnly:true  },
  ].filter(a => {
    if (a.superOnly) return p.role === "superadmin";
    if (a.adminOnly) return isAdminLevel;
    return true;
  });

  function handleActionClick(path: string) {
    if (path === "__charts__") {
      setShowCharts(s => !s);
    } else {
      router.push(path);
    }
  }

  return (
    <div style={{ paddingBottom: 80, background: "#F0F4F8", minHeight: "100vh",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>

      {/* ── Header ── */}
      <div style={{ background: "linear-gradient(135deg, #0D47A1, #1E88E5)",
        padding: "20px 16px 28px", color: "#fff" }}>
        <div style={{ display: "flex", justifyContent: "space-between",
          alignItems: "flex-start" }}>
          <div style={{ flex: 1, marginRight: 12 }}>
            {/* Line 1: Name (Employee ID) */}
            <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 4px", lineHeight: 1.2 }}>
              {p.name}
              <span style={{ fontSize: 13, fontWeight: 400, opacity: .75,
                marginLeft: 8 }}>
                ({p.employeeId})
              </span>
            </h1>
            {/* Line 2: Designation */}
            {p.designation && (
              <div style={{ fontSize: 13, opacity: .9, marginBottom: 3 }}>
                {p.designation}
              </div>
            )}
            {/* Line 3: Office Name — Office ID */}
            {(p.officeName || p.officeId || p.officeCode) && (
              <div style={{ fontSize: 13, opacity: .85 }}>
                {p.officeName || ""}
                {(p.officeId || p.officeCode) && (
                  <span style={{ opacity: .75, marginLeft: 4 }}>
                    — {p.officeId || p.officeCode}
                  </span>
                )}
              </div>
            )}
            {/* For admin roles show role label instead of office */}
            {!p.officeName && !p.officeId && !p.officeCode && (
              <div style={{ fontSize: 13, opacity: .8 }}>
                {ROLE_LABELS[p.role] || p.role}
              </div>
            )}
          </div>
          <div style={{ fontSize: 34, flexShrink: 0 }}>
            {roleIcon[p.role] || "🏢"}
          </div>
        </div>
      </div>

      <div style={{ padding: "0 12px" }}>

        {/* ── Role badge — simplified, no hierarchy codes ── */}
        <div style={{ background: "#fff", borderRadius: 12, padding: "12px 16px",
          marginTop: -16, marginBottom: 12,
          border: "1px solid #E2E8F0",
          boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
          display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 42, height: 42, borderRadius: "50%",
            background: roleColor[p.role] || "#334155",
            display: "flex", alignItems: "center",
            justifyContent: "center", fontSize: 20,
            color: "#fff", flexShrink: 0
          }}>
            {roleIcon[p.role] || "🏢"}
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#1A202C" }}>
              {ROLE_LABELS[p.role] || p.role}
            </div>
            <div style={{ fontSize: 12, color: "#718096" }}>
              ID: {p.employeeId}
            </div>
          </div>
        </div>

        {/* ── Unread messages ── */}
        {unreadCount > 0 && (
          <div onClick={() => router.push("/messages")}
            style={{ background: "#EBF8FF", border: "1px solid #BEE3F8",
              borderRadius: 12, padding: "12px 16px", marginBottom: 12,
              cursor: "pointer", display: "flex",
              justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#1D4ED8" }}>
                ✉️ {unreadCount} unread message{unreadCount>1?"s":""}
              </div>
              <div style={{ fontSize: 12, color: "#4A5568", marginTop: 2 }}>
                Tap to view inbox
              </div>
            </div>
            <span style={{ fontSize: 18, color: "#1D4ED8" }}>→</span>
          </div>
        )}

        {/* ── Quick Actions grid ── */}
        <div style={{ fontSize: 11, fontWeight: 700, color: "#718096",
          textTransform: "uppercase", letterSpacing: .5,
          marginBottom: 10, marginTop: 4 }}>
          Quick Actions
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10,
          marginBottom: 12 }}>
          {allActions.map(item => (
            <button key={item.path}
              onClick={() => handleActionClick(item.path)}
              style={{
                background: item.path === "__charts__" && showCharts
                  ? "#D1FAE5" : item.color,
                border: `1.5px solid ${item.path==="__charts__"&&showCharts
                  ? "#10B981" : item.border}`,
                borderRadius: 12, padding: "14px 10px", cursor: "pointer",
                display: "flex", flexDirection: "column",
                alignItems: "center", gap: 6,
                position: "relative" as const
              }}>
              <span style={{ fontSize: 26 }}>{item.icon}</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: "#2D3748",
                textAlign: "center" as const }}>
                {item.label}
                {item.path === "__charts__" && showCharts && (
                  <span style={{ display: "block", fontSize: 9,
                    color: "#059669" }}>▲ tap to hide</span>
                )}
              </span>
              {/* Messages unread badge */}
              {item.path === "/messages" && unreadCount > 0 && (
                <span style={{ position: "absolute", top: 8, right: 8,
                  background: "#DC2626", color: "#fff", fontSize: 9,
                  fontWeight: 700, minWidth: 16, height: 16,
                  borderRadius: "50%", display: "flex",
                  alignItems: "center", justifyContent: "center",
                  border: "2px solid #fff" }}>
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ── Charts — shown inline when "ECR Progress" is tapped ── */}
        {showCharts && isAdminLevel && !loadingChart && chartData.length > 0
          && cur && prev && (
          <div style={{ marginBottom: 12 }}>

            {/* Current vs Previous */}
            <div style={{ background: "#fff", borderRadius: 12, padding: 14,
              border: "1px solid #E2E8F0", marginBottom: 10 }}>
              <div style={sHead}>📊 Current vs Previous Month</div>
              <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
                <div style={{ flex: 1, background: "#F7FAFC", borderRadius: 10,
                  padding: "10px 12px", textAlign: "center" as const }}>
                  <div style={{ fontSize: 10, color: "#718096", marginBottom: 4 }}>
                    {monthShort(prev.month)}
                  </div>
                  <div style={{ fontSize: 24, fontWeight: 800,
                    color: ecrColor(prev.avg), lineHeight: 1 }}>
                    {prev.avg.toFixed(1)}%
                  </div>
                  <div style={{ fontSize: 10, color: "#A0AEC0", marginTop: 2 }}>
                    {prev.count} offices
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", fontSize: 22,
                  fontWeight: 800,
                  color: diff>0?"#16A34A":diff<0?"#DC2626":"#718096" }}>
                  {diff>0?"▲":diff<0?"▼":"→"}
                </div>
                <div style={{ flex: 1, background: ecrBg(cur.avg), borderRadius: 10,
                  padding: "10px 12px", textAlign: "center" as const,
                  border: `2px solid ${ecrColor(cur.avg)}30` }}>
                  <div style={{ fontSize: 10, color: "#718096", marginBottom: 4 }}>
                    {monthShort(cur.month)} (Now)
                  </div>
                  <div style={{ fontSize: 24, fontWeight: 800,
                    color: ecrColor(cur.avg), lineHeight: 1 }}>
                    {cur.avg.toFixed(1)}%
                  </div>
                  <div style={{ fontSize: 10, color: "#718096", marginTop: 2 }}>
                    {cur.count} offices
                  </div>
                </div>
              </div>
              <div style={{ textAlign: "center" as const, fontSize: 13, fontWeight: 700,
                color: diff>0?"#16A34A":diff<0?"#DC2626":"#718096",
                background: diff>0?"#DCFCE7":diff<0?"#FEE2E2":"#F1F5F9",
                borderRadius: 20, padding: "6px 16px" }}>
                {diff>0?"▲":diff<0?"▼":"→"} {Math.abs(diff).toFixed(1)}%
                {diff>0?" improvement":diff<0?" decline":" no change"}
                {" "}vs last month
              </div>
            </div>

            {/* 3-month ECR bars */}
            <div style={{ background: "#fff", borderRadius: 12, padding: 14,
              border: "1px solid #E2E8F0", marginBottom: 10 }}>
              <div style={sHead}>📈 Avg ECR % — 3 Month Trend</div>
              {chartData.map((d, i) => (
                <div key={d.month} style={{ marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between",
                    fontSize: 12, marginBottom: 4 }}>
                    <span style={{ color: "#4A5568", fontWeight: 600 }}>
                      {monthShort(d.month)}
                      {i === chartData.length-1 && (
                        <span style={{ fontSize: 9, background: "#DBEAFE",
                          color: "#1D4ED8", padding: "1px 6px",
                          borderRadius: 8, marginLeft: 6, fontWeight: 700 }}>
                          Current
                        </span>
                      )}
                    </span>
                    <span style={{ fontWeight: 800, color: ecrColor(d.avg) }}>
                      {d.avg.toFixed(1)}%
                    </span>
                  </div>
                  <div style={{ background: "#F1F5F9", borderRadius: 6,
                    height: 14, overflow: "hidden" }}>
                    <div style={{
                      width: `${Math.min((d.avg/maxAvg)*100, 100)}%`,
                      height: "100%", background: ecrColor(d.avg), borderRadius: 6
                    }}/>
                  </div>
                </div>
              ))}
            </div>

            {/* Good / Poor */}
            <div style={{ background: "#fff", borderRadius: 12, padding: 14,
              border: "1px solid #E2E8F0", marginBottom: 10 }}>
              <div style={sHead}>
                Office Status — {monthShort(prev.month)} vs {monthShort(cur.month)}
              </div>
              {[
                { label:"✅ ≥100% ECR", prevVal:prev.good, curVal:cur.good,
                  color:"#16A34A", bg:"#DCFCE7", better:"more" },
                { label:"✗ Below 80%",  prevVal:prev.poor, curVal:cur.poor,
                  color:"#DC2626", bg:"#FEE2E2", better:"less" },
              ].map(row => {
                const improved = row.better==="more"
                  ? row.curVal>row.prevVal : row.curVal<row.prevVal;
                const arrowColor = row.curVal===row.prevVal ? "#718096"
                  : improved ? "#16A34A" : "#DC2626";
                return (
                  <div key={row.label} style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 600,
                      color: "#4A5568", marginBottom: 6 }}>
                      {row.label}
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <div style={{ flex: 1, background: "#F7FAFC",
                        borderRadius: 8, padding: "8px 10px",
                        textAlign: "center" as const }}>
                        <div style={{ fontSize: 10, color: "#718096" }}>
                          {monthShort(prev.month)}
                        </div>
                        <div style={{ fontSize: 22, fontWeight: 800,
                          color: row.color }}>
                          {row.prevVal}
                        </div>
                      </div>
                      <div style={{ fontSize: 16, color: "#CBD5E0" }}>→</div>
                      <div style={{ flex: 1, background: row.bg,
                        borderRadius: 8, padding: "8px 10px",
                        textAlign: "center" as const,
                        border: `1.5px solid ${row.color}30` }}>
                        <div style={{ fontSize: 10, color: "#718096" }}>
                          {monthShort(cur.month)}
                        </div>
                        <div style={{ fontSize: 22, fontWeight: 800,
                          color: row.color }}>
                          {row.curVal}
                        </div>
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 700,
                        color: arrowColor, minWidth: 60 }}>
                        {row.curVal>row.prevVal?"▲":row.curVal<row.prevVal?"▼":"→"}
                        {" "}{Math.abs(row.curVal-row.prevVal)} offices
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Income vs Expenditure */}
            <div style={{ background: "#fff", borderRadius: 12, padding: 14,
              border: "1px solid #E2E8F0", marginBottom: 10 }}>
              <div style={sHead}>💰 Income vs Expenditure Trend</div>
              {chartData.map(d => (
                <div key={d.month} style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 600,
                    color: "#4A5568", marginBottom: 6 }}>
                    {monthShort(d.month)}
                  </div>
                  <div style={{ marginBottom: 4 }}>
                    <div style={{ display: "flex", justifyContent: "space-between",
                      fontSize: 11, marginBottom: 2 }}>
                      <span style={{ color:"#16A34A", fontWeight:600 }}>Income</span>
                      <span style={{ fontWeight:700, color:"#16A34A" }}>
                        ₹{(d.totalInc/100000).toFixed(1)}L
                      </span>
                    </div>
                    <div style={{ background:"#F1F5F9", borderRadius:4,
                      height:8, overflow:"hidden" }}>
                      <div style={{ width:`${Math.min((d.totalInc/maxInc)*100,100)}%`,
                        height:"100%", background:"#16A34A", borderRadius:4 }}/>
                    </div>
                  </div>
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between",
                      fontSize: 11, marginBottom: 2 }}>
                      <span style={{ color:"#DC2626", fontWeight:600 }}>Expenditure</span>
                      <span style={{ fontWeight:700, color:"#DC2626" }}>
                        ₹{(d.totalExp/100000).toFixed(1)}L
                      </span>
                    </div>
                    <div style={{ background:"#F1F5F9", borderRadius:4,
                      height:8, overflow:"hidden" }}>
                      <div style={{ width:`${Math.min((d.totalExp/maxInc)*100,100)}%`,
                        height:"100%", background:"#DC2626", borderRadius:4 }}/>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Close button */}
            <button onClick={() => setShowCharts(false)} style={{
              width: "100%", padding: 10, background: "#F1F5F9",
              color: "#4A5568", border: "none", borderRadius: 10,
              fontSize: 13, fontWeight: 600, cursor: "pointer",
              marginBottom: 4
            }}>
              ▲ Hide Charts
            </button>
          </div>
        )}

      </div>

      <BottomNav />
    </div>
  );
}

const sHead: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: "#718096",
  textTransform: "uppercase", letterSpacing: .5, marginBottom: 12
};
