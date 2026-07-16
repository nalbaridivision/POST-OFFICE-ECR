"use client";
import { useState, useEffect, useMemo } from "react";
import { useAuth } from "../../context/AuthContext";
import { useRouter } from "next/navigation";
import { db } from "../firebase";
import {
  collection, getDocs, query, where, writeBatch, doc
} from "firebase/firestore";
import BottomNav from "../../components/BottomNav";

// ── Interfaces ───────────────────────────────────────────────────
interface OfficeRow {
  id: string;
  name: string;
  type?: string;
  circleCode?: string;
  regionCode?: string;
  divisionCode?: string;
  subDivCode?: string;
}

interface ParsedRow {
  officeName: string;
  villageCode: string;
  villageName: string;
}

interface MatchedRow extends ParsedRow {
  office: OfficeRow;
}

interface VillageDoc {
  id: string;
  officeId: string;
  officeName?: string;
  villageCode: string;
  villageName: string;

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
  submittedByName?: string;
  submittedAt?: string;
}

interface OfficeSummary {
  officeId: string;
  officeName: string;
  total: number;
  submitted: number;
  pending: number;
}

type MainTab = "upload" | "report";
type ReportSubTab = "submitted" | "notsub-office" | "notsub-village";

const TRAI_ADMIN_ROLES = ["superadmin", "circle_admin", "region_admin", "division_admin", "subdivision_admin"];

