"use client";

import { useState, useEffect } from "react";
import { useAuth } from "../../context/AuthContext";
import { useRouter } from "next/navigation";
import { db } from "../firebase";
import {
  collection, doc, setDoc, getDocs,
  query, where, serverTimestamp, getDoc
} from "firebase/firestore";
import BottomNav from "../../components/BottomNav";

// ── Interfaces ───────────────────────────────────────────────────

interface VillageData {
  villageName: string;
  headmanName: string;
  headmanContact: string;
  panchayatName: string;
  panchayatSecy: string;
  panchayatContact: string;
  totalHouseholds: number;
  householdsWithPOSB: number;
  householdsWithPLI: number;
  schoolName: string;
  headmasterContact: string;
  totalGirlsBelow10: number;
  girlsWithSSY: number;
}

interface Institution {
  type: string;          // School / College / Govt Office / Bank / Hospital / Other
  name: string;
  contactPerson: string;
  contactNumber: string;
  address: string;
  // School/College fields
  totalStudents: number;
  totalGirlStudents: number;
  studentsWithPOSB: number;
  studentsWithRD: number;
  studentsWithSSY: number;
  // Staff/Employee fields
  totalStaff: number;
  staffWithPOSB: number;
  staffWithPLI: number;
  staffWithRPLI: number;
  // Bank fields
  bankBranch: string;
  ifscCode: string;
  // Govt Office fields
  deptName: string;
  officeHeadName: string;
  // General
  remarks: string;
}

interface OfficeRecord {
  officeId: string;
  officeName: string;
  contactNumber: string;
  totalVillages: number;
  villages: VillageData[];
  institutions: Institution[];
  submittedBy: string;
  submittedByName: string;
  circleCode?: string;
  divisionCode?: string;
  subDivCode?: string;
  updatedAt: any;
}

// ── Defaults ──────────────────────────────────────────────────────

const emptyVillage = (): VillageData => ({
  villageName: "", headmanName: "", headmanContact: "",
  panchayatName: "", panchayatSecy: "", panchayatContact: "",
  totalHouseholds: 0, householdsWithPOSB: 0, householdsWithPLI: 0,
  schoolName: "", headmasterContact: "",
  totalGirlsBelow10: 0, girlsWithSSY: 0,
});

const emptyInstitution = (): Institution => ({
  type: "School", name: "", contactPerson: "", contactNumber: "",
  address: "", totalStudents: 0, totalGirlStudents: 0,
  studentsWithPOSB: 0, studentsWithRD: 0, studentsWithSSY: 0,
  totalStaff: 0, staffWithPOSB: 0, staffWithPLI: 0, staffWithRPLI: 0,
  bankBranch: "", ifscCode: "", deptName: "", officeHeadName: "",
  remarks: "",
});

const INSTITUTION_TYPES = [
  "School", "College", "Govt Office", "Bank",
  "Hospital", "Post Office", "NGO", "Other"
];

const INST_ICONS: Record<string, string> = {
  "School":       "🏫",
  "College":      "🎓",
  "Govt Office":  "🏛️",
  "Bank":         "🏦",
  "Hospital":     "🏥",
  "Post Office":  "📮",
  "NGO":          "🤝",
  "Other":        "🏢",
};

const ENTRY_ROLES = ["office_user", "ho_admin", "so_admin"];

type MainTab = "villages" | "institutions" | "view";

// ── Main Component ───────────────────────────────────────────────

