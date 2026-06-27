"use client";

import { useEffect, useState } from "react";
import { useAuth, ROLE_LABELS, CREATABLE_ROLES } from "../../context/AuthContext";
import { useRouter } from "next/navigation";
import { listUsers, toggleUserActive } from "../../utils/userService";

// Firebase App & Auth imports
import { initializeApp, getApps } from "firebase/app";
import { 
  getAuth as getSecondaryAuth, 
  createUserWithEmailAndPassword as createUser 
} from "firebase/auth";
import { doc, setDoc, updateDoc, deleteDoc, getDoc, serverTimestamp, collection, getDocs } from "firebase/firestore";

import { auth, db } from "../firebase";
import BottomNav from "../../components/BottomNav";

// ── Secondary App Initialization (Prevents Admin Logout) ──────
function getSecondaryApp() {
  const secondaryApp = getApps().find(a => a.name === "secondary") ||
    initializeApp({
      apiKey: "AIzaSyCFltPP-g1yKSY9YXMB9CrUm86jzuOeb_w",
      authDomain: "post-office-ecr.firebaseapp.com",
      projectId: "post-office-ecr",
      storageBucket: "post-office-ecr.firebasestorage.app",
      messagingSenderId: "571296585764",
      appId: "1:571296585764:web:326cbc1155d5c8e4ef60b1",
    }, "secondary");
  return secondaryApp;
}

// ── Role Permissions Logic ────────────────────────────────────────
function getViewableRoles(userRole: string) {
  if (userRole === "superadmin") return "ALL";
  if (userRole === "circle_admin") return ["region_admin", "division_admin"];
  if (userRole === "region_admin") return ["division_admin", "subdivision_admin"]; // Assumed standard fallback
  if (userRole === "division_admin") return ["subdivision_admin", "ho_admin", "so_admin", "office_user"];
  if (userRole === "subdivision_admin") return ["ho_admin", "so_admin", "office_user"];
  return []; // ho_admin, so_admin, bo/office_user can only view self
}

function getEditableRoles(userRole: string) {
  if (userRole === "superadmin") return "ALL";
  if (userRole === "circle_admin") return ["region_admin", "division_admin"];
  if (userRole === "region_admin") return ["division_admin", "subdivision_admin"];
  if (userRole === "division_admin") return ["subdivision_admin", "ho_admin", "so_admin", "office_user"];
  return []; // Subdivision, HO, SO, BO cannot create/edit others
}