export default function TraiSurveyPage() {
  const { profile, user } = useAuth();
  const router = useRouter();

  const [mainTab, setMainTab] = useState<MainTab>("upload");
  const [toast, setToast] = useState("");

  const canAccess = TRAI_ADMIN_ROLES.includes(profile?.role || "");

  useEffect(() => {
    if (!user) { router.push("/"); return; }
    if (profile) {
      if (!canAccess) {
        showToast("You don't have permission to access this page");
        router.push("/dashboard");
        return;
      }
      fetchMasterOffices();
    }
  }, [user, profile]);

  useEffect(() => {
    if (mainTab === "report" && !reportLoadedOnce) fetchReportData();
  }, [mainTab]);

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

  // ═══════════════════════════════════════════════════════════
  // MASTER UPLOAD — state & logic
  // ═══════════════════════════════════════════════════════════
  const [offices, setOffices] = useState<OfficeRow[]>([]);
  const [loadingOffices, setLoadingOffices] = useState(true);
  const [fileName, setFileName] = useState("");
  const [parsing, setParsing] = useState(false);
  const [matched, setMatched] = useState<MatchedRow[]>([]);
  const [unmatched, setUnmatched] = useState<ParsedRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadDone, setUploadDone] = useState(false);

  async function fetchMasterOffices() {
    setLoadingOffices(true);
    try {
      const scopeConstraints = getScopeConstraints();
      const snap = await getDocs(
        scopeConstraints.length ? query(collection(db, "offices"), ...scopeConstraints) : collection(db, "offices")
      );
      setOffices(snap.docs.map(d => ({ id: d.id, ...d.data() } as OfficeRow)));
    } catch (e: any) {
      showToast("Error loading offices: " + e.message);
    } finally {
      setLoadingOffices(false);
    }
  }

  function normalize(s: string) {
    return (s || "").toString().trim().toLowerCase();
  }

  function buildOfficeLookup() {
    const map = new Map<string, OfficeRow>();
    offices.forEach(o => map.set(normalize(o.name), o));
    return map;
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setParsing(true);
    setMatched([]);
    setUnmatched([]);
    setUploadDone(false);

    try {
      const XLSX = await import("xlsx");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });

      if (rows.length < 2) {
        showToast("File appears empty");
        setParsing(false);
        return;
      }

      const header = rows[0].map((h: any) => normalize(String(h)));
      const officeCol = header.findIndex(h => h.includes("bo") || h.includes("office"));
      const codeCol = header.findIndex(h => h.includes("village") && h.includes("code"));
      const nameCol = header.findIndex(h => h.includes("village") && h.includes("name"));

      if (officeCol === -1 || codeCol === -1 || nameCol === -1) {
        showToast("Could not find 'Name of BO', 'Village Code', 'Village Name' columns.");
        setParsing(false);
        return;
      }

      const officeLookup = buildOfficeLookup();
      const matchedRows: MatchedRow[] = [];
      const unmatchedRows: ParsedRow[] = [];
      let lastOfficeName = "";

      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        if (!r || r.every(c => c === "" || c === null || c === undefined)) continue;

        const rawOfficeName = String(r[officeCol] ?? "").trim();
        const officeName = rawOfficeName || lastOfficeName;
        if (rawOfficeName) lastOfficeName = rawOfficeName;

        const villageCode = String(r[codeCol] ?? "").trim();
        const villageName = String(r[nameCol] ?? "").trim();
        if (!officeName || !villageCode || !villageName) continue;

        const office = officeLookup.get(normalize(officeName));
        if (office) matchedRows.push({ officeName, villageCode, villageName, office });
        else unmatchedRows.push({ officeName, villageCode, villageName });
      }

      setMatched(matchedRows);
      setUnmatched(unmatchedRows);
      if (matchedRows.length === 0 && unmatchedRows.length === 0) showToast("No valid rows found in file");
    } catch (e: any) {
      showToast("Error reading file: " + e.message);
    } finally {
      setParsing(false);
    }
  }

  async function handleUpload() {
    if (matched.length === 0) return;
    setUploading(true);
    setUploadProgress(0);
    setUploadDone(false);
    try {
      const CHUNK = 400;
      let done = 0;
      for (let i = 0; i < matched.length; i += CHUNK) {
        const chunk = matched.slice(i, i + CHUNK);
        const batch = writeBatch(db);
        chunk.forEach(row => {
          const docId = `${row.office.id}_${row.villageCode}`;
          const ref = doc(db, "traiSurveyData", docId);
          batch.set(ref, {
            officeId: row.office.id,
            officeName: row.office.name,
            villageCode: row.villageCode,
            villageName: row.villageName,
            circleCode: row.office.circleCode || null,
            regionCode: row.office.regionCode || null,
            divisionCode: row.office.divisionCode || null,
            subDivCode: row.office.subDivCode || null,
            masterUploadedBy: user?.uid || null,
            masterUploadedAt: new Date().toISOString(),
          }, { merge: true });
        });
        await batch.commit();
        done += chunk.length;
        setUploadProgress(Math.round((done / matched.length) * 100));
      }
      setUploadDone(true);
      showToast(`✅ Uploaded ${matched.length} villages successfully!`);
      setReportLoadedOnce(false); // force report tab to refresh next time it's opened
    } catch (e: any) {
      showToast("Upload error: " + e.message);
    } finally {
      setUploading(false);
    }
  }

  function resetUploadForm() {
    setFileName(""); setMatched([]); setUnmatched([]);
    setUploadDone(false); setUploadProgress(0);
  }

  async function downloadUnmatchedTemplate() {
    const XLSX = await import("xlsx");
    const rows = unmatched.map((r, i) => ({
      Rank: i + 1, "Name of BO": r.officeName, "Village Code": r.villageCode,
      "Village Name": r.villageName, Issue: "Office name not found",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = Array(5).fill({ wch: 22 });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Unmatched");
    XLSX.writeFile(wb, "Unmatched_Offices.xlsx");
  }

  // ═══════════════════════════════════════════════════════════
  // REPORT — state & logic
  // ═══════════════════════════════════════════════════════════
  const [villages, setVillages] = useState<VillageDoc[]>([]);
  const [reportOffices, setReportOffices] = useState<OfficeRow[]>([]);
  const [loadingReport, setLoadingReport] = useState(true);
  const [reportLoadedOnce, setReportLoadedOnce] = useState(false);
  const [reportSubTab, setReportSubTab] = useState<ReportSubTab>("submitted");
  const [searchSubmitted, setSearchSubmitted] = useState("");
  const [searchOffice, setSearchOffice] = useState("");
  const [searchVillage, setSearchVillage] = useState("");

  async function fetchReportData() {
    setLoadingReport(true);
    try {
      const scopeConstraints = getScopeConstraints();
      const [villageSnap, officeSnap] = await Promise.all([
        getDocs(scopeConstraints.length ? query(collection(db, "traiSurveyData"), ...scopeConstraints) : collection(db, "traiSurveyData")),
        getDocs(scopeConstraints.length ? query(collection(db, "offices"), ...scopeConstraints) : collection(db, "offices")),
      ]);
      setVillages(villageSnap.docs.map(d => ({ id: d.id, ...d.data() } as VillageDoc)));
      setReportOffices(officeSnap.docs.map(d => ({ id: d.id, ...d.data() } as OfficeRow)));
      setReportLoadedOnce(true);
    } catch (e: any) {
      showToast("Error: " + e.message);
    } finally {
      setLoadingReport(false);
    }
  }

  const submittedVillages = useMemo(() => villages.filter(v => v.dataSubmitted), [villages]);
  const pendingVillages = useMemo(() => villages.filter(v => !v.dataSubmitted), [villages]);

  const officeSummary: OfficeSummary[] = useMemo(() => {
    const nameMap = new Map(reportOffices.map(o => [o.id, o.name]));
    const grouped = new Map<string, { total: number; submitted: number }>();
    villages.forEach(v => {
      const cur = grouped.get(v.officeId) || { total: 0, submitted: 0 };
      cur.total += 1;
      if (v.dataSubmitted) cur.submitted += 1;
      grouped.set(v.officeId, cur);
    });
    const list: OfficeSummary[] = [];
    grouped.forEach((val, officeId) => list.push({
      officeId, officeName: nameMap.get(officeId) || officeId,
      total: val.total, submitted: val.submitted, pending: val.total - val.submitted,
    }));
    return list.filter(o => o.pending > 0).sort((a, b) => b.pending - a.pending);
  }, [villages, reportOffices]);

  const displaySubmitted = useMemo(() => {
    if (!searchSubmitted) return submittedVillages;
    const s = searchSubmitted.toLowerCase();
    return submittedVillages.filter(v =>
      (v.villageName || "").toLowerCase().includes(s) ||
      (v.villageCode || "").toLowerCase().includes(s) ||
      (v.officeName || "").toLowerCase().includes(s));
  }, [submittedVillages, searchSubmitted]);

  const displayOfficeSummary = useMemo(() => {
    if (!searchOffice) return officeSummary;
    const s = searchOffice.toLowerCase();
    return officeSummary.filter(o => o.officeName.toLowerCase().includes(s) || o.officeId.toLowerCase().includes(s));
  }, [officeSummary, searchOffice]);

  const displayPendingVillages = useMemo(() => {
    if (!searchVillage) return pendingVillages;
    const s = searchVillage.toLowerCase();
    return pendingVillages.filter(v =>
      (v.villageName || "").toLowerCase().includes(s) ||
      (v.villageCode || "").toLowerCase().includes(s) ||
      (v.officeName || "").toLowerCase().includes(s));
  }, [pendingVillages, searchVillage]);

  const totalViProc = submittedVillages.reduce((a, v) => a + (v.viSimProcurementRequired || 0), 0);
  const totalAirtelProc = submittedVillages.reduce((a, v) => a + (v.airtelSimProcurementRequired || 0), 0);
  const totalBsnlProc = submittedVillages.reduce((a, v) => a + (v.bsnlSimProcurementRequired || 0), 0);
  const totalJioProc = submittedVillages.reduce((a, v) => a + (v.jioSimProcurementRequired || 0), 0);

  async function exportSubmitted() {
    const XLSX = await import("xlsx");
    const rows = displaySubmitted.map((v, i) => ({
      Rank: i + 1, "Name of BO": v.officeName || v.officeId, "Village Code": v.villageCode,
      "Village Name": v.villageName, VIL: v.vil ?? "", RJIL: v.rjil ?? "", BAL: v.bal ?? "", BSNL: v.bsnl ?? "",
      "Overall 4G Status": v.overall4gStatus || "",
      "Vi SIM Available": v.viSimAvailable ?? "", "Airtel SIM Available": v.airtelSimAvailable ?? "",
      "BSNL SIM Available": v.bsnlSimAvailable ?? "", "Jio SIM Available": v.jioSimAvailable ?? "",
      "Vi SIM Procurement Required": v.viSimProcurementRequired ?? "",
      "Airtel SIM Procurement Required": v.airtelSimProcurementRequired ?? "",
      "BSNL SIM Procurement Required": v.bsnlSimProcurementRequired ?? "",
      "Jio SIM Procurement Required": v.jioSimProcurementRequired ?? "",
      "Submitted By": v.submittedByName || "", "Submitted At": v.submittedAt || "",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = Array(19).fill({ wch: 16 });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Submitted Report");
    XLSX.writeFile(wb, `TRAI_Survey_Submitted_${new Date().toISOString().split("T")[0]}.xlsx`);
    showToast("✅ Exported!");
  }

  async function exportOfficeWise() {
    const XLSX = await import("xlsx");
    const rows = displayOfficeSummary.map((o, i) => ({
      Rank: i + 1, "Office Name": o.officeName, "Office Code": o.officeId,
      "Total Villages": o.total, Submitted: o.submitted, Pending: o.pending,
      "% Complete": o.total > 0 ? Math.round((o.submitted / o.total) * 100) + "%" : "—",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = Array(7).fill({ wch: 18 });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Not Submitted - Office wise");
    XLSX.writeFile(wb, `TRAI_Survey_NotSubmitted_OfficeWise_${new Date().toISOString().split("T")[0]}.xlsx`);
    showToast("✅ Exported!");
  }

  async function exportVillageWise() {
    const XLSX = await import("xlsx");
    const rows = displayPendingVillages.map((v, i) => ({
      Rank: i + 1, "Office Name": v.officeName || v.officeId,
      "Village Code": v.villageCode, "Village Name": v.villageName, Status: "NOT SUBMITTED",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = Array(5).fill({ wch: 18 });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Not Submitted - Village wise");
    XLSX.writeFile(wb, `TRAI_Survey_NotSubmitted_VillageWise_${new Date().toISOString().split("T")[0]}.xlsx`);
    showToast("✅ Exported!");
  }

  if (!canAccess) return null;

  return (
    <div style={{ paddingBottom: 80, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      {/* Header */}
      <div style={{ background: "linear-gradient(135deg, #0D47A1, #1E88E5)", padding: "16px 16px 20px", color: "#fff" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 2px" }}>📡 TRAI Survey</h1>
            <div style={{ fontSize: 13, opacity: .85 }}>
              {mainTab === "upload" ? "Village master upload" : `${villages.length} villages in your scope`}
            </div>
          </div>
          <button onClick={() => router.push("/dashboard")} style={hBtn}>← Back</button>
        </div>

        {/* Main tabs */}
        <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
          <button onClick={() => setMainTab("upload")} style={{
            ...tabBtn,
            background: mainTab === "upload" ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.2)",
            color: mainTab === "upload" ? "#1565C0" : "#fff",
          }}>📤 Master Upload</button>
          <button onClick={() => setMainTab("report")} style={{
            ...tabBtn,
            background: mainTab === "report" ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.2)",
            color: mainTab === "report" ? "#1565C0" : "#fff",
          }}>📊 Report</button>
        </div>
      </div>

      <div style={{ padding: "12px 12px 0" }}>

        {/* ═══════════════ MASTER UPLOAD TAB ═══════════════ */}
        {mainTab === "upload" && (
          <>
            <div style={card}>
              <div style={sHead}>📋 File Format Required</div>
              <div style={{ fontSize: 13, color: "#4A5568", lineHeight: 1.6 }}>
                Upload an Excel (.xlsx) file with exactly these 3 columns in the header row:
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" as const }}>
                {["Name of BO", "Village Code", "Village Name"].map(c => (
                  <span key={c} style={{ fontSize: 12, fontWeight: 700, background: "#EBF8FF", color: "#1D4ED8", padding: "4px 10px", borderRadius: 8 }}>{c}</span>
                ))}
              </div>
              <div style={{ fontSize: 12, color: "#A0AEC0", marginTop: 10 }}>
                "Name of BO" must match an office name already in the system exactly (case-insensitive).
              </div>
            </div>

            <div style={card}>
              <div style={sHead}>📤 Select File</div>
              <label style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                border: "2px dashed #CBD5E0", borderRadius: 10, padding: "24px 12px",
                cursor: loadingOffices ? "not-allowed" : "pointer",
                background: "#F7FAFC", flexDirection: "column" as const, gap: 8
              }}>
                <div style={{ fontSize: 28 }}>📁</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#4A5568" }}>
                  {fileName || "Tap to choose an .xlsx file"}
                </div>
                <input type="file" accept=".xlsx,.xls" disabled={loadingOffices} onChange={handleFile} style={{ display: "none" }} />
              </label>
              {parsing && <div style={{ textAlign: "center" as const, padding: 16, color: "#A0AEC0", fontSize: 13 }}>Parsing file…</div>}
            </div>

            {!parsing && (matched.length > 0 || unmatched.length > 0) && (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
                  <div style={{ background: "#F0FFF4", border: "1px solid #9AE6B4", borderRadius: 10, padding: "10px 12px", textAlign: "center" as const }}>
                    <div style={{ fontSize: 9, color: "#15803D", fontWeight: 700, textTransform: "uppercase" as const }}>Matched</div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: "#15803D" }}>{matched.length}</div>
                  </div>
                  <div style={{ background: unmatched.length ? "#FEF2F2" : "#F7FAFC", border: `1px solid ${unmatched.length ? "#FECACA" : "#E2E8F0"}`, borderRadius: 10, padding: "10px 12px", textAlign: "center" as const }}>
                    <div style={{ fontSize: 9, color: unmatched.length ? "#DC2626" : "#A0AEC0", fontWeight: 700, textTransform: "uppercase" as const }}>Unmatched</div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: unmatched.length ? "#DC2626" : "#A0AEC0" }}>{unmatched.length}</div>
                  </div>
                </div>

                {unmatched.length > 0 && (
                  <div style={{ ...card, borderColor: "#FECACA" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#DC2626" }}>⚠️ {unmatched.length} not found</div>
                      <button onClick={downloadUnmatchedTemplate} style={{ padding: "6px 12px", background: "#DC2626", color: "#fff", border: "none", borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>📥 Download List</button>
                    </div>
                    <div style={{ maxHeight: 160, overflowY: "auto" as const }}>
                      {unmatched.slice(0, 20).map((r, i) => (
                        <div key={i} style={{ fontSize: 12, padding: "4px 0", borderBottom: "1px solid #FEE2E2", color: "#4A5568" }}>
                          "{r.officeName}" — {r.villageName} ({r.villageCode})
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {matched.length > 0 && !uploadDone && (
                  <div style={card}>
                    <div style={sHead}>✅ Ready to Upload ({matched.length} villages)</div>
                    <div style={{ maxHeight: 200, overflowY: "auto" as const, marginBottom: 12 }}>
                      {matched.slice(0, 15).map((r, i) => (
                        <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "6px 0", borderBottom: "1px solid #F7FAFC" }}>
                          <span style={{ color: "#1A202C", fontWeight: 600 }}>{r.villageName}</span>
                          <span style={{ color: "#A0AEC0" }}>{r.office.name} · {r.villageCode}</span>
                        </div>
                      ))}
                    </div>
                    {uploading ? (
                      <div>
                        <div style={{ height: 8, background: "#E2E8F0", borderRadius: 4, overflow: "hidden", marginBottom: 8 }}>
                          <div style={{ height: "100%", width: `${uploadProgress}%`, background: "#1565C0", transition: "width .3s" }} />
                        </div>
                        <div style={{ textAlign: "center" as const, fontSize: 12, color: "#718096" }}>Uploading… {uploadProgress}%</div>
                      </div>
                    ) : (
                      <button onClick={handleUpload} style={{ width: "100%", padding: 12, background: "#1565C0", color: "#fff", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
                        📤 Upload {matched.length} Villages
                      </button>
                    )}
                  </div>
                )}

                {uploadDone && (
                  <div style={{ background: "#F0FFF4", border: "1px solid #9AE6B4", borderRadius: 12, padding: "16px", textAlign: "center" as const, marginBottom: 12 }}>
                    <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#15803D", marginBottom: 4 }}>{matched.length} villages uploaded</div>
                    <button onClick={resetUploadForm} style={{ padding: "8px 16px", background: "#1565C0", color: "#fff", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                      Upload Another File
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {/* ═══════════════ REPORT TAB ═══════════════ */}
        {mainTab === "report" && (
          <>
            {!loadingReport && villages.length > 0 && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
                {[
                  { label: "Total", val: String(villages.length), color: "#1D4ED8" },
                  { label: "Submitted", val: String(submittedVillages.length), color: "#16A34A" },
                  { label: "Pending", val: String(pendingVillages.length), color: "#D97706" },
                  { label: "Complete", val: villages.length ? Math.round((submittedVillages.length / villages.length) * 100) + "%" : "—", color: "#7C3AED" },
                ].map(s => (
                  <div key={s.label} style={{ background: "#fff", borderRadius: 10, padding: "10px 12px", border: "1px solid #E2E8F0", textAlign: "center" as const }}>
                    <div style={{ fontSize: 9, color: "#718096", fontWeight: 700, textTransform: "uppercase" as const, marginBottom: 3 }}>{s.label}</div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: s.color }}>{s.val}</div>
                  </div>
                ))}
              </div>
            )}

            {!loadingReport && submittedVillages.length > 0 && (
              <div style={card}>
                <div style={sHead}>📶 Total SIM Procurement Required</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}>
                  {[{ label: "Vi", val: totalViProc }, { label: "Airtel", val: totalAirtelProc }, { label: "BSNL", val: totalBsnlProc }, { label: "Jio", val: totalJioProc }].map(p => (
                    <div key={p.label} style={{ background: p.val > 0 ? "#FEF2F2" : "#F7FAFC", border: `1px solid ${p.val > 0 ? "#FECACA" : "#E2E8F0"}`, borderRadius: 8, padding: "8px 6px", textAlign: "center" as const }}>
                      <div style={{ fontSize: 10, color: "#718096", fontWeight: 700 }}>{p.label}</div>
                      <div style={{ fontSize: 16, fontWeight: 800, color: p.val > 0 ? "#DC2626" : "#A0AEC0" }}>{p.val}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: "flex", marginBottom: 12, borderRadius: 10, overflow: "hidden", border: "1px solid #E2E8F0", background: "#fff", flexWrap: "wrap" as const }}>
              {[
                { id: "submitted" as ReportSubTab, label: `✅ Submitted (${submittedVillages.length})` },
                { id: "notsub-office" as ReportSubTab, label: `🏢 Office (${officeSummary.length})` },
                { id: "notsub-village" as ReportSubTab, label: `📍 Village (${pendingVillages.length})` },
              ].map(t => (
                <button key={t.id} onClick={() => setReportSubTab(t.id)} style={{
                  flex: "1 1 33%", padding: "10px 4px", border: "none", cursor: "pointer",
                  fontWeight: 700, fontSize: 11,
                  background: reportSubTab === t.id ? "#1565C0" : "#fff",
                  color: reportSubTab === t.id ? "#fff" : "#718096",
                }}>{t.label}</button>
              ))}
            </div>

            {loadingReport ? (
              <div style={{ textAlign: "center" as const, padding: 40, color: "#A0AEC0" }}>Loading…</div>
            ) : villages.length === 0 ? (
              <EmptyState icon="📭" title="No village data found" subtitle="Upload village master data first" />
            ) : (
              <>
                {reportSubTab === "submitted" && (
                  <>
                    <input type="text" placeholder="🔍 Search by village, code, or office" style={{ ...inputStyle, marginBottom: 10 }} value={searchSubmitted} onChange={e => setSearchSubmitted(e.target.value)} />
                    {displaySubmitted.length > 0 && (
                      <button onClick={exportSubmitted} style={exportBtn}>📥 Export Submitted ({displaySubmitted.length})</button>
                    )}
                    {displaySubmitted.length === 0 ? (
                      <EmptyState icon="✅" title="No submitted villages" subtitle="Nothing submitted yet" />
                    ) : displaySubmitted.map(v => (
                      <div key={v.id} style={{ background: "#fff", border: "1px solid #DCFCE7", borderRadius: 12, padding: "12px 14px", marginBottom: 8 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                          <div>
                            <div style={{ fontSize: 14, fontWeight: 700, color: "#1A202C" }}>{v.villageName}</div>
                            <div style={{ fontSize: 11, color: "#A0AEC0" }}>{v.officeName || v.officeId} · {v.villageCode}</div>
                          </div>
                          <span style={{ fontSize: 10, fontWeight: 700, background: "#DCFCE7", color: "#16A34A", padding: "3px 10px", borderRadius: 20, height: "fit-content" }}>✅ Submitted</span>
                        </div>
                        {[v.viSimProcurementRequired, v.airtelSimProcurementRequired, v.bsnlSimProcurementRequired, v.jioSimProcurementRequired].some(x => x === 1) && (
                          <div style={{ fontSize: 11, color: "#DC2626", fontWeight: 600 }}>
                            ⚠️ Procurement: {[v.viSimProcurementRequired === 1 && "Vi", v.airtelSimProcurementRequired === 1 && "Airtel", v.bsnlSimProcurementRequired === 1 && "BSNL", v.jioSimProcurementRequired === 1 && "Jio"].filter(Boolean).join(", ")}
                          </div>
                        )}
                      </div>
                    ))}
                  </>
                )}

                {reportSubTab === "notsub-office" && (
                  <>
                    <input type="text" placeholder="🔍 Search by office" style={{ ...inputStyle, marginBottom: 10 }} value={searchOffice} onChange={e => setSearchOffice(e.target.value)} />
                    {displayOfficeSummary.length > 0 && (
                      <button onClick={exportOfficeWise} style={{ ...exportBtn, background: "#DC2626" }}>📥 Export Office-wise ({displayOfficeSummary.length})</button>
                    )}
                    {displayOfficeSummary.length === 0 ? (
                      <EmptyState icon="🎉" title="All offices fully submitted!" subtitle="" />
                    ) : (
                      <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #FECACA", overflow: "hidden" }}>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto auto", padding: "10px 14px", background: "#FEE2E2", borderBottom: "1px solid #FECACA" }}>
                          {["Office", "Total", "Done", "Pending"].map(h => <div key={h} style={{ fontSize: 10, fontWeight: 700, color: "#B91C1C", textTransform: "uppercase" as const }}>{h}</div>)}
                        </div>
                        {displayOfficeSummary.map((o, i) => (
                          <div key={o.officeId} style={{ display: "grid", gridTemplateColumns: "1fr auto auto auto", padding: "10px 14px", alignItems: "center", borderBottom: i < displayOfficeSummary.length - 1 ? "1px solid #FEE2E2" : "none", background: i % 2 === 0 ? "#FFF5F5" : "#FEF2F2" }}>
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

                {reportSubTab === "notsub-village" && (
                  <>
                    <input type="text" placeholder="🔍 Search by village" style={{ ...inputStyle, marginBottom: 10 }} value={searchVillage} onChange={e => setSearchVillage(e.target.value)} />
                    {displayPendingVillages.length > 0 && (
                      <button onClick={exportVillageWise} style={{ ...exportBtn, background: "#DC2626" }}>📥 Export Village-wise ({displayPendingVillages.length})</button>
                    )}
                    {displayPendingVillages.length === 0 ? (
                      <EmptyState icon="🎉" title="All villages submitted!" subtitle="" />
                    ) : (
                      <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #FECACA", overflow: "hidden" }}>
                        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", padding: "10px 14px", background: "#FEE2E2", borderBottom: "1px solid #FECACA" }}>
                          {["#", "Village / Office", "Code"].map(h => <div key={h} style={{ fontSize: 10, fontWeight: 700, color: "#B91C1C", textTransform: "uppercase" as const }}>{h}</div>)}
                        </div>
                        {displayPendingVillages.map((v, i) => (
                          <div key={v.id} style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", padding: "10px 14px", alignItems: "center", borderBottom: i < displayPendingVillages.length - 1 ? "1px solid #FEE2E2" : "none", background: i % 2 === 0 ? "#FFF5F5" : "#FEF2F2" }}>
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
          </>
        )}
      </div>

      {toast && (
        <div style={{ position: "fixed", bottom: 80, left: "50%", transform: "translateX(-50%)", background: "#2D3748", color: "#fff", padding: "10px 20px", borderRadius: 24, fontSize: 13, fontWeight: 500, zIndex: 300, maxWidth: "90%", textAlign: "center" as const }}>
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
      {subtitle && <div style={{ fontSize: 13, marginTop: 4 }}>{subtitle}</div>}
    </div>
  );
}

const card: React.CSSProperties = { background: "#fff", border: "1px solid #E2E8F0", borderRadius: 12, padding: 16, marginBottom: 12 };
const sHead: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: "#718096", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 10 };
const inputStyle: React.CSSProperties = { width: "100%", padding: "9px 11px", fontSize: 14, border: "1.5px solid #E2E8F0", borderRadius: 8, color: "#1A202C", background: "#fff", boxSizing: "border-box", outline: "none" };
const hBtn: React.CSSProperties = { background: "rgba(255,255,255,0.2)", border: "1px solid rgba(255,255,255,0.4)", color: "#fff", borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer" };
const tabBtn: React.CSSProperties = { padding: "7px 14px", borderRadius: 20, border: "none", fontWeight: 600, fontSize: 12, cursor: "pointer" };
const exportBtn: React.CSSProperties = { display: "block", width: "100%", padding: "10px 14px", background: "#1565C0", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", textAlign: "center" as const, marginBottom: 12 };

