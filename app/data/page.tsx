"use client";

import { useState, useEffect } from "react";
import { useAuth } from "../../context/AuthContext";
import { useRouter } from "next/navigation";
import { db } from "../firebase";
import {
  doc, setDoc, getDoc, getDocs, deleteDoc,
  serverTimestamp, collection, query, where
} from "firebase/firestore";
import BottomNav from "../../components/BottomNav";

interface IncomeHead {
  id: string;
  label: string;
  type: "count" | "amount";
  rate?: number;
  rateType?: "multiplier" | "percentage";
  isProportionate?: boolean;
  value: string;
  computed: number;
  ledgerData?: any[];
  fileName?: string;
}

const DEFAULT_HEADS: Omit<IncomeHead, "value" | "computed">[] = [
  { id: "posb_live",    label: "POSB Live A/C",      type: "count",  rate: 219.23, rateType: "multiplier", isProportionate: false },
  { id: "posb_silent",  label: "POSB Silent A/C",    type: "count",  rate: 36.61,  rateType: "multiplier", isProportionate: false },
  { id: "certificates", label: "Certificates",       type: "amount", rate: 73.92,  rateType: "multiplier", isProportionate: false },
  { id: "mail_booking", label: "Mail Booking (All)", type: "amount",                                       isProportionate: false },
  { id: "aadhaar",      label: "Aadhaar Enrollment", type: "amount",                                       isProportionate: false },
  { id: "pli_premium",  label: "PLI Premium",        type: "amount", rate: 4,      rateType: "percentage", isProportionate: false },
  { id: "rpli_premium", label: "RPLI Premium",       type: "amount", rate: 12,     rateType: "percentage", isProportionate: false },
];

const DATA_ENTRY_ROLES = ["superadmin", "circle_admin", "region_admin", "division_admin"];
const CAN_DELETE_ROLES = ["superadmin", "circle_admin", "region_admin", "division_admin"];

