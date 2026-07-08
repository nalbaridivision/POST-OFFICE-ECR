"use client";

import { useState, useEffect } from "react";
import { useAuth } from "../../context/AuthContext";
import { useRouter } from "next/navigation";
import { db } from "../firebase";
import {
  collection, doc, setDoc, getDocs,
  deleteDoc, serverTimestamp, query, where
} from "firebase/firestore";
import BottomNav from "../../components/BottomNav";

interface OfficeRow {
  id: string;
  name: string;
  type: string;
  circleCode?: string;
  regionId?: string;
  divisionCode?: string;
  subDivCode?: string;
  hoCode?: string;
  soCode?: string;
  createdByRole?: string;
  createdBy?: string;
}

// Who can see the hierarchy page
const BLOCKED_ROLES = ["ho_admin", "so_admin", "office_user"];

// What each role can CREATE
const CREATE_PERMISSIONS: Record<string, string[]> = {
  superadmin:        ["circle", "region", "division", "subdivision", "HO", "SO", "BO"],
  circle_admin:      ["region", "division"],
  region_admin:      ["division"],
  division_admin:    ["subdivision", "HO", "SO", "BO"],
  subdivision_admin: [],
  ho_admin:          [],
  so_admin:          [],
  office_user:       [],
};

// Role hierarchy for delete/edit permission
// A user can only delete/edit what was created by a role BELOW them
const ROLE_LEVEL: Record<string, number> = {
  superadmin:        0,
  circle_admin:      1,
  region_admin:      2,
  division_admin:    3,
  subdivision_admin: 4,
  ho_admin:          5,
  so_admin:          6,
  office_user:       7,
};

function canDelete(myRole: string, createdByRole: string): boolean {
  // subdivision_admin CANNOT delete any office
  if (myRole === "subdivision_admin") return false;
  // Can delete if my level is HIGHER (lower number) than creator
  return (ROLE_LEVEL[myRole] || 0) < (ROLE_LEVEL[createdByRole] || 99);
}

