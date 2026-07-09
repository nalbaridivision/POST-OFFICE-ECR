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

interface OfficeRecord {
  officeId: string;
  officeName: string;
  contactNumber: string;
  totalVillages: number;
  villages: VillageData[];
  submittedBy: string;
  submittedByName: string;
  updatedAt: any;
}

const emptyVillage = (): VillageData => ({
  villageName: "",
  headmanName: "",
  headmanContact: "",
  panchayatName: "",
  panchayatSecy: "",
  panchayatContact: "",
  totalHouseholds: 0,
  householdsWithPOSB: 0,
  householdsWithPLI: 0,
  schoolName: "",
  headmasterContact: "",
  totalGirlsBelow10: 0,
  girlsWithSSY: 0,
});

const ENTRY_ROLES = ["office_user", "ho_admin", "so_admin"];

export default function VillageDataPage() {
  const { profile, user } = useAuth();
  const router = useRouter();

  const p = profile as any;
  const myRole   = p?.role || "";
  const myOffice = p?.officeId || p?.officeCode || "";
  const myName   = p?.name || "";

  const canEnter = ENTRY_ROLES.includes(myRole);

  const [activeTab,     setActiveTab]     = useState<"entry"|"view">("entry");
  const [contactNumber, setContactNumber] = useState("");
  const [totalVillages, setTotalVillages] = useState(0);
  const [villages,      setVillages]      = useState<VillageData[]>([]);
  const [activeVillage, setActiveVillage] = useState(0);
  const [officeName,    setOfficeName]    = useState("");

  const [records,        setRecords]        = useState<OfficeRecord[]>([]);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [expandedRecord, setExpandedRecord] = useState<string|null>(null);
  const [expandedVillage,setExpandedVillage]= useState<number|null>(null);

  const [loading, setLoading] = useState(false);
  const [toast,   setToast]   = useState("");
  const [saved,   setSaved]   = useState(false);

  useEffect(() => {
    if (!user) { router.push("/"); return; }
    if (profile) {
      if (canEnter) {
        loadExistingData();
      } else {
        setActiveTab("view");
        fetchAllRecords();
      }
    }
  }, [user, profile]);

  async function loadExistingData() {
    if (!myOffice) return;
    try {
      const snap = await getDoc(doc(db, "villageData", myOffice));
      if (snap.exists()) {
        const data = snap.data() as OfficeRecord;
        setContactNumber(data.contactNumber || "");
        setTotalVillages(data.totalVillages || 0);
        setVillages(data.villages?.length ? data.villages : [emptyVillage()]);
        setOfficeName(data.officeName || p?.officeName || "");
        setSaved(true);
      } else {
        setOfficeName(p?.officeName || "");
        setVillages([]);
      }
    } catch(e) { console.error(e); }
  }

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
      else if (myRole === "ho_admin")          q = query(col, where("hoCode",       "==", myOffice));
      else if (myRole === "so_admin")          q = query(col, where("soCode",       "==", myOffice));
      else                                     q = query(col, where("officeId",     "==", myOffice));

      const snap = await getDocs(q);
      setRecords(snap.docs.map(d => d.data() as OfficeRecord));
    } catch(e: any) { showToast("Error: " + e.message); }
    finally { setLoadingRecords(false); }
  }

  function addVillage() {
    const updated = [...villages, emptyVillage()];
    setVillages(updated);
    setActiveVillage(updated.length - 1);
  }

  function removeVillage(index: number) {
    if (villages.length === 1) return;
    const updated = villages.filter((_, i) => i !== index);
    setVillages(updated);
    setActiveVillage(Math.max(0, Math.min(activeVillage, updated.length - 1)));
  }

  function updateVillage(index: number, field: keyof VillageData, value: any) {
    setVillages(vs => vs.map((v, i) =>
      i === index ? { ...v, [field]: value } : v
    ));
  }

  async function handleSave() {
    if (!myOffice) { showToast("Office ID not found"); return; }
    setLoading(true);
    try {
      const docData: any = {
        officeId:        myOffice,
        officeName:      officeName || p?.officeName || "",
        contactNumber,
        totalVillages,
        villages,
        submittedBy:     p?.uid || "",
        submittedByName: myName,
        circleCode:      p?.circleCode   || "",
        regionId:        p?.regionId     || "",
        divisionCode:    p?.divisionCode || "",
        subDivCode:      p?.subDivCode   || "",
        hoCode:          p?.hoCode       || "",
        soCode:          p?.soCode       || "",
        updatedAt:       serverTimestamp(),
      };
      await setDoc(doc(db, "villageData", myOffice), docData, { merge: true });
      setSaved(true);
      showToast("✅ Village data saved successfully!");
    } catch(e: any) { showToast("Error: " + e.message); }
    finally { setLoading(false); }
  }

  async function exportToExcel(data?: OfficeRecord[]) {
    const XLSX = await import("xlsx");
    const source = data || records;
    const rows: any[] = [];
    source.forEach(office => {
      (office.villages || []).forEach((v, i) => {
        rows.push({
          OfficeName:         office.officeName,
          OfficeID:           office.officeId,
          OfficeContact:      office.contactNumber,
          TotalVillages:      office.totalVillages,
          VillageNo:          i + 1,
          VillageName:        v.villageName,
          HeadmanName:        v.headmanName,
          HeadmanContact:     v.headmanContact,
          PanchayatName:      v.panchayatName,
          PanchayatSecy:      v.panchayatSecy,
          PanchayatContact:   v.panchayatContact,
          TotalHouseholds:    v.totalHouseholds,
          HouseholdsWithPOSB: v.householdsWithPOSB,
          HouseholdsWithPLI:  v.householdsWithPLI,
          HouseholdsNoPOSB:   Math.max(0, v.totalHouseholds - v.householdsWithPOSB),
          HouseholdsNoPLI:    Math.max(0, v.totalHouseholds - v.householdsWithPLI),
          SchoolName:         v.schoolName,
          HeadmasterContact:  v.headmasterContact,
          TotalGirlsBelow10:  v.totalGirlsBelow10,
          GirlsWithSSY:       v.girlsWithSSY,
          GirlsWithoutSSY:    Math.max(0, v.totalGirlsBelow10 - v.girlsWithSSY),
        });
      });
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = Array(21).fill({ wch: 20 });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Village Data");
    XLSX.writeFile(wb, `Village_Data_${new Date().toISOString().split("T")[0]}.xlsx`);
    showToast("✅ Exported!");
  }

  function showToast(msg: string) {
    setToast(msg); setTimeout(() => setToast(""), 3500);
  }

  const cv = villages[activeVillage] || emptyVillage();

  return (
    <div style={{ paddingBottom: 80, background: "#F0F4F8", minHeight: "100vh",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>

      {/* ── Header ── */}
      <div style={{ background: "linear-gradient(135deg, #0D47A1, #1E88E5)",
        padding: "16px 16px 20px", color: "#fff" }}>
        <div style={{ display: "flex", justifyContent: "space-between",
          alignItems: "flex-start" }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 2px" }}>
              Village Data
            </h1>
            <div style={{ fontSize: 13, opacity: .85 }}>
              {p?.officeName || myOffice}
            </div>
          </div>
          <button onClick={() => router.push("/dashboard")} style={hBtn}>
            ← Back
          </button>
        </div>

        {/* Tab buttons */}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          {canEnter && (
            <button onClick={() => setActiveTab("entry")} style={{
              padding: "7px 16px", borderRadius: 20, border: "none",
              fontWeight: 600, fontSize: 12, cursor: "pointer",
              background: activeTab==="entry"
                ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.2)",
              color: activeTab==="entry" ? "#1565C0" : "#fff",
            }}>
              📝 Data Entry
            </button>
          )}
          <button onClick={() => { setActiveTab("view"); fetchAllRecords(); }}
            style={{
              padding: "7px 16px", borderRadius: 20, border: "none",
              fontWeight: 600, fontSize: 12, cursor: "pointer",
              background: activeTab==="view"
                ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.2)",
              color: activeTab==="view" ? "#1565C0" : "#fff",
            }}>
            👁️ View All
          </button>
        </div>
      </div>

      <div style={{ padding: "12px 12px 0" }}>

        {/* ══════════════════════════════════════════
            DATA ENTRY TAB
        ══════════════════════════════════════════ */}
        {activeTab === "entry" && canEnter && (
          <>
            {/* Office Info Card */}
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
              <input
                style={{ ...inp, marginBottom: 12 }}
                type="tel"
                placeholder="e.g. 9876543210"
                value={contactNumber}
                onChange={e => setContactNumber(e.target.value)}
              />

              <label style={lbl}>Total Number of Revenue Villages</label>
              <input
                style={inp}
                type="number"
                placeholder="e.g. 15"
                value={totalVillages || ""}
                onChange={e => {
                  const n = parseInt(e.target.value) || 0;
                  setTotalVillages(n);
                  // Auto-initialize first village if none exist
                  if (n > 0 && villages.length === 0) {
                    setVillages([emptyVillage()]);
                    setActiveVillage(0);
                  }
                }}
              />
            </div>

            {/* Prompt to start adding villages */}
            {totalVillages > 0 && villages.length === 0 && (
              <button onClick={() => {
                setVillages([emptyVillage()]);
                setActiveVillage(0);
              }} style={{
                width: "100%", padding: 14,
                background: "#EBF8FF", color: "#1565C0",
                border: "2px dashed #BEE3F8", borderRadius: 10,
                fontSize: 14, fontWeight: 600, cursor: "pointer",
                marginBottom: 12
              }}>
                + Start Adding Village Data
              </button>
            )}

            {/* Village section */}
            {totalVillages > 0 && villages.length > 0 && (
              <>
                {/* Progress */}
                <div style={{ fontSize: 12, fontWeight: 700,
                  color: "#718096", textTransform: "uppercase",
                  letterSpacing: .5, marginBottom: 8 }}>
                  Villages — {villages.length} of {totalVillages} entered
                </div>

                {/* Village selector tabs */}
                <div style={{ display: "flex", gap: 6,
                  overflowX: "auto", paddingBottom: 8,
                  marginBottom: 10 }}>
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
                    }}>
                      + Add Village
                    </button>
                  )}
                </div>

                {/* Village Form */}
                <div style={card}>
                  <div style={{ display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center", marginBottom: 14 }}>
                    <div style={sHead}>
                      🏘️ Village {activeVillage + 1} Details
                    </div>
                    {villages.length > 1 && (
                      <button onClick={() => removeVillage(activeVillage)}
                        style={{ background: "#FEE2E2", border: "none",
                          color: "#DC2626", borderRadius: 6,
                          padding: "4px 10px", fontSize: 11,
                          fontWeight: 600, cursor: "pointer" }}>
                        🗑️ Remove
                      </button>
                    )}
                  </div>

                  {/* Village name */}
                  <label style={lbl}>Name of Village</label>
                  <input style={{ ...inp, marginBottom: 16 }}
                    placeholder="e.g. Pub Nalbari"
                    value={cv.villageName}
                    onChange={e => updateVillage(activeVillage,
                      "villageName", e.target.value)} />

                  {/* ── Village Headman ── */}
                  <div style={secBox("#EBF8FF", "#1D4ED8")}>
                    <div style={secTitle("#1D4ED8")}>👤 Village Headman / Gaonbura</div>

                    <label style={lbl}>Name</label>
                    <input style={{ ...inp, marginBottom: 10 }}
                      placeholder="Full name"
                      value={cv.headmanName}
                      onChange={e => updateVillage(activeVillage,
                        "headmanName", e.target.value)} />

                    <label style={lbl}>Contact Number</label>
                    <input style={inp} type="tel"
                      placeholder="e.g. 9876543210"
                      value={cv.headmanContact}
                      onChange={e => updateVillage(activeVillage,
                        "headmanContact", e.target.value)} />
                  </div>

                  {/* ── Panchayat ── */}
                  <div style={secBox("#F0FFF4", "#15803D")}>
                    <div style={secTitle("#15803D")}>🏛️ Panchayat Details</div>

                    <label style={lbl}>Name of Panchayat</label>
                    <input style={{ ...inp, marginBottom: 10 }}
                      placeholder="e.g. Nalbari Gaon Panchayat"
                      value={cv.panchayatName}
                      onChange={e => updateVillage(activeVillage,
                        "panchayatName", e.target.value)} />

                    <label style={lbl}>Name of Secretary / President</label>
                    <input style={{ ...inp, marginBottom: 10 }}
                      placeholder="Full name"
                      value={cv.panchayatSecy}
                      onChange={e => updateVillage(activeVillage,
                        "panchayatSecy", e.target.value)} />

                    <label style={lbl}>Contact Number</label>
                    <input style={inp} type="tel"
                      placeholder="e.g. 9876543210"
                      value={cv.panchayatContact}
                      onChange={e => updateVillage(activeVillage,
                        "panchayatContact", e.target.value)} />
                  </div>

                  {/* ── Household Data ── */}
                  <div style={secBox("#FFF5F5", "#DC2626")}>
                    <div style={secTitle("#DC2626")}>🏠 Household Data</div>

                    <label style={lbl}>Total Number of Households</label>
                    <input style={{ ...inp, marginBottom: 10 }}
                      type="number" placeholder="e.g. 250"
                      value={cv.totalHouseholds || ""}
                      onChange={e => updateVillage(activeVillage,
                        "totalHouseholds", parseInt(e.target.value)||0)} />

                    <label style={lbl}>Households WITH POSB Account</label>
                    <input style={{ ...inp, marginBottom: 10 }}
                      type="number"
                      placeholder={`Max: ${cv.totalHouseholds}`}
                      value={cv.householdsWithPOSB || ""}
                      onChange={e => updateVillage(activeVillage,
                        "householdsWithPOSB",
                        Math.min(parseInt(e.target.value)||0,
                          cv.totalHouseholds))} />

                    <label style={lbl}>Households WITH PLI / RPLI Policy</label>
                    <input style={{ ...inp, marginBottom: 14 }}
                      type="number"
                      placeholder={`Max: ${cv.totalHouseholds}`}
                      value={cv.householdsWithPLI || ""}
                      onChange={e => updateVillage(activeVillage,
                        "householdsWithPLI",
                        Math.min(parseInt(e.target.value)||0,
                          cv.totalHouseholds))} />

                    {/* Balance display */}
                    {cv.totalHouseholds > 0 && (
                      <div style={{ background: "#FEF2F2",
                        border: "1px solid #FECACA",
                        borderRadius: 10, padding: 12 }}>
                        <div style={{ fontSize: 11, fontWeight: 700,
                          color: "#DC2626", marginBottom: 10,
                          textTransform: "uppercase" }}>
                          📊 Balance Households (Potential Customers)
                        </div>
                        <div style={{ display: "grid",
                          gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                          {[
                            { label: "Total HH",
                              val: cv.totalHouseholds,
                              color: "#1D4ED8" },
                            { label: "Without POSB",
                              val: Math.max(0, cv.totalHouseholds - cv.householdsWithPOSB),
                              color: "#DC2626" },
                            { label: "Without PLI",
                              val: Math.max(0, cv.totalHouseholds - cv.householdsWithPLI),
                              color: "#D97706" },
                          ].map(m => (
                            <div key={m.label} style={{ background: "#fff",
                              borderRadius: 8, padding: "8px 6px",
                              textAlign: "center" as const }}>
                              <div style={{ fontSize: 9, color: "#718096",
                                fontWeight: 700 }}>{m.label}</div>
                              <div style={{ fontSize: 20, fontWeight: 800,
                                color: m.color }}>{m.val}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* ── School Data ── */}
                  <div style={secBox("#FAF5FF", "#7C3AED")}>
                    <div style={secTitle("#7C3AED")}>🏫 School Details</div>

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

                    <label style={lbl}>
                      Total Girl Children (Below 10 Years)
                    </label>
                    <input style={{ ...inp, marginBottom: 10 }}
                      type="number" placeholder="e.g. 45"
                      value={cv.totalGirlsBelow10 || ""}
                      onChange={e => updateVillage(activeVillage,
                        "totalGirlsBelow10",
                        parseInt(e.target.value)||0)} />

                    <label style={lbl}>
                      Girl Children WITH Sukanya Samriddhi (SSY) Account
                    </label>
                    <input style={{ ...inp, marginBottom: 14 }}
                      type="number"
                      placeholder={`Max: ${cv.totalGirlsBelow10}`}
                      value={cv.girlsWithSSY || ""}
                      onChange={e => updateVillage(activeVillage,
                        "girlsWithSSY",
                        Math.min(parseInt(e.target.value)||0,
                          cv.totalGirlsBelow10))} />

                    {/* SSY Balance */}
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
                            { label: "Total Girls",
                              val: cv.totalGirlsBelow10, color: "#7C3AED" },
                            { label: "With SSY",
                              val: cv.girlsWithSSY, color: "#15803D" },
                            { label: "Without SSY",
                              val: Math.max(0, cv.totalGirlsBelow10 - cv.girlsWithSSY),
                              color: "#DC2626" },
                          ].map(m => (
                            <div key={m.label} style={{ background: "#fff",
                              borderRadius: 8, padding: "8px 6px",
                              textAlign: "center" as const }}>
                              <div style={{ fontSize: 9, color: "#718096",
                                fontWeight: 700 }}>{m.label}</div>
                              <div style={{ fontSize: 20, fontWeight: 800,
                                color: m.color }}>{m.val}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Prev / Next navigation */}
                <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                  {activeVillage > 0 && (
                    <button onClick={() => setActiveVillage(v => v - 1)}
                      style={{ flex: 1, padding: 10,
                        background: "#E2E8F0", color: "#4A5568",
                        border: "none", borderRadius: 8,
                        fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                      ← Previous Village
                    </button>
                  )}
                  {activeVillage < villages.length - 1 && (
                    <button onClick={() => setActiveVillage(v => v + 1)}
                      style={{ flex: 1, padding: 10,
                        background: "#1565C0", color: "#fff",
                        border: "none", borderRadius: 8,
                        fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                      Next Village →
                    </button>
                  )}
                </div>
              </>
            )}

            {/* Save button */}
            <button onClick={handleSave} disabled={loading} style={{
              width: "100%", padding: 14,
              background: loading ? "#90CDF4" : "#1565C0",
              color: "#fff", border: "none", borderRadius: 10,
              fontSize: 15, fontWeight: 700,
              cursor: loading ? "not-allowed" : "pointer",
              marginBottom: 12
            }}>
              {loading ? "Saving…"
                : saved ? "✅ Update Village Data"
                : "💾 Save Village Data"}
            </button>
          </>
        )}

        {/* ══════════════════════════════════════════
            VIEW TAB
        ══════════════════════════════════════════ */}
        {activeTab === "view" && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between",
              alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#1A202C" }}>
                {records.length} offices submitted
              </div>
              {records.length > 0 && (
                <button onClick={() => exportToExcel()}
                  style={{ padding: "8px 14px", background: "#1565C0",
                    color: "#fff", border: "none", borderRadius: 8,
                    fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                  📥 Export All
                </button>
              )}
            </div>

            {loadingRecords ? (
              <div style={{ textAlign: "center" as const, padding: 40,
                color: "#A0AEC0" }}>Loading…</div>
            ) : records.length === 0 ? (
              <div style={{ textAlign: "center" as const, padding: 40,
                color: "#A0AEC0" }}>
                <div style={{ fontSize: 40, marginBottom: 10 }}>🏘️</div>
                <div style={{ fontSize: 15, fontWeight: 600 }}>
                  No village data submitted yet
                </div>
                <div style={{ fontSize: 13, marginTop: 4 }}>
                  BO/SO/HO offices need to submit their village data
                </div>
              </div>
            ) : (
              records.map(rec => (
                <div key={rec.officeId} style={{ background: "#fff",
                  borderRadius: 12, border: "1px solid #E2E8F0",
                  marginBottom: 10, overflow: "hidden" }}>

                  {/* Office header */}
                  <div
                    style={{ padding: "12px 14px", cursor: "pointer",
                      background: expandedRecord===rec.officeId
                        ? "#EBF8FF" : "#fff" }}
                    onClick={() => setExpandedRecord(
                      expandedRecord===rec.officeId ? null : rec.officeId
                    )}>
                    <div style={{ display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start" }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700,
                          color: "#1A202C" }}>
                          {rec.officeName}
                        </div>
                        <div style={{ fontSize: 11, color: "#A0AEC0" }}>
                          {rec.officeId}
                          {rec.contactNumber ? ` · 📞 ${rec.contactNumber}` : ""}
                        </div>
                        <div style={{ fontSize: 12, color: "#1D4ED8",
                          marginTop: 4, fontWeight: 600 }}>
                          {rec.villages?.length || 0} villages entered
                          {" / "}{rec.totalVillages} total
                        </div>
                      </div>
                      <div style={{ textAlign: "right" as const }}>
                        <div style={{ fontSize: 24, fontWeight: 800,
                          color: "#1D4ED8" }}>
                          {rec.villages?.length || 0}
                        </div>
                        <div style={{ fontSize: 9, color: "#718096" }}>
                          VILLAGES
                        </div>
                        <div style={{ fontSize: 11, color: "#A0AEC0",
                          marginTop: 4 }}>
                          {expandedRecord===rec.officeId ? "▲ Less" : "▼ More"}
                        </div>
                      </div>
                    </div>

                    {/* Summary stats row */}
                    {(rec.villages?.length || 0) > 0 && (
                      <div style={{ display: "grid",
                        gridTemplateColumns: "1fr 1fr 1fr 1fr",
                        gap: 6, marginTop: 10 }}>
                        {[
                          { label: "Households",
                            val: rec.villages.reduce((a,v)=>a+(v.totalHouseholds||0),0),
                            color: "#1D4ED8" },
                          { label: "POSB",
                            val: rec.villages.reduce((a,v)=>a+(v.householdsWithPOSB||0),0),
                            color: "#15803D" },
                          { label: "PLI/RPLI",
                            val: rec.villages.reduce((a,v)=>a+(v.householdsWithPLI||0),0),
                            color: "#0F766E" },
                          { label: "SSY Girls",
                            val: rec.villages.reduce((a,v)=>a+(v.girlsWithSSY||0),0),
                            color: "#7C3AED" },
                        ].map(s => (
                          <div key={s.label} style={{ background: "#F7FAFC",
                            borderRadius: 6, padding: "5px 6px",
                            textAlign: "center" as const }}>
                            <div style={{ fontSize: 9, color: "#718096",
                              fontWeight: 700 }}>{s.label}</div>
                            <div style={{ fontSize: 15, fontWeight: 800,
                              color: s.color }}>{s.val}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Expanded — village list */}
                  {expandedRecord === rec.officeId && (
                    <div style={{ borderTop: "1px solid #E2E8F0",
                      background: "#F7FAFC" }}>
                      {(rec.villages || []).map((v, vi) => (
                        <div key={vi} style={{
                          borderBottom: "1px solid #E2E8F0" }}>

                          {/* Village row header */}
                          <div
                            style={{ padding: "10px 14px",
                              cursor: "pointer", display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center" }}
                            onClick={() => setExpandedVillage(
                              expandedVillage===vi ? null : vi
                            )}>
                            <div>
                              <div style={{ fontSize: 13, fontWeight: 600,
                                color: "#1A202C" }}>
                                🏘️ {v.villageName || `Village ${vi+1}`}
                              </div>
                              <div style={{ fontSize: 11, color: "#718096" }}>
                                {v.panchayatName}
                                {v.totalHouseholds
                                  ? ` · ${v.totalHouseholds} households`
                                  : ""}
                              </div>
                            </div>
                            <div style={{ fontSize: 11, color: "#A0AEC0" }}>
                              {expandedVillage===vi ? "▲" : "▼"}
                            </div>
                          </div>

                          {/* Village detail */}
                          {expandedVillage === vi && (
                            <div style={{ padding: "0 14px 14px" }}>

                              {/* Headman */}
                              <div style={miniSec}>
                                <div style={miniHd}>👤 Village Headman</div>
                                <VRow label="Name"    val={v.headmanName} />
                                <VRow label="Contact" val={v.headmanContact} />
                              </div>

                              {/* Panchayat */}
                              <div style={miniSec}>
                                <div style={miniHd}>🏛️ Panchayat</div>
                                <VRow label="Name"            val={v.panchayatName} />
                                <VRow label="Secy/President"  val={v.panchayatSecy} />
                                <VRow label="Contact"         val={v.panchayatContact} />
                              </div>

                              {/* Households */}
                              <div style={miniSec}>
                                <div style={miniHd}>🏠 Households</div>
                                <div style={{ display: "grid",
                                  gridTemplateColumns: "1fr 1fr 1fr",
                                  gap: 6 }}>
                                  {[
                                    { label: "Total",
                                      val: v.totalHouseholds, color: "#1D4ED8" },
                                    { label: "With POSB",
                                      val: v.householdsWithPOSB, color: "#15803D" },
                                    { label: "With PLI",
                                      val: v.householdsWithPLI, color: "#0F766E" },
                                    { label: "No POSB",
                                      val: Math.max(0,v.totalHouseholds-v.householdsWithPOSB),
                                      color: "#DC2626" },
                                    { label: "No PLI",
                                      val: Math.max(0,v.totalHouseholds-v.householdsWithPLI),
                                      color: "#D97706" },
                                  ].map(m => (
                                    <div key={m.label} style={{ background: "#fff",
                                      borderRadius: 6, padding: "6px 8px",
                                      textAlign: "center" as const }}>
                                      <div style={{ fontSize: 9,
                                        color: "#718096", fontWeight: 700 }}>
                                        {m.label}
                                      </div>
                                      <div style={{ fontSize: 16,
                                        fontWeight: 800, color: m.color }}>
                                        {m.val}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>

                              {/* School */}
                              <div style={miniSec}>
                                <div style={miniHd}>🏫 School</div>
                                <VRow label="School Name"
                                  val={v.schoolName} />
                                <VRow label="Headmaster Contact"
                                  val={v.headmasterContact} />
                                <div style={{ display: "grid",
                                  gridTemplateColumns: "1fr 1fr 1fr",
                                  gap: 6, marginTop: 8 }}>
                                  {[
                                    { label: "Total Girls",
                                      val: v.totalGirlsBelow10, color: "#7C3AED" },
                                    { label: "With SSY",
                                      val: v.girlsWithSSY, color: "#15803D" },
                                    { label: "Without SSY",
                                      val: Math.max(0,v.totalGirlsBelow10-v.girlsWithSSY),
                                      color: "#DC2626" },
                                  ].map(m => (
                                    <div key={m.label} style={{ background: "#fff",
                                      borderRadius: 6, padding: "6px 8px",
                                      textAlign: "center" as const }}>
                                      <div style={{ fontSize: 9,
                                        color: "#718096", fontWeight: 700 }}>
                                        {m.label}
                                      </div>
                                      <div style={{ fontSize: 16,
                                        fontWeight: 800, color: m.color }}>
                                        {m.val}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}

                      {/* Export single office */}
                      <div style={{ padding: "10px 14px" }}>
                        <button onClick={() => exportToExcel([rec])}
                          style={{ padding: "8px 14px",
                            background: "#EBF8FF", color: "#1565C0",
                            border: "1px solid #BEE3F8",
                            borderRadius: 8, fontSize: 12,
                            fontWeight: 600, cursor: "pointer" }}>
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
        <div style={{ position: "fixed", bottom: 80, left: "50%",
          transform: "translateX(-50%)", background: "#2D3748",
          color: "#fff", padding: "10px 20px", borderRadius: 24,
          fontSize: 13, fontWeight: 500, zIndex: 300,
          whiteSpace: "nowrap" as const }}>
          {toast}
        </div>
      )}
      <BottomNav />
    </div>
  );
}

// ── Small components ─────────────────────────────────────────────
function VRow({ label, val }: { label: string; val: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between",
      fontSize: 12, padding: "5px 0",
      borderBottom: "1px solid #F1F5F9" }}>
      <span style={{ color: "#718096" }}>{label}</span>
      <span style={{ fontWeight: 600, color: "#1A202C" }}>
        {val || "—"}
      </span>
    </div>
  );
}

function secBox(bg: string, border: string): React.CSSProperties {
  return {
    background: bg, borderRadius: 10,
    padding: 12, marginBottom: 14,
    border: `1px solid ${border}20`
  };
}

function secTitle(color: string): React.CSSProperties {
  return {
    fontSize: 12, fontWeight: 700, color,
    textTransform: "uppercase", letterSpacing: .5,
    marginBottom: 10
  };
}

// ── Styles ────────────────────────────────────────────────────────
const card: React.CSSProperties = {
  background: "#fff", border: "1px solid #E2E8F0",
  borderRadius: 12, padding: 14, marginBottom: 12
};
const sHead: React.CSSProperties = {
  fontSize: 12, fontWeight: 700, color: "#718096",
  textTransform: "uppercase", letterSpacing: .5, marginBottom: 12
};
const lbl: React.CSSProperties = {
  display: "block", fontSize: 11, fontWeight: 600,
  color: "#4A5568", textTransform: "uppercase",
  letterSpacing: .3, marginBottom: 4
};
const inp: React.CSSProperties = {
  width: "100%", padding: "9px 11px", fontSize: 14,
  border: "1.5px solid #E2E8F0", borderRadius: 8,
  color: "#1A202C", background: "#fff",
  boxSizing: "border-box", outline: "none"
};
const hBtn: React.CSSProperties = {
  background: "rgba(255,255,255,0.2)",
  border: "1px solid rgba(255,255,255,0.4)",
  color: "#fff", borderRadius: 8, padding: "7px 14px",
  fontSize: 12, fontWeight: 600, cursor: "pointer"
};
const miniSec: React.CSSProperties = {
  background: "#F7FAFC", borderRadius: 8,
  padding: 10, marginBottom: 8
};
const miniHd: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: "#4A5568",
  textTransform: "uppercase", marginBottom: 6
};
