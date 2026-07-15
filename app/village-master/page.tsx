"use client";
import { useState, useEffect } from "react";
import { useAuth } from "../../context/AuthContext";
import { useRouter } from "next/navigation";
import { db } from "../firebase";
import {
  collection, getDocs, query, where, writeBatch, doc
} from "firebase/firestore";
import BottomNav from "../../components/BottomNav";

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

// Roles allowed to upload village master data
const MASTER_UPLOAD_ROLES = ["superadmin", "circle_admin", "region_admin", "division_admin", "subdivision_admin"];

export default function VillageMasterUploadPage() {
  const { profile, user } = useAuth();
  const router = useRouter();

  const [offices, setOffices] = useState<OfficeRow[]>([]);
  const [loadingOffices, setLoadingOffices] = useState(true);
  const [fileName, setFileName] = useState("");
  const [parsing, setParsing] = useState(false);
  const [matched, setMatched] = useState<MatchedRow[]>([]);
  const [unmatched, setUnmatched] = useState<ParsedRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadDone, setUploadDone] = useState(false);
  const [toast, setToast] = useState("");

  const canUpload = MASTER_UPLOAD_ROLES.includes(profile?.role || "");

  useEffect(() => {
    if (!user) { router.push("/"); return; }
    if (profile) {
      if (!MASTER_UPLOAD_ROLES.includes(profile.role || "")) {
        showToast("You don't have permission to access this page");
        router.push("/dashboard");
        return;
      }
      fetchOffices();
    }
  }, [user, profile]);

  function showToast(msg: string) {
    setToast(msg); setTimeout(() => setToast(""), 3500);
  }

  // Fetch offices within this admin's scope (mirrors daily-report scoping)
  async function fetchOffices() {
    setLoadingOffices(true);
    try {
      const role = profile?.role || "";
      const constraints: any[] = [];
      if (role === "circle_admin") constraints.push(where("circleCode", "==", (profile as any)?.circleCode));
      else if (role === "region_admin") constraints.push(where("regionId", "==", (profile as any)?.regionId));
      else if (role === "division_admin") constraints.push(where("divisionCode", "==", (profile as any)?.divisionCode));
      else if (role === "subdivision_admin") constraints.push(where("subDivCode", "==", (profile as any)?.subDivCode));
      // superadmin: no constraint, sees all offices

      const snap = await getDocs(
        constraints.length ? query(collection(db, "offices"), ...constraints) : collection(db, "offices")
      );
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as OfficeRow));
      setOffices(list);
    } catch (e: any) {
      showToast("Error loading offices: " + e.message);
    } finally {
      setLoadingOffices(false);
    }
  }

  function normalize(s: string) {
    return (s || "").toString().trim().toLowerCase();
  }

  // Build a lookup of office name -> office record
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

      // Detect header columns (tolerant of casing / minor wording differences)
      const header = rows[0].map((h: any) => normalize(String(h)));
      const officeCol = header.findIndex(h => h.includes("bo") || h.includes("office"));
      const codeCol = header.findIndex(h => h.includes("village") && h.includes("code"));
      const nameCol = header.findIndex(h => h.includes("village") && h.includes("name"));

      if (officeCol === -1 || codeCol === -1 || nameCol === -1) {
        showToast("Could not find 'Name of BO', 'Village Code', 'Village Name' columns. Check the header row.");
        setParsing(false);
        return;
      }

      const officeLookup = buildOfficeLookup();
      const matchedRows: MatchedRow[] = [];
      const unmatchedRows: ParsedRow[] = [];

      // Village rows may leave "Name of BO" blank when repeating the previous office
      // (common in exported survey sheets) — carry the last seen office name forward.
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
        if (office) {
          matchedRows.push({ officeName, villageCode, villageName, office });
        } else {
          unmatchedRows.push({ officeName, villageCode, villageName });
        }
      }

      setMatched(matchedRows);
      setUnmatched(unmatchedRows);

      if (matchedRows.length === 0 && unmatchedRows.length === 0) {
        showToast("No valid rows found in file");
      }
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
      const CHUNK = 400; // stay under Firestore's 500-write batch limit
      let done = 0;

      for (let i = 0; i < matched.length; i += CHUNK) {
        const chunk = matched.slice(i, i + CHUNK);
        const batch = writeBatch(db);

        chunk.forEach(row => {
          const docId = `${row.office.id}_${row.villageCode}`;
          const ref = doc(db, "villageData", docId);
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
          }, { merge: true }); // merge — never overwrites existing D–P survey data
        });

        await batch.commit();
        done += chunk.length;
        setUploadProgress(Math.round((done / matched.length) * 100));
      }

      setUploadDone(true);
      showToast(`✅ Uploaded ${matched.length} villages successfully!`);
    } catch (e: any) {
      showToast("Upload error: " + e.message);
    } finally {
      setUploading(false);
    }
  }

  function resetForm() {
    setFileName("");
    setMatched([]);
    setUnmatched([]);
    setUploadDone(false);
    setUploadProgress(0);
  }

  async function downloadUnmatchedTemplate() {
    const XLSX = await import("xlsx");
    const rows = unmatched.map((r, i) => ({
      Rank: i + 1,
      "Name of BO": r.officeName,
      "Village Code": r.villageCode,
      "Village Name": r.villageName,
      Issue: "Office name not found — check spelling / office master list",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = Array(5).fill({ wch: 22 });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Unmatched");
    XLSX.writeFile(wb, "Unmatched_Offices.xlsx");
  }

  if (!canUpload) return null;

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
              Village Master Upload
            </h1>
            <div style={{ fontSize: 13, opacity: .85 }}>
              {loadingOffices ? "Loading offices…" : `${offices.length} offices in your scope`}
            </div>
          </div>
          <button onClick={() => router.push("/dashboard")} style={hBtn}>← Back</button>
        </div>
      </div>

      <div style={{ padding: "12px 12px 0" }}>

        {/* Instructions */}
        <div style={card}>
          <div style={sHead}>📋 File Format Required</div>
          <div style={{ fontSize: 13, color: "#4A5568", lineHeight: 1.6 }}>
            Upload an Excel (.xlsx) file with exactly these 3 columns in the header row:
          </div>
          <div style={{
            display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" as const
          }}>
            {["Name of BO", "Village Code", "Village Name"].map(c => (
              <span key={c} style={{
                fontSize: 12, fontWeight: 700, background: "#EBF8FF",
                color: "#1D4ED8", padding: "4px 10px", borderRadius: 8
              }}>{c}</span>
            ))}
          </div>
          <div style={{ fontSize: 12, color: "#A0AEC0", marginTop: 10 }}>
            "Name of BO" must match an office name already in the system exactly (case-insensitive).
            Only villages under offices in your scope will be matched.
          </div>
        </div>

        {/* Upload box */}
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
            <input
              type="file"
              accept=".xlsx,.xls"
              disabled={loadingOffices}
              onChange={handleFile}
              style={{ display: "none" }}
            />
          </label>

          {parsing && (
            <div style={{ textAlign: "center" as const, padding: 16, color: "#A0AEC0", fontSize: 13 }}>
              Parsing file…
            </div>
          )}
        </div>

        {/* Preview / results */}
        {!parsing && (matched.length > 0 || unmatched.length > 0) && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
              <div style={{
                background: "#F0FFF4", border: "1px solid #9AE6B4", borderRadius: 10,
                padding: "10px 12px", textAlign: "center" as const
              }}>
                <div style={{ fontSize: 9, color: "#15803D", fontWeight: 700, textTransform: "uppercase" as const }}>
                  Matched
                </div>
                <div style={{ fontSize: 20, fontWeight: 800, color: "#15803D" }}>{matched.length}</div>
              </div>
              <div style={{
                background: unmatched.length ? "#FEF2F2" : "#F7FAFC",
                border: `1px solid ${unmatched.length ? "#FECACA" : "#E2E8F0"}`, borderRadius: 10,
                padding: "10px 12px", textAlign: "center" as const
              }}>
                <div style={{ fontSize: 9, color: unmatched.length ? "#DC2626" : "#A0AEC0", fontWeight: 700, textTransform: "uppercase" as const }}>
                  Unmatched
                </div>
                <div style={{ fontSize: 20, fontWeight: 800, color: unmatched.length ? "#DC2626" : "#A0AEC0" }}>{unmatched.length}</div>
              </div>
            </div>

            {unmatched.length > 0 && (
              <div style={{ ...card, borderColor: "#FECACA" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#DC2626" }}>
                    ⚠️ {unmatched.length} office name{unmatched.length > 1 ? "s" : ""} not found
                  </div>
                  <button onClick={downloadUnmatchedTemplate} style={{
                    padding: "6px 12px", background: "#DC2626", color: "#fff",
                    border: "none", borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: "pointer"
                  }}>
                    📥 Download List
                  </button>
                </div>
                <div style={{ fontSize: 12, color: "#718096", marginBottom: 8 }}>
                  These rows will be skipped. Fix the office name spelling and re-upload just these rows.
                </div>
                <div style={{ maxHeight: 160, overflowY: "auto" as const }}>
                  {unmatched.slice(0, 20).map((r, i) => (
                    <div key={i} style={{ fontSize: 12, padding: "4px 0", borderBottom: "1px solid #FEE2E2", color: "#4A5568" }}>
                      "{r.officeName}" — {r.villageName} ({r.villageCode})
                    </div>
                  ))}
                  {unmatched.length > 20 && (
                    <div style={{ fontSize: 11, color: "#A0AEC0", marginTop: 6 }}>
                      +{unmatched.length - 20} more — download the list to see all
                    </div>
                  )}
                </div>
              </div>
            )}

            {matched.length > 0 && !uploadDone && (
              <div style={card}>
                <div style={sHead}>✅ Ready to Upload ({matched.length} villages)</div>
                <div style={{ maxHeight: 200, overflowY: "auto" as const, marginBottom: 12 }}>
                  {matched.slice(0, 15).map((r, i) => (
                    <div key={i} style={{
                      display: "flex", justifyContent: "space-between",
                      fontSize: 12, padding: "6px 0", borderBottom: "1px solid #F7FAFC"
                    }}>
                      <span style={{ color: "#1A202C", fontWeight: 600 }}>{r.villageName}</span>
                      <span style={{ color: "#A0AEC0" }}>{r.office.name} · {r.villageCode}</span>
                    </div>
                  ))}
                  {matched.length > 15 && (
                    <div style={{ fontSize: 11, color: "#A0AEC0", marginTop: 6 }}>
                      +{matched.length - 15} more rows
                    </div>
                  )}
                </div>

                {uploading ? (
                  <div>
                    <div style={{
                      height: 8, background: "#E2E8F0", borderRadius: 4, overflow: "hidden", marginBottom: 8
                    }}>
                      <div style={{
                        height: "100%", width: `${uploadProgress}%`,
                        background: "#1565C0", transition: "width .3s"
                      }} />
                    </div>
                    <div style={{ textAlign: "center" as const, fontSize: 12, color: "#718096" }}>
                      Uploading… {uploadProgress}%
                    </div>
                  </div>
                ) : (
                  <button onClick={handleUpload} style={{
                    width: "100%", padding: 12, background: "#1565C0", color: "#fff",
                    border: "none", borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: "pointer"
                  }}>
                    📤 Upload {matched.length} Villages
                  </button>
                )}
              </div>
            )}

            {uploadDone && (
              <div style={{
                background: "#F0FFF4", border: "1px solid #9AE6B4", borderRadius: 12,
                padding: "16px", textAlign: "center" as const, marginBottom: 12
              }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#15803D", marginBottom: 4 }}>
                  {matched.length} villages uploaded successfully
                </div>
                <div style={{ fontSize: 12, color: "#718096", marginBottom: 12 }}>
                  BO/SO/HO users can now fill in survey data for these villages.
                </div>
                <button onClick={resetForm} style={{
                  padding: "8px 16px", background: "#1565C0", color: "#fff",
                  border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer"
                }}>
                  Upload Another File
                </button>
              </div>
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

const card: React.CSSProperties = {
  background: "#fff", border: "1px solid #E2E8F0",
  borderRadius: 12, padding: 16, marginBottom: 12
};

const sHead: React.CSSProperties = {
  fontSize: 13, fontWeight: 700, color: "#718096",
  textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 12
};

const hBtn: React.CSSProperties = {
  background: "rgba(255,255,255,0.2)", border: "1px solid rgba(255,255,255,0.4)",
  color: "#fff", borderRadius: 8, padding: "7px 14px",
  fontSize: 12, fontWeight: 600, cursor: "pointer"
};