export default function DataPage() {
  const { profile, user } = useAuth();
  const router = useRouter();

  const [divisions,    setDivisions]    = useState<any[]>([]);
  const [allOffices,   setAllOffices]   = useState<any[]>([]);
  const [selectedDiv,    setSelectedDiv]    = useState("");
  const [selectedSubDiv, setSelectedSubDiv] = useState("");
  const [selectedMonth,  setSelectedMonth]  = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });

  const [baseHeads,    setBaseHeads]    = useState<Omit<IncomeHead, "value" | "computed">[]>(DEFAULT_HEADS);
  const [incomeHeads,  setIncomeHeads]  = useState<IncomeHead[]>([]);
  const [customHeads,  setCustomHeads]  = useState<IncomeHead[]>([]);
  const [saving,       setSaving]       = useState(false);
  const [loading,      setLoading]      = useState(false);
  const [toast,        setToast]        = useState("");
  const [existingData, setExistingData] = useState<any>(null);
  const [mappedCount,  setMappedCount]  = useState(0);
  const [expandedHeadId, setExpandedHeadId] = useState<string | null>(null);
  const [showSettings,   setShowSettings]   = useState(false);
  const [editingRates,   setEditingRates]   = useState<Omit<IncomeHead, "value" | "computed">[]>([]);
  const [deletePrompt, setDeletePrompt] = useState<{
    action: "row" | "head" | "month";
    headId?: string;
    officeCode?: string;
    message: string;
  } | null>(null);

  useEffect(() => {
    if (!user) { router.push("/"); return; }
    if (profile && !DATA_ENTRY_ROLES.includes(profile.role)) return;
    fetchHierarchyAndRates();
  }, [user, profile]);

  useEffect(() => {
    if (!selectedDiv) {
      setSelectedSubDiv("");
      return;
    }
  }, [selectedDiv]);

  useEffect(() => {
    const scope = selectedSubDiv || selectedDiv;
    if (scope && selectedMonth) checkExisting(scope, selectedMonth);
  }, [selectedSubDiv, selectedDiv, selectedMonth, baseHeads]);

  useEffect(() => {
    const scope = selectedSubDiv || selectedDiv;
    if (!scope) { setMappedCount(0); return; }
    const count = allOffices.filter((o: any) =>
      o._collection === "offices" &&
      (selectedSubDiv ? o.subDivCode === selectedSubDiv : o.divisionCode === selectedDiv)
    ).length;
    setMappedCount(count);
  }, [selectedDiv, selectedSubDiv, allOffices]);

  // ACCESS DENIED check
  if (profile && !DATA_ENTRY_ROLES.includes(profile.role)) {
    return (
      <div style={accessDenied}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🚫</div>
        <h2 style={{ color: "#C53030", margin: "0 0 8px" }}>Access Denied</h2>
        <p style={{ color: "#718096", fontSize: 14, maxWidth: 280 }}>
          Only Circle Office and Division Office users can enter income data.
        </p>
        <button onClick={() => router.push("/dashboard")} style={backBtn}>
          ← Back to Dashboard
        </button>
      </div>
    );
  }

  async function fetchHierarchyAndRates() {
    setLoading(true);
    try {
      // Load global rates
      const rateSnap = await getDoc(doc(db, "settings", "incomeRates"));
      let dbRates: Record<string, any> = {};
      if (rateSnap.exists()) dbRates = rateSnap.data().rates || {};

      const mergedHeads = DEFAULT_HEADS.map(h => ({
        ...h,
        rate:     dbRates[h.id]?.rate     !== undefined ? dbRates[h.id].rate     : h.rate,
        rateType: dbRates[h.id]?.rateType !== undefined ? dbRates[h.id].rateType : h.rateType,
      }));
      setBaseHeads(mergedHeads);
      setEditingRates(mergedHeads);
      setIncomeHeads(mergedHeads.map(h => ({ ...h, value: "", computed: 0 })));

      // Load divisions
      let divSnap;
      if (["superadmin", "circle_admin", "region_admin"].includes(profile?.role || "")) {
        divSnap = await getDocs(collection(db, "divisions"));
      } else {
        divSnap = await getDocs(query(collection(db, "divisions"),
          where("code", "==", profile?.divisionCode)));
      }
      setDivisions(divSnap.docs.map(d => ({ id: d.id, ...d.data(), _collection: "divisions" })));

      const [subSnap, offSnap] = await Promise.all([
        getDocs(collection(db, "subdivisions")),
        getDocs(collection(db, "offices")),
      ]);
      setAllOffices([
        ...subSnap.docs.map(d => ({ id: d.id, ...d.data(), _collection: "subdivisions" })),
        ...offSnap.docs.map(d => ({ id: d.id, ...d.data(), _collection: "offices" })),
      ]);

      if (profile?.role === "division_admin" && profile.divisionCode) {
        setSelectedDiv(profile.divisionCode);
      }
    } catch (e: any) { showToast("Error: " + e.message); }
    finally { setLoading(false); }
  }

  async function saveGlobalRates() {
    try {
      const ratesToSave: Record<string, any> = {};
      editingRates.forEach(h => {
        ratesToSave[h.id] = { rate: h.rate, rateType: h.rateType };
      });
      await setDoc(doc(db, "settings", "incomeRates"),
        { rates: ratesToSave, updatedAt: serverTimestamp() },
        { merge: true });
      setBaseHeads(editingRates);
      setShowSettings(false);
      showToast("✅ Global rates updated!");
      if (!existingData) setIncomeHeads(editingRates.map(h => ({ ...h, value: "", computed: 0 })));
    } catch (e: any) { showToast("Error: " + e.message); }
  }

  function handleRateEdit(id: string, field: "rate" | "rateType", val: any) {
    setEditingRates(prev => prev.map(h => h.id === id ? { ...h, [field]: val } : h));
  }

  async function checkExisting(scope: string, month: string) {
    const key = `${scope}_${month.replace("-", "")}`;
    try {
      const snap = await getDoc(doc(db, "income", key));
      if (snap.exists()) {
        const data = snap.data();
        setExistingData(data);
        setIncomeHeads(baseHeads.map(h => {
          const ledger = data.officeWiseLedger?.[h.id] || [];
          return {
            ...h,
            value:      String(data.heads?.[h.id] || ""),
            computed:   data.computedHeads?.[h.id] || computeIncome(h.id, String(data.heads?.[h.id] || ""), h.rate, h.rateType),
            ledgerData: ledger,
            fileName:   ledger.length > 0 ? `Saved (${ledger.length} offices)` : undefined,
          };
        }));
        if (data.customHeads) setCustomHeads(data.customHeads.map((h: any) => ({
          ...h, value: String(h.value || ""), computed: h.computed || 0
        })));
      } else {
        setExistingData(null);
        setIncomeHeads(baseHeads.map(h => ({ ...h, value: "", computed: 0 })));
        setCustomHeads([]);
      }
    } catch (e) { console.error(e); }
  }

  function computeIncome(headId: string, rawValue: string | number, rate?: number, rateType?: string): number {
    const num = typeof rawValue === "string" ? parseFloat(rawValue) : rawValue;
    if (isNaN(num) || num === 0) return 0;
    let computed = num;
    if (rate) {
      if (rateType === "percentage")  computed = num * (rate / 100);
      else if (rateType === "multiplier") computed = num * rate;
    }
    if (["posb_live", "posb_silent", "certificates"].includes(headId)) {
      computed = computed / 12;
    }
    return Math.round(computed * 100) / 100;
  }

  function updateHead(id: string, value: string) {
    setIncomeHeads(prev => prev.map(h =>
      h.id === id ? { ...h, value, computed: computeIncome(h.id, value, h.rate, h.rateType) } : h
    ));
  }

  function downloadTemplate() {
    import("xlsx").then(XLSX => {
      const ws = XLSX.utils.json_to_sheet([
        { office_code: "12660179", office_name: "Mukalmua S.O", amount: 500 },
        { office_code: "12100675", office_name: "Adabari B.O",  amount: 150 },
      ]);
      ws["!cols"] = [{ wch: 15 }, { wch: 25 }, { wch: 12 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Template");
      XLSX.writeFile(wb, "Income_Upload_Template.xlsx");
    });
  }

  async function handleFileUpload(id: string, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const XLSX = await import("xlsx");
      const reader = new FileReader();
      reader.onload = (evt) => {
        const wb   = XLSX.read(evt.target?.result, { type: "binary" });
        const rows: any[] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
        let added = 0, skipped = 0;
        setIncomeHeads(prev => prev.map(h => {
          if (h.id !== id) return h;
          const currentLedger  = h.ledgerData || [];
          const existingCodes  = new Set(currentLedger.map((r: any) => String(r.officeCode)));
          const newLedger      = [...currentLedger];
          for (const row of rows) {
            const code = String(row.office_code || row["Office Code"] || row.bo_id || row.so_id || "").trim();
            const name = String(row.office_name || row["Office Name"] || row.bo_name || "").trim();
            const val  = Number(row.amount || row.count || row.value || 0);
            if (code && !isNaN(val)) {
              if (existingCodes.has(code)) { skipped++; continue; }
              newLedger.push({ officeCode: code, officeName: name, value: val,
                computedIncome: computeIncome(h.id, val, h.rate, h.rateType) });
              existingCodes.add(code);
              added++;
            }
          }
          const totalRaw      = newLedger.reduce((s, r) => s + r.value, 0);
          const totalComputed = newLedger.reduce((s, r) => s + r.computedIncome, 0);
          return { ...h, value: String(totalRaw), computed: totalComputed, ledgerData: newLedger,
            fileName: `${newLedger.length} offices` };
        }));
        showToast(skipped > 0
          ? `⚠️ Added ${added}, skipped ${skipped} duplicates`
          : `✅ ${added} offices loaded`);
      };
      reader.readAsBinaryString(file);
      e.target.value = "";
    } catch (err: any) { showToast("Error: " + err.message); }
  }

  function requestRemoveLedgerRow(headId: string, officeCode: string) {
    setDeletePrompt({ action: "row", headId, officeCode,
      message: `Remove office ${officeCode} from this income head?` });
  }

  function requestClearHead(headId: string) {
    setDeletePrompt({ action: "head", headId,
      message: "Delete ALL uploaded data for this income head?" });
  }

  async function executeDelete() {
    if (!deletePrompt) return;
    if (deletePrompt.action === "row" && deletePrompt.headId && deletePrompt.officeCode) {
      setIncomeHeads(prev => prev.map(h => {
        if (h.id !== deletePrompt.headId || !h.ledgerData) return h;
        const updated      = h.ledgerData.filter((r: any) => r.officeCode !== deletePrompt.officeCode);
        const totalRaw     = updated.reduce((s: number, r: any) => s + r.value, 0);
        const totalComputed= updated.reduce((s: number, r: any) => s + r.computedIncome, 0);
        return { ...h, ledgerData: updated, value: String(totalRaw), computed: totalComputed,
          fileName: updated.length === 0 ? undefined : `${updated.length} offices` };
      }));
    } else if (deletePrompt.action === "head" && deletePrompt.headId) {
      setIncomeHeads(prev => prev.map(h =>
        h.id === deletePrompt.headId
          ? { ...h, value: "", computed: 0, ledgerData: undefined, fileName: undefined }
          : h
      ));
      if (expandedHeadId === deletePrompt.headId) setExpandedHeadId(null);
    } else if (deletePrompt.action === "month") {
      try {
        // Delete income
        await deleteDoc(doc(db, "income", scopeKey));

        // Also delete ECR documents for this scope and month
        const ecrSnap = await getDocs(
          query(collection(db, "ecr"),
            where("month", "==", selectedMonth),
            selectedSubDiv
              ? where("subDivCode", "==", selectedSubDiv)
              : where("divisionCode", "==", selectedDiv)
          )
        );
        for (const d of ecrSnap.docs) {
          await deleteDoc(doc(db, "ecr", d.id));
        }

        setExistingData(null);
        setIncomeHeads(baseHeads.map(h => ({ ...h, value: "", computed: 0 })));
        setCustomHeads([]);
        showToast(`🗑️ Income + ECR data deleted for ${monthLabel(selectedMonth)}`);
      } catch (e: any) { showToast("Error: " + e.message); }
    }
    setDeletePrompt(null);
  }

  function updateCustomHead(idx: number, field: string, value: any) {
    setCustomHeads(prev => prev.map((h, i) => {
      if (i !== idx) return h;
      const updated = { ...h, [field]: value };
      if (["value", "rate", "rateType"].includes(field)) {
        updated.computed = computeIncome("custom", updated.value, updated.rate, updated.rateType);
      }
      return updated;
    }));
  }

  const totalIncome = [
    ...incomeHeads.map(h => h.computed),
    ...customHeads.map(h => h.computed),
  ].reduce((a, b) => a + b, 0);

  const scope    = selectedSubDiv || selectedDiv;
  const scopeKey = scope ? `${scope}_${selectedMonth.replace("-", "")}` : "";

  async function handleSave() {
    if (!scope || !selectedMonth) { showToast("Select Division and month"); return; }
    setSaving(true);
    try {
      const headsMap:        Record<string, number>  = {};
      const computedHeadsMap:Record<string, number>  = {};
      const officeWiseLedger:Record<string, any[]>   = {};

      incomeHeads.forEach(h => {
        headsMap[h.id]         = parseFloat(h.value) || 0;
        computedHeadsMap[h.id] = h.computed;
        if (h.ledgerData && h.ledgerData.length > 0) officeWiseLedger[h.id] = h.ledgerData;
      });

      const mappedOffices = allOffices
        .filter((o: any) => o._collection === "offices" &&
          (selectedSubDiv ? o.subDivCode === selectedSubDiv : o.divisionCode === selectedDiv))
        .map((o: any) => o.id || o.code);

      await setDoc(doc(db, "income", scopeKey), {
        scopeCode:      scope,
        divisionCode:   selectedDiv,
        subDivCode:     selectedSubDiv || null,
        month:          selectedMonth,
        heads:          headsMap,
        computedHeads:  computedHeadsMap,
        officeWiseLedger,
        customHeads:    customHeads.map(h => ({ ...h, value: parseFloat(h.value) || 0 })),
        totalIncome:    Math.round(totalIncome * 100) / 100,
        mappedOffices,
        submittedBy:    profile?.uid,
        submittedByName:profile?.name,
        submittedAt:    serverTimestamp(),
        updatedAt:      serverTimestamp(),
      });

      showToast(`✅ Saved for ${monthLabel(selectedMonth)}`);
      checkExisting(scope, selectedMonth);
    } catch (e: any) { showToast("Error: " + e.message); }
    finally { setSaving(false); }
  }

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(""), 4000); }

  const monthLabel = (m: string) => {
    if (!m) return "";
    const [y, mo] = m.split("-");
    return new Date(+y, +mo - 1).toLocaleString("default", { month: "long", year: "numeric" });
  };

  const filteredSubDivs = allOffices.filter((o: any) =>
    o._collection === "subdivisions" && o.divisionCode === selectedDiv
  );

  return (
    <div style={{ paddingBottom: 80,
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>

      {/* Header */}
      <div style={{ background: "linear-gradient(135deg, #0D47A1, #1E88E5)",
        padding: "16px 16px 20px", color: "#fff" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 4px" }}>Income Data Entry</h1>
            <div style={{ fontSize: 13, opacity: 0.85 }}>
              Division-level batch entry — data flows to all offices
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column" as const, gap: 8, alignItems: "flex-end" }}>
            <button onClick={() => router.push("/dashboard")} style={headerBtn}>← Back</button>
            {profile?.role === "superadmin" && (
              <button onClick={() => setShowSettings(true)} style={headerBtn}>⚙️ Rates</button>
            )}
          </div>
        </div>
      </div>

      <div style={{ padding: "12px 12px 0" }}>

        {/* Step 1 */}
        <div style={card}>
          <div style={sectionHead}>Step 1 — Select Division & Month</div>

          <div style={{ marginBottom: 10 }}>
            <label style={labelStyle}>Division Office *</label>
            {loading ? (
              <div style={{ fontSize: 13, color: "#A0AEC0", padding: 8 }}>Loading…</div>
            ) : (
              <select style={inputStyle} value={selectedDiv}
                onChange={e => setSelectedDiv(e.target.value)}
                disabled={profile?.role === "division_admin"}>
                <option value="">— Select Division —</option>
                {divisions.map((d: any) => (
                  <option key={d.id} value={d.id}>{d.id} — {d.name}</option>
                ))}
              </select>
            )}
          </div>

          {selectedDiv && (
            <div style={{ marginBottom: 10 }}>
              <label style={labelStyle}>Sub Division (optional)</label>
              <select style={inputStyle} value={selectedSubDiv}
                onChange={e => setSelectedSubDiv(e.target.value)}>
                <option value="">— All Sub Divisions under {selectedDiv} —</option>
                {filteredSubDivs.map((s: any) => (
                  <option key={s.id} value={s.id}>{s.id} — {s.name}</option>
                ))}
              </select>
            </div>
          )}

          {selectedDiv && (
            <div style={{ marginBottom: 10 }}>
              <label style={labelStyle}>Month & Year *</label>
              <input type="month" style={inputStyle} value={selectedMonth}
                onChange={e => setSelectedMonth(e.target.value)} />
            </div>
          )}

          {/* Scope info */}
          {scope && (
            <div style={{ padding: "8px 12px", background: "#EBF8FF",
              borderRadius: 8, fontSize: 12, color: "#2B6CB0", marginBottom: 10 }}>
              📋 Scope: <strong>{scope}</strong> · {monthLabel(selectedMonth)}
              <br />🏢 {mappedCount} offices will receive this data
            </div>
          )}

          {/* Existing data warning */}
          {existingData && (
            <div style={{ padding: "10px 12px", background: "#FFFBEB",
              border: "1px solid #FCD34D", borderRadius: 8, fontSize: 13 }}>
              <strong style={{ color: "#92400E" }}>
                ℹ️ Editing existing data for {monthLabel(selectedMonth)}
              </strong>
              <div style={{ fontSize: 12, color: "#78350F", marginTop: 2 }}>
                You can update values or upload additional office data below.
              </div>
              {CAN_DELETE_ROLES.includes(profile?.role || "") && (
                <button
                  onClick={() => setDeletePrompt({
                    action: "month",
                    message: `Delete ALL income data for ${monthLabel(selectedMonth)}? ECR will also be deleted. This cannot be undone.`
                  })}
                  style={{ marginTop: 8, padding: "6px 14px", background: "#FEE2E2",
                    color: "#C53030", border: "1px solid #FC8181",
                    borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                  🗑️ Delete & Re-enter
                </button>
              )}
            </div>
          )}
        </div>

        {/* Step 2 — Income heads */}
        {scope && (
          <>
            <div style={card}>
              <div style={{ display: "flex", justifyContent: "space-between",
                alignItems: "center", marginBottom: 14 }}>
                <div style={sectionHead}>Step 2 — Standard Income Heads</div>
                <button onClick={downloadTemplate}
                  style={{ fontSize: 12, background: "none", border: "none",
                    color: "#1565C0", fontWeight: 600, cursor: "pointer" }}>
                  📥 Template
                </button>
              </div>

              {incomeHeads.map(head => (
                <div key={head.id} style={{ marginBottom: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between",
                    alignItems: "center", marginBottom: 4 }}>
                    <label style={labelStyle}>
                      {head.label}
                      {head.rateType === "percentage" && head.rate !== undefined && (
                        <span style={{ color: "#718096", fontSize: 11, marginLeft: 6 }}>
                          ({head.rate}%)
                        </span>
                      )}
                      {head.rateType === "multiplier" && head.rate !== undefined && (
                        <span style={{ color: "#718096", fontSize: 11, marginLeft: 6 }}>
                          (× ₹{head.rate})
                        </span>
                      )}
                      {["posb_live", "posb_silent", "certificates"].includes(head.id) && (
                        <span style={{ color: "#D97706", fontSize: 10, fontWeight: "bold",
                          marginLeft: 8, background: "#FEF3C7",
                          padding: "1px 5px", borderRadius: 4 }}>
                          /12
                        </span>
                      )}
                    </label>
                    {head.computed > 0 && (
                      <span style={{ fontSize: 13, color: "#0F766E", fontWeight: 700 }}>
                        = ₹{head.computed.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                      </span>
                    )}
                  </div>

                  <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
                    {head.ledgerData && head.ledgerData.length > 0 ? (
                      <div style={{ flex: 1, display: "flex", alignItems: "center",
                        justifyContent: "space-between", background: "#F0FFF4",
                        padding: "8px 12px", border: "1px solid #9AE6B4", borderRadius: 8 }}>
                        <div>
                          <div style={{ fontSize: 13, color: "#276749", fontWeight: 600 }}>
                            {head.ledgerData.length} Offices Uploaded
                          </div>
                          <div style={{ fontSize: 11, color: "#2F855A" }}>
                            Total: {head.value}
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button
                            onClick={() => setExpandedHeadId(
                              expandedHeadId === head.id ? null : head.id
                            )}
                            style={actionBtn("#2B6CB0")}>
                            {expandedHeadId === head.id ? "Hide" : "View"}
                          </button>
                          <button onClick={() => requestClearHead(head.id)}
                            style={actionBtn("#C53030")}>
                            Clear
                          </button>
                        </div>
                      </div>
                    ) : (
                      <input type="number" min="0"
                        style={{ ...inputStyle, flex: 1, marginBottom: 0 }}
                        value={head.value}
                        onChange={e => updateHead(head.id, e.target.value)}
                        placeholder={head.type === "count"
                          ? "Manual total OR upload Excel →"
                          : "Manual amount OR upload Excel →"} />
                    )}

                    <label style={uploadBtnStyle}>
                      📤 {head.ledgerData && head.ledgerData.length > 0 ? "Add More" : "Upload"}
                      <input type="file" accept=".xlsx,.xls"
                        style={{ display: "none" }}
                        onChange={e => handleFileUpload(head.id, e)} />
                    </label>
                  </div>

                  {/* Ledger table */}
                  {expandedHeadId === head.id && head.ledgerData && (
                    <div style={{ marginTop: 8, maxHeight: 250, overflowY: "auto",
                      border: "1px solid #E2E8F0", borderRadius: 8, background: "#fff" }}>
                      <table style={{ width: "100%", fontSize: 12,
                        textAlign: "left" as const, borderCollapse: "collapse" }}>
                        <thead style={{ background: "#EDF2F7",
                          position: "sticky" as const, top: 0, zIndex: 10 }}>
                          <tr>
                            {["Code", "Office Name", "Value", "Income ₹", ""].map(h => (
                              <th key={h} style={{ padding: "7px 10px", color: "#4A5568",
                                fontWeight: 700 }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {head.ledgerData.map((row: any) => (
                            <tr key={row.officeCode}
                              style={{ borderBottom: "1px solid #E2E8F0" }}>
                              <td style={{ padding: "7px 10px", fontWeight: 500 }}>
                                {row.officeCode}
                              </td>
                              <td style={{ padding: "7px 10px", color: "#718096" }}>
                                {row.officeName || "—"}
                              </td>
                              <td style={{ padding: "7px 10px", fontWeight: 600 }}>
                                {row.value}
                              </td>
                              <td style={{ padding: "7px 10px", fontWeight: 700,
                                color: "#0F766E" }}>
                                ₹{(row.computedIncome || 0).toLocaleString("en-IN",
                                  { maximumFractionDigits: 2 })}
                              </td>
                              <td style={{ padding: "7px 10px", textAlign: "right" as const }}>
                                <button
                                  onClick={() => requestRemoveLedgerRow(head.id, row.officeCode)}
                                  style={{ color: "#E53E3E", background: "none",
                                    border: "none", cursor: "pointer", fontSize: 14 }}>
                                  🗑️
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Custom heads */}
            <div style={card}>
              <div style={sectionHead}>Additional Manual Heads</div>
              {customHeads.map((head, idx) => (
                <div key={head.id} style={{ marginBottom: 14, padding: 12,
                  border: "1px solid #E2E8F0", borderRadius: 8, background: "#F7FAFC" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                    <input type="text" placeholder="Income head name"
                      style={{ ...inputStyle, width: "80%" }}
                      value={head.label}
                      onChange={e => updateCustomHead(idx, "label", e.target.value)} />
                    <button onClick={() => setCustomHeads(prev => prev.filter((_, i) => i !== idx))}
                      style={{ color: "#DC2626", background: "none", border: "none",
                        fontWeight: 700, cursor: "pointer", fontSize: 18 }}>✕</button>
                  </div>
                  <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 11, color: "#718096" }}>Rate Type</label>
                      <select style={inputStyle} value={head.rateType || "percentage"}
                        onChange={e => updateCustomHead(idx, "rateType", e.target.value)}>
                        <option value="percentage">Percentage (%)</option>
                        <option value="multiplier">Per unit (×)</option>
                      </select>
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 11, color: "#718096" }}>Rate</label>
                      <input type="number" style={inputStyle} value={head.rate || ""}
                        onChange={e => updateCustomHead(idx, "rate", parseFloat(e.target.value) || 0)} />
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input type="number" placeholder="Amount"
                      style={{ ...inputStyle, flex: 1 }}
                      value={head.value}
                      onChange={e => updateCustomHead(idx, "value", e.target.value)} />
                    {head.computed > 0 && (
                      <span style={{ fontSize: 13, color: "#0F766E",
                        fontWeight: 700, minWidth: 90 }}>
                        = ₹{head.computed.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                      </span>
                    )}
                  </div>
                </div>
              ))}
              <button
                onClick={() => setCustomHeads(prev => [...prev, {
                  id: `custom_${Date.now()}`, label: "", type: "amount",
                  rate: 100, rateType: "percentage", isProportionate: false,
                  value: "", computed: 0
                }])}
                style={{ width: "100%", padding: 10, background: "#EBF8FF",
                  color: "#1565C0", border: "2px dashed #BEE3F8", borderRadius: 8,
                  fontWeight: 600, cursor: "pointer", fontSize: 13 }}>
                + Add Manual Head
              </button>
            </div>

            {/* Total */}
            <div style={{ ...card, border: "2px solid #1565C0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontSize: 13, color: "#718096", fontWeight: 600 }}>TOTAL INCOME</div>
                  <div style={{ fontSize: 11, color: "#A0AEC0" }}>{monthLabel(selectedMonth)}</div>
                </div>
                <div style={{ fontSize: 28, fontWeight: 700, color: "#1565C0" }}>
                  ₹{totalIncome.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                </div>
              </div>
            </div>

            <button onClick={handleSave} disabled={saving} style={{
              width: "100%", padding: 14,
              background: saving ? "#90CDF4" : "#1565C0",
              color: "#fff", border: "none", borderRadius: 10,
              fontSize: 15, fontWeight: 700,
              cursor: saving ? "not-allowed" : "pointer", marginBottom: 12
            }}>
              {saving ? "Saving…"
                : existingData
                  ? `Update Income — ${monthLabel(selectedMonth)}`
                  : `Save Income — ${monthLabel(selectedMonth)}`}
            </button>
          </>
        )}
      </div>

      {/* Settings Modal */}
      {showSettings && (
        <div style={modalOverlay}>
          <div style={{ ...modalContent, maxWidth: 500, textAlign: "left" as const }}>
            <div style={{ display: "flex", justifyContent: "space-between",
              alignItems: "center", marginBottom: 16 }}>
              <h3 style={{ margin: 0 }}>⚙️ Global Income Rates</h3>
              <button onClick={() => setShowSettings(false)}
                style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer" }}>
                ✕
              </button>
            </div>
            <p style={{ fontSize: 13, color: "#718096", marginBottom: 16 }}>
              Changes apply globally to all divisions for future income calculations.
            </p>
            <div style={{ maxHeight: "60vh", overflowY: "auto" as const,
              paddingRight: 8, marginBottom: 16 }}>
              {editingRates.map(head => (
                <div key={head.id} style={{ marginBottom: 12, padding: 10,
                  background: "#F7FAFC", border: "1px solid #E2E8F0", borderRadius: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#2D3748", marginBottom: 8 }}>
                    {head.label}
                  </div>
                  <div style={{ display: "flex", gap: 10 }}>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 10, color: "#718096" }}>RATE TYPE</label>
                      <select style={{ ...inputStyle, padding: "6px" }}
                        value={head.rateType || "percentage"}
                        onChange={e => handleRateEdit(head.id, "rateType", e.target.value)}>
                        <option value="percentage">Percentage (%)</option>
                        <option value="multiplier">Per unit (×)</option>
                      </select>
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 10, color: "#718096" }}>RATE</label>
                      <input type="number" style={{ ...inputStyle, padding: "6px" }}
                        value={head.rate !== undefined ? head.rate : ""}
                        onChange={e => handleRateEdit(head.id, "rate", parseFloat(e.target.value) || 0)} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <button onClick={saveGlobalRates} style={{
              width: "100%", padding: 12, background: "#1565C0", color: "#fff",
              border: "none", borderRadius: 8, fontWeight: 700, cursor: "pointer"
            }}>
              💾 Save Global Rates
            </button>
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {deletePrompt && (
        <div style={modalOverlay}>
          <div style={{ ...modalContent, textAlign: "center" as const }}>
            <div style={{ fontSize: 36, marginBottom: 10 }}>⚠️</div>
            <h3 style={{ margin: "0 0 10px", color: "#C53030" }}>Confirm Deletion</h3>
            <p style={{ margin: 0, color: "#4A5568", fontSize: 14, lineHeight: 1.6 }}>
              {deletePrompt.message}
            </p>
            <div style={{ display: "flex", gap: 12, marginTop: 20 }}>
              <button onClick={() => setDeletePrompt(null)} style={{
                flex: 1, padding: 10, background: "#E2E8F0", color: "#4A5568",
                border: "none", borderRadius: 8, fontWeight: 600, cursor: "pointer"
              }}>
                Cancel
              </button>
              <button onClick={executeDelete} style={{
                flex: 1, padding: 10, background: "#E53E3E", color: "#fff",
                border: "none", borderRadius: 8, fontWeight: 600, cursor: "pointer"
              }}>
                Yes, Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div style={{ position: "fixed", bottom: 80, left: "50%",
          transform: "translateX(-50%)", background: "#2D3748", color: "#fff",
          padding: "10px 20px", borderRadius: 24, fontSize: 13,
          fontWeight: 500, zIndex: 300, whiteSpace: "nowrap" as const }}>
          {toast}
        </div>
      )}

      <BottomNav />
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────
const card: React.CSSProperties = {
  background: "#fff", border: "1px solid #E2E8F0",
  borderRadius: 12, padding: 16, marginBottom: 12
};
const sectionHead: React.CSSProperties = {
  fontSize: 13, fontWeight: 700, color: "#718096",
  textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 14
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
const headerBtn: React.CSSProperties = {
  background: "rgba(255,255,255,0.2)", border: "1px solid rgba(255,255,255,0.4)",
  color: "#fff", borderRadius: 8, padding: "7px 14px",
  fontSize: 12, fontWeight: 600, cursor: "pointer"
};
const uploadBtnStyle: React.CSSProperties = {
  background: "#EBF8FF", color: "#2B6CB0", border: "1px solid #90CDF4",
  borderRadius: 8, padding: "0 12px", display: "flex", alignItems: "center",
  fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" as const
};
const accessDenied: React.CSSProperties = {
  minHeight: "100vh", display: "flex", flexDirection: "column",
  alignItems: "center", justifyContent: "center",
  padding: 24, textAlign: "center", background: "#FFF5F5",
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
};
const backBtn: React.CSSProperties = {
  marginTop: 20, padding: "10px 20px", background: "#1565C0",
  color: "#fff", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: "pointer"
};
const actionBtn = (color: string): React.CSSProperties => ({
  background: "none", border: `1px solid ${color}`, borderRadius: 6,
  color, fontSize: 11, fontWeight: 600, cursor: "pointer", padding: "4px 8px"
});
const modalOverlay: React.CSSProperties = {
  position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
  background: "rgba(0,0,0,0.5)", display: "flex",
  alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20
};
const modalContent: React.CSSProperties = {
  background: "#fff", padding: 24, borderRadius: 12,
  width: "100%", maxWidth: 400, boxShadow: "0 10px 25px rgba(0,0,0,0.1)"
};