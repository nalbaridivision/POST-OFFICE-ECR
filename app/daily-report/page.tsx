"use client";

import { useState, useEffect } from "react";
import { useAuth } from "../../context/AuthContext";
import { useRouter } from "next/navigation";
import { db } from "../firebase";
import {
  collection, getDocs, query, where,
  orderBy, Timestamp
} from "firebase/firestore";
import BottomNav from "../../components/BottomNav";

interface DailyRecord {
  officeId: string;
  officeName?: string;
  date: string;
  closingBalance: number;
  minBalance: number;
  maxBalance: number;
  excessCash: number;
  cashStatus: string;
  posbIndexed: number;
  pliPolicies: number;
  pliPremium: number;
  rpliPolicies: number;
  rpliPremium: number;
  remarks?: string;
  submittedByName?: string;
  circleCode?: string;
  divisionCode?: string;
  subDivCode?: string;
}

type FilterParam = "excessCash" | "posbIndexed" | "pliPremium" | "rpliPremium" | "closingBalance";
type FilterOp    = "above" | "below" | "between";

export default function DailyReportPage() {
  const { profile, user } = useAuth();
  const router = useRouter();

  const [records,    setRecords]    = useState<DailyRecord[]>([]);
  const [loading,    setLoading]    = useState(false);
  const [toast,      setToast]      = useState("");

  // Date filter
  const today = new Date().toISOString().split("T")[0];
  const [fromDate, setFromDate] = useState(today);
  const [toDate,   setToDate]   = useState(today);
  const [viewMode, setViewMode] = useState<"date" | "range">("date");

  // Parameter filter
  const [filterParam,  setFilterParam]  = useState<FilterParam>("excessCash");
  const [filterOp,     setFilterOp]     = useState<FilterOp>("above");
  const [filterVal1,   setFilterVal1]   = useState("");
  const [filterVal2,   setFilterVal2]   = useState("");
  const [filterResult, setFilterResult] = useState<DailyRecord[] | null>(null);
  const [activeTab,    setActiveTab]    = useState<"list" | "filter">("list");

  useEffect(() => {
    if (!user) { router.push("/"); return; }
    if (profile) fetchRecords();
  }, [user, profile, fromDate, toDate, viewMode]);

  async function fetchRecords() {
    setLoading(true);
    try {
      const col  = collection(db, "dailyEntry");
      const role = profile?.role || "";
      let constraints: any[] = [];

      // Date filter
      if (viewMode === "date") {
        constraints.push(where("date", "==", fromDate));
      } else {
        constraints.push(where("date", ">=", fromDate));
        constraints.push(where("date", "<=", toDate));
      }

      // Hierarchy filter
      if      (role === "circle_admin")     constraints.push(where("circleCode",   "==", profile?.circleCode));
      else if (role === "region_admin")     constraints.push(where("regionId",     "==", profile?.regionId));
      else if (role === "division_admin")   constraints.push(where("divisionCode", "==", profile?.divisionCode));
      else if (role === "subdivision_admin")constraints.push(where("subDivCode",   "==", profile?.subDivCode));
      else if (!["superadmin"].includes(role)) {
        constraints.push(where("officeId", "==", profile?.officeId || profile?.officeCode));
      }

      const q    = query(col, ...constraints);
      const snap = await getDocs(q);
      const data = snap.docs.map(d => d.data() as DailyRecord);
      setRecords(data.sort((a,b) => b.date.localeCompare(a.date)));
    } catch (e: any) { showToast("Error: " + e.message); }
    finally { setLoading(false); }
  }

  function applyFilter() {
    const v1 = parseFloat(filterVal1) || 0;
    const v2 = parseFloat(filterVal2) || 0;

    const getVal = (r: DailyRecord) => {
      switch (filterParam) {
        case "excessCash":     return r.excessCash     || 0;
        case "posbIndexed":    return r.posbIndexed    || 0;
        case "pliPremium":     return r.pliPremium     || 0;
        case "rpliPremium":    return r.rpliPremium    || 0;
        case "closingBalance": return r.closingBalance || 0;
      }
    };

    const result = records.filter(r => {
      const val = getVal(r);
      if (filterOp === "above")   return val > v1;
      if (filterOp === "below")   return val < v1;
      if (filterOp === "between") return val >= v1 && val <= v2;
      return true;
    }).sort((a,b) => getVal(b) - getVal(a));

    setFilterResult(result);
  }

  async function exportReport(data: DailyRecord[], filename: string) {
    const XLSX = await import("xlsx");
    const rows = data.map((r,i) => ({
      Rank:            i+1,
      Date:            r.date,
      OfficeId:        r.officeId,
      OfficeName:      r.officeName || r.officeId,
      ClosingBalance:  r.closingBalance,
      MinBalance:      r.minBalance,
      MaxBalance:      r.maxBalance,
      ExcessCash:      r.excessCash,
      CashStatus:      r.cashStatus,
      POSBIndexed:     r.posbIndexed,
      PLIPolicies:     r.pliPolicies,
      PLIPremium:      r.pliPremium,
      RPLIPolicies:    r.rpliPolicies,
      RPLIPremium:     r.rpliPremium,
      SubmittedBy:     r.submittedByName,
      Remarks:         r.remarks || "",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = Array(16).fill({ wch: 16 });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Daily Report");
    XLSX.writeFile(wb, filename);
    showToast("✅ Report exported!");
  }

  function showToast(msg: string) {
    setToast(msg); setTimeout(() => setToast(""), 3000);
  }

  function cashStatusColor(status: string): [string, string] {
    if (status === "excess") return ["#FEE2E2", "#DC2626"];
    if (status === "low")    return ["#FFFBEB", "#D97706"];
    return ["#DCFCE7", "#16A34A"];
  }

  const paramLabels: Record<FilterParam, string> = {
    excessCash:     "Excess Cash Balance (₹)",
    posbIndexed:    "POSB A/C Indexed (count)",
    pliPremium:     "PLI Premium (₹)",
    rpliPremium:    "RPLI Premium (₹)",
    closingBalance: "Closing Balance (₹)",
  };

  // Summary stats
  const totalExcess  = records.reduce((a,r) => a + (r.excessCash||0), 0);
  const totalPOSB    = records.reduce((a,r) => a + (r.posbIndexed||0), 0);
  const excessCount  = records.filter(r => r.cashStatus === "excess").length;
  const lowCount     = records.filter(r => r.cashStatus === "low").length;

  return (
    <div style={{ paddingBottom: 80,
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>

      {/* Header */}
      <div style={{ background: "linear-gradient(135deg, #0D47A1, #1E88E5)",
        padding: "16px 16px 20px", color: "#fff" }}>
        <div style={{ display: "flex", justifyContent: "space-between",
          alignItems: "flex-start" }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 2px" }}>
              Daily Report
            </h1>
            <div style={{ fontSize: 13, opacity: .85 }}>
              {records.length} entries loaded
            </div>
          </div>
          <button onClick={() => router.push("/dashboard")} style={hBtn}>← Back</button>
        </div>
      </div>

      <div style={{ padding: "12px 12px 0" }}>

        {/* Date filter */}
        <div style={card}>
          <div style={{ display: "flex", gap: 0, marginBottom: 12,
            borderRadius: 8, overflow: "hidden", border: "1px solid #E2E8F0" }}>
            <button onClick={() => setViewMode("date")} style={{
              flex: 1, padding: "8px", border: "none", cursor: "pointer",
              fontWeight: 600, fontSize: 12,
              background: viewMode==="date" ? "#1565C0" : "#fff",
              color:      viewMode==="date" ? "#fff"    : "#718096",
            }}>📅 Single Day</button>
            <button onClick={() => setViewMode("range")} style={{
              flex: 1, padding: "8px", border: "none", cursor: "pointer",
              fontWeight: 600, fontSize: 12,
              background: viewMode==="range" ? "#1565C0" : "#fff",
              color:      viewMode==="range" ? "#fff"    : "#718096",
            }}>📆 Date Range</button>
          </div>

          {viewMode === "date" ? (
            <div>
              <label style={labelStyle}>Select Date</label>
              <input type="date" style={inputStyle} value={fromDate} max={today}
                onChange={e => setFromDate(e.target.value)} />
            </div>
          ) : (
            <div style={{ display: "flex", gap: 10 }}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>From</label>
                <input type="date" style={inputStyle} value={fromDate} max={today}
                  onChange={e => setFromDate(e.target.value)} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>To</label>
                <input type="date" style={inputStyle} value={toDate} max={today}
                  onChange={e => setToDate(e.target.value)} />
              </div>
            </div>
          )}
        </div>

        {/* Summary stats */}
        {records.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr",
            gap: 8, marginBottom: 12 }}>
            {[
              { label: "Total Offices", val: String(records.length), color: "#1D4ED8" },
              { label: "Excess Cash",   val: String(excessCount) + " offices", color: "#DC2626" },
              { label: "Low Cash",      val: String(lowCount) + " offices",    color: "#D97706" },
              { label: "Total POSB",    val: String(totalPOSB) + " a/c",       color: "#0F766E" },
            ].map(s => (
              <div key={s.label} style={{ background: "#fff", borderRadius: 10,
                padding: "10px 12px", border: "1px solid #E2E8F0",
                textAlign: "center" as const }}>
                <div style={{ fontSize: 9, color: "#718096", fontWeight: 700,
                  textTransform: "uppercase" as const, marginBottom: 3 }}>
                  {s.label}
                </div>
                <div style={{ fontSize: 18, fontWeight: 800, color: s.color }}>
                  {s.val}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: "flex", marginBottom: 12, borderRadius: 10,
          overflow: "hidden", border: "1px solid #E2E8F0", background: "#fff" }}>
          <button onClick={() => setActiveTab("list")} style={{
            flex: 1, padding: "10px", border: "none", cursor: "pointer",
            fontWeight: 700, fontSize: 13,
            background: activeTab==="list" ? "#1565C0" : "#fff",
            color:      activeTab==="list" ? "#fff"    : "#718096",
          }}>📋 Office List</button>
          <button onClick={() => setActiveTab("filter")} style={{
            flex: 1, padding: "10px", border: "none", cursor: "pointer",
            fontWeight: 700, fontSize: 13,
            background: activeTab==="filter" ? "#1565C0" : "#fff",
            color:      activeTab==="filter" ? "#fff"    : "#718096",
          }}>🔍 Filter & Search</button>
        </div>

        {/* OFFICE LIST TAB */}
        {activeTab === "list" && (
          <>
            {records.length > 0 && (
              <button onClick={() => exportReport(records,
                `Daily_Report_${fromDate}.xlsx`)} style={exportBtn}>
                📥 Export Report
              </button>
            )}

            {loading ? (
              <div style={{ textAlign: "center" as const, padding: 40,
                color: "#A0AEC0" }}>Loading…</div>
            ) : records.length === 0 ? (
              <div style={{ textAlign: "center" as const, padding: 40,
                color: "#A0AEC0" }}>
                <div style={{ fontSize: 40, marginBottom: 10 }}>📋</div>
                <div style={{ fontSize: 15, fontWeight: 600 }}>No entries found</div>
                <div style={{ fontSize: 13, marginTop: 4 }}>
                  No daily data submitted for selected date
                </div>
              </div>
            ) : (
              records.map((r, i) => {
                const [bg, tc] = cashStatusColor(r.cashStatus);
                return (
                  <div key={`${r.officeId}_${r.date}`} style={{
                    background: "#fff", border: `1px solid ${bg}`,
                    borderRadius: 12, padding: "12px 14px", marginBottom: 10
                  }}>
                    {/* Office header */}
                    <div style={{ display: "flex", justifyContent: "space-between",
                      alignItems: "flex-start", marginBottom: 8 }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: "#1A202C" }}>
                          {r.officeName || r.officeId}
                        </div>
                        <div style={{ fontSize: 11, color: "#A0AEC0" }}>
                          {r.officeId} · {r.date}
                        </div>
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 700,
                        background: bg, color: tc,
                        padding: "3px 10px", borderRadius: 20 }}>
                        {r.cashStatus === "excess" ? "⚠️ Excess"
                          : r.cashStatus === "low" ? "⚠️ Low"
                          : "✅ Normal"}
                      </span>
                    </div>

                    {/* Data grid */}
                    <div style={{ display: "grid",
                      gridTemplateColumns: "1fr 1fr 1fr", gap: 6,
                      marginBottom: 8 }}>
                      {[
                        { label: "Closing Bal",  val: `₹${(r.closingBalance||0).toLocaleString("en-IN")}`, color: tc },
                        { label: "Excess Cash",  val: r.excessCash>0 ? `₹${r.excessCash.toLocaleString("en-IN")}` : "—", color: r.excessCash>0?"#DC2626":"#A0AEC0" },
                        { label: "POSB Indexed", val: String(r.posbIndexed||0) + " a/c", color: "#1D4ED8" },
                        { label: "PLI Policies", val: String(r.pliPolicies||0), color: "#0F766E" },
                        { label: "PLI Premium",  val: `₹${(r.pliPremium||0).toLocaleString("en-IN")}`, color: "#0F766E" },
                        { label: "RPLI Premium", val: `₹${(r.rpliPremium||0).toLocaleString("en-IN")}`, color: "#7C3AED" },
                      ].map(m => (
                        <div key={m.label} style={{ background: "#F7FAFC",
                          borderRadius: 6, padding: "6px 8px" }}>
                          <div style={{ fontSize: 9, color: "#718096",
                            fontWeight: 700 }}>
                            {m.label}
                          </div>
                          <div style={{ fontSize: 12, fontWeight: 700,
                            color: m.color }}>
                            {m.val}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Excess cash highlight */}
                    {r.excessCash > 0 && (
                      <div style={{ background: "#FEF2F2",
                        borderRadius: 8, padding: "8px 10px",
                        fontSize: 12, color: "#B91C1C", fontWeight: 600 }}>
                        ⚠️ Excess Cash: ₹{r.excessCash.toLocaleString("en-IN")} — needs to be deposited
                      </div>
                    )}

                    {r.remarks && (
                      <div style={{ marginTop: 6, fontSize: 12,
                        color: "#718096", fontStyle: "italic" }}>
                        📝 {r.remarks}
                      </div>
                    )}

                    <div style={{ fontSize: 11, color: "#A0AEC0", marginTop: 6 }}>
                      Submitted by: {r.submittedByName}
                    </div>
                  </div>
                );
              })
            )}
          </>
        )}

        {/* FILTER TAB */}
        {activeTab === "filter" && (
          <>
            <div style={card}>
              <div style={sHead}>Filter by Parameter</div>

              {/* Parameter */}
              <label style={labelStyle}>Parameter</label>
              <div style={{ display: "flex", flexWrap: "wrap" as const,
                gap: 6, marginBottom: 12 }}>
                {(Object.keys(paramLabels) as FilterParam[]).map(p => (
                  <button key={p} onClick={() => setFilterParam(p)} style={{
                    padding: "6px 12px", fontSize: 11, fontWeight: 700,
                    borderRadius: 20, cursor: "pointer", border: "1px solid",
                    background: filterParam===p ? "#1565C0" : "#fff",
                    color:      filterParam===p ? "#fff"    : "#718096",
                    borderColor:filterParam===p ? "#1565C0" : "#E2E8F0",
                  }}>
                    {p === "excessCash"     ? "💰 Excess Cash"
                      : p === "posbIndexed"  ? "📮 POSB"
                      : p === "pliPremium"   ? "🛡️ PLI"
                      : p === "rpliPremium"  ? "🌾 RPLI"
                      : "💵 Closing Bal"}
                  </button>
                ))}
              </div>

              {/* Operator */}
              <label style={labelStyle}>Condition</label>
              <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
                {(["above","below","between"] as FilterOp[]).map(op => (
                  <button key={op} onClick={() => setFilterOp(op)} style={{
                    flex: 1, padding: "8px 4px", border: "1px solid",
                    borderRadius: 8, cursor: "pointer", fontWeight: 600,
                    fontSize: 12, textTransform: "capitalize" as const,
                    background: filterOp===op ? "#1565C0" : "#fff",
                    color:      filterOp===op ? "#fff"    : "#718096",
                    borderColor:filterOp===op ? "#1565C0" : "#E2E8F0",
                  }}>{op}</button>
                ))}
              </div>

              {/* Value inputs */}
              <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>
                    {filterOp==="between" ? "From" : "Value"}
                    {" — "}{paramLabels[filterParam]}
                  </label>
                  <input type="number" style={inputStyle} value={filterVal1}
                    placeholder="e.g. 30000"
                    onChange={e => setFilterVal1(e.target.value)} />
                </div>
                {filterOp === "between" && (
                  <div style={{ flex: 1 }}>
                    <label style={labelStyle}>To</label>
                    <input type="number" style={inputStyle} value={filterVal2}
                      placeholder="e.g. 100000"
                      onChange={e => setFilterVal2(e.target.value)} />
                  </div>
                )}
              </div>

              <button onClick={applyFilter} style={{ width: "100%", padding: 12,
                background: "#1565C0", color: "#fff", border: "none",
                borderRadius: 10, fontSize: 14, fontWeight: 700,
                cursor: "pointer" }}>
                🔍 Search
              </button>
            </div>

            {/* Filter results */}
            {filterResult !== null && (
              <>
                <div style={{ display: "flex", justifyContent: "space-between",
                  alignItems: "center", marginBottom: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#1A202C" }}>
                    {filterResult.length} offices found
                  </div>
                  {filterResult.length > 0 && (
                    <button onClick={() => exportReport(filterResult,
                      `Daily_Filter_${filterParam}_${filterOp}_${filterVal1}.xlsx`)}
                      style={exportBtn}>
                      📥 Export
                    </button>
                  )}
                </div>

                {filterResult.length === 0 ? (
                  <div style={{ textAlign: "center" as const, padding: 30,
                    color: "#A0AEC0" }}>
                    <div style={{ fontSize: 36 }}>🔍</div>
                    <div style={{ fontSize: 14, marginTop: 8 }}>
                      No offices match this filter
                    </div>
                  </div>
                ) : (
                  /* Results table */
                  <div style={{ background: "#fff", borderRadius: 12,
                    border: "1px solid #E2E8F0", overflow: "hidden",
                    marginBottom: 12 }}>
                    {/* Header */}
                    <div style={{ display: "grid",
                      gridTemplateColumns: "auto 1fr auto auto",
                      padding: "10px 14px", background: "#F7FAFC",
                      borderBottom: "1px solid #E2E8F0" }}>
                      {["#", "Office", paramLabels[filterParam], "Date"].map(h => (
                        <div key={h} style={{ fontSize: 10, fontWeight: 700,
                          color: "#718096", textTransform: "uppercase" as const }}>
                          {h}
                        </div>
                      ))}
                    </div>

                    {/* Rows */}
                    {filterResult.map((r, i) => {
                      const val = filterParam==="excessCash"     ? r.excessCash
                                : filterParam==="posbIndexed"    ? r.posbIndexed
                                : filterParam==="pliPremium"     ? r.pliPremium
                                : filterParam==="rpliPremium"    ? r.rpliPremium
                                : r.closingBalance;
                      const [bg, tc] = cashStatusColor(r.cashStatus);
                      return (
                        <div key={`${r.officeId}_${r.date}_${i}`} style={{
                          display: "grid",
                          gridTemplateColumns: "auto 1fr auto auto",
                          padding: "10px 14px",
                          borderBottom: i<filterResult.length-1
                            ? "1px solid #F7FAFC" : "none",
                          background: i%2===0 ? "#fff" : "#FAFAFA",
                          alignItems: "center",
                        }}>
                          <div style={{ fontSize: 11, color: "#A0AEC0",
                            fontWeight: 700, marginRight: 10 }}>
                            {i+1}
                          </div>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 600 }}>
                              {r.officeName || r.officeId}
                            </div>
                            <div style={{ fontSize: 10, color: "#A0AEC0" }}>
                              {r.officeId}
                            </div>
                          </div>
                          <div style={{ fontSize: 14, fontWeight: 800,
                            color: filterParam==="posbIndexed"
                              ? "#1D4ED8" : "#DC2626",
                            marginRight: 10, textAlign: "right" as const }}>
                            {filterParam==="posbIndexed"
                              ? val
                              : `₹${(val||0).toLocaleString("en-IN")}`}
                          </div>
                          <div style={{ fontSize: 11, color: "#718096" }}>
                            {r.date}
                          </div>
                        </div>
                      );
                    })}

                    {/* Footer total */}
                    <div style={{ display: "grid",
                      gridTemplateColumns: "auto 1fr auto auto",
                      padding: "10px 14px",
                      background: "#EBF8FF",
                      borderTop: "2px solid #BEE3F8" }}>
                      <div />
                      <div style={{ fontSize: 12, fontWeight: 700,
                        color: "#1D4ED8" }}>
                        TOTAL ({filterResult.length})
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 800,
                        color: "#1D4ED8", marginRight: 10,
                        textAlign: "right" as const }}>
                        {filterParam === "posbIndexed"
                          ? filterResult.reduce((a,r)=>a+r.posbIndexed,0)
                          : `₹${filterResult.reduce((a,r)=>{
                              const v = filterParam==="excessCash"   ? r.excessCash
                                      : filterParam==="pliPremium"   ? r.pliPremium
                                      : filterParam==="rpliPremium"  ? r.rpliPremium
                                      : r.closingBalance;
                              return a + (v||0);
                            }, 0).toLocaleString("en-IN")}`}
                      </div>
                      <div />
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>

      {toast && (
        <div style={{ position: "fixed", bottom: 80, left: "50%",
          transform: "translateX(-50%)", background: "#2D3748", color: "#fff",
          padding: "10px 20px", borderRadius: 24, fontSize: 13,
          fontWeight: 500, zIndex: 300 }}>
          {toast}
        </div>
      )}
      <BottomNav />
    </div>
  );
}

const card: React.CSSProperties = {
  background: "#fff", border: "1px solid #E2E8F0",
  borderRadius: 12, padding: 16, marginBottom: 12
};
const sHead: React.CSSProperties = {
  fontSize: 13, fontWeight: 700, color: "#718096",
  textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 12
};
const labelStyle: React.CSSProperties = {
  display: "block", fontSize: 11, fontWeight: 600, color: "#4A5568",
  textTransform: "uppercase", letterSpacing: "0.3px", marginBottom: 4
};
const inputStyle: React.CSSProperties = {
  width: "100%", padding: "9px 11px", fontSize: 14,
  border: "1.5px solid #E2E8F0", borderRadius: 8,
  color: "#1A202C", background: "#fff", boxSizing: "border-box", outline: "none"
};
const hBtn: React.CSSProperties = {
  background: "rgba(255,255,255,0.2)", border: "1px solid rgba(255,255,255,0.4)",
  color: "#fff", borderRadius: 8, padding: "7px 14px",
  fontSize: 12, fontWeight: 600, cursor: "pointer"
};
const exportBtn: React.CSSProperties = {
  display: "block", width: "100%", padding: "10px 14px",
  background: "#1565C0", color: "#fff", border: "none",
  borderRadius: 8, fontSize: 13, fontWeight: 600,
  cursor: "pointer", textAlign: "center" as const,
  marginBottom: 12
};