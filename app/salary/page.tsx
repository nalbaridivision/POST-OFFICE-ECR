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

interface SalaryRow {
  officeCode: string;
  officeName: string;
  employeeId: string;
  name: string;
  designation: string;
  grossSalary: number;
}

interface ExpenseHead {
  id: string;
  label: string;
  amount: string;
}

interface ReportRow {
  officeCode:   string;
  officeName:   string;
  income:       number;
  salary:       number;   // actual salary of that office
  otherExp:     number;   // proportional share of other expenses
  expenditure:  number;   // salary + otherExp
  profitLoss:   number;
  ecr:          number;
  posbToOpen:   number;
  empCount:     number;   // number of employees in this office
}

const SALARY_ROLES = ["superadmin", "circle_admin", "division_admin"];
const DELETE_ROLES = ["superadmin", "circle_admin", "region_admin", "division_admin"];

const DEFAULT_EXPENSES: ExpenseHead[] = [
  { id: "house_rent",  label: "House Rent",           amount: "" },
  { id: "electricity", label: "Electricity Bill",     amount: "" },
  { id: "safaiwala",   label: "Safaiwala Bills",      amount: "" },
  { id: "ta_bills",    label: "TA Bills",             amount: "" },
  { id: "cea",         label: "CEA (Child Education)",amount: "" },
  { id: "medical",     label: "Medical Bills",        amount: "" },
  { id: "bonus",       label: "Bonus",                amount: "" },
  { id: "ts_bills",    label: "TS Bills",             amount: "" },
  { id: "other",       label: "Other Allowances",     amount: "" },
];

