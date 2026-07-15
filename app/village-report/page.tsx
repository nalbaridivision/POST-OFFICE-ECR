"use client";
import { useState, useEffect, useMemo } from "react";
import { useAuth } from "../../context/AuthContext";
import { useRouter } from "next/navigation";
import { db } from "../firebase";
import {
  collection, getDocs, query, where
} from "firebase/firestore";
import BottomNav from "../../components/BottomNav";

interface VillageDoc {
  id: string;
  officeId: string;
  officeName?: string;
  villageCode: string;
  villageName: string;
  circleCode?: string;
  regionCode?: string;
  divisionCode?: string;
  subDivCode?: string;

  vil?: number;
  rjil?: number;
  bal?: number;
  bsnl?: number;
  overall4gStatus?: string;
  viSimAvailable?: number;
  airtelSimAvailable?: number;
  bsnlSimAvailable?: number;
  jioSimAvailable?: number;

  viSimProcurementRequired?: number;
  airtelSimProcurementRequired?: number;
  bsnlSimProcurementRequired?: number;
  jioSimProcurementRequired?: number;

  dataSubmitted?: boolean;
  submittedBy?: string;
  submittedByName?: string;
  submittedAt?: string;
}

interface OfficeRow {
  id: string;
  name: string;
  type?: string;
}

interface OfficeSummary {
  officeId: string;
  officeName: string;
  total: number;
  submitted: number;
  pending: number;
}

type TabType = "submitted" | "notsub-office" | "notsub-village";

const REPORT_ROLES = ["superadmin", "circle_admin", "region_admin", "division_admin", "subdivision_admin"];

