"use client";
import { useState, useEffect } from "react";
import { useAuth } from "../../context/AuthContext";
import { useRouter } from "next/navigation";
import { db } from "../firebase";
import {
  collection, getDocs, query, where
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

interface OfficeRow {
  id: string;
  name: string;
  type: string;
  circleCode?: string;
  divisionCode?: string;
  subDivCode?: string;
}

type FilterParam = "excessCash" | "posbIndexed" | "pliPremium" | "rpliPremium" | "closingBalance";
type FilterOp = "above" | "below" | "between";
type TabType = "list" | "filter" | "notsubmitted";

// Roles allowed to see "not submitted"
const NOT_SUBMITTED_ROLES = ["superadmin", "circle_admin", "division_admin", "subdivision_admin"];

export default function DailyReportPage() {
  const { profile, user } = useAuth();
  const router = useRouter();
  const [records, setRecords] = useState<DailyRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState("");

  // Date filter
  const today = new Date().toISOString().split("T")[0];
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [viewMode, setViewMode] = useState<"date" | "range">("date");

  // Office-wise search (NEW)
  const [officeSearch, setOfficeSearch] = useState("");
  const [notSubSearch, setNotSubSearch] = useState("");

  // Parameter filter
  const [filterParam, setFilterParam] = useState<FilterParam>("excessCash");
  const [filterOp, setFilterOp] = useState<FilterOp>("above");
  const [filterVal1, setFilterVal1] = useState("");
  const [filterVal2, setFilterVal2] = useState("");
  const [filterResult, setFilterResult] = useState<DailyRecord[] | null>(null);

  const [activeTab, setActiveTab] = useState<TabType>("list");

  // Not submitted state
  const [checkDate, setCheckDate] = useState(today);
  const [notSubmitted, setNotSubmitted] = useState<OfficeRow[]>([]);
  const [loadingNonSub, setLoadingNonSub] = useState(false);
  const [nonSubChecked, setNonSubChecked] = useState(false);

  const canSeeNotSubmitted = NOT_SUBMITTED_ROLES.includes(profile?.role || "");

  useEffect(() => {
    if (!user) { router.push("/"); return; }
    if (profile) fetchRecords();
  }, [user, profile, fromDate, toDate, viewMode]);

  // Helper: build role-based scope constraints (used by both queries below)
  function getScopeConstraints() {
    const role = profile?.role || "";
    if (role === "circle_admin") return [where("circleCode", "==", (profile as any)?.circleCode)];
    if (role === "region_admin") return [where("regionId", "==", (profile as any)?.regionId)];
    if (role === "division_admin") return [where("divisionCode", "==", (profile as any)?.divisionCode)];
    if (role === "subdivision_admin") return [where("subDivCode", "==", (profile as any)?.subDivCode)];
    return []; // superadmin — no constraint
  }

  async function fetchRecords() {
    setLoading(true);
    try {
      const col = collection(db, "dailyEntry");
      const role = profile?.role || "";
      const constraints: any[] = [];

      if (viewMode === "date") {
        constraints.push(where("date", "==", fromDate));
      } else {
        constraints.push(where("date", ">=", fromDate));
        constraints.push(where("date", "<=", toDate));
      }

      if (role === "circle_admin") constraints.push(where("circleCode", "==", (profile as any)?.circleCode));
      else if (role === "region_admin") constraints.push(where("regionId", "==", (profile as any)?.regionId));
      else if (role === "division_admin") constraints.push(where("divisionCode", "==", (profile as any)?.divisionCode));
      else if (role === "subdivision_admin") constraints.push(where("subDivCode", "==", (profile as any)?.subDivCode));
      else if (!["superadmin"].includes(role)) {
        constraints.push(where("officeId", "==", (profile as any)?.officeId || (profile as any)?.officeCode));
      }

      const q = query(col, ...constraints);
      const snap = await getDocs(q);
      const data = snap.docs.map(d => d.data() as DailyRecord);
      setRecords(data.sort((a, b) => b.date.localeCompare(a.date)));
    } catch (e: any) { showToast("Error: " + e.message); }
    finally { setLoading(false); }
  }

  // ── Fetch offices that have NOT submitted for checkDate ────────
  // FIXED: both queries are now scoped with where() to match Firestore
  // security rules instead of fetching whole collections and filtering
  // client-side (that unscoped read is what threw "Missing or
  // insufficient permissions" for subdivision_admin).
  async function fetchNotSubmitted() {
    setLoadingNonSub(true);
    setNonSubChecked(false);
    setNotSubmitted([]);
    try {
      const scopeConstraints = getScopeConstraints();

      // Scoped offices query
      const offSnap = await getDocs(
        scopeConstraints.length
          ? query(collection(db, "offices"), ...scopeConstraints)
          : collection(db, "offices")
      );
      const allOffices = offSnap.docs.map(d =>
        ({ id: d.id, ...d.data() } as OfficeRow)
      );

      // Scoped dailyEntry query (date + same role scope)
      const subSnap = await getDocs(
        query(collection(db, "dailyEntry"), where("date", "==", checkDate), ...scopeConstraints)
      );
      const submittedIds = new Set(
        subSnap.docs.map(d => d.data().officeId)
      );

      // Find offices that did NOT submit
      const missing = allOffices.filter(o => !submittedIds.has(o.id));
      setNotSubmitted(missing.sort((a, b) => (a.name || "").localeCompare(b.name || "")));
      setNonSubChecked(true);
    } catch (e: any) { showToast("Error: " + e.message); }
    finally { setLoadingNonSub(false); }
  }

  async function exportNotSubmitted() {
    const XLSX = await import("xlsx");
    const rows = displayNotSubmitted.map((o, i) => ({
      Rank: i + 1,
      OfficeCode: o.id,
      OfficeName: o.name,
      Type: o.type || "",
      DivisionCode: (o as any).divisionCode || "",
      SubDivCode: (o as any).subDivCode || "",
      Date: checkDate,
      Status: "NOT SUBMITTED",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = Array(8).fill({ wch: 18 });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Not Submitted");
    XLSX.writeFile(wb, `Not_Submitted_${checkDate}.xlsx`);
    showToast("✅ Exported!");
  }

  function applyFilter() {
    const v1 = parseFloat(filterVal1) || 0;
    const v2 = parseFloat(filterVal2) || 0;
    const getVal = (r: DailyRecord) => {
      switch (filterParam) {
        case "excessCash": return r.excessCash || 0;
        case "posbIndexed": return r.posbIndexed || 0;
        case "pliPremium": return r.pliPremium || 0;
        case "rpliPremium": return r.rpliPremium || 0;
        case "closingBalance": return r.closingBalance || 0;
      }
    };
    const result = records.filter(r => {
      const val = getVal(r);
      if (filterOp === "above") return val > v1;
      if (filterOp === "below") return val < v1;
      if (filterOp === "between") return val >= v1 && val <= v2;
      return true;
    }).sort((a, b) => getVal(b) - getVal(a));
    setFilterResult(result);
  }

  async function exportReport(data: DailyRecord[], filename: string) {
    const XLSX = await import("xlsx");
    const rows = data.map((r, i) => ({
      Rank: i + 1,
      Date: r.date,
      OfficeId: r.officeId,
      OfficeName: r.officeName || r.officeId,
      ClosingBalance: r.closingBalance,
      MinBalance: r.minBalance,
      MaxBalance: r.maxBalance,
      ExcessCash: r.excessCash,
      CashStatus: r.cashStatus,
      POSBIndexed: r.posbIndexed,
      PLIPolicies: r.pliPolicies,
      PLIPremium: r.pliPremium,
      RPLIPolicies: r.rpliPolicies,
      RPLIPremium: r.rpliPremium,
      SubmittedBy: r.submittedByName,
      Remarks: r.remarks || "",
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
    if (status === "low") return ["#FFFBEB", "#D97706"];
    return ["#DCFCE7", "#16A34A"];
  }

  const paramLabels: Record<FilterParam, string> = {
    excessCash: "Excess Cash Balance (₹)",
    posbIndexed: "POSB A/C Indexed (count)",
    pliPremium: "PLI Premium (₹)",
    rpliPremium: "RPLI Premium (₹)",
    closingBalance: "Closing Balance (₹)",
  };

  // NEW: office-wise search filters — applied on top of records / notSubmitted
  const displayRecords = records.filter(r =>
    !officeSearch ||
    r.officeId.toLowerCase().includes(officeSearch.toLowerCase()) ||
    (r.officeName || "").toLowerCase().includes(officeSearch.toLowerCase())
  );

  const displayNotSubmitted = notSubmitted.filter(o =>
    !notSubSearch ||
    o.id.toLowerCase().includes(notSubSearch.toLowerCase()) ||
    (o.name || "").toLowerCase().includes(notSubSearch.toLowerCase())
  );

  const totalExcess = records.reduce((a, r) => a + (r.excessCash || 0), 0);
  const totalPOSB = records.reduce((a, r) => a + (r.posbIndexed || 0), 0);
  const excessCount = records.filter(r => r.cashStatus === "excess").length;
  const lowCount = records.filter(r => r.cashStatus === "low").length;

  // Tabs to show
  const tabs = [
    { id: "list" as TabType, label: "📋 Office List", show: true },
    { id: "filter" as TabType, label: "🔍 Filter", show: true },
    { id: "notsubmitted" as TabType, label: "🚨 Not Submitted", show: canSeeNotSubmitted },
  ].filter(t => t.show);

  return (
    <div style={{
      paddingBottom: 80,
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    }}>
      {/* Header */}
      <div style={{
        background: "linear-gradient(135deg, #0D47A1, #1E88E5)",
        padding: "16px 16px 20px", color: "#fff"
      }}>
        <div style={{
          display: "flex", justifyContent: "space-between",
          alignItems: "flex-start"
        }}>
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
          <div style={{
            display: "flex", gap: 0, marginBottom: 12,
            borderRadius: 8, overflow: "hidden", border: "1px solid #E2E8F0"
          }}>
            <button onClick={() => setViewMode("date")} style={{
              flex: 1, padding: "8px", border: "none", cursor: "pointer",
              fontWeight: 600, fontSize: 12,
              background: viewMode === "date" ? "#1565C0" : "#fff",
              color: viewMode === "date" ? "#fff" : "#718096",
            }}>📅 Single Day</button>
            <button onClick={() => setViewMode("range")} style={{
              flex: 1, padding: "8px", border: "none", cursor: "pointer",
              fontWeight: 600, fontSize: 12,
              background: viewMode === "range" ? "#1565C0" : "#fff",
              color: viewMode === "range" ? "#fff" : "#718096",
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
          <div style={{
            display: "grid", gridTemplateColumns: "1fr 1fr",
            gap: 8, marginBottom: 12
          }}>
            {[
              { label: "Total Offices", val: String(records.length), color: "#1D4ED8" },
              { label: "Excess Cash", val: String(excessCount) + " offices", color: "#DC2626" },
              { label: "Low Cash", val: String(lowCount) + " offices", color: "#D97706" },
              { label: "Total POSB", val: String(totalPOSB) + " a/c", color: "#0F766E" },
            ].map(s => (
              <div key={s.label} style={{
                background: "#fff", borderRadius: 10,
                padding: "10px 12px", border: "1px solid #E2E8F0",
                textAlign: "center" as const
              }}>
                <div style={{
                  fontSize: 9, color: "#718096", fontWeight: 700,
                  textTransform: "uppercase" as const, marginBottom: 3
                }}>
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
        <div style={{
          display: "flex", marginBottom: 12, borderRadius: 10,
          overflow: "hidden", border: "1px solid #E2E8F0", background: "#fff"
        }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
              flex: 1, padding: "10px 4px", border: "none", cursor: "pointer",
              fontWeight: 700, fontSize: 12,
              background: activeTab === t.id ? "#1565C0" : "#fff",
              color: activeTab === t.id ? "#fff" : "#718096",
            }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* ── OFFICE LIST TAB ── */}
        {activeTab === "list" && (
          <>
            {/* NEW: office-wise search box */}
            {records.length > 0 && (
              <input
                type="text"
                placeholder="🔍 Search by office name or ID"
                style={{ ...inputStyle, marginBottom: 10 }}
                value={officeSearch}
                onChange={e => setOfficeSearch(e.target.value)}
              />
            )}

            {displayRecords.length > 0 && (
              <button onClick={() => exportReport(displayRecords,
                `Daily_Report_${fromDate}.xlsx`)} style={exportBtn}>
                📥 Export Report {officeSearch && `(${displayRecords.length} filtered)`}
              </button>
            )}

            {loading ? (
              <div style={{
                textAlign: "center" as const, padding: 40,
                color: "#A0AEC0"
              }}>Loading…</div>
            ) : records.length === 0 ? (
              <div style={{
                textAlign: "center" as const, padding: 40,
                color: "#A0AEC0"
              }}>
                <div style={{ fontSize: 40, marginBottom: 10 }}>📋</div>
                <div style={{ fontSize: 15, fontWeight: 600 }}>No entries found</div>
                <div style={{ fontSize: 13, marginTop: 4 }}>
                  No daily data submitted for selected date
                </div>
              </div>
            ) : displayRecords.length === 0 ? (
              <div style={{
                textAlign: "center" as const, padding: 40,
                color: "#A0AEC0"
              }}>
                <div style={{ fontSize: 40, marginBottom: 10 }}>🔍</div>
                <div style={{ fontSize: 15, fontWeight: 600 }}>No matching offices</div>
                <div style={{ fontSize: 13, marginTop: 4 }}>
                  Try a different office name or ID
                </div>
              </div>
            ) : (
              displayRecords.map((r, i) => {
                const [bg, tc] = cashStatusColor(r.cashStatus);
                return (
                  <div key={`${r.officeId}_${r.date}`} style={{
                    background: "#fff", border: `1px solid ${bg}`,
                    borderRadius: 12, padding: "12px 14px", marginBottom: 10
                  }}>
                    <div style={{
                      display: "flex", justifyContent: "space-between",
                      alignItems: "flex-start", marginBottom: 8
                    }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: "#1A202C" }}>
                          {r.officeName || r.officeId}
                        </div>
                        <div style={{ fontSize: 11, color: "#A0AEC0" }}>
                          {r.officeId} · {r.date}
                        </div>
                      </div>
                      <span style={{
                        fontSize: 11, fontWeight: 700,
                        background: bg, color: tc,
                        padding: "3px 10px", borderRadius: 20
                      }}>
                        {r.cashStatus === "excess" ? "⚠️ Excess"
                          : r.cashStatus === "low" ? "⚠️ Low"
                            : "✅ Normal"}
                      </span>
                    </div>

                    <div style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr 1fr", gap: 6,
                      marginBottom: 8
                    }}>
                      {[
                        { label: "Closing Bal", val: `₹${(r.closingBalance || 0).toLocaleString("en-IN")}`, color: tc },
                        { label: "Excess Cash", val: r.excessCash > 0 ? `₹${r.excessCash.toLocaleString("en-IN")}` : "—", color: r.excessCash > 0 ? "#DC2626" : "#A0AEC0" },
                        { label: "POSB Indexed", val: String(r.posbIndexed || 0) + " a/c", color: "#1D4ED8" },
                        { label: "PLI Policies", val: String(r.pliPolicies || 0), color: "#0F766E" },
                        { label: "PLI Premium", val: `₹${(r.pliPremium || 0).toLocaleString("en-IN")}`, color: "#0F766E" },
                        { label: "RPLI Premium", val: `₹${(r.rpliPremium || 0).toLocaleString("en-IN")}`, color: "#7C3AED" },
                      ].map(m => (
                        <div key={m.label} style={{
                          background: "#F7FAFC",
                          borderRadius: 6, padding: "6px 8px"
                        }}>
                          <div style={{ fontSize: 9, color: "#718096", fontWeight: 700 }}>
                            {m.label}
                          </div>
                          <div style={{ fontSize: 12, fontWeight: 700, color: m.color }}>
                            {m.val}
                          </div>
                        </div>
                      ))}
                    </div>

                    {r.excessCash > 0 && (
                      <div style={{
                        background: "#FEF2F2", borderRadius: 8,
                        padding: "8px 10px", fontSize: 12,
                        color: "#B91C1C", fontWeight: 600
                      }}>
                        ⚠️ Excess Cash: ₹{r.excessCash.toLocaleString("en-IN")} — needs to be deposited
                      </div>
                    )}

                    {r.remarks && (
                      <div style={{
                        marginTop: 6, fontSize: 12,
                        color: "#718096", fontStyle: "italic"
                      }}>
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

        {/* ── FILTER TAB ── */}
        {activeTab === "filter" && (
          <>
            <div style={card}>
              <div style={sHead}>Filter by Parameter</div>

              <label style={labelStyle}>Parameter</label>
              <div style={{
                display: "flex", flexWrap: "wrap" as const,
                gap: 6, marginBottom: 12
              }}>
                {(Object.keys(paramLabels) as FilterParam[]).map(p => (
                  <button key={p} onClick={() => setFilterParam(p)} style={{
                    padding: "6px 12px", fontSize: 11, fontWeight: 700,
                    borderRadius: 20, cursor: "pointer", border: "1px solid",
                    background: filterParam === p ? "#1565C0" : "#fff",
                    color: filterParam === p ? "#fff" : "#718096",
                    borderColor: filterParam === p ? "#1565C0" : "#E2E8F0",
                  }}>
                    {p === "excessCash" ? "💰 Excess Cash"
                      : p === "posbIndexed" ? "📮 POSB"
                        : p === "pliPremium" ? "🛡️ PLI"
                          : p === "rpliPremium" ? "🌾 RPLI"
                            : "💵 Closing Bal"}
                  </button>
                ))}
              </div>

              <label style={labelStyle}>Condition</label>
              <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
                {(["above", "below", "between"] as FilterOp[]).map(op => (
                  <button key={op} onClick={() => setFilterOp(op)} style={{
                    flex: 1, padding: "8px 4px", border: "1px solid",
                    borderRadius: 8, cursor: "pointer", fontWeight: 600,
                    fontSize: 12, textTransform: "capitalize" as const,
                    background: filterOp === op ? "#1565C0" : "#fff",
                    color: filterOp === op ? "#fff" : "#718096",
                    borderColor: filterOp === op ? "#1565C0" : "#E2E8F0",
                  }}>{op}</button>
                ))}
              </div>

              <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>
                    {filterOp === "between" ? "From" : "Value"}
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

              <button onClick={applyFilter} style={{
                width: "100%", padding: 12,
                background: "#1565C0", color: "#fff", border: "none",
                borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: "pointer"
              }}>
                🔍 Search
              </button>
            </div>

            {filterResult !== null && (
              <>
                <div style={{
                  display: "flex", justifyContent: "space-between",
                  alignItems: "center", marginBottom: 8
                }}>
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
                  <div style={{
                    textAlign: "center" as const, padding: 30,
                    color: "#A0AEC0"
                  }}>
                    <div style={{ fontSize: 36 }}>🔍</div>
                    <div style={{ fontSize: 14, marginTop: 8 }}>
                      No offices match this filter
                    </div>
                  </div>
                ) : (
                  <div style={{
                    background: "#fff", borderRadius: 12,
                    border: "1px solid #E2E8F0", overflow: "hidden",
                    marginBottom: 12
                  }}>
                    <div style={{
                      display: "grid",
                      gridTemplateColumns: "auto 1fr auto auto",
                      padding: "10px 14px", background: "#F7FAFC",
                      borderBottom: "1px solid #E2E8F0"
                    }}>
                      {["#", "Office", paramLabels[filterParam], "Date"].map(h => (
                        <div key={h} style={{
                          fontSize: 10, fontWeight: 700,
                          color: "#718096", textTransform: "uppercase" as const
                        }}>
                          {h}
                        </div>
                      ))}
                    </div>

                    {filterResult.map((r, i) => {
                      const val = filterParam === "excessCash" ? r.excessCash
                        : filterParam === "posbIndexed" ? r.posbIndexed
                          : filterParam === "pliPremium" ? r.pliPremium
                            : filterParam === "rpliPremium" ? r.rpliPremium
                              : r.closingBalance;
                      return (
                        <div key={`${r.officeId}_${r.date}_${i}`} style={{
                          display: "grid",
                          gridTemplateColumns: "auto 1fr auto auto",
                          padding: "10px 14px",
                          borderBottom: i < filterResult.length - 1
                            ? "1px solid #F7FAFC" : "none",
                          background: i % 2 === 0 ? "#fff" : "#FAFAFA",
                          alignItems: "center",
                        }}>
                          <div style={{
                            fontSize: 11, color: "#A0AEC0",
                            fontWeight: 700, marginRight: 10
                          }}>
                            {i + 1}
                          </div>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 600 }}>
                              {r.officeName || r.officeId}
                            </div>
                            <div style={{ fontSize: 10, color: "#A0AEC0" }}>
                              {r.officeId}
                            </div>
                          </div>
                          <div style={{
                            fontSize: 14, fontWeight: 800,
                            color: filterParam === "posbIndexed" ? "#1D4ED8" : "#DC2626",
                            marginRight: 10, textAlign: "right" as const
                          }}>
                            {filterParam === "posbIndexed"
                              ? val
                              : `₹${(val || 0).toLocaleString("en-IN")}`}
                          </div>
                          <div style={{ fontSize: 11, color: "#718096" }}>
                            {r.date}
                          </div>
                        </div>
                      );
                    })}

                    <div style={{
                      display: "grid",
                      gridTemplateColumns: "auto 1fr auto auto",
                      padding: "10px 14px", background: "#EBF8FF",
                      borderTop: "2px solid #BEE3F8"
                    }}>
                      <div />
                      <div style={{ fontSize: 12, fontWeight: 700, color: "#1D4ED8" }}>
                        TOTAL ({filterResult.length})
                      </div>
                      <div style={{
                        fontSize: 13, fontWeight: 800,
                        color: "#1D4ED8", marginRight: 10,
                        textAlign: "right" as const
                      }}>
                        {filterParam === "posbIndexed"
                          ? filterResult.reduce((a, r) => a + r.posbIndexed, 0)
                          : `₹${filterResult.reduce((a, r) => {
                            const v = filterParam === "excessCash" ? r.excessCash
                              : filterParam === "pliPremium" ? r.pliPremium
                                : filterParam === "rpliPremium" ? r.rpliPremium
                                  : r.closingBalance;
                            return a + (v || 0);
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

        {/* ── NOT SUBMITTED TAB ── */}
        {activeTab === "notsubmitted" && canSeeNotSubmitted && (
          <>
            <div style={card}>
              <div style={sHead}>🚨 Offices Not Submitted Daily Report</div>
              <div style={{ fontSize: 12, color: "#718096", marginBottom: 12 }}>
                Check which offices under your scope have <strong>not submitted</strong> daily data for a selected date.
              </div>

              <label style={labelStyle}>Select Date to Check</label>
              <input type="date" style={{ ...inputStyle, marginBottom: 14 }}
                value={checkDate} max={today}
                onChange={e => {
                  setCheckDate(e.target.value);
                  setNonSubChecked(false);
                  setNotSubmitted([]);
                }} />

              <button
                onClick={fetchNotSubmitted}
                disabled={loadingNonSub}
                style={{
                  width: "100%", padding: 12,
                  background: loadingNonSub ? "#90CDF4" : "#DC2626",
                  color: "#fff", border: "none", borderRadius: 10,
                  fontSize: 14, fontWeight: 700,
                  cursor: loadingNonSub ? "not-allowed" : "pointer"
                }}>
                {loadingNonSub ? "Checking…" : "🔍 Check Non-Submitted Offices"}
              </button>
            </div>

            {/* Results */}
            {nonSubChecked && !loadingNonSub && (
              <>
                {/* Summary banner */}
                <div style={{
                  borderRadius: 12, padding: "12px 16px", marginBottom: 12,
                  background: notSubmitted.length === 0 ? "#F0FFF4" : "#FEF2F2",
                  border: `1px solid ${notSubmitted.length === 0 ? "#9AE6B4" : "#FECACA"}`,
                  display: "flex", justifyContent: "space-between",
                  alignItems: "center"
                }}>
                  <div>
                    <div style={{
                      fontSize: 14, fontWeight: 700,
                      color: notSubmitted.length === 0 ? "#15803D" : "#DC2626"
                    }}>
                      {notSubmitted.length === 0
                        ? "✅ All offices submitted!"
                        : `⚠️ ${notSubmitted.length} office${notSubmitted.length > 1 ? "s" : ""} NOT submitted`}
                    </div>
                    <div style={{ fontSize: 12, color: "#718096", marginTop: 2 }}>
                      For date: {checkDate}
                    </div>
                  </div>
                  {notSubmitted.length > 0 && (
                    <button onClick={exportNotSubmitted} style={{
                      padding: "8px 14px", background: "#1565C0",
                      color: "#fff", border: "none", borderRadius: 8,
                      fontSize: 12, fontWeight: 700, cursor: "pointer",
                      whiteSpace: "nowrap" as const
                    }}>
                      📥 Export
                    </button>
                  )}
                </div>

                {/* NEW: office-wise search box for not-submitted list */}
                {notSubmitted.length > 0 && (
                  <input
                    type="text"
                    placeholder="🔍 Search by office name or ID"
                    style={{ ...inputStyle, marginBottom: 10 }}
                    value={notSubSearch}
                    onChange={e => setNotSubSearch(e.target.value)}
                  />
                )}

                {/* Office list */}
                {notSubmitted.length > 0 && (
                  <div style={{
                    background: "#fff", borderRadius: 12,
                    border: "1px solid #FECACA", overflow: "hidden",
                    marginBottom: 12
                  }}>
                    {/* Table header */}
                    <div style={{
                      display: "grid",
                      gridTemplateColumns: "auto 1fr auto",
                      padding: "10px 14px", background: "#FEE2E2",
                      borderBottom: "1px solid #FECACA"
                    }}>
                      {["#", "Office Name & ID", "Type"].map(h => (
                        <div key={h} style={{
                          fontSize: 10, fontWeight: 700,
                          color: "#B91C1C",
                          textTransform: "uppercase" as const
                        }}>
                          {h}
                        </div>
                      ))}
                    </div>

                    {/* Table rows */}
                    {displayNotSubmitted.length === 0 ? (
                      <div style={{
                        textAlign: "center" as const, padding: 24,
                        color: "#A0AEC0", fontSize: 13
                      }}>
                        No matching offices for "{notSubSearch}"
                      </div>
                    ) : (
                      displayNotSubmitted.map((o, i) => (
                        <div key={o.id} style={{
                          display: "grid",
                          gridTemplateColumns: "auto 1fr auto",
                          padding: "10px 14px",
                          borderBottom: i < displayNotSubmitted.length - 1
                            ? "1px solid #FEE2E2" : "none",
                          background: i % 2 === 0 ? "#FFF5F5" : "#FEF2F2",
                          alignItems: "center",
                        }}>
                          <div style={{
                            fontSize: 11, color: "#DC2626",
                            fontWeight: 700, marginRight: 10
                          }}>
                            {i + 1}
                          </div>
                          <div>
                            <div style={{
                              fontSize: 13, fontWeight: 600,
                              color: "#1A202C"
                            }}>
                              {o.name}
                            </div>
                            <div style={{ fontSize: 10, color: "#A0AEC0" }}>
                              {o.id}
                              {(o as any).subDivCode && ` · SubDiv: ${(o as any).subDivCode}`}
                            </div>
                          </div>
                          <div>
                            <span style={{
                              fontSize: 10, fontWeight: 700,
                              background: "#FEE2E2", color: "#DC2626",
                              padding: "2px 8px", borderRadius: 10
                            }}>
                              {o.type || "—"}
                            </span>
                          </div>
                        </div>
                      ))
                    )}

                    {/* Footer */}
                    <div style={{
                      padding: "10px 14px",
                      background: "#FEE2E2",
                      borderTop: "2px solid #FECACA"
                    }}>
                      <div style={{
                        fontSize: 12, fontWeight: 700,
                        color: "#DC2626"
                      }}>
                        Total not submitted: {notSubmitted.length} offices
                        {notSubSearch && ` (${displayNotSubmitted.length} shown)`}
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>

      {toast && (
        <div style={{
          position: "fixed", bottom: 80, left: "50%",
          transform: "translateX(-50%)", background: "#2D3748", color: "#fff",
          padding: "10px 20px", borderRadius: 24, fontSize: 13,
          fontWeight: 500, zIndex: 300
        }}>
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