export default function UsersPage() {
  const { profile, user } = useAuth();
  const router = useRouter();
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"list" | "create" | "bulk">("list");
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [formError, setFormError] = useState("");
  const [lastCreated, setLastCreated] = useState<any>(null);
  const [officeInfo, setOfficeInfo] = useState<any>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [allOffices, setAllOffices] = useState<any[]>([]);
  const [officeSearchTerm, setOfficeSearchTerm] = useState("");
  const [showOfficeDropdown, setShowOfficeDropdown] = useState(false);
  
  // Bulk Upload State updated to handle current and total counts
  const [bulkStatus, setBulkStatus] = useState({ uploading: false, progress: 0, current: 0, total: 0, errors: [] as any[] });

  const [form, setForm] = useState({
    employeeId: "", name: "", designation: "", role: "", officeId: "",
  });

  const currentUserRole = profile?.role || "";
  const creatableRoles = CREATABLE_ROLES[currentUserRole] || [];
  const editableRoles = getEditableRoles(currentUserRole);
  const viewableRoles = getViewableRoles(currentUserRole);
  const canAddUser = editableRoles === "ALL" || editableRoles.length > 0;

  useEffect(() => {
    if (!user) { router.push("/"); return; }
    fetchUsers();
  }, [user, profile]);

  useEffect(() => {
    if (view === "create" && allOffices.length === 0) {
      loadAllOffices();
    }
  }, [view]);

  async function fetchUsers() {
    setLoading(true);
    try {
      const u = await listUsers(profile);
      
      const allowedUsers = u.filter((userItem: any) => {
        const isSelf = (userItem.uid || userItem.id) === user?.uid;
        if (isSelf) return true; 
        if (viewableRoles === "ALL") return true;
        return Array.isArray(viewableRoles) && viewableRoles.includes(userItem.role);
      });

      setUsers(allowedUsers.sort((a: any, b: any) => (a.name || "").localeCompare(b.name || "")));
    } catch (e: any) { showToast("Error: " + e.message); }
    finally { setLoading(false); }
  }

  async function loadAllOffices() {
    try {
      const cols = ["offices", "subdivisions", "divisions", "regions", "circles"];
      let all: any[] = [];
      for (const col of cols) {
        const snap = await getDocs(collection(db, col));
        snap.forEach(d => all.push({ id: d.id, ...d.data(), level: col }));
      }
      setAllOffices(all);
    } catch (e) { console.error(e); }
  }

  async function lookupOffice(officeId: string) {
    if (!officeId || officeId.length < 3) { setOfficeInfo(null); return; }
    setLookingUp(true);
    try {
      const cols = ["offices", "subdivisions", "divisions", "regions", "circles"];
      for (const col of cols) {
        const snap = await getDoc(doc(db, col, officeId));
        if (snap.exists()) {
          setOfficeInfo({ ...snap.data(), found: true, level: col.replace(/s$/, "") });
          return;
        }
      }
      setOfficeInfo({ found: false });
    } catch { setOfficeInfo({ found: false }); }
    finally { setLookingUp(false); }
  }

  function handleSelectOffice(o: any) {
    const id = o.id || o.code;
    setForm(f => ({ ...f, officeId: id }));
    setOfficeSearchTerm(`${o.name} (${id})`);
    setShowOfficeDropdown(false);
    lookupOffice(id);
  }

  function openEditUser(u: any) {
    setEditingUserId(u.uid || u.id);
    setForm({
      employeeId: u.employeeId,
      name: u.name,
      designation: u.designation || "",
      role: u.role,
      officeId: u.officeId || u.officeCode || "",
    });
    setOfficeSearchTerm(`${u.officeName || ""} (${u.officeId || u.officeCode || ""})`);
    lookupOffice(u.officeId || u.officeCode || "");
    setView("create");
    window.scrollTo(0, 0);
  }

  async function handleDeleteUser(uid: string, name: string) {
    if (!window.confirm(`⚠️ Delete ${name}? This cannot be undone.`)) return;
    try {
      await deleteDoc(doc(db, "users", uid));
      showToast(`🗑️ ${name} deleted`);
      fetchUsers();
    } catch (e: any) { showToast("Error: " + e.message); }
  }

  async function handleSave() {
    const { employeeId, name, role, officeId } = form;
    if (!employeeId || !name || !role || !officeId) {
      setFormError("Employee ID, Name, Role and Office are all required"); return;
    }
    if (!officeInfo?.found) {
      setFormError("Valid office not selected. Choose from dropdown."); return;
    }
    setFormError(""); setCreating(true);
    try {
      const profileData: any = {
        employeeId: employeeId.toUpperCase(),
        name, designation: form.designation, role,
        officeId, officeName: officeInfo.name || "",
        officeType: officeInfo.type || officeInfo.level || "",
        circleCode:   officeInfo.circleCode   || (officeInfo.level === "circle"       ? officeInfo.code : null),
        regionId:     officeInfo.regionId     || (officeInfo.level === "region"       ? officeInfo.code : null),
        divisionCode: officeInfo.divisionCode || (officeInfo.level === "division"     ? officeInfo.code : null),
        subDivCode:   officeInfo.subDivCode   || (officeInfo.level === "subdivision"  ? officeInfo.code : null),
        hoCode:       officeInfo.hoCode       || (officeInfo.type === "HO"            ? officeId : null),
        soCode:       officeInfo.soCode       || (officeInfo.type === "SO"            ? officeId : null),
        officeCode: officeId,
        updatedAt: serverTimestamp(),
      };

      if (editingUserId) {
        await updateDoc(doc(db, "users", editingUserId), profileData);
        showToast("✅ User updated!");
      } else {
        const email = `${employeeId.toLowerCase()}@poecr.in`;
        const tempPassword = `ECR@${employeeId}`;
        
        const secondaryAuth = getSecondaryAuth(getSecondaryApp());
        const cred = await createUser(secondaryAuth, email, tempPassword);
        await secondaryAuth.signOut();

        profileData.uid = cred.user.uid;
        profileData.email = email;
        profileData.isActive = true;
        profileData.mustResetPassword = true;
        profileData.createdBy = profile?.uid;
        profileData.createdAt = serverTimestamp();
        
        await setDoc(doc(db, "users", cred.user.uid), profileData);
        setLastCreated({ ...profileData, tempPassword });
        showToast("✅ User created!");
      }
      resetForm();
      fetchUsers();
    } catch (e: any) { setFormError(e.message); }
    finally { setCreating(false); }
  }

  function resetForm() {
    setForm({ employeeId: "", name: "", designation: "", role: "", officeId: "" });
    setOfficeSearchTerm(""); setOfficeInfo(null); setEditingUserId(null);
    setView("list");
  }

  async function handleBulkUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setBulkStatus({ uploading: true, progress: 0, current: 0, total: 0, errors: [] });
    const errors: any[] = [];
    let ok = 0;

    const XLSX = await import("xlsx");
    const reader = new FileReader();
    
    // A simple delay function to prevent Firebase rate-limiting
    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    reader.onload = async (evt) => {
      const wb = XLSX.read(evt.target?.result, { type: "binary" });
      const rows: any[] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
      
      setBulkStatus(prev => ({ ...prev, total: rows.length }));

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowNum = i + 2; 
        
        let success = false;
        let attempts = 0;

        // Retry loop in case we hit a rate limit
        while (!success && attempts < 2) {
          try {
            attempts++;
            const employeeId = String(row.EmployeeID || "").trim().toUpperCase();
            const name = String(row.Name || "").trim();
            const officeId = String(row.OfficeID || row.OfficeCode || "").trim();
            const role = String(row.Role || creatableRoles[0] || "office_user").trim();
            
            if (!employeeId || !name || !officeId) {
              throw new Error("Missing required fields (EmployeeID, Name, or OfficeID)");
            }
            
            const officeSnap = await getDoc(doc(db, "offices", officeId));
            if (!officeSnap.exists()) {
               throw new Error(`Office ID ${officeId} not found in database`);
            }

            const od = officeSnap.data();
            const email = `${employeeId.toLowerCase()}@poecr.in`;
            const tempPassword = `ECR@${employeeId}`;
            
            const secondaryAuth = getSecondaryAuth(getSecondaryApp());
            const cred = await createUser(secondaryAuth, email, tempPassword);
            await secondaryAuth.signOut();

            await setDoc(doc(db, "users", cred.user.uid), {
              uid: cred.user.uid, employeeId, email, name,
              designation: String(row.Designation || "").trim(),
              role, officeId, officeName: od.name || "", officeType: od.type || "",
              circleCode: od.circleCode || null, regionId: od.regionId || null,
              divisionCode: od.divisionCode || null, subDivCode: od.subDivCode || null,
              hoCode: od.hoCode || null, soCode: od.soCode || null, officeCode: officeId,
              isActive: true, mustResetPassword: true,
              createdBy: profile?.uid, createdAt: serverTimestamp(),
            });
            success = true;
            ok++;
          } catch (err: any) { 
            // Catch Firebase rate limits and wait 10 seconds before retrying
            if (err.code === "auth/too-many-requests" || err.message?.includes("too-many-requests")) {
              if (attempts < 2) {
                await sleep(10000); // 10 second backoff
              } else {
                errors.push({ row: rowNum, employeeId: row.EmployeeID, reason: "Rate limited by Firebase. Slow down." });
              }
            } else {
              errors.push({ row: rowNum, employeeId: row.EmployeeID, reason: err.message });
              break; // Break the while loop for other normal errors
            }
          }
        }
        
        setBulkStatus(prev => ({ 
          ...prev, 
          progress: Math.floor(((i + 1) / rows.length) * 100),
          current: i + 1,
          errors
        }));

        // CRUCIAL: Wait 1.5 seconds between every single user to prevent triggering the block
        if (i < rows.length - 1) {
          await sleep(1500);
        }
      }
      
      setBulkStatus(prev => ({ ...prev, uploading: false }));
      showToast(`Bulk Upload Complete! ${ok} created successfully.`);
      fetchUsers();
    };
    reader.readAsBinaryString(file);
    e.target.value = ""; 
  }

  function handleExport() {
    import("xlsx").then(XLSX => {
      const dataToExport = filtered.map(u => ({
        OfficeID: u.officeId || u.officeCode || "",
        OfficeName: u.officeName || "",
        EmployeeID: u.employeeId || "",
        Name: u.name || "",
        Designation: u.designation || "",
        Role: ROLE_LABELS[u.role] || u.role,
        Email: u.email || "",
        Status: u.isActive ? "Active" : "Suspended"
      }));

      const ws = XLSX.utils.json_to_sheet(dataToExport);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Users");
      XLSX.writeFile(wb, "ECR_Users_Export.xlsx");
    });
  }

  function downloadTemplate() {
    import("xlsx").then(XLSX => {
      const ws = XLSX.utils.aoa_to_sheet([
        ["OfficeID", "EmployeeID", "Name", "Designation", "Role"],
        ["12100675", "EMP001", "Raju Kumar", "Postmaster", "office_user"],
        ["12660179", "EMP002", "Priya Devi", "SO Incharge", "so_admin"],
        ["12360006", "EMP003", "Amit Singh", "HO Postmaster", "ho_admin"],
        ["12640010", "EMP004", "Mridul Kalita", "Inspector", "subdivision_admin"],
      ]);
      ws["!cols"] = Array(5).fill({ wch: 20 });
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Users");
      XLSX.writeFile(wb, "ECR_Users_Template.xlsx");
    });
  }

  function showToast(msg: string) {
    setToast(msg); setTimeout(() => setToast(""), 4000);
  }

  const filtered = users.filter(u =>
    u.name?.toLowerCase().includes(search.toLowerCase()) ||
    u.employeeId?.toLowerCase().includes(search.toLowerCase()) ||
    u.officeName?.toLowerCase().includes(search.toLowerCase()) ||
    u.officeId?.includes(search)
  );

  const roleColors: Record<string, [string, string]> = {
    superadmin:        ["#F3E8FF", "#6B21A8"],
    circle_admin:      ["#DBEAFE", "#1D4ED8"],
    region_admin:      ["#E0F2FE", "#0369A1"],
    division_admin:    ["#CCFBF1", "#0F766E"],
    subdivision_admin: ["#DCFCE7", "#15803D"],
    ho_admin:          ["#FEF9C3", "#854D0E"],
    so_admin:          ["#FFEDD5", "#9A3412"],
    office_user:       ["#FEE2E2", "#991B1B"],
  };

  return (
    <div style={{ paddingBottom: 80 }}>
      <div style={{
        background: "linear-gradient(135deg, #0D47A1, #1E88E5)",
        padding: "16px 16px 20px", color: "#fff",
        display: "flex", justifyContent: "space-between", alignItems: "center"
      }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>User Management</h1>
          <div style={{ fontSize: 13, opacity: 0.85 }}>{users.length} users in scope</div>
        </div>
        {canAddUser && (
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => view === "create" ? resetForm() : setView("create")}
              style={headerBtn}>
              {view === "create" ? "← Back" : "+ New"}
            </button>
            <button onClick={() => setView(view === "bulk" ? "list" : "bulk")} style={headerBtn}>
              {view === "bulk" ? "← Back" : "📤 Bulk"}
            </button>
          </div>
        )}
      </div>

      <div style={{ padding: "12px 12px 0" }}>

        {/* CREATE / EDIT FORM */}
        {view === "create" && (
          <div style={card}>
            <div style={cardTitle}>{editingUserId ? "Edit & Transfer User" : "Create New User"}</div>
            {formError && <div style={errorBox}>{formError}</div>}
            {lastCreated && !editingUserId && (
              <div style={successBox}>
                <strong>✅ User Created!</strong><br />
                Email: <code style={codeStyle}>{lastCreated.email}</code><br />
                Temp Password: <code style={codeStyle}>{lastCreated.tempPassword}</code><br />
                Office: <strong>{lastCreated.officeName}</strong><br />
                <small>⚠️ Share credentials securely.</small>
              </div>
            )}
            <div style={rowStyle}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Employee ID *</label>
                <input style={{ ...inputStyle, background: editingUserId ? "#F3F4F6" : "#fff" }}
                  value={form.employeeId} disabled={!!editingUserId}
                  onChange={e => setForm(f => ({ ...f, employeeId: e.target.value.toUpperCase() }))}
                  placeholder="e.g. EMP001" />
              </div>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Full Name *</label>
                <input style={inputStyle} value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Full name" />
              </div>
            </div>
            <div style={rowStyle}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Designation</label>
                <input style={inputStyle} value={form.designation}
                  onChange={e => setForm(f => ({ ...f, designation: e.target.value }))}
                  placeholder="e.g. Postmaster" />
              </div>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Role *</label>
                <select style={inputStyle} value={form.role}
                  onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
                  <option value="">— Select Role —</option>
                  {creatableRoles.map((r: string) => (
                    <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Office Autocomplete */}
            <div style={{ marginBottom: 10, position: "relative" }}>
              <label style={labelStyle}>Search & Select Office *</label>
              <input style={inputStyle}
                value={officeSearchTerm}
                onChange={e => {
                  setOfficeSearchTerm(e.target.value);
                  setShowOfficeDropdown(true);
                  if (!e.target.value) setOfficeInfo(null);
                }}
                onFocus={() => setShowOfficeDropdown(true)}
                placeholder="Type office name or ID…" />
              {showOfficeDropdown && officeSearchTerm && (
                <ul style={dropdownStyle}>
                  {allOffices
                    .filter(o =>
                      (o.name || "").toLowerCase().includes(officeSearchTerm.toLowerCase()) ||
                      (o.id || o.code || "").includes(officeSearchTerm)
                    )
                    .slice(0, 8)
                    .map(o => (
                      <li key={o.id} onClick={() => handleSelectOffice(o)} style={dropdownItem}>
                        <strong>{o.name}</strong>{" "}
                        <span style={{ fontSize: 11, color: "#718096" }}>({o.id || o.code})</span>
                        {o.type && <span style={{ fontSize: 10, color: "#A0AEC0" }}> · {o.type}</span>}
                      </li>
                    ))}
                </ul>
              )}
              {!lookingUp && officeInfo?.found && (
                <div style={{ marginTop: 6, padding: "8px 12px", borderRadius: 8,
                  background: "#F0FFF4", color: "#276749", fontSize: 13 }}>
                  ✅ <strong>{officeInfo.name}</strong>
                  {officeInfo.type && <span> · {officeInfo.type}</span>}
                  <div style={{ fontSize: 11, marginTop: 4, color: "#4A5568" }}>
                    {[officeInfo.circleCode, officeInfo.regionId,
                      officeInfo.divisionCode, officeInfo.subDivCode]
                      .filter(Boolean).join(" › ")}
                  </div>
                </div>
              )}
              {!lookingUp && officeInfo?.found === false && (
                <div style={{ marginTop: 6, padding: "8px 12px", borderRadius: 8,
                  background: "#FFF5F5", color: "#C53030", fontSize: 13 }}>
                  ❌ Office not found. Upload hierarchy first.
                </div>
              )}
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <button onClick={handleSave} disabled={creating} style={primaryBtn}>
                {creating ? "Saving…" : editingUserId ? "Update User" : "Create User"}
              </button>
              {editingUserId && (
                <button onClick={resetForm} style={cancelBtn}>Cancel</button>
              )}
            </div>
          </div>
        )}

        {/* BULK UPLOAD */}
        {view === "bulk" && (
          <div style={card}>
            <div style={cardTitle}>Bulk Upload from Excel</div>
            <p style={{ fontSize: 13, color: "#718096", marginBottom: 10 }}>
              Columns: <code style={codeStyle}>OfficeID | EmployeeID | Name | Designation | Role</code>
            </p>
            <button onClick={downloadTemplate} style={linkBtn}>📥 Download Template</button>
            
            {bulkStatus.uploading ? (
              <div style={{ padding: 20, textAlign: "center" }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#2B6CB0", marginBottom: 6 }}>
                  Uploading & Creating Users... {bulkStatus.progress}%
                </div>
                <div style={{ fontSize: 12, color: "#4A5568", marginBottom: 10 }}>
                  Processed {bulkStatus.current} of {bulkStatus.total} users<br/>
                  <small>(Throttled at ~1.5s per user to prevent rate limits)</small>
                </div>
                <div style={{ width: "100%", background: "#E2E8F0", borderRadius: 8, height: 10, overflow: "hidden" }}>
                  <div style={{ width: `${bulkStatus.progress}%`, background: "#3182CE", height: "100%", transition: "width 0.2s" }} />
                </div>
              </div>
            ) : (
              <label style={uploadZone}>
                <input type="file" accept=".xlsx,.xls"
                  onChange={handleBulkUpload} style={{ display: "none" }} />
                📤 Choose Excel File
              </label>
            )}

            {/* Error Report Display */}
            {!bulkStatus.uploading && bulkStatus.errors.length > 0 && (
              <div style={{ marginTop: 20 }}>
                <h4 style={{ color: "#C53030", margin: "0 0 10px 0", fontSize: 14 }}>⚠️ Some rows failed to import:</h4>
                <div style={{ maxHeight: 200, overflowY: "auto", border: "1px solid #FC8181", borderRadius: 8 }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead style={{ background: "#FFF5F5", position: "sticky", top: 0 }}>
                      <tr>
                        <th style={{ padding: 8, textAlign: "left", borderBottom: "1px solid #FC8181", color: "#C53030" }}>Row</th>
                        <th style={{ padding: 8, textAlign: "left", borderBottom: "1px solid #FC8181", color: "#C53030" }}>EmployeeID</th>
                        <th style={{ padding: 8, textAlign: "left", borderBottom: "1px solid #FC8181", color: "#C53030" }}>Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bulkStatus.errors.map((err, idx) => (
                        <tr key={idx} style={{ borderBottom: "1px solid #FED7D7" }}>
                          <td style={{ padding: 8, color: "#4A5568" }}>{err.row}</td>
                          <td style={{ padding: 8, color: "#4A5568" }}>{err.employeeId || "N/A"}</td>
                          <td style={{ padding: 8, color: "#C53030" }}>{err.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* SEARCH + LIST */}
        {view === "list" && (
          <>
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <input style={{ ...inputStyle, flex: 1 }}
                placeholder="Search by name, ID or office…"
                value={search} onChange={e => setSearch(e.target.value)} />
              <button onClick={handleExport} style={{ ...headerBtn, background: "#10B981", border: "none" }}>
                📥 Export
              </button>
            </div>
            
            {loading ? (
              <div style={{ textAlign: "center", padding: 40, color: "#A0AEC0" }}>Loading…</div>
            ) : filtered.length === 0 ? (
              <div style={{ textAlign: "center", padding: 40, color: "#A0AEC0" }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>👥</div>
                <div style={{ fontSize: 15, fontWeight: 600 }}>No users found</div>
              </div>
            ) : (
              filtered.map((u: any) => {
                const [bg, text] = roleColors[u.role] || ["#F1F5F9", "#334155"];
                const isSelf = (u.uid || u.id) === user?.uid;
                const canEditThisUser = editableRoles === "ALL" || (Array.isArray(editableRoles) && editableRoles.includes(u.role));

                return (
                  <div key={u.uid || u.id} style={{ ...officeCard, opacity: u.isActive ? 1 : 0.6 }}>
                    <div style={{ display: "flex", justifyContent: "space-between",
                      alignItems: "flex-start", marginBottom: 4 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 15, fontWeight: 600, color: "#1A202C" }}>
                          {u.name} {isSelf && <span style={{ color: "#718096", fontSize: 12 }}>(You)</span>}
                        </div>
                        <div style={{ fontSize: 12, color: "#718096" }}>{u.employeeId} · {u.designation}</div>
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 600, background: bg, color: text,
                        padding: "3px 10px", borderRadius: 20, whiteSpace: "nowrap" as const }}>
                        {ROLE_LABELS[u.role] || u.role}
                      </span>
                    </div>
                    {u.officeName && (
                      <div style={{ fontSize: 12, color: "#1565C0", fontWeight: 500, marginBottom: 4 }}>
                        🏢 {u.officeName} ({u.officeId || u.officeCode})
                      </div>
                    )}
                    <div style={{ fontSize: 12, color: "#A0AEC0", marginBottom: 10 }}>{u.email}</div>
                    
                    {/* Action Buttons (Restricted by Role & Self) */}
                    {!isSelf && canEditThisUser && (
                      <div style={{ display: "flex", gap: 8, borderTop: "1px dashed #E2E8F0", paddingTop: 10 }}>
                        <button onClick={() => openEditUser(u)}
                          style={{ ...actionBtn, color: "#2563EB", background: "#EFF6FF" }}>
                          ✏️ Edit
                        </button>
                        
                        <button onClick={() => handleDeleteUser(u.uid || u.id, u.name)}
                          style={{ ...actionBtn, color: "#DC2626", background: "#FEF2F2" }}>
                          🗑️ Delete
                        </button>
                        
                        <button onClick={async () => { await toggleUserActive(u.uid || u.id, u.isActive); fetchUsers(); }}
                          style={{ ...actionBtn,
                            color: u.isActive ? "#D97706" : "#16A34A",
                            background: u.isActive ? "#FEF3C7" : "#DCFCE7" }}>
                          {u.isActive ? "⏸️ Suspend" : "▶️ Activate"}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </>
        )}
      </div>

      {toast && (
        <div style={{ position: "fixed", bottom: 80, left: "50%",
          transform: "translateX(-50%)", background: "#2D3748", color: "#fff",
          padding: "10px 20px", borderRadius: 24, fontSize: 13, zIndex: 300 }}>
          {toast}
        </div>
      )}
      <BottomNav />
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────
const headerBtn: React.CSSProperties = {
  background: "rgba(255,255,255,0.2)", border: "1px solid rgba(255,255,255,0.4)",
  color: "#fff", borderRadius: 8, padding: "7px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer"
};
const card: React.CSSProperties = {
  background: "#fff", border: "1px solid #E2E8F0", borderRadius: 12, padding: 16, marginBottom: 12
};
const cardTitle: React.CSSProperties = {
  fontSize: 13, fontWeight: 700, color: "#718096",
  textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 14
};
const rowStyle: React.CSSProperties = { display: "flex", gap: 10, marginBottom: 10 };
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
  flex: 2, padding: 12, background: "#1565C0", color: "#fff",
  border: "none", borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: "pointer"
};
const cancelBtn: React.CSSProperties = {
  flex: 1, padding: 12, background: "#E2E8F0", color: "#4A5568",
  border: "none", borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: "pointer"
};
const actionBtn: React.CSSProperties = {
  flex: 1, padding: "6px", fontSize: "12px", fontWeight: 600,
  border: "none", borderRadius: "6px", cursor: "pointer"
};
const linkBtn: React.CSSProperties = {
  display: "block", fontSize: 13, color: "#1565C0", background: "none",
  border: "none", cursor: "pointer", padding: 0, fontWeight: 500, marginBottom: 12
};
const uploadZone: React.CSSProperties = {
  display: "block", width: "100%", padding: 14, textAlign: "center",
  background: "#EBF8FF", color: "#1565C0", borderRadius: 10,
  border: "2px dashed #BEE3F8", cursor: "pointer", fontSize: 14,
  fontWeight: 500, boxSizing: "border-box"
};
const officeCard: React.CSSProperties = {
  background: "#fff", border: "1px solid #E2E8F0", borderRadius: 12, padding: "12px 14px", marginBottom: 10
};
const errorBox: React.CSSProperties = {
  background: "#FFF5F5", border: "1px solid #FC8181", borderRadius: 8,
  padding: "10px 14px", color: "#C53030", fontSize: 13, marginBottom: 12
};
const successBox: React.CSSProperties = {
  background: "#F0FFF4", border: "1px solid #9AE6B4", borderRadius: 8,
  padding: "12px 14px", color: "#276749", fontSize: 13, marginBottom: 12, lineHeight: 1.8
};
const codeStyle: React.CSSProperties = {
  background: "#EBF8FF", color: "#2B6CB0", padding: "1px 5px", borderRadius: 4, fontSize: 12
};
const dropdownStyle: React.CSSProperties = {
  position: "absolute", top: "100%", left: 0, right: 0,
  background: "#fff", border: "1px solid #E2E8F0",
  borderRadius: "0 0 8px 8px", zIndex: 10, maxHeight: 200,
  overflowY: "auto", listStyle: "none", padding: 0, margin: 0,
  boxShadow: "0 4px 6px -1px rgba(0,0,0,0.1)"
};
const dropdownItem: React.CSSProperties = {
  padding: "10px 12px", borderBottom: "1px solid #EDF2F7",
  fontSize: 13, cursor: "pointer", color: "#2D3748"
};