export default function HierarchyPage() {
  const { profile, user } = useAuth();
  const router = useRouter();

  const [view,         setView]         = useState<"list" | "add" | "bulk">("list");
  const [offices,      setOffices]      = useState<OfficeRow[]>([]);
  const [loading,      setLoading]      = useState(false);
  const [toast,        setToast]        = useState("");
  const [search,       setSearch]       = useState("");
  const [filterType,   setFilterType]   = useState<"ALL" | "HO" | "SO" | "BO">("ALL");
  const [uploadResult, setUploadResult] = useState<any>(null);
  
  // Updated for bulk delete support
  const [deleteConfirm,setDeleteConfirm]= useState<{id:string; name:string}[] | null>(null);
  const [selectedIds,  setSelectedIds]  = useState<string[]>([]);

  const myRole        = profile?.role || "";
  const myLevel       = ROLE_LEVEL[myRole] || 99;
  const canCreate     = CREATE_PERMISSIONS[myRole] || [];
  const hasCreatePerm = canCreate.length > 0;

  // Form state — show only fields relevant to role
  const [form, setForm] = useState({
    circleCode: "", circleName: "",
    regionId:   "", regionName: "",
    divId:      "", divName: "",
    subDivId:   "", subDivName: "",
    hoId:       "", hoName: "",
    soId:       "", soName: "",
    boId:       "", boName: "",
  });

  useEffect(() => {
    if (!user) { router.push("/"); return; }
    if (profile && !BLOCKED_ROLES.includes(profile.role)) fetchOffices();
  }, [user, profile]);

  // Clear selections when filter or search changes
  useEffect(() => {
    setSelectedIds([]);
  }, [filterType, search]);

  // ACCESS DENIED
  if (profile && BLOCKED_ROLES.includes(profile.role)) {
    return (
      <div style={accessDenied}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🚫</div>
        <h2 style={{ color: "#C53030", margin: "0 0 8px" }}>Access Denied</h2>
        <p style={{ color: "#718096", fontSize: 14, maxWidth: 280 }}>
          HO, SO and BO users cannot access Office Hierarchy management.
        </p>
        <button onClick={() => router.push("/dashboard")} style={backBtn}>
          ← Back to Dashboard
        </button>
      </div>
    );
  }

  async function fetchOffices() {
    setLoading(true);
    try {
      const snap = await getDocs(collection(db, "offices"));
      let data = snap.docs.map(d => ({ id: d.id, ...d.data() })) as OfficeRow[];

      // Filter by scope
      if      (myRole === "circle_admin")     data = data.filter((o:any) => o.circleCode   === profile?.circleCode);
      else if (myRole === "region_admin")     data = data.filter((o:any) => o.regionId     === profile?.regionId);
      else if (myRole === "division_admin")   data = data.filter((o:any) => o.divisionCode === profile?.divisionCode);
      else if (myRole === "subdivision_admin")data = data.filter((o:any) => o.subDivCode   === profile?.subDivCode);

      setOffices(data.sort((a, b) => (a.name||"").localeCompare(b.name||"")));
    } catch (e: any) { showToast("Error: " + e.message); }
    finally { setLoading(false); }
  }

  // ── MANUAL ADD ────────────────────────────────────────────────
  async function handleManualAdd() {
    if (!hasCreatePerm) { showToast("You do not have permission to add offices."); return; }
    setLoading(true);
    try {
      const meta = {
        createdByRole: myRole,
        createdBy:     profile?.uid,
        createdAt:     serverTimestamp(),
      };

      if (canCreate.includes("circle") && form.circleCode) {
        await setDoc(doc(db, "circles", form.circleCode),
          { code: form.circleCode, name: form.circleName || form.circleCode, ...meta },
          { merge: true });
      }
      if (canCreate.includes("region") && form.regionId) {
        await setDoc(doc(db, "regions", form.regionId),
          { code: form.regionId, name: form.regionName || form.regionId,
            circleCode: form.circleCode || profile?.circleCode, ...meta },
          { merge: true });
      }
      if (canCreate.includes("division") && form.divId) {
        await setDoc(doc(db, "divisions", form.divId),
          { code: form.divId, name: form.divName || form.divId,
            regionId:   form.regionId   || profile?.regionId,
            circleCode: form.circleCode || profile?.circleCode, ...meta },
          { merge: true });
      }
      if (canCreate.includes("subdivision") && form.subDivId) {
        await setDoc(doc(db, "subdivisions", form.subDivId),
          { code: form.subDivId, name: form.subDivName || form.subDivId,
            divisionCode: form.divId   || profile?.divisionCode,
            regionId:     profile?.regionId,
            circleCode:   profile?.circleCode, ...meta },
          { merge: true });
      }
      if (canCreate.includes("HO") && form.hoId) {
        await setDoc(doc(db, "offices", form.hoId),
          { code: form.hoId, name: form.hoName, type: "HO",
            subDivCode:   form.subDivId  || profile?.subDivCode,
            divisionCode: form.divId     || profile?.divisionCode,
            regionId:     profile?.regionId,
            circleCode:   profile?.circleCode, ...meta },
          { merge: true });
      }
      if (canCreate.includes("SO") && form.soId) {
        await setDoc(doc(db, "offices", form.soId),
          { code: form.soId, name: form.soName, type: "SO",
            hoCode:       form.hoId      || null,
            subDivCode:   form.subDivId  || profile?.subDivCode,
            divisionCode: form.divId     || profile?.divisionCode,
            regionId:     profile?.regionId,
            circleCode:   profile?.circleCode, ...meta },
          { merge: true });
      }
      if (canCreate.includes("BO") && form.boId) {
        await setDoc(doc(db, "offices", form.boId),
          { code: form.boId, name: form.boName, type: "BO",
            soCode:       form.soId      || null,
            hoCode:       form.hoId      || null,
            subDivCode:   form.subDivId  || profile?.subDivCode,
            divisionCode: form.divId     || profile?.divisionCode,
            regionId:     profile?.regionId,
            circleCode:   profile?.circleCode, ...meta },
          { merge: true });
      }

      showToast("✅ Saved successfully!");
      setForm({ circleCode:"",circleName:"",regionId:"",regionName:"",
        divId:"",divName:"",subDivId:"",subDivName:"",
        hoId:"",hoName:"",soId:"",soName:"",boId:"",boName:"" });
      fetchOffices();
      setView("list");
    } catch (e: any) { showToast("Error: " + e.message); }
    finally { setLoading(false); }
  }

  // ── BULK UPLOAD ───────────────────────────────────────────────
  async function handleBulkUpload(e: React.ChangeEvent<HTMLInputElement>) {
    if (!hasCreatePerm) { showToast("No permission to add offices."); return; }
    const file = e.target.files?.[0];
    if (!file) return;
    const XLSX = await import("xlsx");
    const reader = new FileReader();
    reader.onload = async (evt) => {
      const wb   = XLSX.read(evt.target?.result, { type: "binary" });
      const rows: any[] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
      let count = 0;
      const errors: string[] = [];
      const stats = { circles:0, regions:0, divisions:0, subdivisions:0, ho:0, so:0, bo:0 };
      const meta  = { createdByRole: myRole, createdBy: profile?.uid };

      for (const row of rows) {
        try {
          const cc   = String(row.circle_code            || "").trim();
          const cn   = String(row.circle_name            || "").trim();
          const ri   = String(row.region_office_id       || "").trim();
          const rn   = String(row.region_name            || "").trim();
          const di   = String(row.division_office_id     || "").trim();
          const dn   = String(row.division_name          || "").trim();
          const si   = String(row.sub_division_office_id || "").trim();
          const sn   = String(row.sub_division_name      || "").trim();
          const hid  = String(row.ho_id                  || "").trim();
          const hn   = String(row.ho_name                || "").trim();
          const soid = String(row.so_id                  || "").trim();
          const son  = String(row.so_name                || "").trim();
          const bid  = String(row.bo_id                  || "").trim();
          const bn   = String(row.bo_name                || "").trim();

          if (canCreate.includes("circle") && cc) {
            await setDoc(doc(db,"circles",cc),{code:cc,name:cn,...meta},{merge:true});
            stats.circles++;
          }
          if (canCreate.includes("region") && ri) {
            await setDoc(doc(db,"regions",ri),{code:ri,name:rn,circleCode:cc||profile?.circleCode,...meta},{merge:true});
            stats.regions++;
          }
          if (canCreate.includes("division") && di) {
            await setDoc(doc(db,"divisions",di),{code:di,name:dn,regionId:ri||profile?.regionId,circleCode:cc||profile?.circleCode,...meta},{merge:true});
            stats.divisions++;
          }
          if (canCreate.includes("subdivision") && si) {
            await setDoc(doc(db,"subdivisions",si),{code:si,name:sn,divisionCode:di||profile?.divisionCode,regionId:ri||profile?.regionId,circleCode:cc||profile?.circleCode,...meta},{merge:true});
            stats.subdivisions++;
          }
          if (canCreate.includes("HO") && hid) {
            await setDoc(doc(db,"offices",hid),{code:hid,name:hn,type:"HO",subDivCode:si,divisionCode:di||profile?.divisionCode,regionId:ri||profile?.regionId,circleCode:cc||profile?.circleCode,...meta},{merge:true});
            stats.ho++;
          }
          if (canCreate.includes("SO") && soid) {
            await setDoc(doc(db,"offices",soid),{code:soid,name:son,type:"SO",hoCode:hid,subDivCode:si,divisionCode:di||profile?.divisionCode,regionId:ri||profile?.regionId,circleCode:cc||profile?.circleCode,...meta},{merge:true});
            stats.so++;
          }
          if (canCreate.includes("BO") && bid) {
            await setDoc(doc(db,"offices",bid),{code:bid,name:bn,type:"BO",soCode:soid,hoCode:hid,subDivCode:si,divisionCode:di||profile?.divisionCode,regionId:ri||profile?.regionId,circleCode:cc||profile?.circleCode,...meta},{merge:true});
            stats.bo++;
          }
          count++;
        } catch (err: any) { errors.push(err.message); }
      }
      setUploadResult({ count, stats, errors });
      showToast(`✅ ${count} rows processed`);
      fetchOffices();
    };
    reader.readAsBinaryString(file);
  }

  // ── DELETE ────────────────────────────────────────────────────
  async function handleDelete(office: OfficeRow) {
    const createdByRole = office.createdByRole || "office_user";
    if (!canDelete(myRole, createdByRole)) {
      showToast("⛔ You can only delete offices created by roles below you.");
      return;
    }
    setDeleteConfirm([{ id: office.id, name: office.name }]);
  }

  async function handleBulkDeletePrompt() {
    const itemsToDelete = offices
      .filter(o => selectedIds.includes(o.id))
      .map(o => ({ id: o.id, name: o.name }));
    if (itemsToDelete.length === 0) return;
    setDeleteConfirm(itemsToDelete);
  }

  async function confirmDelete() {
    if (!deleteConfirm || deleteConfirm.length === 0) return;
    setLoading(true);
    try {
      // Deleting all selected documents concurrently
      await Promise.all(deleteConfirm.map(item => deleteDoc(doc(db, "offices", item.id))));
      showToast(`🗑️ ${deleteConfirm.length} Office(s) deleted`);
      setDeleteConfirm(null);
      setSelectedIds([]);
      fetchOffices();
    } catch (e: any) { 
      showToast("Error: " + e.message); 
      setLoading(false);
    }
  }

  // ── EXPORT ────────────────────────────────────────────────────
  function exportHierarchy() {
    import("xlsx").then(XLSX => {
      const rows = offices.map(o => ({
        OfficeCode:   o.id,
        OfficeName:   o.name,
        Type:         o.type,
        CircleCode:   o.circleCode   || "",
        RegionID:     o.regionId     || "",
        DivisionCode: o.divisionCode || "",
        SubDivCode:   o.subDivCode   || "",
        HOCode:       o.hoCode       || "",
        SOCode:       o.soCode       || "",
        CreatedByRole:o.createdByRole|| "",
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      ws["!cols"] = Array(10).fill({ wch: 18 });
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Offices");
      XLSX.writeFile(wb, `ECR_Offices_${new Date().toISOString().split("T")[0]}.xlsx`);
    });
  }

  function downloadTemplate() {
    import("xlsx").then(XLSX => {
      const ws = XLSX.utils.aoa_to_sheet([
        ["bo_id","bo_name","so_id","so_name","ho_id","ho_name",
         "sub_division_name","sub_division_office_id",
         "division_name","division_office_id",
         "region_name","region_office_id",
         "circle_name","circle_code"],
        ["12100675","Adabari B.O","12660179","Mukalmua S.O","12360006","Nalbari H.O",
         "Nalbari West","12640010","Nalbari Division","12530005",
         "Assam Region","12300001","Assam Circle","12"],
      ]);
      ws["!cols"] = Array(14).fill({ wch: 22 });
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Hierarchy");
      XLSX.writeFile(wb, "ECR_Hierarchy_Template.xlsx");
    });
  }

  function showToast(msg: string) {
    setToast(msg); setTimeout(() => setToast(""), 3000);
  }

  const typeColors: Record<string, [string, string]> = {
    HO: ["#DBEAFE", "#1D4ED8"],
    SO: ["#DCFCE7", "#15803D"],
    BO: ["#FEF9C3", "#854D0E"],
  };

  const filtered = offices.filter(o => {
    const matchType   = filterType === "ALL" || o.type === filterType;
    const matchSearch = !search ||
      (o.name||"").toLowerCase().includes(search.toLowerCase()) ||
      (o.id||"").toLowerCase().includes(search.toLowerCase());
    return matchType && matchSearch;
  });

  // Calculate selectable offices for the "Select All" checkbox
  const selectableOffices = filtered.filter(o => canDelete(myRole, o.createdByRole || "office_user"));
  const isAllSelected = selectableOffices.length > 0 && selectableOffices.every(o => selectedIds.includes(o.id));

  function toggleSelectAll() {
    if (isAllSelected) {
      // Deselect all visible
      const visibleIds = selectableOffices.map(o => o.id);
      setSelectedIds(prev => prev.filter(id => !visibleIds.includes(id)));
    } else {
      // Select all visible
      const visibleIds = selectableOffices.map(o => o.id);
      setSelectedIds(prev => Array.from(new Set([...prev, ...visibleIds])));
    }
  }

  function toggleSelect(id: string) {
    if (selectedIds.includes(id)) {
      setSelectedIds(selectedIds.filter(i => i !== id));
    } else {
      setSelectedIds([...selectedIds, id]);
    }
  }

  // ── FORM SECTIONS based on role ───────────────────────────────
  function FormField({ label, value, placeholder, onChange }: {
    label:string; value:string; placeholder:string; onChange:(v:string)=>void;
  }) {
    return (
      <div style={{ flex: 1 }}>
        <label style={labelStyle}>{label}</label>
        <input style={inputStyle} value={value} placeholder={placeholder}
          onChange={e => onChange(e.target.value)} />
      </div>
    );
  }

  return (
    <div style={{ paddingBottom: 80,
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>

      {/* Header */}
      <div style={{ background: "linear-gradient(135deg, #0D47A1, #1E88E5)",
        padding: "16px 16px 20px", color: "#fff" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 2px" }}>Office Hierarchy</h1>
            <div style={{ fontSize: 13, opacity: .85 }}>
              {offices.length} offices · Your scope
            </div>
          </div>
          <button onClick={() => router.push("/dashboard")} style={hBtn}>← Back</button>
        </div>

        {/* Action buttons — based on permission */}
        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" as const }}>
          {hasCreatePerm && (
            <>
              <button onClick={() => setView(view==="add"?"list":"add")}
                style={view==="add" ? hBtnActive : hBtn}>
                {view==="add" ? "✕ Close" : "+ Add Office"}
              </button>
              <button onClick={() => setView(view==="bulk"?"list":"bulk")}
                style={view==="bulk" ? hBtnActive : hBtn}>
                {view==="bulk" ? "✕ Close" : "📤 Bulk Upload"}
              </button>
            </>
          )}
          <button onClick={exportHierarchy} style={hBtn}>📥 Export</button>
        </div>

        {/* Permission info badge */}
        <div style={{ marginTop: 10, fontSize: 11, opacity: .75 }}>
          {hasCreatePerm
            ? `✅ You can create: ${canCreate.join(", ")}`
            : "👁️ View only — contact your Circle or Division office to add offices"}
        </div>
      </div>

      <div style={{ padding: "12px 12px 0" }}>

        {/* ── MANUAL ADD FORM ── */}
        {view === "add" && hasCreatePerm && (
          <div style={card}>
            <div style={sectionHead}>Add Office — {myRole.replace("_", " ").toUpperCase()}</div>

            {/* Circle & Region — superadmin and circle_admin */}
            {(canCreate.includes("circle") || canCreate.includes("region")) && (
              <div style={{ background: "#EFF6FF", borderRadius: 8, padding: 12, marginBottom: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#1D4ED8", marginBottom: 8 }}>
                  CIRCLE & REGION
                </div>
                {canCreate.includes("circle") && (
                  <div style={rowStyle}>
                    <FormField label="Circle Code" value={form.circleCode}
                      placeholder="e.g. 12"
                      onChange={v => setForm(f=>({...f,circleCode:v}))} />
                    <FormField label="Circle Name" value={form.circleName}
                      placeholder="e.g. Assam Circle"
                      onChange={v => setForm(f=>({...f,circleName:v}))} />
                  </div>
                )}
                {canCreate.includes("region") && (
                  <div style={rowStyle}>
                    <FormField label="Region ID" value={form.regionId}
                      placeholder="e.g. 12300001"
                      onChange={v => setForm(f=>({...f,regionId:v}))} />
                    <FormField label="Region Name" value={form.regionName}
                      placeholder="e.g. Assam Region"
                      onChange={v => setForm(f=>({...f,regionName:v}))} />
                  </div>
                )}
              </div>
            )}

            {/* Division — superadmin, circle_admin, region_admin */}
            {canCreate.includes("division") && (
              <div style={{ background: "#F0FFF4", borderRadius: 8, padding: 12, marginBottom: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#15803D", marginBottom: 8 }}>
                  DIVISION
                </div>
                <div style={rowStyle}>
                  <FormField label="Division ID" value={form.divId}
                    placeholder="e.g. 12530005"
                    onChange={v => setForm(f=>({...f,divId:v}))} />
                  <FormField label="Division Name" value={form.divName}
                    placeholder="e.g. Nalbari Division"
                    onChange={v => setForm(f=>({...f,divName:v}))} />
                </div>
              </div>
            )}

            {/* SubDiv + HO/SO/BO — superadmin and division_admin */}
            {canCreate.includes("subdivision") && (
              <div style={{ background: "#FFFBEB", borderRadius: 8, padding: 12, marginBottom: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#92400E", marginBottom: 8 }}>
                  SUB DIVISION & POST OFFICES
                </div>
                <div style={rowStyle}>
                  <FormField label="Sub Division ID" value={form.subDivId}
                    placeholder="e.g. 12640010"
                    onChange={v => setForm(f=>({...f,subDivId:v}))} />
                  <FormField label="Sub Division Name" value={form.subDivName}
                    placeholder="e.g. Nalbari West"
                    onChange={v => setForm(f=>({...f,subDivName:v}))} />
                </div>
                {canCreate.includes("HO") && (
                  <div style={rowStyle}>
                    <FormField label="HO ID" value={form.hoId}
                      placeholder="e.g. 12360006"
                      onChange={v => setForm(f=>({...f,hoId:v}))} />
                    <FormField label="HO Name" value={form.hoName}
                      placeholder="e.g. Nalbari H.O"
                      onChange={v => setForm(f=>({...f,hoName:v}))} />
                  </div>
                )}
                {canCreate.includes("SO") && (
                  <div style={rowStyle}>
                    <FormField label="SO ID" value={form.soId}
                      placeholder="e.g. 12660179"
                      onChange={v => setForm(f=>({...f,soId:v}))} />
                    <FormField label="SO Name" value={form.soName}
                      placeholder="e.g. Mukalmua S.O"
                      onChange={v => setForm(f=>({...f,soName:v}))} />
                  </div>
                )}
                {canCreate.includes("BO") && (
                  <div style={rowStyle}>
                    <FormField label="BO ID" value={form.boId}
                      placeholder="e.g. 12100675"
                      onChange={v => setForm(f=>({...f,boId:v}))} />
                    <FormField label="BO Name" value={form.boName}
                      placeholder="e.g. Adabari B.O"
                      onChange={v => setForm(f=>({...f,boName:v}))} />
                  </div>
                )}
              </div>
            )}

            <button onClick={handleManualAdd} disabled={loading} style={primaryBtn}>
              {loading ? "Saving…" : "Save"}
            </button>
          </div>
        )}

        {/* ── BULK UPLOAD ── */}
        {view === "bulk" && hasCreatePerm && (
          <div style={card}>
            <div style={sectionHead}>Bulk Upload from Excel</div>
            <div style={{ background: "#F7FAFC", borderRadius: 8,
              padding: 12, marginBottom: 12, fontSize: 12, color: "#718096" }}>
              <strong>Your role ({myRole}) can create:</strong>{" "}
              {canCreate.join(", ")}
              <br />Columns not in your permission will be ignored.
            </div>
            <div style={{ background: "#F7FAFC", borderRadius: 8, padding: 10, marginBottom: 12 }}>
              {["bo_id · bo_name", "so_id · so_name", "ho_id · ho_name",
                "sub_division_name · sub_division_office_id",
                "division_name · division_office_id",
                "region_name · region_office_id",
                "circle_name · circle_code",
              ].map((col,i) => (
                <div key={i} style={{ fontSize: 11, color: "#718096",
                  padding: "3px 0", borderBottom: "1px solid #EDF2F7" }}>
                  <code style={codeStyle}>{col}</code>
                </div>
              ))}
            </div>
            <button onClick={downloadTemplate} style={linkBtn}>📥 Download Template</button>
            <label style={uploadZone}>
              <input type="file" accept=".xlsx,.xls"
                onChange={handleBulkUpload} style={{ display: "none" }} />
              📤 Choose Excel File
            </label>

            {uploadResult && (
              <div style={{ marginTop: 12, background: "#F0FFF4",
                border: "1px solid #9AE6B4", borderRadius: 10, padding: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#276749", marginBottom: 10 }}>
                  ✅ {uploadResult.count} rows processed
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                  {[
                    { label: "Circles",    value: uploadResult.stats.circles      },
                    { label: "Regions",    value: uploadResult.stats.regions      },
                    { label: "Divisions",  value: uploadResult.stats.divisions    },
                    { label: "Sub Divs",   value: uploadResult.stats.subdivisions },
                    { label: "HO",         value: uploadResult.stats.ho           },
                    { label: "SO",         value: uploadResult.stats.so           },
                    { label: "BO",         value: uploadResult.stats.bo           },
                  ].map(s => (
                    <div key={s.label} style={{ background: "#fff", borderRadius: 8,
                      padding: "8px 10px", textAlign: "center" as const }}>
                      <div style={{ fontSize: 20, fontWeight: 700, color: "#1565C0" }}>
                        {s.value}
                      </div>
                      <div style={{ fontSize: 11, color: "#718096" }}>{s.label}</div>
                    </div>
                  ))}
                </div>
                {uploadResult.errors.length > 0 && (
                  <div style={{ marginTop: 10, fontSize: 12, color: "#C53030" }}>
                    ⚠️ {uploadResult.errors.length} errors
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── OFFICE LIST ── */}
        {view === "list" && (
          <>
            <input style={{ ...inputStyle, marginBottom: 10 }}
              placeholder="Search office name or ID…"
              value={search} onChange={e => setSearch(e.target.value)} />

            <div style={{ display: "flex", marginBottom: 12, borderRadius: 10,
              overflow: "hidden", border: "1px solid #E2E8F0", background: "#fff" }}>
              {(["ALL","HO","SO","BO"] as const).map(t => (
                <button key={t} onClick={() => setFilterType(t)} style={{
                  flex: 1, padding: "9px 4px", border: "none", cursor: "pointer",
                  fontWeight: 600, fontSize: 12,
                  background: filterType===t ? "#1565C0" : "#fff",
                  color:      filterType===t ? "#fff"    : "#718096",
                }}>
                  {t==="ALL" ? `All (${offices.length})`
                    : `${t} (${offices.filter(o=>o.type===t).length})`}
                </button>
              ))}
            </div>

            {/* Bulk Selection Actions */}
            {filtered.length > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, background: '#F7FAFC', padding: '10px 12px', borderRadius: 8, border: '1px solid #E2E8F0' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#4A5568' }}>
                  <input type="checkbox" checked={isAllSelected} onChange={toggleSelectAll} disabled={selectableOffices.length === 0} style={{ transform: "scale(1.2)" }} />
                  Select All
                </label>
                {selectedIds.length > 0 && (
                  <button onClick={handleBulkDeletePrompt} style={{ background: '#DC2626', color: '#fff', border: 'none', padding: '6px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                    🗑️ Delete Selected ({selectedIds.length})
                  </button>
                )}
              </div>
            )}

            {loading ? (
              <div style={{ textAlign: "center" as const, padding: 40, color: "#A0AEC0" }}>
                Loading…
              </div>
            ) : filtered.length === 0 ? (
              <div style={{ textAlign: "center" as const, padding: 40, color: "#A0AEC0" }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>🏢</div>
                <div style={{ fontSize: 15, fontWeight: 600 }}>No offices yet</div>
                {hasCreatePerm && (
                  <div style={{ fontSize: 13, marginTop: 4 }}>
                    Use "+ Add Office" or "Bulk Upload" to add offices
                  </div>
                )}
              </div>
            ) : (
              filtered.map((o: any) => {
                const [bg, text] = typeColors[o.type] || ["#F1F5F9","#334155"];
                const createdByRole = o.createdByRole || "office_user";
                const canDel = canDelete(myRole, createdByRole);

                return (
                  <div key={o.id} style={officeCard}>
                    <div style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 6 }}>
                      {canDel && (
                        <input 
                          type="checkbox" 
                          checked={selectedIds.includes(o.id)} 
                          onChange={() => toggleSelect(o.id)} 
                          style={{ marginTop: 4, transform: "scale(1.2)", cursor: "pointer" }} 
                        />
                      )}
                      
                      <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                          <div>
                            <div style={{ fontSize: 15, fontWeight: 600, color: "#1A202C" }}>
                              {o.name}
                            </div>
                            <div style={{ fontSize: 12, color: "#718096", marginTop: 1 }}>
                              ID: {o.id}
                            </div>
                          </div>
                          
                          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                            <span style={{ fontSize: 11, fontWeight: 700, background: bg,
                              color: text, padding: "3px 10px", borderRadius: 20 }}>
                              {o.type || "—"}
                            </span>
                            {canDel && (
                              <button onClick={() => handleDelete(o)}
                                style={{ fontSize: 12, background: "#FEE2E2",
                                  color: "#DC2626", border: "1px solid #FECACA",
                                  borderRadius: 6, padding: "3px 8px",
                                  cursor: "pointer", fontWeight: 600 }}>
                                🗑️
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Breadcrumb */}
                        <div style={{ display: "flex", gap: 4,
                          flexWrap: "wrap" as const, alignItems: "center", marginTop: 8 }}>
                          {o.circleCode   && <span style={crumb("#F3E8FF","#6B21A8")}>{o.circleCode}</span>}
                          {o.circleCode   && <span style={arrow}>›</span>}
                          {o.regionId     && <span style={crumb("#DBEAFE","#1D4ED8")}>{o.regionId}</span>}
                          {o.regionId     && <span style={arrow}>›</span>}
                          {o.divisionCode && <span style={crumb("#CCFBF1","#0F766E")}>{o.divisionCode}</span>}
                          {o.divisionCode && <span style={arrow}>›</span>}
                          {o.subDivCode   && <span style={crumb("#DCFCE7","#15803D")}>{o.subDivCode}</span>}
                          {o.subDivCode && o.type!=="HO" && <span style={arrow}>›</span>}
                          {o.hoCode && o.type!=="HO" && <span style={crumb("#FEF9C3","#854D0E")}>{o.hoCode}</span>}
                          {o.soCode       && <span style={arrow}>›</span>}
                          {o.soCode       && <span style={crumb("#FFEDD5","#9A3412")}>{o.soCode}</span>}
                        </div>

                        {/* Created by info */}
                        {o.createdByRole && (
                          <div style={{ fontSize: 10, color: "#CBD5E0", marginTop: 6 }}>
                            Added by: {o.createdByRole.replace("_"," ")}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </>
        )}
      </div>

      {/* Delete confirmation modal */}
      {deleteConfirm && (
        <div style={modalOverlay}>
          <div style={{ background: "#fff", borderRadius: 12, padding: 24,
            width: "100%", maxWidth: 360, textAlign: "center" as const }}>
            <div style={{ fontSize: 36, marginBottom: 10 }}>⚠️</div>
            <h3 style={{ margin: "0 0 8px", color: "#C53030" }}>
              Delete Office{deleteConfirm.length > 1 ? "s" : ""}?
            </h3>
            <p style={{ fontSize: 13, color: "#718096", margin: "0 0 20px" }}>
              {deleteConfirm.length === 1 ? (
                <>Delete <strong>{deleteConfirm[0].name}</strong> ({deleteConfirm[0].id})?</>
              ) : (
                <>Delete <strong>{deleteConfirm.length} selected offices?</strong></>
              )}
              <br />This cannot be undone.
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setDeleteConfirm(null)} style={{
                flex: 1, padding: 10, background: "#E2E8F0", color: "#4A5568",
                border: "none", borderRadius: 8, fontWeight: 600, cursor: "pointer"
              }}>Cancel</button>
              <button onClick={confirmDelete} style={{
                flex: 1, padding: 10, background: "#DC2626", color: "#fff",
                border: "none", borderRadius: 8, fontWeight: 600, cursor: "pointer"
              }}>Delete</button>
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

// ── Helpers ───────────────────────────────────────────────────────
function crumb(bg: string, color: string): React.CSSProperties {
  return { fontSize: 10, background: bg, color,
    padding: "2px 7px", borderRadius: 10, fontWeight: 600 };
}
const arrow: React.CSSProperties = { fontSize: 12, color: "#CBD5E0", fontWeight: 700 };

// ── Styles ────────────────────────────────────────────────────────
const accessDenied: React.CSSProperties = {
  minHeight: "100vh", display: "flex", flexDirection: "column",
  alignItems: "center", justifyContent: "center",
  padding: 24, textAlign: "center", background: "#FFF5F5",
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
};
const backBtn: React.CSSProperties = {
  marginTop: 20, padding: "10px 20px", background: "#1565C0",
  color: "#fff", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: "pointer",
};
const hBtn: React.CSSProperties = {
  background: "rgba(255,255,255,0.2)", border: "1px solid rgba(255,255,255,0.4)",
  color: "#fff", borderRadius: 8, padding: "7px 14px",
  fontSize: 12, fontWeight: 600, cursor: "pointer"
};
const hBtnActive: React.CSSProperties = {
  background: "rgba(255,255,255,0.9)", border: "1px solid rgba(255,255,255,0.4)",
  color: "#1565C0", borderRadius: 8, padding: "7px 14px",
  fontSize: 12, fontWeight: 700, cursor: "pointer"
};
const card: React.CSSProperties = {
  background: "#fff", border: "1px solid #E2E8F0",
  borderRadius: 12, padding: 16, marginBottom: 12
};
const sectionHead: React.CSSProperties = {
  fontSize: 13, fontWeight: 700, color: "#718096",
  textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 14
};
const rowStyle: React.CSSProperties = { display: "flex", gap: 10, marginBottom: 8 };
const labelStyle: React.CSSProperties = {
  display: "block", fontSize: 11, fontWeight: 600, color: "#4A5568",
  textTransform: "uppercase", letterSpacing: "0.3px", marginBottom: 4
};
const inputStyle: React.CSSProperties = {
  width: "100%", padding: "9px 11px", fontSize: 14,
  border: "1.5px solid #E2E8F0", borderRadius: 8,
  color: "#1A202C", background: "#fff", boxSizing: "border-box", outline: "none"
};
const primaryBtn: React.CSSProperties = {
  width: "100%", padding: 12, background: "#1565C0", color: "#fff",
  border: "none", borderRadius: 10, fontSize: 15, fontWeight: 700,
  cursor: "pointer", marginTop: 4
};
const linkBtn: React.CSSProperties = {
  display: "block", fontSize: 13, color: "#1565C0", background: "none",
  border: "none", cursor: "pointer", padding: 0, fontWeight: 500, marginBottom: 12
};
const uploadZone: React.CSSProperties = {
  display: "block", width: "100%", padding: 14, textAlign: "center",
  background: "#EBF8FF", color: "#1565C0", borderRadius: 10,
  border: "2px dashed #BEE3F8", cursor: "pointer",
  fontSize: 14, fontWeight: 500, boxSizing: "border-box"
};
const officeCard: React.CSSProperties = {
  background: "#fff", border: "1px solid #E2E8F0",
  borderRadius: 12, padding: "12px 14px", marginBottom: 10
};
const codeStyle: React.CSSProperties = {
  background: "#EBF8FF", color: "#2B6CB0",
  padding: "1px 5px", borderRadius: 4, fontSize: 11
};
const modalOverlay: React.CSSProperties = {
  position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
  background: "rgba(0,0,0,0.5)", display: "flex",
  alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20
};
