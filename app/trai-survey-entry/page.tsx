"use client";
import { useState, useEffect, useMemo } from "react";
import { useAuth } from "../../context/AuthContext";
import { useRouter } from "next/navigation";
import { db } from "../firebase";
import {
  collection, getDocs, query, where, doc, setDoc
} from "firebase/firestore";
import BottomNav from "../../components/BottomNav";

interface VillageDoc {
  id: string; // {officeId}_{villageCode}
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

type FormState = {
  vil: number; rjil: number; bal: number; bsnl: number;
  overall4gStatus: string;
  viSimAvailable: number; airtelSimAvailable: number;
  bsnlSimAvailable: number; jioSimAvailable: number;
};

const EMPTY_FORM: FormState = {
  vil: 0, rjil: 0, bal: 0, bsnl: 0,
  overall4gStatus: "Present",
  viSimAvailable: 0, airtelSimAvailable: 0,
  bsnlSimAvailable: 0, jioSimAvailable: 0,
};

// Roles allowed to fill village survey data
const ENTRY_ROLES = ["office_user", "ho_admin", "so_admin"];

export default function VillageDataEntryPage() {
  const { profile, user } = useAuth();
  const router = useRouter();

  const [villages, setVillages] = useState<VillageDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState("");
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"pending" | "submitted">("pending");
  const [openVillageId, setOpenVillageId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const canEnter = ENTRY_ROLES.includes(profile?.role || "");
  const myOffice = (profile as any)?.officeId || (profile as any)?.officeCode || "";

  useEffect(() => {
    if (!user) { router.push("/"); return; }
    if (profile) {
      if (!ENTRY_ROLES.includes(profile.role || "")) {
        showToast("You don't have permission to access this page");
        router.push("/dashboard");
        return;
      }
      fetchVillages();
    }
  }, [user, profile]);

  function showToast(msg: string) {
    setToast(msg); setTimeout(() => setToast(""), 3500);
  }

  async function fetchVillages() {
    setLoading(true);
    try {
      const snap = await getDocs(
        query(collection(db, "traiSurveyData"), where("officeId", "==", myOffice))
      );
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as VillageDoc));
      setVillages(data.sort((a, b) => (a.villageName || "").localeCompare(b.villageName || "")));
    } catch (e: any) {
      showToast("Error: " + e.message);
    } finally {
      setLoading(false);
    }
  }

  const pendingCount = villages.filter(v => !v.dataSubmitted).length;
  const submittedCount = villages.filter(v => v.dataSubmitted).length;

  const displayVillages = useMemo(() => {
    let list = villages.filter(v => tab === "pending" ? !v.dataSubmitted : v.dataSubmitted);
    if (search) {
      const s = search.toLowerCase();
      list = list.filter(v =>
        (v.villageName || "").toLowerCase().includes(s) ||
        (v.villageCode || "").toLowerCase().includes(s)
      );
    }
    return list;
  }, [villages, tab, search]);

  function openForm(v: VillageDoc) {
    setOpenVillageId(v.id);
    setForm({
      vil: v.vil ?? 0,
      rjil: v.rjil ?? 0,
      bal: v.bal ?? 0,
      bsnl: v.bsnl ?? 0,
      overall4gStatus: v.overall4gStatus || "Present",
      viSimAvailable: v.viSimAvailable ?? 0,
      airtelSimAvailable: v.airtelSimAvailable ?? 0,
      bsnlSimAvailable: v.bsnlSimAvailable ?? 0,
      jioSimAvailable: v.jioSimAvailable ?? 0,
    });
  }

  function closeForm() {
    setOpenVillageId(null);
    setForm(EMPTY_FORM);
  }

  // M–P calculation: network present (1) but SIM not available (0) => procurement required
  function calcProcurement(network: number, simAvailable: number) {
    return (network === 1 && simAvailable === 0) ? 1 : 0;
  }

  async function handleSave() {
    if (!openVillageId) return;
    setSaving(true);
    try {
      const viProc = calcProcurement(form.vil, form.viSimAvailable);
      const airtelProc = calcProcurement(form.bal, form.airtelSimAvailable);
      const bsnlProc = calcProcurement(form.bsnl, form.bsnlSimAvailable);
      const jioProc = calcProcurement(form.rjil, form.jioSimAvailable);

      const ref = doc(db, "traiSurveyData", openVillageId);
      await setDoc(ref, {
        vil: form.vil,
        rjil: form.rjil,
        bal: form.bal,
        bsnl: form.bsnl,
        overall4gStatus: form.overall4gStatus,
        viSimAvailable: form.viSimAvailable,
        airtelSimAvailable: form.airtelSimAvailable,
        bsnlSimAvailable: form.bsnlSimAvailable,
        jioSimAvailable: form.jioSimAvailable,
        viSimProcurementRequired: viProc,
        airtelSimProcurementRequired: airtelProc,
        bsnlSimProcurementRequired: bsnlProc,
        jioSimProcurementRequired: jioProc,
        dataSubmitted: true,
        submittedBy: user?.uid || null,
        submittedByName: (profile as any)?.name || (profile as any)?.displayName || user?.email || null,
        submittedAt: new Date().toISOString(),
      }, { merge: true });

      // Update local state without refetching
      setVillages(prev => prev.map(v => v.id === openVillageId ? {
        ...v,
        ...form,
        viSimProcurementRequired: viProc,
        airtelSimProcurementRequired: airtelProc,
        bsnlSimProcurementRequired: bsnlProc,
        jioSimProcurementRequired: jioProc,
        dataSubmitted: true,
      } : v));

      showToast("✅ Saved!");
      closeForm();
    } catch (e: any) {
      showToast("Error saving: " + e.message);
    } finally {
      setSaving(false);
    }
  }