export default function VillageDataPage() {
  const { profile, user } = useAuth();
  const router = useRouter();

  const p        = profile as any;
  const myRole   = p?.role || "";
  const myOffice = p?.officeId || p?.officeCode || "";
  const myName   = p?.name || "";
  const canEnter = ENTRY_ROLES.includes(myRole);

  // Main tab
  const [mainTab, setMainTab] = useState<MainTab>(
    canEnter ? "villages" : "view"
  );

  // Office info
  const [contactNumber,  setContactNumber]  = useState("");
  const [totalVillages,  setTotalVillages]  = useState(0);
  const [officeName,     setOfficeName]     = useState("");

  // Villages
  const [villages,       setVillages]       = useState<VillageData[]>([]);
  const [activeVillage,  setActiveVillage]  = useState(0);

  // Institutions
  const [institutions,      setInstitutions]      = useState<Institution[]>([]);
  const [activeInstitution, setActiveInstitution] = useState(0);

  // View mode
  const [records,         setRecords]         = useState<OfficeRecord[]>([]);
  const [loadingRecords,  setLoadingRecords]  = useState(false);
  const [expandedRecord,  setExpandedRecord]  = useState<string|null>(null);
  const [expandedVillage, setExpandedVillage] = useState<number|null>(null);
  const [expandedInst,    setExpandedInst]    = useState<number|null>(null);
  const [viewSubTab,      setViewSubTab]      = useState<"villages"|"institutions">("villages");

  const [loading, setLoading] = useState(false);
  const [toast,   setToast]   = useState("");
  const [saved,   setSaved]   = useState(false);

  useEffect(() => {
    if (!user) { router.push("/"); return; }
    if (profile) {
      if (canEnter) loadExistingData();
      else { setMainTab("view"); fetchAllRecords(); }
    }
  }, [user, profile]);

  // ── Load existing ──────────────────────────────────────────────
  async function loadExistingData() {
    if (!myOffice) return;
    try {
      const snap = await getDoc(doc(db, "villageData", myOffice));
      if (snap.exists()) {
        const data = snap.data() as OfficeRecord;
        setContactNumber(data.contactNumber || "");
        setTotalVillages(data.totalVillages || 0);
        setVillages(data.villages?.length ? data.villages : []);
        setInstitutions(data.institutions?.length ? data.institutions : []);
        setOfficeName(data.officeName || p?.officeName || "");
        setSaved(true);
      } else {
        setOfficeName(p?.officeName || "");
      }
    } catch(e) { console.error(e); }
  }

  // ── Fetch all records for admins ───────────────────────────────
  async function fetchAllRecords() {
    setLoadingRecords(true);
    try {
      const col = collection(db, "villageData");
      let q;
      if      (myRole === "superadmin")        q = query(col);
      else if (myRole === "circle_admin")      q = query(col, where("circleCode",   "==", p?.circleCode));
      else if (myRole === "region_admin")      q = query(col, where("regionId",     "==", p?.regionId));
      else if (myRole === "division_admin")    q = query(col, where("divisionCode", "==", p?.divisionCode));
      else if (myRole === "subdivision_admin") q = query(col, where("subDivCode",   "==", p?.subDivCode));
      else                                     q = query(col, where("officeId",     "==", myOffice));
      const snap = await getDocs(q);
      setRecords(snap.docs.map(d => d.data() as OfficeRecord));
    } catch(e: any) { showToast("Error: " + e.message); }
    finally { setLoadingRecords(false); }
  }

  // ── Village helpers ────────────────────────────────────────────
  function addVillage() {
    const updated = [...villages, emptyVillage()];
    setVillages(updated);
    setActiveVillage(updated.length - 1);
  }

  function removeVillage(i: number) {
    if (villages.length === 1) return;
    const updated = villages.filter((_, idx) => idx !== i);
    setVillages(updated);
    setActiveVillage(Math.max(0, Math.min(activeVillage, updated.length - 1)));
  }

  function updateVillage(i: number, field: keyof VillageData, val: any) {
    setVillages(vs => vs.map((v, idx) =>
      idx === i ? { ...v, [field]: val } : v
    ));
  }

  // ── Institution helpers ────────────────────────────────────────
  function addInstitution() {
    const updated = [...institutions, emptyInstitution()];
    setInstitutions(updated);
    setActiveInstitution(updated.length - 1);
  }

  function removeInstitution(i: number) {
    if (institutions.length === 1) {
      setInstitutions([]);
      return;
    }
    const updated = institutions.filter((_, idx) => idx !== i);
    setInstitutions(updated);
    setActiveInstitution(Math.max(0, Math.min(activeInstitution, updated.length - 1)));
  }

  function updateInst(i: number, field: keyof Institution, val: any) {
    setInstitutions(ins => ins.map((inst, idx) =>
      idx === i ? { ...inst, [field]: val } : inst
    ));
  }

  // ── Save ──────────────────────────────────────────────────────
  async function handleSave() {
    if (!myOffice) { showToast("Office ID not found"); return; }
    setLoading(true);
    try {
      await setDoc(doc(db, "villageData", myOffice), {
        officeId:        myOffice,
        officeName:      officeName || p?.officeName || "",
        contactNumber,
        totalVillages,
        villages,
        institutions,
        submittedBy:     p?.uid || "",
        submittedByName: myName,
        circleCode:      p?.circleCode   || "",
        regionId:        p?.regionId     || "",
        divisionCode:    p?.divisionCode || "",
        subDivCode:      p?.subDivCode   || "",
        hoCode:          p?.hoCode       || "",
        soCode:          p?.soCode       || "",
        updatedAt:       serverTimestamp(),
      }, { merge: true });
      setSaved(true);
      showToast("✅ Data saved successfully!");
    } catch(e: any) { showToast("Error: " + e.message); }
    finally { setLoading(false); }
  }

  // ── Export ────────────────────────────────────────────────────
  async function exportToExcel(data?: OfficeRecord[]) {
    const XLSX = await import("xlsx");
    const source = data || records;
    const wb = XLSX.utils.book_new();

    // Sheet 1 — Village data
    const villageRows: any[] = [];
    source.forEach(rec => {
      (rec.villages || []).forEach((v, i) => {
        villageRows.push({
          OfficeName: rec.officeName, OfficeID: rec.officeId,
          VillageNo: i+1, VillageName: v.villageName,
          HeadmanName: v.headmanName, HeadmanContact: v.headmanContact,
          PanchayatName: v.panchayatName, PanchayatSecy: v.panchayatSecy,
          PanchayatContact: v.panchayatContact,
          TotalHouseholds: v.totalHouseholds,
          WithPOSB: v.householdsWithPOSB, NoPOSB: Math.max(0,v.totalHouseholds-v.householdsWithPOSB),
          WithPLI: v.householdsWithPLI,   NoPLI:  Math.max(0,v.totalHouseholds-v.householdsWithPLI),
          TotalGirls: v.totalGirlsBelow10, WithSSY: v.girlsWithSSY,
          NoSSY: Math.max(0,v.totalGirlsBelow10-v.girlsWithSSY),
        });
      });
    });
    const ws1 = XLSX.utils.json_to_sheet(villageRows);
    ws1["!cols"] = Array(20).fill({ wch: 18 });
    XLSX.utils.book_append_sheet(wb, ws1, "Villages");

    // Sheet 2 — Institutions
    const instRows: any[] = [];
    source.forEach(rec => {
      (rec.institutions || []).forEach((inst, i) => {
        instRows.push({
          OfficeName: rec.officeName, OfficeID: rec.officeId,
          InstNo: i+1, Type: inst.type, Name: inst.name,
          ContactPerson: inst.contactPerson, Contact: inst.contactNumber,
          Address: inst.address,
          TotalStudents: inst.totalStudents, GirlStudents: inst.totalGirlStudents,
          StudentsWithPOSB: inst.studentsWithPOSB, StudentsWithRD: inst.studentsWithRD,
          StudentsWithSSY: inst.studentsWithSSY,
          TotalStaff: inst.totalStaff, StaffWithPOSB: inst.staffWithPOSB,
          StaffWithPLI: inst.staffWithPLI, StaffWithRPLI: inst.staffWithRPLI,
          BankBranch: inst.bankBranch, IFSC: inst.ifscCode,
          DeptName: inst.deptName, OfficeHead: inst.officeHeadName,
          Remarks: inst.remarks,
        });
      });
    });
    const ws2 = XLSX.utils.json_to_sheet(instRows);
    ws2["!cols"] = Array(23).fill({ wch: 18 });
    XLSX.utils.book_append_sheet(wb, ws2, "Institutions");

    XLSX.writeFile(wb, `Village_Institution_Data_${new Date().toISOString().split("T")[0]}.xlsx`);
    showToast("✅ Exported!");
  }

  function showToast(msg: string) {
    setToast(msg); setTimeout(() => setToast(""), 3500);
  }

  const cv   = villages[activeVillage]       || emptyVillage();
  const ci   = institutions[activeInstitution] || emptyInstitution();
  const isSchoolOrCollege = ci.type === "School" || ci.type === "College";
  const isBank            = ci.type === "Bank";
  const isGovt            = ci.type === "Govt Office" || ci.type === "Post Office";

  // ── RENDER ────────────────────────────────────────────────────
  return (
    <div style={{ paddingBottom: 80, background: "#F0F4F8", minHeight: "100vh",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>

      {/* Header */}
      <div style={{ background: "linear-gradient(135deg, #0D47A1, #1E88E5)",
        padding: "16px 16px 20px", color: "#fff" }}>
        <div style={{ display: "flex", justifyContent: "space-between",
          alignItems: "flex-start" }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 2px" }}>
              Village & Institution Data
            </h1>
            <div style={{ fontSize: 13, opacity: .85 }}>
              {p?.officeName || myOffice}
            </div>
          </div>
          <button onClick={() => router.push("/dashboard")} style={hBtn}>
            ← Back
          </button>
        </div>

        {/* Main tabs */}
        <div style={{ display: "flex", gap: 6, marginTop: 12,
          flexWrap: "wrap" as const }}>
          {canEnter && (
            <>
              <button onClick={() => setMainTab("villages")} style={{
                ...tabBtn,
                background: mainTab==="villages"
                  ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.2)",
                color: mainTab==="villages" ? "#1565C0" : "#fff",
              }}>🏘️ Villages</button>

              <button onClick={() => setMainTab("institutions")} style={{
                ...tabBtn,
                background: mainTab==="institutions"
                  ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.2)",
                color: mainTab==="institutions" ? "#1565C0" : "#fff",
              }}>🏫 Institutions</button>
            </>
          )}
          <button onClick={() => { setMainTab("view"); fetchAllRecords(); }}
            style={{
              ...tabBtn,
              background: mainTab==="view"
                ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.2)",
              color: mainTab==="view" ? "#1565C0" : "#fff",
            }}>
            👁️ View All
          </button>
        </div>
      </div>

      <div style={{ padding: "12px 12px 0" }}>

        {/* ════════════════════════════════════════
            VILLAGES TAB
        ════════════════════════════════════════ */}
        {mainTab === "villages" && canEnter && (
          <>
            {/* Office Info */}
            <div style={card}>
              <div style={sHead}>📮 Office Information</div>
              <label style={lbl}>Office Name</label>
              <div style={{ background: "#F7FAFC", color: "#4A5568",
                padding: "10px 12px", borderRadius: 8,
                border: "1.5px solid #E2E8F0", fontSize: 14,
                marginBottom: 12 }}>
                {officeName || p?.officeName || myOffice}
              </div>
              <label style={lbl}>Contact Number of Office</label>
              <input style={{ ...inp, marginBottom: 12 }}
                type="tel" placeholder="e.g. 9876543210"
                value={contactNumber}
                onChange={e => setContactNumber(e.target.value)} />
              <label style={lbl}>Total Number of Revenue Villages</label>
              <input style={inp} type="number" placeholder="e.g. 15"
                value={totalVillages || ""}
                onChange={e => {
                  const n = parseInt(e.target.value) || 0;
                  setTotalVillages(n);
                  if (n > 0 && villages.length === 0) {
                    setVillages([emptyVillage()]);
                    setActiveVillage(0);
                  }
                }} />
            </div>

            {/* Start adding */}
            {totalVillages > 0 && villages.length === 0 && (
              <button onClick={() => {
                setVillages([emptyVillage()]); setActiveVillage(0);
              }} style={{
                width: "100%", padding: 14, background: "#EBF8FF",
                color: "#1565C0", border: "2px dashed #BEE3F8",
                borderRadius: 10, fontSize: 14, fontWeight: 600,
                cursor: "pointer", marginBottom: 12
              }}>
                + Start Adding Village Data
              </button>
            )}

            {totalVillages > 0 && villages.length > 0 && (
              <>
                {/* Progress */}
                <div style={{ fontSize: 12, fontWeight: 700, color: "#718096",
                  textTransform: "uppercase", letterSpacing: .5,
                  marginBottom: 8 }}>
                  Villages — {villages.length} of {totalVillages} entered
                </div>

                {/* Village selector */}
                <div style={{ display: "flex", gap: 6, overflowX: "auto",
                  paddingBottom: 8, marginBottom: 10 }}>
                  {villages.map((v, i) => (
                    <button key={i} onClick={() => setActiveVillage(i)} style={{
                      padding: "6px 14px", borderRadius: 20,
                      border: "1px solid", flexShrink: 0,
                      fontSize: 12, fontWeight: 600, cursor: "pointer",
                      background: activeVillage===i ? "#1565C0" : "#fff",
                      color:      activeVillage===i ? "#fff"    : "#718096",
                      borderColor:activeVillage===i ? "#1565C0" : "#E2E8F0",
                    }}>
                      {v.villageName || `Village ${i+1}`}
                    </button>
                  ))}
                  {villages.length < totalVillages && (
                    <button onClick={addVillage} style={{
                      padding: "6px 14px", borderRadius: 20,
                      border: "1px dashed #1565C0", flexShrink: 0,
                      fontSize: 12, fontWeight: 600, cursor: "pointer",
                      background: "#EBF8FF", color: "#1565C0",
                    }}>+ Add Village</button>
                  )}
                </div>

                {/* Village form */}
                <div style={card}>
                  <div style={{ display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center", marginBottom: 14 }}>
                    <div style={sHead}>🏘️ Village {activeVillage+1}</div>
                    {villages.length > 1 && (
                      <button onClick={() => removeVillage(activeVillage)}
                        style={delBtn}>🗑️ Remove</button>
                    )}
                  </div>

                  <label style={lbl}>Name of Village</label>
                  <input style={{ ...inp, marginBottom: 16 }}
                    placeholder="e.g. Pub Nalbari"
                    value={cv.villageName}
                    onChange={e => updateVillage(activeVillage,
                      "villageName", e.target.value)} />

                  {/* Headman */}
                  <div style={secBox("#EBF8FF","#1D4ED8")}>
                    <div style={secTit("#1D4ED8")}>👤 Village Headman / Gaonbura</div>
                    <label style={lbl}>Name</label>
                    <input style={{ ...inp, marginBottom: 10 }}
                      placeholder="Full name" value={cv.headmanName}
                      onChange={e => updateVillage(activeVillage,
                        "headmanName", e.target.value)} />
                    <label style={lbl}>Contact Number</label>
                    <input style={inp} type="tel" placeholder="e.g. 9876543210"
                      value={cv.headmanContact}
                      onChange={e => updateVillage(activeVillage,
                        "headmanContact", e.target.value)} />
                  </div>

                  {/* Panchayat */}
                  <div style={secBox("#F0FFF4","#15803D")}>
                    <div style={secTit("#15803D")}>🏛️ Panchayat Details</div>
                    <label style={lbl}>Name of Panchayat</label>
                    <input style={{ ...inp, marginBottom: 10 }}
                      placeholder="e.g. Nalbari Gaon Panchayat"
                      value={cv.panchayatName}
                      onChange={e => updateVillage(activeVillage,
                        "panchayatName", e.target.value)} />
                    <label style={lbl}>Name of Secretary / President</label>
                    <input style={{ ...inp, marginBottom: 10 }}
                      placeholder="Full name" value={cv.panchayatSecy}
                      onChange={e => updateVillage(activeVillage,
                        "panchayatSecy", e.target.value)} />
                    <label style={lbl}>Contact Number</label>
                    <input style={inp} type="tel" placeholder="e.g. 9876543210"
                      value={cv.panchayatContact}
                      onChange={e => updateVillage(activeVillage,
                        "panchayatContact", e.target.value)} />
                  </div>

                  {/* Households */}
                  <div style={secBox("#FFF5F5","#DC2626")}>
                    <div style={secTit("#DC2626")}>🏠 Household Data</div>
                    <label style={lbl}>Total Number of Households</label>
                    <input style={{ ...inp, marginBottom: 10 }}
                      type="number" placeholder="e.g. 250"
                      value={cv.totalHouseholds || ""}
                      onChange={e => updateVillage(activeVillage,
                        "totalHouseholds", parseInt(e.target.value)||0)} />
                    <label style={lbl}>Households WITH POSB Account</label>
                    <input style={{ ...inp, marginBottom: 10 }}
                      type="number" placeholder={`Max: ${cv.totalHouseholds}`}
                      value={cv.householdsWithPOSB || ""}
                      onChange={e => updateVillage(activeVillage,
                        "householdsWithPOSB",
                        Math.min(parseInt(e.target.value)||0, cv.totalHouseholds))} />
                    <label style={lbl}>Households WITH PLI / RPLI Policy</label>
                    <input style={{ ...inp, marginBottom: 14 }}
                      type="number" placeholder={`Max: ${cv.totalHouseholds}`}
                      value={cv.householdsWithPLI || ""}
                      onChange={e => updateVillage(activeVillage,
                        "householdsWithPLI",
                        Math.min(parseInt(e.target.value)||0, cv.totalHouseholds))} />
                    {cv.totalHouseholds > 0 && (
                      <div style={{ background: "#FEF2F2",
                        border: "1px solid #FECACA",
                        borderRadius: 10, padding: 12 }}>
                        <div style={{ fontSize: 11, fontWeight: 700,
                          color: "#DC2626", marginBottom: 10,
                          textTransform: "uppercase" }}>
                          📊 Balance Households
                        </div>
                        <div style={{ display: "grid",
                          gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                          {[
                            { label: "Total HH", val: cv.totalHouseholds, color: "#1D4ED8" },
                            { label: "No POSB",  val: Math.max(0,cv.totalHouseholds-cv.householdsWithPOSB), color: "#DC2626" },
                            { label: "No PLI",   val: Math.max(0,cv.totalHouseholds-cv.householdsWithPLI),  color: "#D97706" },
                          ].map(m => (
                            <StatBox key={m.label} label={m.label}
                              val={m.val} color={m.color} />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* School */}
                  <div style={secBox("#FAF5FF","#7C3AED")}>
                    <div style={secTit("#7C3AED")}>🏫 School Details</div>
                    <label style={lbl}>Name of School</label>
                    <input style={{ ...inp, marginBottom: 10 }}
                      placeholder="e.g. Nalbari Primary School"
                      value={cv.schoolName}
                      onChange={e => updateVillage(activeVillage,
                        "schoolName", e.target.value)} />
                    <label style={lbl}>Contact Number of Headmaster</label>
                    <input style={{ ...inp, marginBottom: 10 }}
                      type="tel" placeholder="e.g. 9876543210"
                      value={cv.headmasterContact}
                      onChange={e => updateVillage(activeVillage,
                        "headmasterContact", e.target.value)} />
                    <label style={lbl}>Total Girl Children (Below 10 Years)</label>
                    <input style={{ ...inp, marginBottom: 10 }}
                      type="number" placeholder="e.g. 45"
                      value={cv.totalGirlsBelow10 || ""}
                      onChange={e => updateVillage(activeVillage,
                        "totalGirlsBelow10", parseInt(e.target.value)||0)} />
                    <label style={lbl}>Girl Children WITH SSY Account</label>
                    <input style={{ ...inp, marginBottom: 14 }}
                      type="number" placeholder={`Max: ${cv.totalGirlsBelow10}`}
                      value={cv.girlsWithSSY || ""}
                      onChange={e => updateVillage(activeVillage,
                        "girlsWithSSY",
                        Math.min(parseInt(e.target.value)||0, cv.totalGirlsBelow10))} />
                    {cv.totalGirlsBelow10 > 0 && (
                      <div style={{ background: "#F3E8FF",
                        border: "1px solid #D8B4FE",
                        borderRadius: 10, padding: 12 }}>
                        <div style={{ fontSize: 11, fontWeight: 700,
                          color: "#7C3AED", marginBottom: 10,
                          textTransform: "uppercase" }}>
                          📊 SSY Status
                        </div>
                        <div style={{ display: "grid",
                          gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                          {[
                            { label: "Total Girls", val: cv.totalGirlsBelow10, color: "#7C3AED" },
                            { label: "With SSY",    val: cv.girlsWithSSY,      color: "#15803D" },
                            { label: "Without SSY", val: Math.max(0,cv.totalGirlsBelow10-cv.girlsWithSSY), color: "#DC2626" },
                          ].map(m => (
                            <StatBox key={m.label} label={m.label}
                              val={m.val} color={m.color} />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Prev/Next */}
                <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                  {activeVillage > 0 && (
                    <button onClick={() => setActiveVillage(v=>v-1)}
                      style={{ flex:1, padding:10, background:"#E2E8F0",
                        color:"#4A5568", border:"none", borderRadius:8,
                        fontSize:13, fontWeight:600, cursor:"pointer" }}>
                      ← Previous
                    </button>
                  )}
                  {activeVillage < villages.length-1 && (
                    <button onClick={() => setActiveVillage(v=>v+1)}
                      style={{ flex:1, padding:10, background:"#1565C0",
                        color:"#fff", border:"none", borderRadius:8,
                        fontSize:13, fontWeight:600, cursor:"pointer" }}>
                      Next →
                    </button>
                  )}
                </div>
              </>
            )}

            {/* Save */}
            <button onClick={handleSave} disabled={loading} style={{
              width:"100%", padding:14,
              background: loading ? "#90CDF4" : "#1565C0",
              color:"#fff", border:"none", borderRadius:10,
              fontSize:15, fontWeight:700,
              cursor: loading ? "not-allowed" : "pointer",
              marginBottom:12
            }}>
              {loading ? "Saving…" : saved ? "✅ Update Data" : "💾 Save Village Data"}
            </button>
          </>
        )}

        {/* ════════════════════════════════════════
            INSTITUTIONS TAB
        ════════════════════════════════════════ */}
        {mainTab === "institutions" && canEnter && (
          <>
            {/* Add institution button */}
            {institutions.length === 0 ? (
              <button onClick={addInstitution} style={{
                width:"100%", padding:14, background:"#EBF8FF",
                color:"#1565C0", border:"2px dashed #BEE3F8",
                borderRadius:10, fontSize:14, fontWeight:600,
                cursor:"pointer", marginBottom:12
              }}>
                + Add First Institution
              </button>
            ) : (
              <>
                {/* Institution selector */}
                <div style={{ display:"flex", gap:6, overflowX:"auto",
                  paddingBottom:8, marginBottom:10 }}>
                  {institutions.map((inst, i) => (
                    <button key={i} onClick={() => setActiveInstitution(i)}
                      style={{
                        padding:"6px 14px", borderRadius:20,
                        border:"1px solid", flexShrink:0,
                        fontSize:12, fontWeight:600, cursor:"pointer",
                        background: activeInstitution===i ? "#1565C0" : "#fff",
                        color:      activeInstitution===i ? "#fff"    : "#718096",
                        borderColor:activeInstitution===i ? "#1565C0" : "#E2E8F0",
                      }}>
                      {INST_ICONS[inst.type]||"🏢"} {inst.name || `${inst.type} ${i+1}`}
                    </button>
                  ))}
                  <button onClick={addInstitution} style={{
                    padding:"6px 14px", borderRadius:20,
                    border:"1px dashed #1565C0", flexShrink:0,
                    fontSize:12, fontWeight:600, cursor:"pointer",
                    background:"#EBF8FF", color:"#1565C0",
                  }}>+ Add</button>
                </div>

                {/* Institution form */}
                <div style={card}>
                  <div style={{ display:"flex", justifyContent:"space-between",
                    alignItems:"center", marginBottom:14 }}>
                    <div style={sHead}>
                      {INST_ICONS[ci.type]||"🏢"} Institution {activeInstitution+1}
                    </div>
                    <button onClick={() => removeInstitution(activeInstitution)}
                      style={delBtn}>🗑️ Remove</button>
                  </div>

                  {/* Type selector */}
                  <label style={lbl}>Type of Institution</label>
                  <div style={{ display:"flex", flexWrap:"wrap" as const,
                    gap:6, marginBottom:14 }}>
                    {INSTITUTION_TYPES.map(t => (
                      <button key={t} onClick={() => updateInst(activeInstitution, "type", t)}
                        style={{
                          padding:"6px 12px", borderRadius:20,
                          border:"1px solid", fontSize:12,
                          fontWeight:600, cursor:"pointer",
                          background: ci.type===t ? "#1565C0" : "#fff",
                          color:      ci.type===t ? "#fff"    : "#718096",
                          borderColor:ci.type===t ? "#1565C0" : "#E2E8F0",
                        }}>
                        {INST_ICONS[t]} {t}
                      </button>
                    ))}
                  </div>

                  {/* Basic Info */}
                  <div style={secBox("#F7FAFC","#4A5568")}>
                    <div style={secTit("#4A5568")}>📋 Basic Information</div>
                    <label style={lbl}>Name of {ci.type}</label>
                    <input style={{ ...inp, marginBottom:10 }}
                      placeholder={`e.g. Nalbari ${ci.type}`}
                      value={ci.name}
                      onChange={e => updateInst(activeInstitution, "name", e.target.value)} />
                    <label style={lbl}>Name of Contact Person / Head</label>
                    <input style={{ ...inp, marginBottom:10 }}
                      placeholder="Full name"
                      value={ci.contactPerson}
                      onChange={e => updateInst(activeInstitution, "contactPerson", e.target.value)} />
                    <label style={lbl}>Contact Number</label>
                    <input style={{ ...inp, marginBottom:10 }}
                      type="tel" placeholder="e.g. 9876543210"
                      value={ci.contactNumber}
                      onChange={e => updateInst(activeInstitution, "contactNumber", e.target.value)} />
                    <label style={lbl}>Address</label>
                    <input style={inp}
                      placeholder="Village / Ward / Area"
                      value={ci.address}
                      onChange={e => updateInst(activeInstitution, "address", e.target.value)} />
                  </div>

                  {/* School / College specific */}
                  {isSchoolOrCollege && (
                    <>
                      <div style={secBox("#EBF8FF","#1D4ED8")}>
                        <div style={secTit("#1D4ED8")}>👨‍🎓 Student Data</div>
                        <label style={lbl}>Total Number of Students</label>
                        <input style={{ ...inp, marginBottom:10 }}
                          type="number" placeholder="e.g. 500"
                          value={ci.totalStudents || ""}
                          onChange={e => updateInst(activeInstitution,
                            "totalStudents", parseInt(e.target.value)||0)} />
                        <label style={lbl}>Total Girl Students</label>
                        <input style={{ ...inp, marginBottom:10 }}
                          type="number" placeholder="e.g. 240"
                          value={ci.totalGirlStudents || ""}
                          onChange={e => updateInst(activeInstitution,
                            "totalGirlStudents", parseInt(e.target.value)||0)} />
                        <label style={lbl}>Students WITH POSB Account</label>
                        <input style={{ ...inp, marginBottom:10 }}
                          type="number" placeholder={`Max: ${ci.totalStudents}`}
                          value={ci.studentsWithPOSB || ""}
                          onChange={e => updateInst(activeInstitution,
                            "studentsWithPOSB",
                            Math.min(parseInt(e.target.value)||0, ci.totalStudents))} />
                        <label style={lbl}>Students WITH RD Account</label>
                        <input style={{ ...inp, marginBottom:10 }}
                          type="number" placeholder={`Max: ${ci.totalStudents}`}
                          value={ci.studentsWithRD || ""}
                          onChange={e => updateInst(activeInstitution,
                            "studentsWithRD",
                            Math.min(parseInt(e.target.value)||0, ci.totalStudents))} />
                        <label style={lbl}>Girl Students WITH SSY Account</label>
                        <input style={{ ...inp, marginBottom:14 }}
                          type="number" placeholder={`Max: ${ci.totalGirlStudents}`}
                          value={ci.studentsWithSSY || ""}
                          onChange={e => updateInst(activeInstitution,
                            "studentsWithSSY",
                            Math.min(parseInt(e.target.value)||0, ci.totalGirlStudents))} />

                        {ci.totalStudents > 0 && (
                          <div style={{ background:"#DBEAFE", borderRadius:10,
                            padding:12 }}>
                            <div style={{ fontSize:11, fontWeight:700,
                              color:"#1D4ED8", marginBottom:10,
                              textTransform:"uppercase" }}>
                              📊 Student Balance
                            </div>
                            <div style={{ display:"grid",
                              gridTemplateColumns:"1fr 1fr 1fr", gap:8 }}>
                              {[
                                { label:"Total", val:ci.totalStudents, color:"#1D4ED8" },
                                { label:"No POSB",
                                  val:Math.max(0,ci.totalStudents-ci.studentsWithPOSB),
                                  color:"#DC2626" },
                                { label:"No SSY",
                                  val:Math.max(0,ci.totalGirlStudents-ci.studentsWithSSY),
                                  color:"#D97706" },
                              ].map(m => (
                                <StatBox key={m.label} label={m.label}
                                  val={m.val} color={m.color} />
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Staff */}
                      <div style={secBox("#F0FFF4","#15803D")}>
                        <div style={secTit("#15803D")}>👨‍🏫 Staff / Employee Data</div>
                        <label style={lbl}>Total Staff</label>
                        <input style={{ ...inp, marginBottom:10 }}
                          type="number" placeholder="e.g. 25"
                          value={ci.totalStaff || ""}
                          onChange={e => updateInst(activeInstitution,
                            "totalStaff", parseInt(e.target.value)||0)} />
                        <label style={lbl}>Staff WITH POSB Account</label>
                        <input style={{ ...inp, marginBottom:10 }}
                          type="number" placeholder={`Max: ${ci.totalStaff}`}
                          value={ci.staffWithPOSB || ""}
                          onChange={e => updateInst(activeInstitution,
                            "staffWithPOSB",
                            Math.min(parseInt(e.target.value)||0, ci.totalStaff))} />
                        <label style={lbl}>Staff WITH PLI Policy</label>
                        <input style={{ ...inp, marginBottom:10 }}
                          type="number" placeholder={`Max: ${ci.totalStaff}`}
                          value={ci.staffWithPLI || ""}
                          onChange={e => updateInst(activeInstitution,
                            "staffWithPLI",
                            Math.min(parseInt(e.target.value)||0, ci.totalStaff))} />
                        <label style={lbl}>Staff WITH RPLI Policy</label>
                        <input style={inp}
                          type="number" placeholder={`Max: ${ci.totalStaff}`}
                          value={ci.staffWithRPLI || ""}
                          onChange={e => updateInst(activeInstitution,
                            "staffWithRPLI",
                            Math.min(parseInt(e.target.value)||0, ci.totalStaff))} />
                      </div>
                    </>
                  )}

                  {/* Govt Office specific */}
                  {isGovt && (
                    <>
                      <div style={secBox("#FFFBEB","#92400E")}>
                        <div style={secTit("#92400E")}>🏛️ Office Details</div>
                        <label style={lbl}>Department Name</label>
                        <input style={{ ...inp, marginBottom:10 }}
                          placeholder="e.g. Block Development Office"
                          value={ci.deptName}
                          onChange={e => updateInst(activeInstitution,
                            "deptName", e.target.value)} />
                        <label style={lbl}>Name of Office Head / BDO / SDO</label>
                        <input style={{ ...inp, marginBottom:14 }}
                          placeholder="Full name"
                          value={ci.officeHeadName}
                          onChange={e => updateInst(activeInstitution,
                            "officeHeadName", e.target.value)} />
                      </div>
                      <div style={secBox("#F0FFF4","#15803D")}>
                        <div style={secTit("#15803D")}>👨‍💼 Staff / Employee Data</div>
                        <label style={lbl}>Total Staff / Employees</label>
                        <input style={{ ...inp, marginBottom:10 }}
                          type="number" placeholder="e.g. 30"
                          value={ci.totalStaff || ""}
                          onChange={e => updateInst(activeInstitution,
                            "totalStaff", parseInt(e.target.value)||0)} />
                        <label style={lbl}>Staff WITH POSB Account</label>
                        <input style={{ ...inp, marginBottom:10 }}
                          type="number" value={ci.staffWithPOSB || ""}
                          onChange={e => updateInst(activeInstitution,
                            "staffWithPOSB",
                            Math.min(parseInt(e.target.value)||0, ci.totalStaff))} />
                        <label style={lbl}>Staff WITH PLI Policy</label>
                        <input style={{ ...inp, marginBottom:10 }}
                          type="number" value={ci.staffWithPLI || ""}
                          onChange={e => updateInst(activeInstitution,
                            "staffWithPLI",
                            Math.min(parseInt(e.target.value)||0, ci.totalStaff))} />
                        <label style={lbl}>Staff WITH RPLI Policy</label>
                        <input style={inp}
                          type="number" value={ci.staffWithRPLI || ""}
                          onChange={e => updateInst(activeInstitution,
                            "staffWithRPLI",
                            Math.min(parseInt(e.target.value)||0, ci.totalStaff))} />
                      </div>
                    </>
                  )}

                  {/* Bank specific */}
                  {isBank && (
                    <div style={secBox("#EBF8FF","#1D4ED8")}>
                      <div style={secTit("#1D4ED8")}>🏦 Bank Details</div>
                      <label style={lbl}>Branch Name</label>
                      <input style={{ ...inp, marginBottom:10 }}
                        placeholder="e.g. SBI Nalbari Branch"
                        value={ci.bankBranch}
                        onChange={e => updateInst(activeInstitution,
                          "bankBranch", e.target.value)} />
                      <label style={lbl}>IFSC Code</label>
                      <input style={{ ...inp, marginBottom:10 }}
                        placeholder="e.g. SBIN0001234"
                        value={ci.ifscCode}
                        onChange={e => updateInst(activeInstitution,
                          "ifscCode", e.target.value.toUpperCase())} />
                      <label style={lbl}>Total Staff</label>
                      <input style={{ ...inp, marginBottom:10 }}
                        type="number" placeholder="e.g. 15"
                        value={ci.totalStaff || ""}
                        onChange={e => updateInst(activeInstitution,
                          "totalStaff", parseInt(e.target.value)||0)} />
                      <label style={lbl}>Staff WITH POSB Account</label>
                      <input style={inp}
                        type="number" value={ci.staffWithPOSB || ""}
                        onChange={e => updateInst(activeInstitution,
                          "staffWithPOSB",
                          Math.min(parseInt(e.target.value)||0, ci.totalStaff))} />
                    </div>
                  )}

                  {/* Hospital and other — staff only */}
                  {!isSchoolOrCollege && !isGovt && !isBank && (
                    <div style={secBox("#F0FFF4","#15803D")}>
                      <div style={secTit("#15803D")}>👥 Staff / Employee Data</div>
                      <label style={lbl}>Total Staff</label>
                      <input style={{ ...inp, marginBottom:10 }}
                        type="number" placeholder="e.g. 20"
                        value={ci.totalStaff || ""}
                        onChange={e => updateInst(activeInstitution,
                          "totalStaff", parseInt(e.target.value)||0)} />
                      <label style={lbl}>Staff WITH POSB Account</label>
                      <input style={{ ...inp, marginBottom:10 }}
                        type="number" value={ci.staffWithPOSB || ""}
                        onChange={e => updateInst(activeInstitution,
                          "staffWithPOSB",
                          Math.min(parseInt(e.target.value)||0, ci.totalStaff))} />
                      <label style={lbl}>Staff WITH PLI Policy</label>
                      <input style={{ ...inp, marginBottom:10 }}
                        type="number" value={ci.staffWithPLI || ""}
                        onChange={e => updateInst(activeInstitution,
                          "staffWithPLI",
                          Math.min(parseInt(e.target.value)||0, ci.totalStaff))} />
                      <label style={lbl}>Staff WITH RPLI Policy</label>
                      <input style={inp}
                        type="number" value={ci.staffWithRPLI || ""}
                        onChange={e => updateInst(activeInstitution,
                          "staffWithRPLI",
                          Math.min(parseInt(e.target.value)||0, ci.totalStaff))} />
                    </div>
                  )}

                  {/* Remarks */}
                  <label style={lbl}>Remarks / Notes</label>
                  <textarea
                    style={{ ...inp, height:72, resize:"none" as const,
                      fontFamily:"inherit" }}
                    placeholder="Any additional information…"
                    value={ci.remarks}
                    onChange={e => updateInst(activeInstitution,
                      "remarks", e.target.value)}
                  />
                </div>

                {/* Prev/Next */}
                <div style={{ display:"flex", gap:8, marginBottom:12 }}>
                  {activeInstitution > 0 && (
                    <button onClick={() => setActiveInstitution(v=>v-1)}
                      style={{ flex:1, padding:10, background:"#E2E8F0",
                        color:"#4A5568", border:"none", borderRadius:8,
                        fontSize:13, fontWeight:600, cursor:"pointer" }}>
                      ← Previous
                    </button>
                  )}
                  {activeInstitution < institutions.length-1 && (
                    <button onClick={() => setActiveInstitution(v=>v+1)}
                      style={{ flex:1, padding:10, background:"#1565C0",
                        color:"#fff", border:"none", borderRadius:8,
                        fontSize:13, fontWeight:600, cursor:"pointer" }}>
                      Next →
                    </button>
                  )}
                </div>
              </>
            )}

            {/* Save */}
            <button onClick={handleSave} disabled={loading} style={{
              width:"100%", padding:14,
              background: loading ? "#90CDF4" : "#1565C0",
              color:"#fff", border:"none", borderRadius:10,
              fontSize:15, fontWeight:700,
              cursor: loading ? "not-allowed" : "pointer",
              marginBottom:12
            }}>
              {loading ? "Saving…" : saved ? "✅ Update Data" : "💾 Save Institution Data"}
            </button>
          </>
        )}

        {/* ════════════════════════════════════════
            VIEW ALL TAB
        ════════════════════════════════════════ */}
        {mainTab === "view" && (
          <>
            {/* Sub tabs */}
            <div style={{ display:"flex", marginBottom:12, borderRadius:10,
              overflow:"hidden", border:"1px solid #E2E8F0", background:"#fff" }}>
              <button onClick={() => setViewSubTab("villages")} style={{
                flex:1, padding:"10px", border:"none", cursor:"pointer",
                fontWeight:700, fontSize:12,
                background: viewSubTab==="villages" ? "#1565C0" : "#fff",
                color:      viewSubTab==="villages" ? "#fff"    : "#718096",
              }}>🏘️ Villages</button>
              <button onClick={() => setViewSubTab("institutions")} style={{
                flex:1, padding:"10px", border:"none", cursor:"pointer",
                fontWeight:700, fontSize:12,
                background: viewSubTab==="institutions" ? "#1565C0" : "#fff",
                color:      viewSubTab==="institutions" ? "#fff"    : "#718096",
              }}>🏫 Institutions</button>
            </div>

            <div style={{ display:"flex", justifyContent:"space-between",
              alignItems:"center", marginBottom:12 }}>
              <div style={{ fontSize:13, fontWeight:700, color:"#1A202C" }}>
                {records.length} offices submitted
              </div>
              {records.length > 0 && (
                <button onClick={() => exportToExcel()}
                  style={{ padding:"8px 14px", background:"#1565C0",
                    color:"#fff", border:"none", borderRadius:8,
                    fontSize:12, fontWeight:600, cursor:"pointer" }}>
                  📥 Export All (Excel)
                </button>
              )}
            </div>

            {loadingRecords ? (
              <div style={{ textAlign:"center" as const, padding:40,
                color:"#A0AEC0" }}>Loading…</div>
            ) : records.length === 0 ? (
              <div style={{ textAlign:"center" as const, padding:40,
                color:"#A0AEC0" }}>
                <div style={{ fontSize:40, marginBottom:10 }}>🏘️</div>
                <div style={{ fontSize:15, fontWeight:600 }}>
                  No data submitted yet
                </div>
              </div>
            ) : (
              records.map(rec => (
                <div key={rec.officeId} style={{ background:"#fff",
                  borderRadius:12, border:"1px solid #E2E8F0",
                  marginBottom:10, overflow:"hidden" }}>

                  {/* Office header */}
                  <div style={{ padding:"12px 14px", cursor:"pointer",
                    background: expandedRecord===rec.officeId
                      ? "#EBF8FF" : "#fff" }}
                    onClick={() => setExpandedRecord(
                      expandedRecord===rec.officeId ? null : rec.officeId
                    )}>
                    <div style={{ display:"flex", justifyContent:"space-between",
                      alignItems:"flex-start" }}>
                      <div>
                        <div style={{ fontSize:14, fontWeight:700, color:"#1A202C" }}>
                          {rec.officeName}
                        </div>
                        <div style={{ fontSize:11, color:"#A0AEC0" }}>
                          {rec.officeId}
                          {rec.contactNumber ? ` · 📞 ${rec.contactNumber}` : ""}
                        </div>
                      </div>
                      <div style={{ display:"flex", gap:8 }}>
                        <div style={{ textAlign:"center" as const }}>
                          <div style={{ fontSize:18, fontWeight:800, color:"#1D4ED8" }}>
                            {rec.villages?.length||0}
                          </div>
                          <div style={{ fontSize:9, color:"#718096" }}>VILLAGES</div>
                        </div>
                        <div style={{ textAlign:"center" as const }}>
                          <div style={{ fontSize:18, fontWeight:800, color:"#7C3AED" }}>
                            {rec.institutions?.length||0}
                          </div>
                          <div style={{ fontSize:9, color:"#718096" }}>INST.</div>
                        </div>
                        <div style={{ fontSize:11, color:"#A0AEC0",
                          alignSelf:"center" }}>
                          {expandedRecord===rec.officeId ? "▲" : "▼"}
                        </div>
                      </div>
                    </div>

                    {/* Summary */}
                    {(rec.villages?.length||0)>0 && (
                      <div style={{ display:"grid",
                        gridTemplateColumns:"1fr 1fr 1fr 1fr",
                        gap:6, marginTop:10 }}>
                        {[
                          { label:"Households",
                            val:rec.villages.reduce((a,v)=>a+(v.totalHouseholds||0),0),
                            color:"#1D4ED8" },
                          { label:"POSB HH",
                            val:rec.villages.reduce((a,v)=>a+(v.householdsWithPOSB||0),0),
                            color:"#15803D" },
                          { label:"PLI/RPLI HH",
                            val:rec.villages.reduce((a,v)=>a+(v.householdsWithPLI||0),0),
                            color:"#0F766E" },
                          { label:"SSY Girls",
                            val:rec.villages.reduce((a,v)=>a+(v.girlsWithSSY||0),0),
                            color:"#7C3AED" },
                        ].map(s => (
                          <div key={s.label} style={{ background:"#F7FAFC",
                            borderRadius:6, padding:"5px 6px",
                            textAlign:"center" as const }}>
                            <div style={{ fontSize:9, color:"#718096",
                              fontWeight:700 }}>{s.label}</div>
                            <div style={{ fontSize:14, fontWeight:800,
                              color:s.color }}>{s.val}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Expanded content */}
                  {expandedRecord === rec.officeId && (
                    <div style={{ borderTop:"1px solid #E2E8F0",
                      background:"#F7FAFC" }}>

                      {/* Villages sub-view */}
                      {viewSubTab === "villages" && (
                        (rec.villages||[]).map((v, vi) => (
                          <div key={vi} style={{ borderBottom:"1px solid #E2E8F0" }}>
                            <div style={{ padding:"10px 14px", cursor:"pointer",
                              display:"flex", justifyContent:"space-between",
                              alignItems:"center" }}
                              onClick={() => setExpandedVillage(
                                expandedVillage===vi ? null : vi
                              )}>
                              <div>
                                <div style={{ fontSize:13, fontWeight:600,
                                  color:"#1A202C" }}>
                                  🏘️ {v.villageName || `Village ${vi+1}`}
                                </div>
                                <div style={{ fontSize:11, color:"#718096" }}>
                                  {v.panchayatName}
                                  {v.totalHouseholds
                                    ? ` · ${v.totalHouseholds} HH` : ""}
                                </div>
                              </div>
                              <div style={{ fontSize:11, color:"#A0AEC0" }}>
                                {expandedVillage===vi ? "▲" : "▼"}
                              </div>
                            </div>
                            {expandedVillage === vi && (
                              <div style={{ padding:"0 14px 14px" }}>
                                <div style={miniSec}>
                                  <div style={miniHd}>👤 Headman</div>
                                  <VRow label="Name"    val={v.headmanName} />
                                  <VRow label="Contact" val={v.headmanContact} />
                                </div>
                                <div style={miniSec}>
                                  <div style={miniHd}>🏛️ Panchayat</div>
                                  <VRow label="Name"           val={v.panchayatName} />
                                  <VRow label="Secy/President" val={v.panchayatSecy} />
                                  <VRow label="Contact"        val={v.panchayatContact} />
                                </div>
                                <div style={miniSec}>
                                  <div style={miniHd}>🏠 Households</div>
                                  <div style={{ display:"grid",
                                    gridTemplateColumns:"1fr 1fr 1fr", gap:6 }}>
                                    {[
                                      { label:"Total",    val:v.totalHouseholds,        color:"#1D4ED8" },
                                      { label:"POSB",     val:v.householdsWithPOSB,     color:"#15803D" },
                                      { label:"PLI",      val:v.householdsWithPLI,      color:"#0F766E" },
                                      { label:"No POSB",  val:Math.max(0,v.totalHouseholds-v.householdsWithPOSB), color:"#DC2626" },
                                      { label:"No PLI",   val:Math.max(0,v.totalHouseholds-v.householdsWithPLI),  color:"#D97706" },
                                    ].map(m => (
                                      <StatBox key={m.label} label={m.label}
                                        val={m.val} color={m.color} />
                                    ))}
                                  </div>
                                </div>
                                <div style={miniSec}>
                                  <div style={miniHd}>🏫 School</div>
                                  <VRow label="School"    val={v.schoolName} />
                                  <VRow label="HM Contact" val={v.headmasterContact} />
                                  <div style={{ display:"grid",
                                    gridTemplateColumns:"1fr 1fr 1fr", gap:6, marginTop:8 }}>
                                    {[
                                      { label:"Total Girls", val:v.totalGirlsBelow10, color:"#7C3AED" },
                                      { label:"With SSY",    val:v.girlsWithSSY,      color:"#15803D" },
                                      { label:"No SSY",      val:Math.max(0,v.totalGirlsBelow10-v.girlsWithSSY), color:"#DC2626" },
                                    ].map(m => (
                                      <StatBox key={m.label} label={m.label}
                                        val={m.val} color={m.color} />
                                    ))}
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        ))
                      )}

                      {/* Institutions sub-view */}
                      {viewSubTab === "institutions" && (
                        (rec.institutions||[]).length === 0 ? (
                          <div style={{ padding:24, textAlign:"center" as const,
                            color:"#A0AEC0", fontSize:13 }}>
                            No institutions recorded for this office
                          </div>
                        ) : (
                          (rec.institutions||[]).map((inst, ii) => (
                            <div key={ii} style={{ borderBottom:"1px solid #E2E8F0" }}>
                              <div style={{ padding:"10px 14px", cursor:"pointer",
                                display:"flex", justifyContent:"space-between",
                                alignItems:"center" }}
                                onClick={() => setExpandedInst(
                                  expandedInst===ii ? null : ii
                                )}>
                                <div>
                                  <div style={{ fontSize:13, fontWeight:600,
                                    color:"#1A202C" }}>
                                    {INST_ICONS[inst.type]||"🏢"}{" "}
                                    {inst.name || `${inst.type} ${ii+1}`}
                                  </div>
                                  <div style={{ fontSize:11, color:"#718096" }}>
                                    {inst.type} · {inst.contactPerson || "—"}
                                  </div>
                                </div>
                                <div style={{ fontSize:11, color:"#A0AEC0" }}>
                                  {expandedInst===ii ? "▲" : "▼"}
                                </div>
                              </div>
                              {expandedInst === ii && (
                                <div style={{ padding:"0 14px 14px" }}>
                                  <div style={miniSec}>
                                    <div style={miniHd}>📋 Basic Info</div>
                                    <VRow label="Name"    val={inst.name} />
                                    <VRow label="Type"    val={inst.type} />
                                    <VRow label="Contact" val={inst.contactPerson} />
                                    <VRow label="Phone"   val={inst.contactNumber} />
                                    <VRow label="Address" val={inst.address} />
                                  </div>
                                  {(inst.totalStudents>0||inst.totalStaff>0) && (
                                    <div style={miniSec}>
                                      <div style={miniHd}>📊 Data</div>
                                      {inst.totalStudents>0 && (
                                        <>
                                          <VRow label="Total Students"
                                            val={String(inst.totalStudents)} />
                                          <VRow label="Students with POSB"
                                            val={String(inst.studentsWithPOSB)} />
                                          <VRow label="Girls with SSY"
                                            val={String(inst.studentsWithSSY)} />
                                        </>
                                      )}
                                      {inst.totalStaff>0 && (
                                        <>
                                          <VRow label="Total Staff"
                                            val={String(inst.totalStaff)} />
                                          <VRow label="Staff with POSB"
                                            val={String(inst.staffWithPOSB)} />
                                          <VRow label="Staff with PLI"
                                            val={String(inst.staffWithPLI)} />
                                          <VRow label="Staff with RPLI"
                                            val={String(inst.staffWithRPLI)} />
                                        </>
                                      )}
                                    </div>
                                  )}
                                  {inst.remarks && (
                                    <div style={{ fontSize:12, color:"#718096",
                                      fontStyle:"italic", padding:"6px 0" }}>
                                      📝 {inst.remarks}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          ))
                        )
                      )}

                      {/* Export this office */}
                      <div style={{ padding:"10px 14px" }}>
                        <button onClick={() => exportToExcel([rec])}
                          style={{ padding:"8px 14px", background:"#EBF8FF",
                            color:"#1565C0", border:"1px solid #BEE3F8",
                            borderRadius:8, fontSize:12, fontWeight:600,
                            cursor:"pointer" }}>
                          📥 Export This Office
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </>
        )}
      </div>

      {toast && (
        <div style={{ position:"fixed", bottom:80, left:"50%",
          transform:"translateX(-50%)", background:"#2D3748",
          color:"#fff", padding:"10px 20px", borderRadius:24,
          fontSize:13, fontWeight:500, zIndex:300,
          whiteSpace:"nowrap" as const }}>
          {toast}
        </div>
      )}
      <BottomNav />
    </div>
  );
}

// ── Helper Components ─────────────────────────────────────────────
function StatBox({ label, val, color }: { label:string; val:number; color:string }) {
  return (
    <div style={{ background:"#fff", borderRadius:8, padding:"7px 6px",
      textAlign:"center" as const }}>
      <div style={{ fontSize:9, color:"#718096", fontWeight:700 }}>{label}</div>
      <div style={{ fontSize:18, fontWeight:800, color }}>{val}</div>
    </div>
  );
}

function VRow({ label, val }: { label:string; val:string }) {
  return (
    <div style={{ display:"flex", justifyContent:"space-between",
      fontSize:12, padding:"5px 0", borderBottom:"1px solid #F1F5F9" }}>
      <span style={{ color:"#718096" }}>{label}</span>
      <span style={{ fontWeight:600, color:"#1A202C" }}>{val||"—"}</span>
    </div>
  );
}

// ── Style helpers ────────────────────────────────────────────────
function secBox(bg:string, border:string): React.CSSProperties {
  return { background:bg, borderRadius:10, padding:12,
    marginBottom:14, border:`1px solid ${border}20` };
}
function secTit(color:string): React.CSSProperties {
  return { fontSize:12, fontWeight:700, color,
    textTransform:"uppercase", letterSpacing:.5, marginBottom:10 };
}

// ── Styles ────────────────────────────────────────────────────────
const card:    React.CSSProperties = { background:"#fff", border:"1px solid #E2E8F0", borderRadius:12, padding:14, marginBottom:12 };
const sHead:   React.CSSProperties = { fontSize:12, fontWeight:700, color:"#718096", textTransform:"uppercase", letterSpacing:.5, marginBottom:12 };
const lbl:     React.CSSProperties = { display:"block", fontSize:11, fontWeight:600, color:"#4A5568", textTransform:"uppercase", letterSpacing:.3, marginBottom:4 };
const inp:     React.CSSProperties = { width:"100%", padding:"9px 11px", fontSize:14, border:"1.5px solid #E2E8F0", borderRadius:8, color:"#1A202C", background:"#fff", boxSizing:"border-box", outline:"none" };
const hBtn:    React.CSSProperties = { background:"rgba(255,255,255,0.2)", border:"1px solid rgba(255,255,255,0.4)", color:"#fff", borderRadius:8, padding:"7px 14px", fontSize:12, fontWeight:600, cursor:"pointer" };
const tabBtn:  React.CSSProperties = { padding:"7px 14px", borderRadius:20, border:"none", fontWeight:600, fontSize:12, cursor:"pointer" };
const delBtn:  React.CSSProperties = { background:"#FEE2E2", border:"none", color:"#DC2626", borderRadius:6, padding:"4px 10px", fontSize:11, fontWeight:600, cursor:"pointer" };
const miniSec: React.CSSProperties = { background:"#F7FAFC", borderRadius:8, padding:10, marginBottom:8 };
const miniHd:  React.CSSProperties = { fontSize:11, fontWeight:700, color:"#4A5568", textTransform:"uppercase", marginBottom:6 };
