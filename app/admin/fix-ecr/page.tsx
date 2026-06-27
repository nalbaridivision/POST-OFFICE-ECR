"use client";

import { useState } from "react";
import { useAuth } from "../../../context/AuthContext";
import { useRouter } from "next/navigation";
import { db } from "../../firebase";
import {
  collection, getDocs, doc,
  updateDoc, getDoc, deleteDoc, query, where
} from "firebase/firestore";

export default function FixECRPage() {
  const { profile } = useAuth();
  const router = useRouter();

  const [running,     setRunning]     = useState(false);
  const [log,         setLog]         = useState<string[]>([]);
  const [done,        setDone]        = useState(false);
  const [activeTab,   setActiveTab]   = useState<"fix" | "delete">("fix");

  // Delete by month state
  const [delMonth,    setDelMonth]    = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
  });
  const [delScope,    setDelScope]    = useState<"month" | "all">("month");
  const [delConfirm,  setDelConfirm]  = useState(false);

  if (profile && profile.role !== "superadmin") {
    return (
      <div style={{ padding: 24, textAlign: "center" as const }}>
        <h2 style={{ color: "#C53030" }}>Superadmin only</h2>
        <button onClick={() => router.push("/dashboard")}
          style={{ marginTop: 16, padding: "10px 20px", background: "#1565C0",
            color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" }}>
          ← Back
        </button>
      </div>
    );
  }

  function addLog(msg: string) {
    setLog(prev => [...prev, msg]);
  }

  // ── FIX ECR HIERARCHY ──────────────────────────────────────────
  async function fixAllECR() {
    setRunning(true); setLog([]); setDone(false);
    try {
      addLog("📂 Loading all offices...");
      const officeSnap = await getDocs(collection(db, "offices"));
      const officeMap: Record<string, any> = {};
      officeSnap.forEach(d => { officeMap[d.id] = d.data(); });
      addLog(`✅ Loaded ${Object.keys(officeMap).length} offices`);

      addLog("📂 Loading circles...");
      const circleSnap = await getDocs(collection(db, "circles"));
      const circleNameToCode: Record<string, string> = {};
      circleSnap.forEach(d => {
        const data = d.data();
        if (data.name) circleNameToCode[data.name] = d.id;
        if (data.code) circleNameToCode[data.code] = d.id;
      });
      addLog(`✅ Loaded ${circleSnap.size} circles`);

      addLog("📂 Loading ECR documents...");
      const ecrSnap = await getDocs(collection(db, "ecr"));
      addLog(`📋 Found ${ecrSnap.size} ECR documents`);

      let fixed = 0, skipped = 0, errors = 0;

      for (const ecrDoc of ecrSnap.docs) {
        const ecrData  = ecrDoc.data();
        const officeCode = ecrData.officeCode;
        if (!officeCode) { skipped++; continue; }

        const office = officeMap[officeCode];
        if (!office) { skipped++; continue; }

        let circleCode = office.circleCode || null;
        if (circleCode && circleNameToCode[circleCode]) {
          circleCode = circleNameToCode[circleCode];
        }

        const updates: Record<string, any> = {
          officeName:   office.name         || officeCode,
          circleCode:   circleCode,
          regionId:     office.regionId     || null,
          divisionCode: office.divisionCode || null,
          subDivCode:   office.subDivCode   || null,
          hoCode:       office.hoCode       || null,
          soCode:       office.soCode       || null,
        };

        const needsUpdate =
          ecrData.circleCode   !== circleCode          ||
          ecrData.regionId     !== (office.regionId    || null) ||
          ecrData.divisionCode !== (office.divisionCode|| null) ||
          ecrData.subDivCode   !== (office.subDivCode  || null) ||
          ecrData.officeName   !== office.name;

        if (!needsUpdate) { skipped++; continue; }

        try {
          await updateDoc(doc(db, "ecr", ecrDoc.id), updates);
          addLog(`✅ Fixed: ${ecrDoc.id} → circleCode: ${circleCode}`);
          fixed++;
        } catch (e: any) {
          addLog(`❌ Error: ${ecrDoc.id}: ${e.message}`);
          errors++;
        }
      }

      addLog("─────────────────────────────");
      addLog(`✅ Done! Fixed: ${fixed} | Skipped: ${skipped} | Errors: ${errors}`);
      setDone(true);
    } catch (e: any) { addLog(`❌ Fatal: ${e.message}`); }
    finally { setRunning(false); }
  }

  // ── DELETE ECR ────────────────────────────────────────────────
  async function deleteECR() {
    setRunning(true); setLog([]); setDone(false); setDelConfirm(false);
    try {
      let snap;
      if (delScope === "month") {
        addLog(`🗑️ Deleting ECR for month: ${delMonth}...`);
        snap = await getDocs(
          query(collection(db, "ecr"), where("month", "==", delMonth))
        );
      } else {
        addLog("🗑️ Deleting ALL ECR documents...");
        snap = await getDocs(collection(db, "ecr"));
      }

      addLog(`📋 Found ${snap.size} documents to delete`);
      let deleted = 0, errors = 0;

      for (const d of snap.docs) {
        try {
          await deleteDoc(doc(db, "ecr", d.id));
          addLog(`✅ Deleted: ${d.id}`);
          deleted++;
        } catch (e: any) {
          addLog(`❌ Error deleting ${d.id}: ${e.message}`);
          errors++;
        }
      }

      addLog("─────────────────────────────");
      addLog(`✅ Done! Deleted: ${deleted} | Errors: ${errors}`);
      setDone(true);
    } catch (e: any) { addLog(`❌ Fatal: ${e.message}`); }
    finally { setRunning(false); }
  }

  return (
    <div style={{ maxWidth: 600, margin: "0 auto", padding: 16,
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>

      {/* Header */}
      <div style={{ background: "linear-gradient(135deg, #0D47A1, #1E88E5)",
        borderRadius: 12, padding: "16px 20px", color: "#fff", marginBottom: 16 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 4px" }}>
          🔧 ECR Admin Tools
        </h1>
        <div style={{ fontSize: 13, opacity: .85 }}>Superadmin only</div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", marginBottom: 16, borderRadius: 10,
        overflow: "hidden", border: "1px solid #E2E8F0" }}>
        <button onClick={() => { setActiveTab("fix"); setLog([]); setDone(false); }}
          style={{ flex: 1, padding: "10px", border: "none", cursor: "pointer",
            fontWeight: 700, fontSize: 13,
            background: activeTab==="fix" ? "#1565C0" : "#fff",
            color:      activeTab==="fix" ? "#fff"    : "#718096" }}>
          🔧 Fix ECR Hierarchy
        </button>
        <button onClick={() => { setActiveTab("delete"); setLog([]); setDone(false); }}
          style={{ flex: 1, padding: "10px", border: "none", cursor: "pointer",
            fontWeight: 700, fontSize: 13,
            background: activeTab==="delete" ? "#DC2626" : "#fff",
            color:      activeTab==="delete" ? "#fff"    : "#718096" }}>
          🗑️ Delete ECR Data
        </button>
      </div>

      {/* FIX TAB */}
      {activeTab === "fix" && (
        <>
          <div style={{ background: "#FFFBEB", border: "1px solid #FCD34D",
            borderRadius: 10, padding: "12px 14px", marginBottom: 16, fontSize: 13 }}>
            <strong style={{ color: "#92400E" }}>What this does:</strong>
            <ul style={{ margin: "8px 0 0 16px", color: "#78350F", lineHeight: 1.8 }}>
              <li>Reads all ECR documents</li>
              <li>Looks up correct hierarchy codes from offices collection</li>
              <li>Updates circleCode, divisionCode, subDivCode etc.</li>
              <li>Safe to run multiple times</li>
            </ul>
          </div>

          {!running && (
            <button onClick={fixAllECR} style={{ width: "100%", padding: 14,
              background: "#1565C0", color: "#fff", border: "none",
              borderRadius: 10, fontSize: 15, fontWeight: 700,
              cursor: "pointer", marginBottom: 16 }}>
              🚀 Run Fix Now
            </button>
          )}
        </>
      )}

      {/* DELETE TAB */}
      {activeTab === "delete" && (
        <>
          <div style={{ background: "#FFF5F5", border: "1px solid #FC8181",
            borderRadius: 10, padding: "12px 14px", marginBottom: 16, fontSize: 13 }}>
            <strong style={{ color: "#C53030" }}>⚠️ Warning:</strong>
            <span style={{ color: "#7F1D1D" }}>
              {" "}Deleted ECR data cannot be recovered.
              You will need to re-submit income and expenditure to recalculate.
            </span>
          </div>

          {/* Delete scope */}
          <div style={{ background: "#fff", border: "1px solid #E2E8F0",
            borderRadius: 12, padding: 16, marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#718096",
              textTransform: "uppercase" as const, marginBottom: 14 }}>
              Select what to delete
            </div>

            <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
              <button onClick={() => setDelScope("month")} style={{
                flex: 1, padding: "10px", border: "1px solid",
                borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13,
                background: delScope==="month" ? "#1565C0" : "#fff",
                color:      delScope==="month" ? "#fff"    : "#718096",
                borderColor:delScope==="month" ? "#1565C0" : "#E2E8F0",
              }}>
                📅 By Month
              </button>
              <button onClick={() => setDelScope("all")} style={{
                flex: 1, padding: "10px", border: "1px solid",
                borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13,
                background: delScope==="all" ? "#DC2626" : "#fff",
                color:      delScope==="all" ? "#fff"    : "#718096",
                borderColor:delScope==="all" ? "#DC2626" : "#E2E8F0",
              }}>
                🗑️ Delete ALL
              </button>
            </div>

            {delScope === "month" && (
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 600,
                  color: "#4A5568", textTransform: "uppercase" as const,
                  marginBottom: 6 }}>
                  Select Month
                </label>
                <input type="month" value={delMonth}
                  onChange={e => setDelMonth(e.target.value)}
                  style={{ width: "100%", padding: "9px 11px", fontSize: 14,
                    border: "1.5px solid #E2E8F0", borderRadius: 8,
                    color: "#1A202C", background: "#fff",
                    boxSizing: "border-box" as const, outline: "none" }} />
              </div>
            )}

            {delScope === "all" && (
              <div style={{ background: "#FEE2E2", borderRadius: 8,
                padding: "10px 12px", marginBottom: 14, fontSize: 13, color: "#7F1D1D" }}>
                ⚠️ This will delete <strong>ALL ECR documents</strong> from the entire system.
              </div>
            )}

            {!delConfirm ? (
              <button onClick={() => setDelConfirm(true)} style={{
                width: "100%", padding: 12, background: "#DC2626", color: "#fff",
                border: "none", borderRadius: 10, fontSize: 14,
                fontWeight: 700, cursor: "pointer" }}>
                🗑️ Delete {delScope === "month" ? `ECR for ${delMonth}` : "ALL ECR Data"}
              </button>
            ) : (
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#C53030",
                  textAlign: "center" as const, marginBottom: 10 }}>
                  Are you sure? This cannot be undone.
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <button onClick={() => setDelConfirm(false)} style={{
                    flex: 1, padding: 10, background: "#E2E8F0", color: "#4A5568",
                    border: "none", borderRadius: 8, fontWeight: 600, cursor: "pointer" }}>
                    Cancel
                  </button>
                  <button onClick={deleteECR} style={{
                    flex: 1, padding: 10, background: "#DC2626", color: "#fff",
                    border: "none", borderRadius: 8, fontWeight: 600, cursor: "pointer" }}>
                    Yes, Delete
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* Running indicator */}
      {running && (
        <div style={{ width: "100%", padding: 14, background: "#EBF8FF",
          borderRadius: 10, fontSize: 14, fontWeight: 600, color: "#1D4ED8",
          textAlign: "center" as const, marginBottom: 16 }}>
          ⏳ Running… please wait
        </div>
      )}

      {/* Done buttons */}
      {done && !running && (
        <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
          <button onClick={() => router.push("/reports")} style={{
            flex: 2, padding: 12, background: "#16A34A", color: "#fff",
            border: "none", borderRadius: 10, fontSize: 14,
            fontWeight: 700, cursor: "pointer" }}>
            ✅ Go to Reports
          </button>
          <button onClick={() => { setLog([]); setDone(false); }} style={{
            flex: 1, padding: 12, background: "#E2E8F0", color: "#4A5568",
            border: "none", borderRadius: 10, fontSize: 14,
            fontWeight: 600, cursor: "pointer" }}>
            🔄 Again
          </button>
        </div>
      )}

      {/* Log output */}
      {log.length > 0 && (
        <div style={{ background: "#1A202C", borderRadius: 10, padding: 14,
          fontFamily: "monospace", fontSize: 12, color: "#E2E8F0",
          maxHeight: 400, overflowY: "auto" as const, lineHeight: 1.8 }}>
          {log.map((line, i) => (
            <div key={i} style={{
              color: line.startsWith("✅") ? "#86EFAC"
                : line.startsWith("❌") ? "#FCA5A5"
                : line.startsWith("⚠️") ? "#FDE68A"
                : line.startsWith("─") ? "#4A5568"
                : line.startsWith("🗑️") ? "#FCA5A5"
                : "#E2E8F0"
            }}>
              {line}
            </div>
          ))}
        </div>
      )}

      <button onClick={() => router.push("/dashboard")}
        style={{ width: "100%", marginTop: 12, padding: 10,
          background: "none", border: "1px solid #E2E8F0",
          borderRadius: 8, fontSize: 13, color: "#718096", cursor: "pointer" }}>
        ← Back to Dashboard
      </button>
    </div>
  );
}