export default function VillageReportPage() {
  const { profile, user } = useAuth();
  const router = useRouter();

  const [villages, setVillages] = useState<VillageDoc[]>([]);
  const [offices, setOffices] = useState<OfficeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState("");
  const [activeTab, setActiveTab] = useState<TabType>("submitted");

  const [searchSubmitted, setSearchSubmitted] = useState("");
  const [searchOffice, setSearchOffice] = useState("");
  const [searchVillage, setSearchVillage] = useState("");

  const canView = REPORT_ROLES.includes(profile?.role || "");

  useEffect(() => {
    if (!user) { router.push("/"); return; }
    if (profile) {
      if (!REPORT_ROLES.includes(profile.role || "")) {
        showToast("You don't have permission to access this page");
        router.push("/dashboard");
        return;
      }
      fetchData();
    }
  }, [user, profile]);

  function showToast(msg: string) {
    setToast(msg); setTimeout(() => setToast(""), 3500);
  }

  // Role-based scope constraints — must match Firestore rules' inMyScope()
  function getScopeConstraints() {
    const role = profile?.role || "";
    if (role === "circle_admin") return [where("circleCode", "==", (profile as any)?.circleCode)];
    if (role === "region_admin") return [where("regionCode", "==", (profile as any)?.regionId)];
    if (role === "division_admin") return [where("divisionCode", "==", (profile as any)?.divisionCode)];
    if (role === "subdivision_admin") return [where("subDivCode", "==", (profile as any)?.subDivCode)];
    return []; // superadmin — no constraint
  }

  async function fetchData() {
    setLoading(true);
    try {
      const scopeConstraints = getScopeConstraints();

      const [villageSnap, officeSnap] = await Promise.all([
        getDocs(
          scopeConstraints.length
            ? query(collection(db, "villageData"), ...scopeConstraints)
            : collection(db, "villageData")
        ),
        getDocs(
          scopeConstraints.length
            ? query(collection(db, "offices"), ...scopeConstraints)
            : collection(db, "offices")
        ),
      ]);

      const villageData = villageSnap.docs.map(d => ({ id: d.id, ...d.data() } as VillageDoc));
      const officeData = officeSnap.docs.map(d => ({ id: d.id, ...d.data() } as OfficeRow));

      setVillages(villageData);
      setOffices(officeData);
    } catch (e: any) {
      showToast("Error: " + e.message);
    } finally {
      setLoading(false);
    }
  }

  const submittedVillages = useMemo(() => villages.filter(v => v.dataSubmitted), [villages]);
  const pendingVillages = useMemo(() => villages.filter(v => !v.dataSubmitted), [villages]);

  // Office-wise not-submitted summary
  const officeSummary: OfficeSummary[] = useMemo(() => {
    const officeNameMap = new Map(offices.map(o => [o.id, o.name]));
    const grouped = new Map<string, { total: number; submitted: number }>();

    villages.forEach(v => {
      const cur = grouped.get(v.officeId) || { total: 0, submitted: 0 };
      cur.total += 1;
      if (v.dataSubmitted) cur.submitted += 1;
      grouped.set(v.officeId, cur);
    });

    const list: OfficeSummary[] = [];
    grouped.forEach((val, officeId) => {
      list.push({
        officeId,
        officeName: officeNameMap.get(officeId) || officeId,
        total: val.total,
        submitted: val.submitted,
        pending: val.total - val.submitted,
      });
    });

    return list
      .filter(o => o.pending > 0)
      .sort((a, b) => b.pending - a.pending);
  }, [villages, offices]);

  // Filtered views
  const displaySubmitted = useMemo(() => {
    if (!searchSubmitted) return submittedVillages;
    const s = searchSubmitted.toLowerCase();
    return submittedVillages.filter(v =>
      (v.villageName || "").toLowerCase().includes(s) ||
      (v.villageCode || "").toLowerCase().includes(s) ||
      (v.officeName || "").toLowerCase().includes(s)
    );
  }, [submittedVillages, searchSubmitted]);

  const displayOfficeSummary = useMemo(() => {
    if (!searchOffice) return officeSummary;
    const s = searchOffice.toLowerCase();
    return officeSummary.filter(o =>
      o.officeName.toLowerCase().includes(s) || o.officeId.toLowerCase().includes(s)
    );
  }, [officeSummary, searchOffice]);

  const displayPendingVillages = useMemo(() => {
    if (!searchVillage) return pendingVillages;
    const s = searchVillage.toLowerCase();
    return pendingVillages.filter(v =>
      (v.villageName || "").toLowerCase().includes(s) ||
      (v.villageCode || "").toLowerCase().includes(s) ||
      (v.officeName || "").toLowerCase().includes(s)
    );
  }, [pendingVillages, searchVillage]);

  // KPI totals across submitted villages
  const totalViProc = submittedVillages.reduce((a, v) => a + (v.viSimProcurementRequired || 0), 0);
  const totalAirtelProc = submittedVillages.reduce((a, v) => a + (v.airtelSimProcurementRequired || 0), 0);
  const totalBsnlProc = submittedVillages.reduce((a, v) => a + (v.bsnlSimProcurementRequired || 0), 0);
  const totalJioProc = submittedVillages.reduce((a, v) => a + (v.jioSimProcurementRequired || 0), 0);

  // ── Exports ──────────────────────────────────────────────────
  async function exportSubmitted() {
    const XLSX = await import("xlsx");
    const rows = displaySubmitted.map((v, i) => ({
      Rank: i + 1,
      "Name of BO": v.officeName || v.officeId,
      "Village Code": v.villageCode,
      "Village Name": v.villageName,
      VIL: v.vil ?? "",
      RJIL: v.rjil ?? "",
      BAL: v.bal ?? "",
      BSNL: v.bsnl ?? "",
      "Overall 4G Status": v.overall4gStatus || "",
      "Vi SIM Available": v.viSimAvailable ?? "",
      "Airtel SIM Available": v.airtelSimAvailable ?? "",
      "BSNL SIM Available": v.bsnlSimAvailable ?? "",
      "Jio SIM Available": v.jioSimAvailable ?? "",
      "Vi SIM Procurement Required": v.viSimProcurementRequired ?? "",
      "Airtel SIM Procurement Required": v.airtelSimProcurementRequired ?? "",
      "BSNL SIM Procurement Required": v.bsnlSimProcurementRequired ?? "",
      "Jio SIM Procurement Required": v.jioSimProcurementRequired ?? "",
      "Submitted By": v.submittedByName || "",
      "Submitted At": v.submittedAt || "",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = Array(19).fill({ wch: 16 });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Submitted Report");
    XLSX.writeFile(wb, `Village_Survey_Submitted_${new Date().toISOString().split("T")[0]}.xlsx`);
    showToast("✅ Exported!");
  }

  async function exportOfficeWise() {
    const XLSX = await import("xlsx");
    const rows = displayOfficeSummary.map((o, i) => ({
      Rank: i + 1,
      "Office Name": o.officeName,
      "Office Code": o.officeId,
      "Total Villages": o.total,
      Submitted: o.submitted,
      Pending: o.pending,
      "% Complete": o.total > 0 ? Math.round((o.submitted / o.total) * 100) + "%" : "—",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = Array(7).fill({ wch: 18 });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Not Submitted - Office wise");
    XLSX.writeFile(wb, `Village_Survey_NotSubmitted_OfficeWise_${new Date().toISOString().split("T")[0]}.xlsx`);
    showToast("✅ Exported!");
  }

  async function exportVillageWise() {
    const XLSX = await import("xlsx");
    const rows = displayPendingVillages.map((v, i) => ({
      Rank: i + 1,
      "Office Name": v.officeName || v.officeId,
      "Village Code": v.villageCode,
      "Village Name": v.villageName,
      Status: "NOT SUBMITTED",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = Array(5).fill({ wch: 18 });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Not Submitted - Village wise");
    XLSX.writeFile(wb, `Village_Survey_NotSubmitted_VillageWise_${new Date().toISOString().split("T")[0]}.xlsx`);
    showToast("✅ Exported!");
  }

  if (!canView) return null;

  const tabs = [
    { id: "submitted" as TabType, label: `✅ Submitted (${submittedVillages.length})` },
    { id: "notsub-office" as TabType, label: `🏢 Not Sub. — Office (${officeSummary.length})` },
    { id: "notsub-village" as TabType, label: `📍 Not Sub. — Village (${pendingVillages.length})` },
  ];

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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 2px" }}>
              Village Survey Report
            </h1>
            <div style={{ fontSize: 13, opacity: .85 }}>
              {villages.length} villages in your scope
            </div>
          </div>
          <button onClick={() => router.push("/dashboard")} style={hBtn}>← Back</button>
        </div>
      </div>

      <div style={{ padding: "12px 12px 0" }}>

        {/* KPI cards */}
        {!loading && villages.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
            {[
              { label: "Total Villages", val: String(villages.length), color: "#1D4ED8" },
              { label: "Submitted", val: String(submittedVillages.length), color: "#16A34A" },
              { label: "Pending", val: String(pendingVillages.length), color: "#D97706" },
              { label: "Completion", val: villages.length ? Math.round((submittedVillages.length / villages.length) * 100) + "%" : "—", color: "#7C3AED" },
            ].map(s => (
              <div key={s.label} style={{
                background: "#fff", borderRadius: 10, padding: "10px 12px",
                border: "1px solid #E2E8F0", textAlign: "center" as const
              }}>
                <div style={{ fontSize: 9, color: "#718096", fontWeight: 700, textTransform: "uppercase" as const, marginBottom: 3 }}>
                  {s.label}
                </div>
                <div style={{ fontSize: 18, fontWeight: 800, color: s.color }}>{s.val}</div>
              </div>
            ))}
          </div>
        )}

        {/* SIM procurement KPIs */}
        {!loading && submittedVillages.length > 0 && (
          <div style={card}>
            <div style={sHead}>📶 Total SIM Procurement Required (submitted villages)</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}>
              {[
                { label: "Vi", val: totalViProc },
                { label: "Airtel", val: totalAirtelProc },
                { label: "BSNL", val: totalBsnlProc },
                { label: "Jio", val: totalJioProc },
              ].map(p => (
                <div key={p.label} style={{
                  background: p.val > 0 ? "#FEF2F2" : "#F7FAFC",
                  border: `1px solid ${p.val > 0 ? "#FECACA" : "#E2E8F0"}`,
                  borderRadius: 8, padding: "8px 6px", textAlign: "center" as const
                }}>
                  <div style={{ fontSize: 10, color: "#718096", fontWeight: 700 }}>{p.label}</div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: p.val > 0 ? "#DC2626" : "#A0AEC0" }}>{p.val}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tabs */}
        <div style={{
          display: "flex", marginBottom: 12, borderRadius: 10,
          overflow: "hidden", border: "1px solid #E2E8F0", background: "#fff", flexWrap: "wrap" as const
        }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
              flex: "1 1 33%", padding: "10px 4px", border: "none", cursor: "pointer",
              fontWeight: 700, fontSize: 11,
              background: activeTab === t.id ? "#1565C0" : "#fff",
              color: activeTab === t.id ? "#fff" : "#718096",
            }}>{t.label}</button>
          ))}
        </div>

        {loading ? (
          <div style={{ textAlign: "center" as const, padding: 40, color: "#A0AEC0" }}>Loading…</div>
        ) : villages.length === 0 ? (
          <div style={{ textAlign: "center" as const, padding: 40, color: "#A0AEC0" }}>
            <div style={{ fontSize: 40, marginBottom: 10 }}>📭</div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>No village data found</div>
            <div style={{ fontSize: 13, marginTop: 4 }}>
              Upload village master data first, then offices can submit survey data
            </div>
          </div>
        ) : (
          <>
            {/* ── SUBMITTED TAB ── */}
            {activeTab === "submitted" && (
              <>
                <input type="text" placeholder="🔍 Search by village, code, or office"
                  style={{ ...inputStyle, marginBottom: 10 }}
                  value={searchSubmitted} onChange={e => setSearchSubmitted(e.target.value)} />

                {displaySubmitted.length > 0 && (
                  <button onClick={exportSubmitted} style={exportBtn}>
                    📥 Export Submitted Report ({displaySubmitted.length})
                  </button>
                )}

                {displaySubmitted.length === 0 ? (
                  <EmptyState icon="✅" title="No submitted villages"
                    subtitle={searchSubmitted ? "Try a different search" : "Nothing submitted yet in your scope"} />
                ) : (
                  displaySubmitted.map(v => (
                    <div key={v.id} style={{
                      background: "#fff", border: "1px solid #DCFCE7", borderRadius: 12,
                      padding: "12px 14px", marginBottom: 8
                    }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 700, color: "#1A202C" }}>{v.villageName}</div>
                          <div style={{ fontSize: 11, color: "#A0AEC0" }}>
                            {v.officeName || v.officeId} · {v.villageCode}
                          </div>
                        </div>
                        <span style={{
                          fontSize: 10, fontWeight: 700, background: "#DCFCE7", color: "#16A34A",
                          padding: "3px 10px", borderRadius: 20, height: "fit-content"
                        }}>✅ Submitted</span>
                      </div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" as const, marginBottom: 6 }}>
                        {[
                          { label: "VIL", on: v.vil === 1 }, { label: "RJIL", on: v.rjil === 1 },
                          { label: "BAL", on: v.bal === 1 }, { label: "BSNL", on: v.bsnl === 1 },
                        ].map(n => (
                          <span key={n.label} style={{
                            fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 10,
                            background: n.on ? "#EBF8FF" : "#F7FAFC",
                            color: n.on ? "#1D4ED8" : "#A0AEC0"
                          }}>{n.label}: {n.on ? "Yes" : "No"}</span>
                        ))}
                      </div>
                      {[
                        v.viSimProcurementRequired, v.airtelSimProcurementRequired,
                        v.bsnlSimProcurementRequired, v.jioSimProcurementRequired
                      ].some(x => x === 1) && (
                        <div style={{ fontSize: 11, color: "#DC2626", fontWeight: 600 }}>
                          ⚠️ Procurement needed:{" "}
                          {[
                            v.viSimProcurementRequired === 1 && "Vi",
                            v.airtelSimProcurementRequired === 1 && "Airtel",
                            v.bsnlSimProcurementRequired === 1 && "BSNL",
                            v.jioSimProcurementRequired === 1 && "Jio",
                          ].filter(Boolean).join(", ")}
                        </div>
                      )}
                      <div style={{ fontSize: 11, color: "#A0AEC0", marginTop: 4 }}>
                        Submitted by: {v.submittedByName || "—"}
                      </div>
                    </div>
                  ))
                )}
              </>
            )}

            {/* ── NOT SUBMITTED — OFFICE WISE TAB ── */}
            {activeTab === "notsub-office" && (
              <>
                <input type="text" placeholder="🔍 Search by office name or code"
                  style={{ ...inputStyle, marginBottom: 10 }}
                  value={searchOffice} onChange={e => setSearchOffice(e.target.value)} />

                {displayOfficeSummary.length > 0 && (
                  <button onClick={exportOfficeWise} style={{ ...exportBtn, background: "#DC2626" }}>
                    📥 Export Office-wise Not Submitted ({displayOfficeSummary.length})
                  </button>
                )}

                {displayOfficeSummary.length === 0 ? (
                  <EmptyState icon="🎉" title="All offices fully submitted!"
                    subtitle={searchOffice ? "Try a different search" : "No pending offices in your scope"} />
                ) : (
                  <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #FECACA", overflow: "hidden" }}>
                    <div style={{
                      display: "grid", gridTemplateColumns: "1fr auto auto auto",
                      padding: "10px 14px", background: "#FEE2E2", borderBottom: "1px solid #FECACA"
                    }}>
                      {["Office", "Total", "Done", "Pending"].map(h => (
                        <div key={h} style={{ fontSize: 10, fontWeight: 700, color: "#B91C1C", textTransform: "uppercase" as const, textAlign: h === "Office" ? "left" as const : "center" as const }}>{h}</div>
                      ))}
                    </div>
                    {displayOfficeSummary.map((o, i) => (
                      <div key={o.officeId} style={{
                        display: "grid", gridTemplateColumns: "1fr auto auto auto",
                        padding: "10px 14px", alignItems: "center",
                        borderBottom: i < displayOfficeSummary.length - 1 ? "1px solid #FEE2E2" : "none",
                        background: i % 2 === 0 ? "#FFF5F5" : "#FEF2F2"
                      }}>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "#1A202C" }}>{o.officeName}</div>
                          <div style={{ fontSize: 10, color: "#A0AEC0" }}>{o.officeId}</div>
                        </div>
                        <div style={{ fontSize: 12, color: "#718096", textAlign: "center" as const }}>{o.total}</div>
                        <div style={{ fontSize: 12, color: "#16A34A", fontWeight: 700, textAlign: "center" as const }}>{o.submitted}</div>
                        <div style={{ fontSize: 12, color: "#DC2626", fontWeight: 800, textAlign: "center" as const }}>{o.pending}</div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {/* ── NOT SUBMITTED — VILLAGE WISE TAB ── */}
            {activeTab === "notsub-village" && (
              <>
                <input type="text" placeholder="🔍 Search by village, code, or office"
                  style={{ ...inputStyle, marginBottom: 10 }}
                  value={searchVillage} onChange={e => setSearchVillage(e.target.value)} />

                {displayPendingVillages.length > 0 && (
                  <button onClick={exportVillageWise} style={{ ...exportBtn, background: "#DC2626" }}>
                    📥 Export Village-wise Not Submitted ({displayPendingVillages.length})
                  </button>
                )}

                {displayPendingVillages.length === 0 ? (
                  <EmptyState icon="🎉" title="All villages submitted!"
                    subtitle={searchVillage ? "Try a different search" : "No pending villages in your scope"} />
                ) : (
                  <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #FECACA", overflow: "hidden" }}>
                    <div style={{
                      display: "grid", gridTemplateColumns: "auto 1fr auto",
                      padding: "10px 14px", background: "#FEE2E2", borderBottom: "1px solid #FECACA"
                    }}>
                      {["#", "Village / Office", "Code"].map(h => (
                        <div key={h} style={{ fontSize: 10, fontWeight: 700, color: "#B91C1C", textTransform: "uppercase" as const }}>{h}</div>
                      ))}
                    </div>
                    {displayPendingVillages.map((v, i) => (
                      <div key={v.id} style={{
                        display: "grid", gridTemplateColumns: "auto 1fr auto",
                        padding: "10px 14px", alignItems: "center",
                        borderBottom: i < displayPendingVillages.length - 1 ? "1px solid #FEE2E2" : "none",
                        background: i % 2 === 0 ? "#FFF5F5" : "#FEF2F2"
                      }}>
                        <div style={{ fontSize: 11, color: "#DC2626", fontWeight: 700 }}>{i + 1}</div>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "#1A202C" }}>{v.villageName}</div>
                          <div style={{ fontSize: 10, color: "#A0AEC0" }}>{v.officeName || v.officeId}</div>
                        </div>
                        <div style={{ fontSize: 11, color: "#718096" }}>{v.villageCode}</div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>

      {toast && (
        <div style={{
          position: "fixed", bottom: 80, left: "50%", transform: "translateX(-50%)",
          background: "#2D3748", color: "#fff", padding: "10px 20px", borderRadius: 24,
          fontSize: 13, fontWeight: 500, zIndex: 300, maxWidth: "90%", textAlign: "center" as const
        }}>
          {toast}
        </div>
      )}

      <BottomNav />
    </div>
  );
}

function EmptyState({ icon, title, subtitle }: { icon: string; title: string; subtitle: string }) {
  return (
    <div style={{ textAlign: "center" as const, padding: 40, color: "#A0AEC0" }}>
      <div style={{ fontSize: 40, marginBottom: 10 }}>{icon}</div>
      <div style={{ fontSize: 15, fontWeight: 600 }}>{title}</div>
      <div style={{ fontSize: 13, marginTop: 4 }}>{subtitle}</div>
    </div>
  );
}

const card: React.CSSProperties = {
  background: "#fff", border: "1px solid #E2E8F0",
  borderRadius: 12, padding: 16, marginBottom: 12
};

const sHead: React.CSSProperties = {
  fontSize: 12, fontWeight: 700, color: "#718096",
  textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 10
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