  function toggle(key: keyof FormState) {
    setForm(f => ({ ...f, [key]: f[key] === 1 ? 0 : 1 }));
  }

  if (!canEnter) return null;

  const openVillage = villages.find(v => v.id === openVillageId);

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
              Village Survey — Data Entry
            </h1>
            <div style={{ fontSize: 13, opacity: .85 }}>
              {villages.length} villages under your office
            </div>
          </div>
          <button onClick={() => router.push("/dashboard")} style={hBtn}>← Back</button>
        </div>
      </div>

      <div style={{ padding: "12px 12px 0" }}>

        {/* Summary */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
          <div style={{ background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 10, padding: "10px 12px", textAlign: "center" as const }}>
            <div style={{ fontSize: 9, color: "#B45309", fontWeight: 700, textTransform: "uppercase" as const }}>Pending</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#B45309" }}>{pendingCount}</div>
          </div>
          <div style={{ background: "#F0FFF4", border: "1px solid #9AE6B4", borderRadius: 10, padding: "10px 12px", textAlign: "center" as const }}>
            <div style={{ fontSize: 9, color: "#15803D", fontWeight: 700, textTransform: "uppercase" as const }}>Submitted</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#15803D" }}>{submittedCount}</div>
          </div>
        </div>

        {/* Tabs */}
        <div style={{
          display: "flex", marginBottom: 12, borderRadius: 10,
          overflow: "hidden", border: "1px solid #E2E8F0", background: "#fff"
        }}>
          <button onClick={() => setTab("pending")} style={{
            flex: 1, padding: "10px 4px", border: "none", cursor: "pointer",
            fontWeight: 700, fontSize: 12,
            background: tab === "pending" ? "#1565C0" : "#fff",
            color: tab === "pending" ? "#fff" : "#718096",
          }}>⏳ Pending ({pendingCount})</button>
          <button onClick={() => setTab("submitted")} style={{
            flex: 1, padding: "10px 4px", border: "none", cursor: "pointer",
            fontWeight: 700, fontSize: 12,
            background: tab === "submitted" ? "#1565C0" : "#fff",
            color: tab === "submitted" ? "#fff" : "#718096",
          }}>✅ Submitted ({submittedCount})</button>
        </div>

        {/* Search */}
        {villages.length > 0 && (
          <input
            type="text"
            placeholder="🔍 Search by village name or code"
            style={{ ...inputStyle, marginBottom: 10 }}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        )}

        {/* List */}
        {loading ? (
          <div style={{ textAlign: "center" as const, padding: 40, color: "#A0AEC0" }}>Loading…</div>
        ) : villages.length === 0 ? (
          <div style={{ textAlign: "center" as const, padding: 40, color: "#A0AEC0" }}>
            <div style={{ fontSize: 40, marginBottom: 10 }}>📭</div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>No villages assigned yet</div>
            <div style={{ fontSize: 13, marginTop: 4 }}>
              Ask your Subdivision Admin to upload village master data for your office
            </div>
          </div>
        ) : displayVillages.length === 0 ? (
          <div style={{ textAlign: "center" as const, padding: 40, color: "#A0AEC0" }}>
            <div style={{ fontSize: 36 }}>🔍</div>
            <div style={{ fontSize: 14, marginTop: 8 }}>No matching villages</div>
          </div>
        ) : (
          displayVillages.map(v => (
            <div key={v.id} onClick={() => openForm(v)} style={{
              background: "#fff", border: "1px solid #E2E8F0", borderRadius: 12,
              padding: "12px 14px", marginBottom: 8, cursor: "pointer",
              display: "flex", justifyContent: "space-between", alignItems: "center"
            }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#1A202C" }}>{v.villageName}</div>
                <div style={{ fontSize: 11, color: "#A0AEC0" }}>Code: {v.villageCode}</div>
              </div>
              <span style={{
                fontSize: 11, fontWeight: 700,
                background: v.dataSubmitted ? "#DCFCE7" : "#FFFBEB",
                color: v.dataSubmitted ? "#16A34A" : "#D97706",
                padding: "3px 10px", borderRadius: 20
              }}>
                {v.dataSubmitted ? "✅ Submitted" : "⏳ Pending"}
              </span>
            </div>
          ))
        )}
      </div>

      {/* Entry form modal */}
      {openVillage && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
          display: "flex", alignItems: "flex-end", zIndex: 400
        }} onClick={closeForm}>
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: "#fff", width: "100%", maxHeight: "88vh", overflowY: "auto" as const,
              borderRadius: "16px 16px 0 0", padding: 18
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 800, color: "#1A202C" }}>{openVillage.villageName}</div>
                <div style={{ fontSize: 12, color: "#A0AEC0" }}>Code: {openVillage.villageCode}</div>
              </div>
              <button onClick={closeForm} style={{
                border: "none", background: "#F7FAFC", borderRadius: 8,
                width: 32, height: 32, cursor: "pointer", fontSize: 16, color: "#718096"
              }}>✕</button>
            </div>

            {/* Network availability toggles D-G */}
            <div style={sHead}>Network Availability</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
              {([
                { key: "vil", label: "VIL (Vodafone Idea)" },
                { key: "rjil", label: "RJIL (Jio)" },
                { key: "bal", label: "BAL (Airtel)" },
                { key: "bsnl", label: "BSNL" },
              ] as const).map(f => (
                <ToggleBtn key={f.key} label={f.label} active={form[f.key] === 1} onClick={() => toggle(f.key)} />
              ))}
            </div>

            {/* Overall 4G status H */}
            <div style={sHead}>Overall 4G Status</div>
            <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
              {["Present", "Absent", "Partial"].map(s => (
                <button key={s} onClick={() => setForm(f => ({ ...f, overall4gStatus: s }))} style={{
                  flex: 1, padding: "8px 4px", border: "1px solid",
                  borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 12,
                  background: form.overall4gStatus === s ? "#1565C0" : "#fff",
                  color: form.overall4gStatus === s ? "#fff" : "#718096",
                  borderColor: form.overall4gStatus === s ? "#1565C0" : "#E2E8F0",
                }}>{s}</button>
              ))}
            </div>

            {/* SIM availability I-L */}
            <div style={sHead}>SIM Availability at Office</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
              <ToggleBtn label="Vi SIM Available" active={form.viSimAvailable === 1} onClick={() => toggle("viSimAvailable")} />
              <ToggleBtn label="Airtel SIM Available" active={form.airtelSimAvailable === 1} onClick={() => toggle("airtelSimAvailable")} />
              <ToggleBtn label="BSNL SIM Available" active={form.bsnlSimAvailable === 1} onClick={() => toggle("bsnlSimAvailable")} />
              <ToggleBtn label="Jio SIM Available" active={form.jioSimAvailable === 1} onClick={() => toggle("jioSimAvailable")} />
            </div>

            {/* Live procurement preview M-P */}
            <div style={sHead}>Procurement Required (auto-calculated)</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 18 }}>
              {([
                { label: "Vi", val: calcProcurement(form.vil, form.viSimAvailable) },
                { label: "Airtel", val: calcProcurement(form.bal, form.airtelSimAvailable) },
                { label: "BSNL", val: calcProcurement(form.bsnl, form.bsnlSimAvailable) },
                { label: "Jio", val: calcProcurement(form.rjil, form.jioSimAvailable) },
              ] as const).map(p => (
                <div key={p.label} style={{
                  background: p.val === 1 ? "#FEF2F2" : "#F7FAFC",
                  border: `1px solid ${p.val === 1 ? "#FECACA" : "#E2E8F0"}`,
                  borderRadius: 8, padding: "8px 10px",
                  display: "flex", justifyContent: "space-between", alignItems: "center"
                }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#4A5568" }}>{p.label}</span>
                  <span style={{
                    fontSize: 11, fontWeight: 700,
                    color: p.val === 1 ? "#DC2626" : "#A0AEC0"
                  }}>{p.val === 1 ? "Required" : "Not needed"}</span>
                </div>
              ))}
            </div>

            <button onClick={handleSave} disabled={saving} style={{
              width: "100%", padding: 14, background: saving ? "#90CDF4" : "#1565C0",
              color: "#fff", border: "none", borderRadius: 10, fontSize: 15, fontWeight: 700,
              cursor: saving ? "not-allowed" : "pointer"
            }}>
              {saving ? "Saving…" : "💾 Save & Submit"}
            </button>
          </div>
        </div>
      )}

      {toast && (
        <div style={{
          position: "fixed", bottom: 80, left: "50%", transform: "translateX(-50%)",
          background: "#2D3748", color: "#fff", padding: "10px 20px", borderRadius: 24,
          fontSize: 13, fontWeight: 500, zIndex: 500, maxWidth: "90%", textAlign: "center" as const
        }}>
          {toast}
        </div>
      )}

      <BottomNav />
    </div>
  );
}

function ToggleBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      padding: "10px 12px", border: "1px solid", borderRadius: 8, cursor: "pointer",
      background: active ? "#EBF8FF" : "#fff",
      borderColor: active ? "#1565C0" : "#E2E8F0",
    }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: "#1A202C", textAlign: "left" as const }}>{label}</span>
      <span style={{
        fontSize: 10, fontWeight: 800, padding: "2px 8px", borderRadius: 12,
        background: active ? "#1565C0" : "#E2E8F0",
        color: active ? "#fff" : "#718096"
      }}>{active ? "YES" : "NO"}</span>
    </button>
  );
}

const sHead: React.CSSProperties = {
  fontSize: 12, fontWeight: 700, color: "#718096",
  textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8
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
