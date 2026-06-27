"use client";

import { useState, useEffect } from "react";
import { useAuth } from "../../context/AuthContext";
import { useRouter } from "next/navigation";
import { db } from "../firebase";
import {
  doc, setDoc, getDoc, getDocs, collection,
  query, where, serverTimestamp
} from "firebase/firestore";
import BottomNav from "../../components/BottomNav";

// Roles that can do daily entry
const ENTRY_ROLES = ["office_user", "so_admin", "ho_admin"];
// Roles that can upload master data
const MASTER_ROLES = ["superadmin", "division_admin"];

export default function DailyEntryPage() {
  const { profile, user } = useAuth();
  const router = useRouter();

  const [tab, setTab] = useState<"entry" | "master">("entry");
  const [today] = useState(() => new Date().toISOString().split("T")[0]);
  const [selectedDate, setSelectedDate] = useState(today);

  // Master data
  const [masterData, setMasterData] = useState<any>(null);

  // Entry form
  const [form, setForm] = useState({
    closingBalance:   "",
    posbIndexed:      "",
    pliPolicies:      "",
    pliPremium:       "",
    rpliPolicies:     "",
    rpliPremium:      "",
    remarks:          "",
  });

  const [saving,       setSaving]       = useState(false);
  const [loading,      setLoading]      = useState(false);
  const [toast,        setToast]        = useState("");
  const [existingData, setExistingData] = useState<any>(null);
  const [alert,        setAlert]        = useState<string[]>([]);

  // Master upload state
  const [masterFile,   setMasterFile]   = useState<any[]>([]);
  const [uploadingMaster, setUploadingMaster] = useState(false);

  const officeId = profile?.officeId || profile?.officeCode || "";
  const isEntryUser  = ENTRY_ROLES.includes(profile?.role || "");
  const isMasterUser = MASTER_ROLES.includes(profile?.role || "");

  useEffect(() => {
    if (!user) { router.push("/"); return; }
    if (officeId) {
      loadMasterData(officeId);
      loadExistingEntry(officeId, selectedDate);
    }
  }, [user, officeId, selectedDate]);

  // Auto-calculate alerts when closing balance changes
  useEffect(() => {
    if (!masterData || !form.closingBalance) { setAlert([]); return; }
    const cb  = parseFloat(form.closingBalance) || 0;
    const min = masterData.minBalance || 0;
    const max = masterData.maxBalance || 0;
    const alerts: string[] = [];
    if (cb > max) {
      alerts.push(`⚠️ Excess Cash Balance: ₹${(cb - max).toLocaleString("en-IN")} above maximum limit of ₹${max.toLocaleString("en-IN")}`);
    }
    if (cb < min) {
      alerts.push(`⚠️ Cash Balance Low: ₹${(min - cb).toLocaleString("en-IN")} below minimum required balance of ₹${min.toLocaleString("en-IN")}`);
    }
    if (cb >= min && cb <= max) {
      alerts.push("✅ Cash Balance is within authorized limits");
    }
    setAlert(alerts);
  }, [form.closingBalance, masterData]);

  async function loadMasterData(officeId: string) {
    try {
      const snap = await getDoc(doc(db, "officeMaster", officeId));
      if (snap.exists()) setMasterData(snap.data());
      else setMasterData(null);
    } catch (e) { console.error(e); }
  }

  async function loadExistingEntry(officeId: string, date: string) {
    setLoading(true);
    try {
      const key  = `${officeId}_${date.replace(/-/g, "")}`;
      const snap = await getDoc(doc(db, "dailyEntry", key));
      if (snap.exists()) {
        const data = snap.data();
        setExistingData(data);
        setForm({
          closingBalance: String(data.closingBalance || ""),
          posbIndexed:    String(data.posbIndexed    || ""),
          pliPolicies:    String(data.pliPolicies    || ""),
          pliPremium:     String(data.pliPremium     || ""),
          rpliPolicies:   String(data.rpliPolicies   || ""),
          rpliPremium:    String(data.rpliPremium    || ""),
          remarks:        data.remarks               || "",
        });
      } else {
        setExistingData(null);
        setForm({ closingBalance:"", posbIndexed:"",
          pliPolicies:"", pliPremium:"",
          rpliPolicies:"", rpliPremium:"", remarks:"" });
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  async function handleSave() {
    if (!officeId) { showToast("Office ID not found in your profile"); return; }
    if (!form.closingBalance) { showToast("Closing balance is required"); return; }
    setSaving(true);
    try {
      const key = `${officeId}_${selectedDate.replace(/-/g,"")}`;
      const cb  = parseFloat(form.closingBalance)  || 0;
      const max = masterData?.maxBalance            || 0;
      const min = masterData?.minBalance            || 0;
      const ecb = cb > max ? cb - max : 0;

      await setDoc(doc(db, "dailyEntry", key), {
        officeId,
        officeName:     profile?.officeName  || officeId,
        date:           selectedDate,
        closingBalance: cb,
        minBalance:     min,
        maxBalance:     max,
        excessCash:     ecb,
        cashStatus:     cb > max ? "excess" : cb < min ? "low" : "normal",
        posbIndexed:    parseFloat(form.posbIndexed)  || 0,
        pliPolicies:    parseFloat(form.pliPolicies)  || 0,
        pliPremium:     parseFloat(form.pliPremium)   || 0,
        rpliPolicies:   parseFloat(form.rpliPolicies) || 0,
        rpliPremium:    parseFloat(form.rpliPremium)  || 0,
        remarks:        form.remarks,
        // Hierarchy for filtering
        circleCode:     profile?.circleCode   || null,
        regionId:       profile?.regionId     || null,
        divisionCode:   profile?.divisionCode || null,
        subDivCode:     profile?.subDivCode   || null,
        hoCode:         profile?.hoCode       || null,
        submittedBy:    profile?.uid,
        submittedByName:profile?.name,
        submittedAt:    serverTimestamp(),
        updatedAt:      serverTimestamp(),
      });
      showToast("✅ Daily data saved successfully!");
      loadExistingEntry(officeId, selectedDate);
    } catch (e: any) { showToast("Error: " + e.message); }
    finally { setSaving(false); }
  }

  // Master data upload
  async function handleMasterUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingMaster(true);
    try {
      const XLSX = await import("xlsx");
      const reader = new FileReader();
      reader.onload = async (evt) => {
        const wb   = XLSX.read(evt.target?.result, { type: "binary" });
        const rows: any[] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
        let ok = 0;
        for (const row of rows) {
          const oid = String(row.OfficeId || row.officeId || row["Office ID"] || "").trim();
          const min = parseFloat(row.MinBalance || row.minBalance || 0);
          const max = parseFloat(row.MaxBalance || row.maxBalance || 0);
          if (!oid) continue;
          await setDoc(doc(db, "officeMaster", oid), {
            officeId:   oid,
            minBalance: min,
            maxBalance: max,
            updatedBy:  profile?.uid,
            updatedAt:  serverTimestamp(),
          }, { merge: true });
          ok++;
        }
        showToast(`✅ ${ok} offices updated`);
        if (officeId) loadMasterData(officeId);
      };
      reader.readAsBinaryString(file);
    } catch (e: any) { showToast("Error: " + e.message); }
    finally { setUploadingMaster(false); e.target.value = ""; }
  }

  function downloadMasterTemplate() {
    import("xlsx").then(XLSX => {
      const ws = XLSX.utils.aoa_to_sheet([
        ["OfficeId", "MinBalance", "MaxBalance"],
        ["12100675", 5000,  50000],
        ["12660179", 10000, 100000],
        ["12360006", 20000, 200000],
      ]);
      ws["!cols"] = [{ wch: 16 }, { wch: 14 }, { wch: 14 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Master");
      XLSX.writeFile(wb, "Office_CashBalance_Master.xlsx");
    });
  }

  function showToast(msg: string) {
    setToast(msg); setTimeout(() => setToast(""), 4000);
  }

  const cb  = parseFloat(form.closingBalance) || 0;
  const ecb = masterData ? Math.max(0, cb - (masterData.maxBalance || 0)) : 0;

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
              Daily Data Entry
            </h1>
            <div style={{ fontSize: 13, opacity: .85 }}>
              {profile?.officeName || officeId}
            </div>
          </div>
          <button onClick={() => router.push("/dashboard")} style={hBtn}>← Back</button>
        </div>

        {/* Tab switcher */}
        {isMasterUser && (
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button onClick={() => setTab("entry")}
              style={tab==="entry" ? hBtnActive : hBtn}>
              📝 Data Entry
            </button>
            <button onClick={() => setTab("master")}
              style={tab==="master" ? hBtnActive : hBtn}>
              ⚙️ Master Data
            </button>
          </div>
        )}
      </div>

      <div style={{ padding: "12px 12px 0" }}>

        {/* ── MASTER DATA UPLOAD TAB ── */}
        {tab === "master" && isMasterUser && (
          <div style={card}>
            <div style={sHead}>Upload Cash Balance Limits</div>
            <p style={{ fontSize: 13, color: "#718096", marginBottom: 12 }}>
              Upload minimum and maximum authorized cash balance for each office.
              Division Admin sets these limits.
            </p>
            <div style={{ background: "#F7FAFC", borderRadius: 8,
              padding: 10, marginBottom: 12, fontSize: 12, color: "#718096" }}>
              Excel columns:
              <code style={codeStyle}> OfficeId | MinBalance | MaxBalance</code>
            </div>
            <button onClick={downloadMasterTemplate} style={linkBtn}>
              📥 Download Template
            </button>
            <label style={uploadZone}>
              <input type="file" accept=".xlsx,.xls"
                onChange={handleMasterUpload} style={{ display: "none" }} />
              {uploadingMaster ? "Uploading…" : "📤 Upload Excel"}
            </label>
          </div>
        )}

        {/* ── DAILY ENTRY TAB ── */}
        {tab === "entry" && (
          <>
            {/* Date selector */}
            <div style={card}>
              <div style={sHead}>Select Date</div>
              <input type="date" style={inputStyle}
                value={selectedDate} max={today}
                onChange={e => setSelectedDate(e.target.value)} />
              {existingData && (
                <div style={{ marginTop: 8, fontSize: 12, color: "#0F766E",
                  background: "#CCFBF1", borderRadius: 6, padding: "6px 10px" }}>
                  ✅ Data already submitted — you are editing existing entry
                </div>
              )}
            </div>

            {/* Master data info */}
            {masterData ? (
              <div style={{ background: "#EBF8FF", border: "1px solid #BEE3F8",
                borderRadius: 10, padding: "10px 14px", marginBottom: 12,
                fontSize: 13 }}>
                <div style={{ fontWeight: 700, color: "#1D4ED8", marginBottom: 4 }}>
                  💰 Authorized Cash Limits
                </div>
                <div style={{ display: "flex", gap: 16, color: "#2B6CB0" }}>
                  <span>Min: <strong>₹{masterData.minBalance?.toLocaleString("en-IN")}</strong></span>
                  <span>Max: <strong>₹{masterData.maxBalance?.toLocaleString("en-IN")}</strong></span>
                </div>
              </div>
            ) : (
              <div style={{ background: "#FFFBEB", border: "1px solid #FCD34D",
                borderRadius: 10, padding: "10px 14px", marginBottom: 12,
                fontSize: 13, color: "#92400E" }}>
                ⚠️ Cash balance limits not set for this office.
                Contact your Division office.
              </div>
            )}

            {loading ? (
              <div style={{ textAlign: "center" as const, padding: 40, color: "#A0AEC0" }}>
                Loading…
              </div>
            ) : (
              <>
                {/* Section 1 — Cash Balance */}
                <div style={card}>
                  <div style={sHead}>1. Cash Balance</div>

                  <div style={{ marginBottom: 14 }}>
                    <label style={labelStyle}>Closing Balance (₹) *</label>
                    <input type="number" min="0" style={inputStyle}
                      value={form.closingBalance}
                      onChange={e => setForm(f=>({...f,closingBalance:e.target.value}))}
                      placeholder="Enter today's closing balance" />
                  </div>

                  {/* Alert box */}
                  {alert.map((a, i) => (
                    <div key={i} style={{
                      background: a.startsWith("✅") ? "#F0FFF4" : "#FFF5F5",
                      border: `1px solid ${a.startsWith("✅") ? "#9AE6B4" : "#FC8181"}`,
                      borderRadius: 8, padding: "10px 14px",
                      fontSize: 13, marginBottom: 8,
                      color: a.startsWith("✅") ? "#276749" : "#C53030",
                      fontWeight: 600,
                    }}>
                      {a}
                    </div>
                  ))}

                  {/* Excess cash highlight */}
                  {ecb > 0 && (
                    <div style={{ background: "#FEF2F2",
                      border: "2px solid #FECACA", borderRadius: 10,
                      padding: "12px 14px", marginTop: 8 }}>
                      <div style={{ fontSize: 12, color: "#DC2626",
                        fontWeight: 700, marginBottom: 4 }}>
                        EXCESS CASH BALANCE
                      </div>
                      <div style={{ fontSize: 28, fontWeight: 800, color: "#B91C1C" }}>
                        ₹{ecb.toLocaleString("en-IN")}
                      </div>
                      <div style={{ fontSize: 12, color: "#DC2626", marginTop: 4 }}>
                        Must be deposited / transferred
                      </div>
                    </div>
                  )}
                </div>

                {/* Section 2 — POSB */}
                <div style={card}>
                  <div style={sHead}>2. POSB Indexing</div>
                  <label style={labelStyle}>
                    Number of POSB A/C indexed today
                  </label>
                  <input type="number" min="0" style={inputStyle}
                    value={form.posbIndexed}
                    onChange={e => setForm(f=>({...f,posbIndexed:e.target.value}))}
                    placeholder="e.g. 5" />
                  {parseFloat(form.posbIndexed) > 0 && (
                    <div style={{ marginTop: 8, fontSize: 13, color: "#0F766E",
                      background: "#F0FFF4", borderRadius: 6, padding: "6px 10px",
                      fontWeight: 600 }}>
                      ✅ {form.posbIndexed} accounts indexed today
                    </div>
                  )}
                </div>

                {/* Section 3 — PLI */}
                <div style={card}>
                  <div style={sHead}>3. PLI</div>
                  <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
                    <div style={{ flex: 1 }}>
                      <label style={labelStyle}>No. of Policies</label>
                      <input type="number" min="0" style={inputStyle}
                        value={form.pliPolicies}
                        onChange={e => setForm(f=>({...f,pliPolicies:e.target.value}))}
                        placeholder="0" />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={labelStyle}>Premium (₹)</label>
                      <input type="number" min="0" style={inputStyle}
                        value={form.pliPremium}
                        onChange={e => setForm(f=>({...f,pliPremium:e.target.value}))}
                        placeholder="0" />
                    </div>
                  </div>
                </div>

                {/* Section 4 — RPLI */}
                <div style={card}>
                  <div style={sHead}>4. RPLI</div>
                  <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
                    <div style={{ flex: 1 }}>
                      <label style={labelStyle}>No. of Policies</label>
                      <input type="number" min="0" style={inputStyle}
                        value={form.rpliPolicies}
                        onChange={e => setForm(f=>({...f,rpliPolicies:e.target.value}))}
                        placeholder="0" />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={labelStyle}>Premium (₹)</label>
                      <input type="number" min="0" style={inputStyle}
                        value={form.rpliPremium}
                        onChange={e => setForm(f=>({...f,rpliPremium:e.target.value}))}
                        placeholder="0" />
                    </div>
                  </div>
                </div>

                {/* Remarks */}
                <div style={card}>
                  <div style={sHead}>5. Remarks (optional)</div>
                  <textarea style={{ ...inputStyle, height: 80,
                    resize: "none" as const, lineHeight: 1.5 }}
                    value={form.remarks}
                    onChange={e => setForm(f=>({...f,remarks:e.target.value}))}
                    placeholder="Any remarks for today..." />
                </div>

                {/* Summary before save */}
                <div style={{ ...card, border: "2px solid #1565C0",
                  background: "#F0F9FF" }}>
                  <div style={sHead}>Today's Summary</div>
                  <div style={{ display: "grid",
                    gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    {[
                      { label: "Closing Balance", val: `₹${(parseFloat(form.closingBalance)||0).toLocaleString("en-IN")}`, color: ecb>0?"#DC2626":"#16A34A" },
                      { label: "Excess Cash",     val: ecb>0?`₹${ecb.toLocaleString("en-IN")}`:"None", color: ecb>0?"#DC2626":"#16A34A" },
                      { label: "POSB Indexed",    val: form.posbIndexed||"0",  color: "#1D4ED8" },
                      { label: "PLI Policies",    val: form.pliPolicies||"0",  color: "#0F766E" },
                      { label: "PLI Premium",     val: `₹${(parseFloat(form.pliPremium)||0).toLocaleString("en-IN")}`, color: "#0F766E" },
                      { label: "RPLI Policies",   val: form.rpliPolicies||"0", color: "#7C3AED" },
                      { label: "RPLI Premium",    val: `₹${(parseFloat(form.rpliPremium)||0).toLocaleString("en-IN")}`, color: "#7C3AED" },
                    ].map(m => (
                      <div key={m.label} style={{ background: "#fff",
                        borderRadius: 8, padding: "8px 10px",
                        border: "1px solid #E2E8F0" }}>
                        <div style={{ fontSize: 9, color: "#718096",
                          fontWeight: 700, textTransform: "uppercase" as const }}>
                          {m.label}
                        </div>
                        <div style={{ fontSize: 14, fontWeight: 700,
                          color: m.color, marginTop: 2 }}>
                          {m.val}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <button onClick={handleSave} disabled={saving} style={{
                  width: "100%", padding: 14,
                  background: saving ? "#90CDF4" : "#1565C0",
                  color: "#fff", border: "none", borderRadius: 10,
                  fontSize: 15, fontWeight: 700,
                  cursor: saving ? "not-allowed" : "pointer",
                  marginBottom: 12
                }}>
                  {saving ? "Saving…"
                    : existingData ? "Update Entry" : "Submit Daily Data"}
                </button>
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
const hBtnActive: React.CSSProperties = {
  background: "rgba(255,255,255,0.9)", border: "none",
  color: "#1565C0", borderRadius: 8, padding: "7px 14px",
  fontSize: 12, fontWeight: 700, cursor: "pointer"
};
const linkBtn: React.CSSProperties = {
  display: "block", fontSize: 13, color: "#1565C0", background: "none",
  border: "none", cursor: "pointer", padding: 0,
  fontWeight: 500, marginBottom: 12
};
const uploadZone: React.CSSProperties = {
  display: "block", width: "100%", padding: 14, textAlign: "center",
  background: "#EBF8FF", color: "#1565C0", borderRadius: 10,
  border: "2px dashed #BEE3F8", cursor: "pointer",
  fontSize: 14, fontWeight: 500, boxSizing: "border-box"
};
const codeStyle: React.CSSProperties = {
  background: "#EBF8FF", color: "#2B6CB0",
  padding: "1px 5px", borderRadius: 4, fontSize: 11
};