export default function SalaryPage() {
  const { profile, user } = useAuth();
  const router = useRouter();

  const [divisions,      setDivisions]      = useState<any[]>([]);
  const [allOffices,     setAllOffices]     = useState<any[]>([]);
  const [selectedDiv,    setSelectedDiv]    = useState("");
  const [selectedSubDiv, setSelectedSubDiv] = useState("");
  const [selectedMonth,  setSelectedMonth]  = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
  });

  const [step,           setStep]           = useState<1|2|3|4>(1);
  const [salaryRows,     setSalaryRows]     = useState<SalaryRow[]>([]);
  const [expenses,       setExpenses]       = useState<ExpenseHead[]>(DEFAULT_EXPENSES);
  const [customExpenses, setCustomExpenses] = useState<ExpenseHead[]>([]);
  const [reportData,     setReportData]     = useState<ReportRow[]>([]);
  const [sortKey,        setSortKey]        = useState<keyof ReportRow>("ecr");
  const [sortOrder,      setSortOrder]      = useState<"asc"|"desc">("desc");

  const [saving,       setSaving]       = useState(false);
  const [loading,      setLoading]      = useState(false);
  const [toast,        setToast]        = useState("");
  const [existingData, setExistingData] = useState<any>(null);
  const [mappedCount,  setMappedCount]  = useState(0);

  useEffect(() => {
    if (!user) { router.push("/"); return; }
    if (profile && !SALARY_ROLES.includes(profile.role)) return;
    fetchHierarchy();
  }, [user, profile]);

  useEffect(() => {
    setSelectedSubDiv("");
    setExistingData(null);
    setSalaryRows([]);
    setExpenses(DEFAULT_EXPENSES);
    setCustomExpenses([]);
    setReportData([]);
  }, [selectedDiv]);

  useEffect(() => {
    const scope = selectedSubDiv || selectedDiv;
    if (scope && selectedMonth) {
      checkExisting(scope, selectedMonth);
      countMappedOffices(scope);
    }
  }, [selectedDiv, selectedSubDiv, selectedMonth]);

  // ── ACCESS DENIED ─────────────────────────────────────────────
  if (profile && !SALARY_ROLES.includes(profile.role)) {
    return (
      <div style={accessDenied}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🚫</div>
        <h2 style={{ color: "#C53030", margin: "0 0 8px" }}>Access Denied</h2>
        <p style={{ color: "#718096", fontSize: 14, maxWidth: 280 }}>
          Only Circle Office and Division Office users can upload expenditure.
        </p>
        <button onClick={() => router.push("/dashboard")} style={backBtnStyle}>
          ← Back to Dashboard
        </button>
      </div>
    );
  }

  async function fetchHierarchy() {
    setLoading(true);
    try {
      let divSnap;
      if (profile?.role === "superadmin" || profile?.role === "circle_admin") {
        divSnap = await getDocs(collection(db, "divisions"));
      } else {
        divSnap = await getDocs(query(collection(db, "divisions"),
          where("code", "==", profile?.divisionCode)));
      }
      setDivisions(divSnap.docs.map(d => ({ id: d.id, ...d.data() })));

      const [subSnap, offSnap] = await Promise.all([
        getDocs(collection(db, "subdivisions")),
        getDocs(collection(db, "offices")),
      ]);
      setAllOffices([
        ...subSnap.docs.map(d => ({ id: d.id, ...d.data(), _col: "subdivisions" })),
        ...offSnap.docs.map(d => ({ id: d.id, ...d.data(), _col: "offices" })),
      ]);

      if (profile?.role === "division_admin" && profile.divisionCode) {
        setSelectedDiv(profile.divisionCode);
      }
    } catch (e: any) { showToast("Error: " + e.message); }
    finally { setLoading(false); }
  }

  function countMappedOffices(scope: string) {
    const count = allOffices.filter((o: any) => {
      if (o._col !== "offices") return false;
      if (selectedSubDiv) return o.subDivCode === selectedSubDiv;
      return o.divisionCode === selectedDiv;
    }).length;
    setMappedCount(count);
  }

  async function checkExisting(scope: string, month: string) {
    const key  = `${scope}_${month.replace("-","")}`;
    const snap = await getDoc(doc(db, "expenditure", key));
    if (snap.exists()) {
      const data = snap.data();
      setExistingData(data);
      if (data.salaryRows)     setSalaryRows(data.salaryRows);
      if (data.expenses)       setExpenses(data.expenses);
      if (data.customExpenses) setCustomExpenses(data.customExpenses);
    } else {
      setExistingData(null);
      setSalaryRows([]);
      setExpenses(DEFAULT_EXPENSES);
      setCustomExpenses([]);
      setReportData([]);
    }
  }

  async function handleExcelUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const XLSX = await import("xlsx");
    const reader = new FileReader();
    reader.onload = async (evt) => {
      const wb   = XLSX.read(evt.target?.result, { type: "binary" });
      const rows: any[] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
      const officeMap: Record<string,string> = {};
      allOffices.filter((o:any) => o._col==="offices")
        .forEach((o:any) => { officeMap[o.id] = o.name || o.id; });

      const mapped: SalaryRow[] = rows.map(r => {
        const officeCode = String(r.OfficeCode || r["Office Code"] || "").trim();
        return {
          officeCode,
          officeName:  officeMap[officeCode] || officeCode,
          employeeId:  String(r.EmployeeID   || r["Employee ID"] || "").trim(),
          name:        String(r.Name         || "").trim(),
          designation: String(r.Designation  || "").trim(),
          grossSalary: parseFloat(r.GrossSalary || r["Gross Salary"] || 0),
        };
      }).filter(r => r.employeeId && r.name);
      setSalaryRows(mapped);
      showToast(`✅ ${mapped.length} employees loaded`);
    };
    reader.readAsBinaryString(file);
    e.target.value = "";
  }

  function downloadTemplate() {
    import("xlsx").then(XLSX => {
      const scopeOffices = allOffices.filter((o:any) => {
        if (o._col !== "offices") return false;
        if (selectedSubDiv) return o.subDivCode === selectedSubDiv;
        if (selectedDiv)    return o.divisionCode === selectedDiv;
        return true;
      });
      const header   = [["OfficeCode","OfficeName","EmployeeID","Name","Designation","GrossSalary"]];
      const examples = scopeOffices.slice(0,3).map(o =>
        [o.id, o.name, "EMP001", "Employee Name", "Postmaster", 45000]
      );
      const ws = XLSX.utils.aoa_to_sheet([
        ...header,
        ...(examples.length > 0 ? examples : [
          ["12360006","Nalbari H.O","EMP001","Raju Kumar","Postmaster",45000],
          ["12660179","Mukalmua S.O","EMP002","Priya Devi","SO Incharge",38000],
          ["12100675","Adabari B.O","EMP003","Amit GDS","GDS",12000],
        ])
      ]);
      ws["!cols"] = Array(6).fill({ wch: 20 });
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Salary");
      XLSX.writeFile(wb, "ECR_Salary_Template.xlsx");
    });
  }

  function downloadReport() {
    import("xlsx").then(XLSX => {
      const header = [[
        "Office Code","Office Name","Employees",
        "Office Salary (₹)","Other Exp Share (₹)","Total Expenditure (₹)",
        "Total Income (₹)","Profit/Loss (₹)","ECR (%)","POSB Needed to 100%"
      ]];
      const data = sortedReportData.map(r => [
        r.officeCode, r.officeName, r.empCount,
        r.salary, r.otherExp, r.expenditure,
        r.income, r.profitLoss, r.ecr.toFixed(2), r.posbToOpen
      ]);
      const ws = XLSX.utils.aoa_to_sheet([...header, ...data]);
      ws["!cols"] = Array(10).fill({ wch: 18 });
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "ECR_Report");
      XLSX.writeFile(wb,
        `ECR_Report_${selectedDiv}_${selectedMonth}.xlsx`);
    });
  }

  function updateExpense(id: string, amount: string) {
    setExpenses(prev => prev.map(e => e.id===id ? {...e, amount} : e));
  }

  function updateSalaryRow(idx: number, field: keyof SalaryRow, value: string) {
    setSalaryRows(prev => prev.map((r,i) =>
      i===idx ? {...r, [field]: field==="grossSalary" ? parseFloat(value)||0 : value} : r
    ));
  }

  const totalSalary      = salaryRows.reduce((a,r) => a+(r.grossSalary||0), 0);
  const totalExpenses    = [
    ...expenses.map(e => parseFloat(e.amount)||0),
    ...customExpenses.map(e => parseFloat(e.amount)||0),
  ].reduce((a,b) => a+b, 0);
  const totalExpenditure = totalSalary + totalExpenses;

  const scope    = selectedSubDiv || selectedDiv;
  const scopeKey = scope ? `${scope}_${selectedMonth.replace("-","")}` : "";

  async function handleSave() {
    if (!scope || !selectedMonth) {
      showToast("Select Division and month"); return;
    }
    if (existingData) {
      showToast("⚠️ Data exists. Higher authority must delete first."); return;
    }
    setSaving(true);
    try {
      const mappedOffices = allOffices
        .filter((o:any) => {
          if (o._col !== "offices") return false;
          if (selectedSubDiv) return o.subDivCode === selectedSubDiv;
          return o.divisionCode === selectedDiv;
        })
        .map((o:any) => o.id);

      await setDoc(doc(db, "expenditure", scopeKey), {
        scopeCode:       scope,
        divisionCode:    selectedDiv,
        subDivCode:      selectedSubDiv || null,
        month:           selectedMonth,
        salaryRows,
        expenses,
        customExpenses,
        totalSalary,
        totalExpenses,
        totalExpenditure,
        mappedOffices,
        submittedBy:     profile?.uid,
        submittedByName: profile?.name || "",
        submittedAt:     serverTimestamp(),
        updatedAt:       serverTimestamp(),
      });

      // Fetch income for this scope ONCE
      const scopeIncomeSnap = await getDoc(doc(db, "income", scopeKey));
      const scopeIncomeData = scopeIncomeSnap.exists()
        ? scopeIncomeSnap.data() : null;

      console.log("📋 Income found:", !!scopeIncomeData,
        "| Total:", scopeIncomeData?.totalIncome);

      const generatedResults: ReportRow[] = [];

      for (const officeCode of mappedOffices) {
        const result = await calculateECR(
          officeCode,
          selectedMonth,
          mappedOffices.length,
          scopeIncomeData,
          salaryRows,      // ← APPROACH C: pass salary rows
          totalExpenses,   // ← APPROACH C: pass other expenses total
        );
        if (result) generatedResults.push(result);
      }

      setReportData(generatedResults);
      setStep(4);
      showToast(`✅ ECR calculated for ${generatedResults.length} offices!`);
      checkExisting(scope, selectedMonth);
    } catch (e: any) { showToast("Error: " + e.message); }
    finally { setSaving(false); }
  }

  // ── APPROACH C ECR CALCULATION ─────────────────────────────────
  // Office expenditure = actual office salary + equal share of other expenses
  async function calculateECR(
    officeCode:      string,
    month:           string,
    officeCount:     number,
    scopeIncomeData: any,
    allSalaryRows:   SalaryRow[],  // all salary rows across all offices
    totalOtherExp:   number,       // house rent + electricity + TA etc.
  ): Promise<ReportRow | null> {
    try {
      const key = `${officeCode}_${month.replace("-","")}`;

      // ── APPROACH C: Expenditure Calculation ───────────────────
      // Step 1: Get actual salary of employees in THIS office
      const officeEmployees = allSalaryRows.filter(
        r => r.officeCode === officeCode
      );
      const officeSalary = officeEmployees.reduce(
        (sum, r) => sum + (r.grossSalary || 0), 0
      );

      // Step 2: Split other expenses equally across all offices
      const otherExpShare = Math.round(
        totalOtherExp / Math.max(officeCount, 1)
      );

      // Step 3: Total expenditure for this office
      const expenditure = officeSalary + otherExpShare;

      // ── Income Calculation ────────────────────────────────────
      let income    = 0;
      let headsData: Record<string,number> = {};

      // Priority 1: Office has its own entry in the ledger
      if (scopeIncomeData?.officeWiseLedger &&
          Object.keys(scopeIncomeData.officeWiseLedger).length > 0) {
        let foundInLedger = false;
        Object.entries(scopeIncomeData.officeWiseLedger)
          .forEach(([headId, ledger]) => {
            const arr    = ledger as any[];
            const record = arr.find((r:any) => r.officeCode === officeCode);
            if (record) {
              income          += record.computedIncome || 0;
              headsData[headId] = record.value || 0;
              foundInLedger    = true;
            }
          });

        // If office not in ledger, split total equally
        if (!foundInLedger && scopeIncomeData.totalIncome) {
          income    = Math.round(
            scopeIncomeData.totalIncome / Math.max(officeCount, 1)
          );
          headsData = scopeIncomeData.computedHeads ||
                      scopeIncomeData.heads || {};
        }
      }
      // Priority 2: No ledger — split total income equally
      else if (scopeIncomeData?.totalIncome) {
        income    = Math.round(
          scopeIncomeData.totalIncome / Math.max(officeCount, 1)
        );
        headsData = scopeIncomeData.computedHeads ||
                    scopeIncomeData.heads || {};
      }
      // Priority 3: Check if office has its own income document
      else {
        const officeIncomeSnap = await getDoc(doc(db, "income", key));
        if (officeIncomeSnap.exists()) {
          const d    = officeIncomeSnap.data();
          income    = d.totalIncome || 0;
          headsData = d.computedHeads || d.heads || {};
        }
      }

      // Add custom heads income — split equally
      if (scopeIncomeData?.customHeads?.length > 0) {
        const customTotal = scopeIncomeData.customHeads.reduce(
          (sum: number, h: any) =>
            sum + (h.computed || parseFloat(h.value) || 0),
          0
        );
        income += Math.round(customTotal / Math.max(officeCount, 1));
      }

      // ── ECR Calculation ───────────────────────────────────────
      const ecr = expenditure > 0
        ? Math.round((income / expenditure) * 10000) / 100
        : income > 0 ? 100 : 0;

      const profitLoss = income - expenditure;
      const posbToOpen = profitLoss < 0
        ? Math.ceil(Math.abs(profitLoss) / 219.23) : 0;

      // ── Get office hierarchy ──────────────────────────────────
      const officeSnap = await getDoc(doc(db, "offices", officeCode));
      const od         = officeSnap.exists() ? officeSnap.data() : {} as any;
      const officeName = od.name || officeCode;

      // ── Debug log ─────────────────────────────────────────────
      console.log(
        `📊 ${officeName} (${officeCode})`,
        `| Salary: ₹${officeSalary}`,
        `| OtherExp: ₹${otherExpShare}`,
        `| Total Exp: ₹${expenditure}`,
        `| Income: ₹${income}`,
        `| ECR: ${ecr}%`
      );

      // ── Save to ECR collection ────────────────────────────────
      await setDoc(doc(db, "ecr", key), {
        officeCode,
        officeName,
        month,
        income,
        expenditure,
        salary:       officeSalary,
        otherExp:     otherExpShare,
        empCount:     officeEmployees.length,
        ecr,
        circleCode:   od.circleCode   || null,
        regionId:     od.regionId     || null,
        divisionCode: od.divisionCode || null,
        subDivCode:   od.subDivCode   || null,
        hoCode:       od.hoCode       || null,
        soCode:       od.soCode       || null,
        heads:        headsData,
        status:       ecr>=100?"good" : ecr>=80?"average" : "poor",
        updatedAt:    serverTimestamp(),
      }, { merge: true });

      return {
        officeCode, officeName,
        income, salary: officeSalary,
        otherExp: otherExpShare,
        expenditure, profitLoss, ecr, posbToOpen,
        empCount: officeEmployees.length,
      };

    } catch (e: any) {
      console.error(`ECR failed for ${officeCode}:`, e.message);
      return null;
    }
  }

  async function handleDelete() {
    if (!DELETE_ROLES.includes(profile?.role || "")) {
      showToast("No permission to delete."); return;
    }
    if (!window.confirm("Delete this expenditure record?")) return;
    try {
      await deleteDoc(doc(db, "expenditure", scopeKey));
      const ecrSnap = await getDocs(
        query(collection(db, "ecr"),
          where("month", "==", selectedMonth),
          selectedSubDiv
            ? where("subDivCode",   "==", selectedSubDiv)
            : where("divisionCode", "==", selectedDiv)
        )
      );
      for (const d of ecrSnap.docs) await deleteDoc(doc(db,"ecr",d.id));
      setExistingData(null); setSalaryRows([]);
      setExpenses(DEFAULT_EXPENSES); setCustomExpenses([]);
      setReportData([]); setStep(1);
      showToast("🗑️ Expenditure and ECR deleted.");
    } catch (e: any) { showToast("Error: " + e.message); }
  }

  function handleSort(key: keyof ReportRow) {
    if (sortKey===key) setSortOrder(o => o==="asc"?"desc":"asc");
    else { setSortKey(key); setSortOrder("desc"); }
  }

  const sortedReportData = [...reportData].sort((a,b) => {
    const av = a[sortKey], bv = b[sortKey];
    if (typeof av==="string" && typeof bv==="string")
      return sortOrder==="asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    return sortOrder==="asc"
      ? (av as number)-(bv as number)
      : (bv as number)-(av as number);
  });

  function showToast(msg: string) {
    setToast(msg); setTimeout(() => setToast(""), 4000);
  }

  const monthLabel = (m: string) => {
    if (!m) return "";
    const [y, mo] = m.split("-");
    return new Date(+y, +mo-1).toLocaleString("default",
      { month:"long", year:"numeric" });
  };

  const canDelete       = DELETE_ROLES.includes(profile?.role||"");
  const scopeOffices    = allOffices.filter((o:any) => {
    if (o._col !== "offices") return false;
    if (selectedSubDiv) return o.subDivCode === selectedSubDiv;
    if (selectedDiv)    return o.divisionCode === selectedDiv;
    return false;
  });
  const filteredSubDivs = allOffices.filter((o:any) =>
    o._col==="subdivisions" && o.divisionCode===selectedDiv
  );
  const salaryByOffice  = salaryRows.reduce((acc, row) => {
    const k = row.officeCode || "unknown";
    if (!acc[k]) acc[k] = [];
    acc[k].push(row);
    return acc;
  }, {} as Record<string,SalaryRow[]>);

  // Summary for step 2 — per office salary preview
  const officeSalarySummary = Object.entries(salaryByOffice).map(([code, rows]) => ({
    officeCode: code,
    officeName: rows[0]?.officeName || code,
    empCount:   rows.length,
    salary:     rows.reduce((a,r) => a+r.grossSalary, 0),
  }));

  return (
    <div style={{ paddingBottom: 80,
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>

      {/* Header */}
      <div style={{ background: "linear-gradient(135deg, #0D47A1, #1E88E5)",
        padding: "16px 16px 20px", color: "#fff",
        display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 2px" }}>
            Expenditure & ECR
          </h1>
          <div style={{ fontSize: 13, opacity: .85 }}>
            Salary + Expenses · Approach C (actual salary per office)
          </div>
        </div>
        <button onClick={() => router.push("/dashboard")} style={headerBtn}>
          ← Back
        </button>
      </div>

      {/* Step indicator */}
      <div style={{ display: "flex", background: "#fff",
        borderBottom: "1px solid #E2E8F0" }}>
        {[
          { n:1, label:"Scope"    },
          { n:2, label:"Salary"   },
          { n:3, label:"Expenses" },
          { n:4, label:"Report"   },
        ].map(s => (
          <div key={s.n}
            onClick={() => {
              if (s.n===4 && reportData.length===0) return;
              if (step>s.n || (s.n===4 && reportData.length>0))
                setStep(s.n as 1|2|3|4);
            }}
            style={{ flex:1, padding:"10px 4px",
              textAlign:"center" as const,
              borderBottom: step===s.n
                ? "3px solid #1565C0" : "3px solid transparent",
              cursor: (step>s.n||(s.n===4&&reportData.length>0))
                ? "pointer" : "default" }}>
            <div style={{ fontSize:11, fontWeight:700,
              color: step===s.n ? "#1565C0"
                : (step>s.n||(s.n===4&&reportData.length>0))
                  ? "#16A34A" : "#A0AEC0" }}>
              {step>s.n ? "✓" : s.n}. {s.label}
            </div>
          </div>
        ))}
      </div>

      <div style={{ padding: "12px 12px 0" }}>

        {/* ── STEP 1 ── */}
        {step===1 && (
          <div style={card}>
            <div style={cardTitle}>Step 1 — Select Division & Month</div>

            <div style={{ marginBottom:10 }}>
              <label style={labelStyle}>Division Office *</label>
              {loading ? (
                <div style={{ fontSize:13, color:"#A0AEC0", padding:8 }}>
                  Loading…
                </div>
              ) : (
                <select style={inputStyle} value={selectedDiv}
                  onChange={e => setSelectedDiv(e.target.value)}
                  disabled={profile?.role==="division_admin"}>
                  <option value="">— Select Division —</option>
                  {divisions.map((d:any) => (
                    <option key={d.id} value={d.id}>
                      {d.id} — {d.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {selectedDiv && (
              <div style={{ marginBottom:10 }}>
                <label style={labelStyle}>Sub Division (optional)</label>
                <select style={inputStyle} value={selectedSubDiv}
                  onChange={e => setSelectedSubDiv(e.target.value)}>
                  <option value="">
                    — All Sub Divisions under {selectedDiv} —
                  </option>
                  {filteredSubDivs.map((s:any) => (
                    <option key={s.id} value={s.id}>
                      {s.id} — {s.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {selectedDiv && (
              <div style={{ marginBottom:12 }}>
                <label style={labelStyle}>Month & Year *</label>
                <input type="month" style={inputStyle}
                  value={selectedMonth}
                  onChange={e => setSelectedMonth(e.target.value)} />
              </div>
            )}

            {scope && (
              <div style={{ padding:"10px 12px", background:"#EBF8FF",
                borderRadius:8, fontSize:13, color:"#2B6CB0", marginBottom:10 }}>
                📋 Scope: <strong>{scope}</strong> · {monthLabel(selectedMonth)}
                <br/>
                <span style={{ fontSize:12, color:"#4A5568" }}>
                  🏢 {mappedCount} offices · expenditure split by actual salary
                </span>
                {scopeOffices.length > 0 && (
                  <div style={{ marginTop:6, display:"flex",
                    flexWrap:"wrap" as const, gap:4 }}>
                    {scopeOffices.map((o:any) => (
                      <span key={o.id} style={{ fontSize:10,
                        background:"#DBEAFE", color:"#1D4ED8",
                        padding:"2px 8px", borderRadius:10, fontWeight:500 }}>
                        {o.name} ({o.type})
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Approach C explanation */}
            <div style={{ background:"#F0FFF4", border:"1px solid #9AE6B4",
              borderRadius:8, padding:"10px 12px", marginBottom:12,
              fontSize:12, color:"#276749" }}>
              <strong>📐 Expenditure Formula (Approach C):</strong>
              <br/>Each office = <strong>Actual Salary</strong> of its employees
              + <strong>Equal share</strong> of other expenses (rent, electricity etc.)
            </div>

            {existingData && (
              <div style={{ background:"#FFF5F5",
                border:"1px solid #FC8181", borderRadius:8,
                padding:"12px 14px", marginBottom:12 }}>
                <strong style={{ color:"#C53030", fontSize:13 }}>
                  ⚠️ Data already submitted for {monthLabel(selectedMonth)}
                </strong>
                <div style={{ color:"#718096", marginTop:4, fontSize:12 }}>
                  By: {existingData.submittedByName} ·
                  Total: ₹{existingData.totalExpenditure?.toLocaleString("en-IN")}
                </div>
                {canDelete ? (
                  <button onClick={handleDelete} style={{
                    marginTop:10, padding:"6px 14px",
                    background:"#FEE2E2", color:"#C53030",
                    border:"1px solid #FC8181", borderRadius:6,
                    fontSize:12, fontWeight:600, cursor:"pointer" }}>
                    🗑️ Delete & Re-enter
                  </button>
                ) : (
                  <div style={{ fontSize:11, color:"#C53030", marginTop:6 }}>
                    Contact Division/Circle office to delete.
                  </div>
                )}
              </div>
            )}

            {scope && !existingData && (
              <button onClick={() => setStep(2)} style={primaryBtn}>
                Next → Upload Salary Details
              </button>
            )}
          </div>
        )}

        {/* ── STEP 2 ── */}
        {step===2 && (
          <div style={card}>
            <div style={{ display:"flex", justifyContent:"space-between",
              alignItems:"center", marginBottom:14 }}>
              <div style={cardTitle}>Step 2 — Salary Upload</div>
              <div style={{ display:"flex", gap:8 }}>
                <button onClick={downloadTemplate} style={smallBtn}>
                  📥 Template
                </button>
                <label style={{ ...smallBtn, cursor:"pointer" }}>
                  <input type="file" accept=".xlsx,.xls"
                    onChange={handleExcelUpload}
                    style={{ display:"none" }} />
                  📤 Upload Excel
                </label>
              </div>
            </div>

            <div style={{ background:"#F7FAFC", borderRadius:8,
              padding:"10px 12px", marginBottom:14,
              fontSize:12, color:"#718096" }}>
              📋 Columns:
              <code style={codeStyle}>
                OfficeCode | OfficeName | EmployeeID | Name | Designation | GrossSalary
              </code>
              <div style={{ marginTop:6, color:"#0F766E", fontWeight:600 }}>
                ✅ Each employee's salary is attributed to their office directly
              </div>
            </div>

            {salaryRows.length===0 ? (
              <div style={{ textAlign:"center" as const, padding:"24px 0",
                color:"#A0AEC0", fontSize:13 }}>
                Upload Excel or add employees manually
              </div>
            ) : (
              Object.entries(salaryByOffice).map(([offCode, rows]) => (
                <div key={offCode} style={{ marginBottom:16 }}>
                  <div style={{ background:"#EBF8FF",
                    borderRadius:"8px 8px 0 0",
                    padding:"8px 12px", display:"flex",
                    justifyContent:"space-between" }}>
                    <span style={{ fontSize:12, fontWeight:700, color:"#1D4ED8" }}>
                      🏢 {rows[0].officeName||offCode} ({offCode})
                    </span>
                    <span style={{ fontSize:12, color:"#4A5568" }}>
                      {rows.length} emp ·
                      ₹{rows.reduce((a,r)=>a+r.grossSalary,0)
                        .toLocaleString("en-IN")}
                    </span>
                  </div>
                  {rows.map((row, idx) => {
                    const gi = salaryRows.findIndex(r =>
                      r.employeeId===row.employeeId &&
                      r.officeCode===row.officeCode
                    );
                    return (
                      <div key={idx} style={{ background:"#F7FAFC",
                        border:"1px solid #E2E8F0", borderTop:"none",
                        padding:"8px 12px", marginBottom:2 }}>
                        <div style={{ display:"flex",
                          justifyContent:"space-between", marginBottom:4 }}>
                          <span style={{ fontSize:13, fontWeight:600,
                            color:"#1A202C" }}>
                            {row.name||`Employee ${idx+1}`}
                          </span>
                          <button
                            onClick={() => setSalaryRows(prev =>
                              prev.filter((_,i) => i!==gi))}
                            style={{ background:"#FEE2E2", border:"none",
                              color:"#DC2626", borderRadius:4,
                              cursor:"pointer", padding:"2px 8px",
                              fontSize:11 }}>✕</button>
                        </div>
                        <div style={{ display:"flex", gap:6 }}>
                          <input style={{ ...inputStyle, flex:1 }}
                            placeholder="Emp ID" value={row.employeeId}
                            onChange={e => updateSalaryRow(gi,"employeeId",e.target.value)}/>
                          <input style={{ ...inputStyle, flex:2 }}
                            placeholder="Designation" value={row.designation}
                            onChange={e => updateSalaryRow(gi,"designation",e.target.value)}/>
                          <input style={{ ...inputStyle, flex:1 }}
                            type="number" placeholder="₹"
                            value={row.grossSalary||""}
                            onChange={e => updateSalaryRow(gi,"grossSalary",e.target.value)}/>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))
            )}

            <button onClick={() => setSalaryRows(prev => [...prev, {
              officeCode: scopeOffices[0]?.id||"",
              officeName: scopeOffices[0]?.name||"",
              employeeId:"", name:"", designation:"", grossSalary:0
            }])} style={addRowBtn}>
              + Add Employee Manually
            </button>

            {/* Per-office salary summary */}
            {officeSalarySummary.length > 0 && (
              <div style={{ marginTop:14, background:"#F7FAFC",
                borderRadius:10, border:"1px solid #E2E8F0",
                overflow:"hidden" }}>
                <div style={{ padding:"8px 12px", background:"#EBF8FF",
                  fontSize:11, fontWeight:700, color:"#1D4ED8",
                  textTransform:"uppercase" as const }}>
                  Office-wise Salary Summary (Approach C)
                </div>
                {officeSalarySummary.map(o => (
                  <div key={o.officeCode} style={{
                    display:"flex", justifyContent:"space-between",
                    padding:"8px 12px", borderBottom:"1px solid #F0F4F8",
                    fontSize:13 }}>
                    <span style={{ color:"#2D3748" }}>
                      {o.officeName}
                      <span style={{ fontSize:11, color:"#A0AEC0",
                        marginLeft:6 }}>
                        ({o.empCount} emp)
                      </span>
                    </span>
                    <span style={{ fontWeight:700, color:"#1D4ED8" }}>
                      ₹{o.salary.toLocaleString("en-IN")}
                    </span>
                  </div>
                ))}
                <div style={{ display:"flex", justifyContent:"space-between",
                  padding:"10px 12px", background:"#EBF8FF",
                  fontSize:13, fontWeight:700 }}>
                  <span style={{ color:"#1D4ED8" }}>
                    Total ({salaryRows.length} employees)
                  </span>
                  <span style={{ color:"#1D4ED8" }}>
                    ₹{totalSalary.toLocaleString("en-IN")}
                  </span>
                </div>
              </div>
            )}

            <div style={{ display:"flex", gap:10, marginTop:14 }}>
              <button onClick={() => setStep(1)} style={cancelBtn}>← Back</button>
              <button onClick={() => setStep(3)}
                style={{ ...primaryBtn, flex:2 }}>
                Next → Other Expenses
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 3 ── */}
        {step===3 && (
          <div style={card}>
            <div style={cardTitle}>Step 3 — Other Expenses</div>

            <div style={{ background:"#FFFBEB", border:"1px solid #FCD34D",
              borderRadius:8, padding:"8px 12px", marginBottom:14,
              fontSize:12, color:"#92400E" }}>
              ℹ️ These expenses will be split <strong>equally</strong> across
              all {mappedCount} offices. Salary is already attributed per office.
            </div>

            {expenses.map(exp => (
              <div key={exp.id} style={{ marginBottom:12 }}>
                <label style={labelStyle}>{exp.label}</label>
                <input type="number" min="0" style={inputStyle}
                  placeholder="Amount in ₹" value={exp.amount}
                  onChange={e => updateExpense(exp.id, e.target.value)} />
              </div>
            ))}

            {customExpenses.map((exp, idx) => (
              <div key={exp.id} style={{ display:"flex", gap:8, marginBottom:10 }}>
                <input style={{ ...inputStyle, flex:2 }}
                  placeholder="Expense name" value={exp.label}
                  onChange={e => setCustomExpenses(prev =>
                    prev.map((x,i) => i===idx?{...x,label:e.target.value}:x))}/>
                <input type="number" style={{ ...inputStyle, flex:1 }}
                  placeholder="₹" value={exp.amount}
                  onChange={e => setCustomExpenses(prev =>
                    prev.map((x,i) => i===idx?{...x,amount:e.target.value}:x))}/>
                <button
                  onClick={() => setCustomExpenses(prev =>
                    prev.filter((_,i) => i!==idx))}
                  style={{ padding:"9px 12px", background:"#FEE2E2",
                    color:"#DC2626", border:"1px solid #FECACA",
                    borderRadius:8, cursor:"pointer", fontWeight:700 }}>
                  ✕
                </button>
              </div>
            ))}

            <button onClick={() => setCustomExpenses(prev => [
              ...prev, { id:`custom_${Date.now()}`, label:"", amount:"" }
            ])} style={addRowBtn}>
              + Add Custom Expense
            </button>

            {/* Expenditure summary with Approach C breakdown */}
            <div style={{ marginTop:16, padding:14, background:"#F7FAFC",
              borderRadius:10, border:"1px solid #E2E8F0" }}>
              <div style={{ fontSize:12, fontWeight:700, color:"#718096",
                textTransform:"uppercase" as const, marginBottom:10 }}>
                Expenditure Breakdown (Approach C)
              </div>
              <div style={{ display:"flex", justifyContent:"space-between",
                fontSize:13, marginBottom:6 }}>
                <span style={{ color:"#718096" }}>
                  Total Salary ({salaryRows.length} employees)
                </span>
                <span style={{ fontWeight:600 }}>
                  ₹{totalSalary.toLocaleString("en-IN")}
                </span>
              </div>
              <div style={{ display:"flex", justifyContent:"space-between",
                fontSize:13, marginBottom:6 }}>
                <span style={{ color:"#718096" }}>
                  Other Expenses (split equally ÷ {mappedCount})
                </span>
                <span style={{ fontWeight:600 }}>
                  ₹{totalExpenses.toLocaleString("en-IN")}
                </span>
              </div>
              <div style={{ display:"flex", justifyContent:"space-between",
                fontSize:12, color:"#A0AEC0", marginBottom:10,
                fontStyle:"italic" }}>
                <span>Other exp per office</span>
                <span>
                  ₹{Math.round(totalExpenses/Math.max(mappedCount,1))
                    .toLocaleString("en-IN")}
                </span>
              </div>
              <div style={{ borderTop:"1px solid #E2E8F0", paddingTop:10,
                display:"flex", justifyContent:"space-between" }}>
                <span style={{ fontSize:15, fontWeight:700, color:"#DC2626" }}>
                  TOTAL EXPENDITURE
                </span>
                <span style={{ fontSize:22, fontWeight:800, color:"#DC2626" }}>
                  ₹{totalExpenditure.toLocaleString("en-IN")}
                </span>
              </div>
            </div>

            <div style={{ display:"flex", gap:10, marginTop:14 }}>
              <button onClick={() => setStep(2)} style={cancelBtn}>← Back</button>
              <button onClick={handleSave} disabled={saving}
                style={{ ...primaryBtn, flex:2,
                  background:saving?"#90CDF4":"#1565C0" }}>
                {saving ? "Calculating ECR…" : "Save & Generate ECR Report"}
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 4 — REPORT ── */}
        {step===4 && reportData.length>0 && (
          <div style={{ ...card, padding:"20px 0 0 0", overflow:"hidden" }}>
            <div style={{ padding:"0 16px", display:"flex",
              justifyContent:"space-between", alignItems:"center",
              marginBottom:16 }}>
              <div>
                <div style={{ fontSize:16, fontWeight:800, color:"#1A202C" }}>
                  ECR Report ✅
                </div>
                <div style={{ fontSize:12, color:"#718096" }}>
                  {monthLabel(selectedMonth)} · {reportData.length} offices ·
                  Approach C
                </div>
              </div>
              <button onClick={downloadReport} style={{
                ...smallBtn, background:"#16A34A", color:"#fff",
                border:"none", padding:"8px 14px", fontWeight:700 }}>
                📥 Excel
              </button>
            </div>

            {/* Summary cards */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr",
              gap:8, padding:"0 16px", marginBottom:16 }}>
              {[
                { label:"≥100%",  val:reportData.filter(r=>r.ecr>=100).length, color:"#16A34A" },
                { label:"80-99%", val:reportData.filter(r=>r.ecr>=80&&r.ecr<100).length, color:"#D97706" },
                { label:"<80%",   val:reportData.filter(r=>r.ecr<80).length, color:"#DC2626" },
              ].map(s => (
                <div key={s.label} style={{ background:"#F7FAFC",
                  borderRadius:8, padding:"8px 10px",
                  textAlign:"center" as const }}>
                  <div style={{ fontSize:20, fontWeight:800, color:s.color }}>
                    {s.val}
                  </div>
                  <div style={{ fontSize:10, color:"#718096" }}>{s.label}</div>
                </div>
              ))}
            </div>

            {/* Table */}
            <div style={{ overflowX:"auto" as const }}>
              <table style={{ width:"100%", textAlign:"left" as const,
                borderCollapse:"collapse", fontSize:11 }}>
                <thead style={{ background:"#EDF2F7" }}>
                  <tr>
                    {[
                      { key:"officeName",  label:"Office"     },
                      { key:"empCount",    label:"Emp"        },
                      { key:"salary",      label:"Salary ₹"  },
                      { key:"otherExp",    label:"OtherExp ₹"},
                      { key:"expenditure", label:"Total Exp ₹"},
                      { key:"income",      label:"Income ₹"  },
                      { key:"profitLoss",  label:"P&L ₹"     },
                      { key:"ecr",         label:"ECR %"      },
                      { key:"posbToOpen",  label:"POSB Needed"},
                    ].map(col => (
                      <th key={col.key}
                        onClick={() => handleSort(col.key as keyof ReportRow)}
                        style={{ ...thStyle, cursor:"pointer" }}>
                        {col.label}
                        {sortKey===col.key && (
                          <span> {sortOrder==="asc"?"▲":"▼"}</span>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedReportData.map((row, i) => (
                    <tr key={row.officeCode} style={{
                      borderBottom:"1px solid #E2E8F0",
                      background:i%2===0?"#fff":"#FAFAFA"
                    }}>
                      <td style={tdStyle}>
                        <div style={{ fontWeight:600, color:"#2D3748",
                          fontSize:12 }}>
                          {row.officeName}
                        </div>
                        <div style={{ fontSize:10, color:"#A0AEC0" }}>
                          {row.officeCode}
                        </div>
                      </td>
                      <td style={{ ...tdStyle, textAlign:"center" as const,
                        color:"#4A5568" }}>
                        {row.empCount}
                      </td>
                      <td style={{ ...tdStyle, color:"#1D4ED8", fontWeight:600 }}>
                        ₹{row.salary.toLocaleString("en-IN")}
                      </td>
                      <td style={{ ...tdStyle, color:"#718096" }}>
                        ₹{row.otherExp.toLocaleString("en-IN")}
                      </td>
                      <td style={{ ...tdStyle, color:"#DC2626", fontWeight:700 }}>
                        ₹{row.expenditure.toLocaleString("en-IN")}
                      </td>
                      <td style={{ ...tdStyle, color:"#16A34A", fontWeight:600 }}>
                        ₹{row.income.toLocaleString("en-IN")}
                      </td>
                      <td style={{ ...tdStyle, fontWeight:700,
                        color:row.profitLoss>=0?"#16A34A":"#DC2626" }}>
                        {row.profitLoss>=0?"+":"-"}
                        ₹{Math.abs(row.profitLoss).toLocaleString("en-IN")}
                      </td>
                      <td style={tdStyle}>
                        <span style={{
                          background: row.ecr>=100?"#DCFCE7"
                            :row.ecr>=80?"#FEF9C3":"#FEE2E2",
                          color: row.ecr>=100?"#16A34A"
                            :row.ecr>=80?"#D97706":"#DC2626",
                          padding:"3px 8px", borderRadius:20,
                          fontWeight:700, fontSize:12
                        }}>
                          {row.ecr.toFixed(1)}%
                        </span>
                      </td>
                      <td style={{ ...tdStyle, fontWeight:600,
                        color:row.posbToOpen>0?"#7C3AED":"#A0AEC0" }}>
                        {row.posbToOpen>0
                          ? `${row.posbToOpen} a/c`
                          : "✓ Met"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ padding:"16px", background:"#F7FAFC",
              textAlign:"center" as const }}>
              <button onClick={() => router.push("/reports")}
                style={{ ...primaryBtn, width:"auto", padding:"10px 24px" }}>
                View Full Dashboard Reports →
              </button>
            </div>
          </div>
        )}

      </div>

      {toast && (
        <div style={{ position:"fixed", bottom:80, left:"50%",
          transform:"translateX(-50%)", background:"#2D3748", color:"#fff",
          padding:"10px 20px", borderRadius:24, fontSize:13,
          fontWeight:500, zIndex:300 }}>
          {toast}
        </div>
      )}

      <BottomNav />
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────
const accessDenied: React.CSSProperties = {
  minHeight:"100vh", display:"flex", flexDirection:"column",
  alignItems:"center", justifyContent:"center",
  padding:24, textAlign:"center", background:"#FFF5F5",
  fontFamily:"-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
};
const backBtnStyle: React.CSSProperties = {
  marginTop:20, padding:"10px 20px", background:"#1565C0",
  color:"#fff", border:"none", borderRadius:8,
  fontSize:14, fontWeight:600, cursor:"pointer",
};
const headerBtn: React.CSSProperties = {
  background:"rgba(255,255,255,0.2)",
  border:"1px solid rgba(255,255,255,0.4)",
  color:"#fff", borderRadius:8, padding:"7px 14px",
  fontSize:13, fontWeight:600, cursor:"pointer"
};
const card: React.CSSProperties = {
  background:"#fff", border:"1px solid #E2E8F0",
  borderRadius:12, padding:16, marginBottom:12
};
const cardTitle: React.CSSProperties = {
  fontSize:13, fontWeight:700, color:"#718096",
  textTransform:"uppercase", letterSpacing:"0.5px", marginBottom:14
};
const labelStyle: React.CSSProperties = {
  display:"block", fontSize:11, fontWeight:600, color:"#4A5568",
  textTransform:"uppercase", letterSpacing:"0.3px", marginBottom:4
};
const inputStyle: React.CSSProperties = {
  width:"100%", padding:"9px 11px", fontSize:14,
  border:"1.5px solid #E2E8F0", borderRadius:8,
  color:"#1A202C", background:"#fff",
  boxSizing:"border-box", outline:"none"
};
const primaryBtn: React.CSSProperties = {
  width:"100%", padding:12, background:"#1565C0", color:"#fff",
  border:"none", borderRadius:10, fontSize:15, fontWeight:700,
  cursor:"pointer"
};
const cancelBtn: React.CSSProperties = {
  flex:1, padding:12, background:"#E2E8F0", color:"#4A5568",
  border:"none", borderRadius:10, fontSize:14, fontWeight:600,
  cursor:"pointer"
};
const addRowBtn: React.CSSProperties = {
  width:"100%", padding:10, background:"#EBF8FF", color:"#1565C0",
  border:"2px dashed #BEE3F8", borderRadius:8, fontSize:13,
  fontWeight:600, cursor:"pointer", marginTop:8
};
const smallBtn: React.CSSProperties = {
  fontSize:12, padding:"5px 10px", background:"#EBF8FF",
  color:"#1565C0", border:"1px solid #BEE3F8",
  borderRadius:6, cursor:"pointer", fontWeight:500
};
const codeStyle: React.CSSProperties = {
  background:"#EBF8FF", color:"#2B6CB0", padding:"2px 6px",
  borderRadius:4, fontSize:11, display:"block", marginTop:4
};
const thStyle: React.CSSProperties = {
  padding:"10px 8px", color:"#4A5568",
  textTransform:"uppercase", fontSize:9,
  letterSpacing:0.5, userSelect:"none" as const,
  whiteSpace:"nowrap" as const
};
const tdStyle: React.CSSProperties = {
  padding:"10px 8px", whiteSpace:"nowrap" as const
};