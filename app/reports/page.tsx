"use client";

import { useState, useEffect } from "react";
import { useAuth, ROLE_LABELS } from "../../context/AuthContext";
import { useRouter } from "next/navigation";
import { db } from "../firebase";
import { collection, getDocs, query, where } from "firebase/firestore";
import BottomNav from "../../components/BottomNav";

interface ECRRecord {
  officeCode: string;
  officeName?: string;
  month: string;
  income: number;
  expenditure: number;
  ecr: number;
  status: string;
  heads?: Record<string, number>;
  circleCode?: string;
  regionId?: string;
  divisionCode?: string;
  subDivCode?: string;
}

type TabType     = "myoffice"|"monthly"|"compare"|"yoy"|"consolidated"|"filter";
type SortKey     = "ecr_desc"|"ecr_asc"|"name_az"|"name_za"|"income_desc"|"pl_desc";
type GroupBy     = "circle"|"division"|"subdivision";
type FilterParam = "ecr"|"posb"|"pli"|"rpli";
type FilterOp    = "above"|"below"|"between";

const ecrColor  = (v:number) => v>=100?"#16A34A":v>=80?"#D97706":"#DC2626";
const ecrBg     = (v:number) => v>=100?"#DCFCE7":v>=80?"#FEF9C3":"#FEE2E2";
const ecrBorder = (v:number) => v>=100?"#86EFAC":v>=80?"#FDE68A":"#FECACA";

function fmt(n:number){ return (n||0).toLocaleString("en-IN",{maximumFractionDigits:0}); }
function fmtR(n:number){ return `₹${fmt(Math.abs(n||0))}`; }

function monthLabel(m:string){
  if(!m) return "";
  const [y,mo]=m.split("-");
  return new Date(+y,+mo-1).toLocaleString("default",{month:"short",year:"numeric"});
}
function lastNMonths(n:number){
  const r:string[]=[];
  const d=new Date();
  for(let i=0;i<n;i++){
    r.unshift(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`);
    d.setMonth(d.getMonth()-1);
  }
  return r;
}

function Stat({label,value,color,sub}:{label:string;value:string;color:string;sub?:string}){
  return(
    <div style={{background:"#fff",borderRadius:10,padding:"10px 12px",
      border:"1px solid #E2E8F0",textAlign:"center" as const}}>
      <div style={{fontSize:9,color:"#718096",fontWeight:700,
        textTransform:"uppercase" as const,letterSpacing:.5,marginBottom:3}}>{label}</div>
      <div style={{fontSize:20,fontWeight:800,color,lineHeight:1}}>{value}</div>
      {sub&&<div style={{fontSize:10,color:"#A0AEC0",marginTop:2}}>{sub}</div>}
    </div>
  );
}

function Empty({icon,title,msg}:{icon:string;title:string;msg:string}){
  return(
    <div style={{textAlign:"center" as const,padding:"40px 20px"}}>
      <div style={{fontSize:44,marginBottom:10}}>{icon}</div>
      <div style={{fontSize:15,fontWeight:600,color:"#718096"}}>{title}</div>
      <div style={{fontSize:13,color:"#A0AEC0",marginTop:4}}>{msg}</div>
    </div>
  );
}

function OfficeRow({r,rank}:{r:ECRRecord;rank:number}){
  const [open,setOpen]=useState(false);
  const pl=r.income-r.expenditure;
  const shortfall=Math.max(0,r.expenditure-r.income);
  return(
    <div style={{background:"#fff",border:`1px solid ${ecrBorder(r.ecr)}`,
      borderRadius:12,marginBottom:8,overflow:"hidden"}}>
      <div style={{padding:"12px 14px",cursor:"pointer"}} onClick={()=>setOpen(o=>!o)}>
        <div style={{display:"flex",justifyContent:"space-between",
          alignItems:"flex-start",marginBottom:8}}>
          <div style={{flex:1,marginRight:10}}>
            <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:2}}>
              <span style={{fontSize:10,fontWeight:700,background:"#F1F5F9",
                color:"#64748B",padding:"1px 6px",borderRadius:8}}>#{rank}</span>
              <span style={{fontSize:14,fontWeight:700,color:"#1A202C"}}>
                {r.officeName||r.officeCode}
              </span>
            </div>
            <div style={{fontSize:11,color:"#A0AEC0"}}>{r.officeCode}</div>
          </div>
          <div style={{textAlign:"right" as const,flexShrink:0}}>
            <div style={{fontSize:22,fontWeight:800,color:ecrColor(r.ecr),lineHeight:1}}>
              {(r.ecr||0).toFixed(1)}%
            </div>
            <span style={{fontSize:10,fontWeight:700,background:ecrBg(r.ecr),
              color:ecrColor(r.ecr),padding:"2px 8px",borderRadius:10}}>
              {r.ecr>=100?"✓ Surplus":r.ecr>=80?"~ Average":"✗ Deficit"}
            </span>
          </div>
        </div>
        <div style={{background:"#F1F5F9",borderRadius:6,height:8,overflow:"hidden",marginBottom:8}}>
          <div style={{width:`${Math.min(r.ecr||0,100)}%`,height:"100%",
            background:ecrColor(r.ecr),borderRadius:6}}/>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6}}>
          {[
            {label:"INCOME",val:fmtR(r.income),bg:"#F0FFF4",color:"#15803D"},
            {label:"EXPENDITURE",val:fmtR(r.expenditure),bg:"#FFF5F5",color:"#B91C1C"},
            {label:pl>=0?"SURPLUS":"DEFICIT",val:(pl>=0?"+":"-")+fmtR(pl),
              bg:pl>=0?"#F0FFF4":"#FFF5F5",color:pl>=0?"#15803D":"#B91C1C"},
          ].map(m=>(
            <div key={m.label} style={{background:m.bg,borderRadius:6,padding:"5px 8px"}}>
              <div style={{fontSize:9,color:m.color,fontWeight:700}}>{m.label}</div>
              <div style={{fontSize:12,fontWeight:700,color:m.color}}>{m.val}</div>
            </div>
          ))}
        </div>
        <div style={{fontSize:11,color:"#A0AEC0",marginTop:5,textAlign:"right" as const}}>
          {open?"▲ Less":"▼ Details"}
        </div>
      </div>
      {open&&(
        <div style={{borderTop:"1px solid #F1F5F9",padding:"12px 14px",background:"#FAFAFA"}}>
          {shortfall>0&&(
            <div style={{background:"#FEF2F2",border:"1.5px solid #FECACA",
              borderRadius:10,padding:12,marginBottom:12}}>
              <div style={{fontSize:12,fontWeight:700,color:"#DC2626",marginBottom:8}}>
                ⚠️ Shortfall {fmtR(shortfall)} — To reach 100%:
              </div>
              {[
                {icon:"📮",label:"POSB Live A/C to open",val:`+${Math.ceil(shortfall/219.23).toLocaleString()} accounts`},
                {icon:"🛡️",label:"PLI Premium needed",val:`₹${Math.ceil(shortfall/0.04).toLocaleString()}`},
                {icon:"🌾",label:"RPLI Premium needed",val:`₹${Math.ceil(shortfall/0.12).toLocaleString()}`},
              ].map(item=>(
                <div key={item.label} style={{display:"flex",justifyContent:"space-between",
                  alignItems:"center",background:"#fff",borderRadius:6,
                  padding:"6px 10px",border:"1px solid #FECACA",marginBottom:4}}>
                  <span style={{fontSize:12,color:"#7F1D1D"}}>{item.icon} {item.label}</span>
                  <strong style={{fontSize:13,color:"#B91C1C"}}>{item.val}</strong>
                </div>
              ))}
            </div>
          )}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6}}>
            {[
              {label:"POSB Live",val:`${r.heads?.posb_live||0} a/c`,color:"#1D4ED8"},
              {label:"POSB Silent",val:`${r.heads?.posb_silent||0} a/c`,color:"#7C3AED"},
              {label:"Certificates",val:fmtR(r.heads?.certificates||0),color:"#EA580C"},
              {label:"Mail Book",val:fmtR(r.heads?.mail_booking||0),color:"#D97706"},
              {label:"PLI",val:fmtR(r.heads?.pli_premium||0),color:"#0F766E"},
              {label:"RPLI",val:fmtR(r.heads?.rpli_premium||0),color:"#15803D"},
            ].map(m=>(
              <div key={m.label} style={{background:"#fff",borderRadius:6,
                padding:"6px 8px",border:"1px solid #E2E8F0"}}>
                <div style={{fontSize:9,color:"#718096",fontWeight:700}}>{m.label}</div>
                <div style={{fontSize:12,fontWeight:700,color:m.color}}>{m.val}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function GroupCard({groupKey,records,groupLabel}:{groupKey:string;records:ECRRecord[];groupLabel:string}){
  const [open,setOpen]=useState(false);
  const totalInc=records.reduce((a,r)=>a+r.income,0);
  const totalExp=records.reduce((a,r)=>a+r.expenditure,0);
  const avgECR=records.length?records.reduce((a,r)=>a+r.ecr,0)/records.length:0;
  const pl=totalInc-totalExp;
  const good=records.filter(r=>r.ecr>=100).length;
  return(
    <div style={{background:"#fff",border:`1px solid ${ecrBorder(avgECR)}`,
      borderRadius:12,marginBottom:10,overflow:"hidden"}}>
      <div style={{padding:"12px 14px",cursor:"pointer"}} onClick={()=>setOpen(o=>!o)}>
        <div style={{display:"flex",justifyContent:"space-between",
          alignItems:"flex-start",marginBottom:8}}>
          <div>
            <div style={{fontSize:11,color:"#A0AEC0",marginBottom:2}}>{groupLabel}</div>
            <div style={{fontSize:15,fontWeight:700,color:"#1A202C"}}>{groupKey}</div>
            <div style={{fontSize:12,color:"#718096"}}>{records.length} offices</div>
          </div>
          <div style={{textAlign:"right" as const}}>
            <div style={{fontSize:24,fontWeight:800,color:ecrColor(avgECR),lineHeight:1}}>
              {avgECR.toFixed(1)}%
            </div>
            <div style={{fontSize:10,color:"#718096"}}>Avg ECR</div>
          </div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:6,marginBottom:6}}>
          {[
            {label:"Income",val:fmtR(totalInc),color:"#15803D"},
            {label:"Expend.",val:fmtR(totalExp),color:"#B91C1C"},
            {label:pl>=0?"Surplus":"Deficit",val:(pl>=0?"+":"-")+fmtR(pl),color:pl>=0?"#15803D":"#B91C1C"},
            {label:"≥100%",val:`${good}/${records.length}`,color:"#16A34A"},
          ].map(m=>(
            <div key={m.label} style={{background:"#F7FAFC",borderRadius:6,
              padding:"5px 8px",textAlign:"center" as const}}>
              <div style={{fontSize:9,color:"#718096",fontWeight:700}}>{m.label}</div>
              <div style={{fontSize:11,fontWeight:700,color:m.color}}>{m.val}</div>
            </div>
          ))}
        </div>
        <div style={{fontSize:11,color:"#A0AEC0",textAlign:"right" as const}}>
          {open?"▲ Hide offices":"▼ Show offices"}
        </div>
      </div>
      {open&&(
        <div style={{borderTop:"1px solid #F1F5F9",padding:"8px 14px",background:"#FAFAFA"}}>
          {records.sort((a,b)=>b.ecr-a.ecr).map((r,i)=>(
            <OfficeRow key={r.officeCode} r={r} rank={i+1}/>
          ))}
        </div>
      )}
    </div>
  );
}

function CompareRow({office,ecr1,ecr2,month1,month2}:{
  office:string;ecr1:number;ecr2:number;month1:string;month2:string;}){
  const diff=ecr2-ecr1,color=diff>0?"#16A34A":diff<0?"#DC2626":"#718096";
  return(
    <div style={{background:"#fff",borderRadius:10,padding:"12px 14px",
      border:"1px solid #E2E8F0",marginBottom:8}}>
      <div style={{fontSize:13,fontWeight:600,color:"#1A202C",marginBottom:8}}>{office}</div>
      <div style={{display:"flex",gap:8,alignItems:"center"}}>
        <div style={{flex:1,textAlign:"center" as const,background:ecrBg(ecr1),
          borderRadius:8,padding:"8px 4px"}}>
          <div style={{fontSize:10,color:"#718096"}}>{monthLabel(month1)}</div>
          <div style={{fontSize:18,fontWeight:700,color:ecrColor(ecr1)}}>{ecr1.toFixed(1)}%</div>
        </div>
        <div style={{fontSize:18,fontWeight:700,color}}>{diff>0?"▲":diff<0?"▼":"→"}</div>
        <div style={{flex:1,textAlign:"center" as const,background:ecrBg(ecr2),
          borderRadius:8,padding:"8px 4px"}}>
          <div style={{fontSize:10,color:"#718096"}}>{monthLabel(month2)}</div>
          <div style={{fontSize:18,fontWeight:700,color:ecrColor(ecr2)}}>{ecr2.toFixed(1)}%</div>
        </div>
        <div style={{fontSize:13,fontWeight:700,color,minWidth:55,textAlign:"right" as const}}>
          {diff>0?"+":""}{diff.toFixed(1)}%
        </div>
      </div>
    </div>
  );
}

function MyOfficeCard({records,name,code}:{records:ECRRecord[];name:string;code:string}){
  const sorted=[...records].sort((a,b)=>a.month.localeCompare(b.month));
  const latest=sorted[sorted.length-1];
  const prev=sorted[sorted.length-2];
  if(!latest) return <Empty icon="📊" title="No ECR data yet"
    msg="Data will appear once income and expenditure are submitted."/>;
  const trend=prev?latest.ecr-prev.ecr:0;
  const shortfall=Math.max(0,latest.expenditure-latest.income);
  return(
    <div style={{background:"#fff",borderRadius:16,border:"1px solid #E2E8F0",
      overflow:"hidden",marginBottom:12}}>
      <div style={{background:"linear-gradient(135deg,#1E3A8A,#1D4ED8)",
        padding:"16px 16px 14px",color:"#fff"}}>
        <div style={{fontSize:11,opacity:.75,textTransform:"uppercase" as const,
          letterSpacing:1,marginBottom:4}}>{code}</div>
        <div style={{fontSize:18,fontWeight:700}}>{name||code}</div>
        <div style={{fontSize:12,opacity:.8,marginTop:2}}>
          {monthLabel(latest.month)} · ECR Performance
        </div>
      </div>
      <div style={{padding:"16px"}}>
        <div style={{display:"flex",gap:14,marginBottom:14}}>
          <div style={{width:88,height:88,borderRadius:"50%",flexShrink:0,
            background:`conic-gradient(${ecrColor(latest.ecr)} ${Math.min(latest.ecr,100)*3.6}deg,#F1F5F9 0deg)`,
            display:"flex",alignItems:"center",justifyContent:"center"}}>
            <div style={{width:68,height:68,borderRadius:"50%",background:"#fff",
              display:"flex",flexDirection:"column" as const,alignItems:"center",justifyContent:"center"}}>
              <div style={{fontSize:18,fontWeight:800,color:ecrColor(latest.ecr),lineHeight:1}}>
                {latest.ecr.toFixed(1)}
              </div>
              <div style={{fontSize:9,color:"#718096"}}>ECR %</div>
            </div>
          </div>
          <div style={{flex:1}}>
            <div style={{display:"flex",gap:6,marginBottom:6}}>
              <div style={{flex:1,background:"#F0FFF4",borderRadius:8,padding:"7px 8px"}}>
                <div style={{fontSize:9,color:"#718096"}}>INCOME</div>
                <div style={{fontSize:12,fontWeight:700,color:"#16A34A"}}>{fmtR(latest.income)}</div>
              </div>
              <div style={{flex:1,background:"#FFF5F5",borderRadius:8,padding:"7px 8px"}}>
                <div style={{fontSize:9,color:"#718096"}}>EXPENDITURE</div>
                <div style={{fontSize:12,fontWeight:700,color:"#DC2626"}}>{fmtR(latest.expenditure)}</div>
              </div>
            </div>
            <div style={{fontSize:12,fontWeight:600,
              color:trend>0?"#16A34A":trend<0?"#DC2626":"#718096"}}>
              {trend>0?"▲":trend<0?"▼":"→"}
              {trend!==0?` ${Math.abs(trend).toFixed(1)}% vs last month`:" No change vs last month"}
            </div>
          </div>
        </div>
        <div style={{display:"flex",gap:6,marginBottom:14}}>
          {sorted.slice(-3).map(r=>(
            <div key={r.month} style={{flex:1,background:ecrBg(r.ecr),
              borderRadius:8,padding:"8px 6px",textAlign:"center" as const}}>
              <div style={{fontSize:10,color:"#718096",marginBottom:2}}>{monthLabel(r.month)}</div>
              <div style={{fontSize:15,fontWeight:700,color:ecrColor(r.ecr)}}>{r.ecr.toFixed(1)}%</div>
            </div>
          ))}
        </div>
        <div style={{background:shortfall>0?"#FEF2F2":"#F0FFF4",
          border:`1px solid ${shortfall>0?"#FECACA":"#86EFAC"}`,
          borderRadius:10,padding:12,marginBottom:12}}>
          {shortfall>0?(
            <>
              <div style={{fontSize:12,fontWeight:700,color:"#DC2626",marginBottom:8}}>
                ⚠️ Shortfall: {fmtR(shortfall)} — To reach 100%:
              </div>
              {[
                {icon:"📮",label:"POSB Live A/C",val:`+${Math.ceil(shortfall/219.23).toLocaleString()} accounts`},
                {icon:"🛡️",label:"PLI Premium",val:`₹${Math.ceil(shortfall/0.04).toLocaleString()}`},
                {icon:"🌾",label:"RPLI Premium",val:`₹${Math.ceil(shortfall/0.12).toLocaleString()}`},
              ].map(item=>(
                <div key={item.label} style={{display:"flex",justifyContent:"space-between",
                  alignItems:"center",background:"#fff",borderRadius:6,
                  padding:"6px 10px",border:"1px solid #FECACA",marginBottom:4}}>
                  <span style={{fontSize:12,color:"#7F1D1D"}}>{item.icon} {item.label}</span>
                  <strong style={{fontSize:13,color:"#B91C1C"}}>{item.val}</strong>
                </div>
              ))}
            </>
          ):(
            <div style={{fontSize:13,fontWeight:700,color:"#15803D"}}>
              ✅ Surplus: {fmtR(latest.income-latest.expenditure)} ({latest.ecr.toFixed(1)}% ECR)
            </div>
          )}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6}}>
          {[
            {label:"POSB Live",val:`${latest.heads?.posb_live||0} a/c`,color:"#1D4ED8"},
            {label:"PLI",val:fmtR(latest.heads?.pli_premium||0),color:"#0F766E"},
            {label:"RPLI",val:fmtR(latest.heads?.rpli_premium||0),color:"#7C3AED"},
          ].map(m=>(
            <div key={m.label} style={{background:"#F7FAFC",borderRadius:8,
              padding:"7px 8px",textAlign:"center" as const}}>
              <div style={{fontSize:9,color:"#718096",marginBottom:2}}>{m.label}</div>
              <div style={{fontSize:12,fontWeight:700,color:m.color}}>{m.val}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── MAIN PAGE ─────────────────────────────────────────────────────
export default function ReportsPage(){
  const {profile,user}=useAuth();
  const router=useRouter();

  const [activeTab,setActiveTab]=useState<TabType>("myoffice");
  const [ecrData,setEcrData]=useState<ECRRecord[]>([]);
  const [loading,setLoading]=useState(false);
  const [toast,setToast]=useState("");

  const months6=lastNMonths(6);
  const curYear=new Date().getFullYear();
  const [month,setMonth]=useState(months6[months6.length-1]);
  const [sortKey,setSortKey]=useState<SortKey>("ecr_desc");
  const [month1,setMonth1]=useState(months6[months6.length-2]);
  const [month2,setMonth2]=useState(months6[months6.length-1]);
  const [year1,setYear1]=useState(String(curYear-1));
  const [year2,setYear2]=useState(String(curYear));
  const [yoyMonth,setYoyMonth]=useState(String(new Date().getMonth()+1).padStart(2,"0"));
  const [groupBy,setGroupBy]=useState<GroupBy>("division");
  const [conMonth,setConMonth]=useState(months6[months6.length-1]);
  const [filterParam,setFilterParam]=useState<FilterParam>("ecr");
  const [filterOp,setFilterOp]=useState<FilterOp>("above");
  const [filterVal1,setFilterVal1]=useState("");
  const [filterVal2,setFilterVal2]=useState("");
  const [filterMonth,setFilterMonth]=useState(months6[months6.length-1]);
  const [filterResult,setFilterResult]=useState<ECRRecord[]|null>(null);

  // ── NEW: Office search state ──────────────────────────────────
  const [officeSearch,setOfficeSearch]=useState("");
  const [officeSearchResult,setOfficeSearchResult]=useState<ECRRecord[]|null>(null);

  const isOfficeLevel=["ho_admin","so_admin","office_user"].includes(profile?.role||"");
  const isAdminLevel=["superadmin","circle_admin","region_admin","division_admin","subdivision_admin"]
    .includes(profile?.role||"");

  useEffect(()=>{
    if(!user){router.push("/");return;}
    if(profile){
      setActiveTab(isOfficeLevel?"myoffice":"monthly");
      fetchECRData();
    }
  },[user,profile]);

  async function fetchECRData(){
    setLoading(true);
    try{
      const col=collection(db,"ecr");
      const role=profile?.role||"";
      let q;
      if(role==="superadmin") q=query(col);
      else if(role==="circle_admin") q=query(col,where("circleCode","==",profile?.circleCode));
      else if(role==="region_admin") q=query(col,where("regionId","==",profile?.regionId));
      else if(role==="division_admin") q=query(col,where("divisionCode","==",profile?.divisionCode));
      else if(role==="subdivision_admin") q=query(col,where("subDivCode","==",profile?.subDivCode));
      else q=query(col,where("officeCode","==",profile?.officeId||profile?.officeCode));
      const snap=await getDocs(q);
      setEcrData(snap.docs.map(d=>d.data() as ECRRecord));
    }catch(e:any){showToast("Error: "+e.message);}
    finally{setLoading(false);}
  }

  function showToast(msg:string){setToast(msg);setTimeout(()=>setToast(""),3000);}

  // ── Office search ──────────────────────────────────────────────
  function searchByOffice(){
    if(!officeSearch.trim()){
      setOfficeSearchResult(null); return;
    }
    const q=officeSearch.toLowerCase().trim();
    const results=ecrData.filter(r=>
      (r.officeName||"").toLowerCase().includes(q)||
      (r.officeCode||"").toLowerCase().includes(q)
    );
    // Deduplicate by officeCode — show latest month only
    const seen=new Set<string>();
    const deduped=results
      .sort((a,b)=>b.month.localeCompare(a.month))
      .filter(r=>{
        if(seen.has(r.officeCode)) return false;
        seen.add(r.officeCode); return true;
      });
    setOfficeSearchResult(deduped);
  }

  async function exportOfficeSearch(data:ECRRecord[]){
    const XLSX=await import("xlsx");
    const rows=data.map((r,i)=>({
      Rank:i+1,
      OfficeCode:r.officeCode,
      OfficeName:r.officeName||r.officeCode,
      Month:monthLabel(r.month),
      "ECR%":r.ecr.toFixed(2),
      Income:r.income,
      Expenditure:r.expenditure,
      "P&L":r.income-r.expenditure,
    }));
    const ws=XLSX.utils.json_to_sheet(rows);
    ws["!cols"]=Array(8).fill({wch:18});
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,ws,"Office Search");
    XLSX.writeFile(wb,`ECR_Search_${officeSearch}.xlsx`);
    showToast("✅ Exported!");
  }

  const monthlyData=ecrData.filter(r=>r.month===month).sort((a,b)=>{
    switch(sortKey){
      case "ecr_desc": return b.ecr-a.ecr;
      case "ecr_asc":  return a.ecr-b.ecr;
      case "name_az":  return (a.officeName||a.officeCode).localeCompare(b.officeName||b.officeCode);
      case "name_za":  return (b.officeName||b.officeCode).localeCompare(a.officeName||a.officeCode);
      case "income_desc": return b.income-a.income;
      case "pl_desc":  return (b.income-b.expenditure)-(a.income-a.expenditure);
      default:         return b.ecr-a.ecr;
    }
  });

  const compareData=(()=>{
    const d1=ecrData.filter(r=>r.month===month1);
    const d2=ecrData.filter(r=>r.month===month2);
    return d1.map(r1=>{
      const r2=d2.find(r=>r.officeCode===r1.officeCode);
      return r2?{office:r1.officeName||r1.officeCode,ecr1:r1.ecr,ecr2:r2.ecr}:null;
    }).filter(Boolean) as {office:string;ecr1:number;ecr2:number}[];
  })();

  const yoyData=(()=>{
    const d1=ecrData.filter(r=>r.month===`${year1}-${yoyMonth}`);
    const d2=ecrData.filter(r=>r.month===`${year2}-${yoyMonth}`);
    return d1.map(r1=>{
      const r2=d2.find(r=>r.officeCode===r1.officeCode);
      return r2?{office:r1.officeName||r1.officeCode,ecr1:r1.ecr,ecr2:r2.ecr}:null;
    }).filter(Boolean) as {office:string;ecr1:number;ecr2:number}[];
  })();

  const conData=ecrData.filter(r=>r.month===conMonth);
  const grouped:Record<string,ECRRecord[]>={};
  conData.forEach(r=>{
    const key=groupBy==="circle"?(r.circleCode||"Unknown")
      :groupBy==="division"?(r.divisionCode||"Unknown"):(r.subDivCode||"Unknown");
    if(!grouped[key]) grouped[key]=[];
    grouped[key].push(r);
  });

  const myRecords=ecrData
    .filter(r=>r.officeCode===(profile?.officeId||profile?.officeCode))
    .sort((a,b)=>a.month.localeCompare(b.month));

  const avgECR=monthlyData.length?monthlyData.reduce((a,b)=>a+b.ecr,0)/monthlyData.length:0;
  const goodCount=monthlyData.filter(r=>r.ecr>=100).length;
  const poorCount=monthlyData.filter(r=>r.ecr<80).length;
  const totalInc=monthlyData.reduce((a,b)=>a+b.income,0);
  const totalExp=monthlyData.reduce((a,b)=>a+b.expenditure,0);
  const totalPL=totalInc-totalExp;

  function applyFilter(){
    const base=ecrData.filter(r=>r.month===filterMonth);
    const v1=parseFloat(filterVal1)||0;
    const v2=parseFloat(filterVal2)||0;
    const getVal=(r:ECRRecord)=>{
      switch(filterParam){
        case "ecr": return r.ecr||0;
        case "posb": return r.heads?.posb_live||0;
        case "pli": return r.heads?.pli_premium||0;
        case "rpli": return r.heads?.rpli_premium||0;
      }
    };
    let result=base.filter(r=>{
      const val=getVal(r);
      if(filterOp==="above") return val>v1;
      if(filterOp==="below") return val<v1;
      if(filterOp==="between") return val>=v1&&val<=v2;
      return true;
    });
    result.sort((a,b)=>getVal(b)-getVal(a));
    setFilterResult(result);
  }

  async function exportMonthly(){
    const XLSX=await import("xlsx");
    const rows=monthlyData.map((r,i)=>({
      Rank:i+1,OfficeCode:r.officeCode,OfficeName:r.officeName||r.officeCode,
      Month:monthLabel(r.month),Income:r.income,Expenditure:r.expenditure,
      "P&L":r.income-r.expenditure,"ECR%":r.ecr.toFixed(2),
      Status:r.ecr>=100?"Surplus":r.ecr>=80?"Average":"Deficit",
      "POSB Live":r.heads?.posb_live||0,"PLI":r.heads?.pli_premium||0,"RPLI":r.heads?.rpli_premium||0,
    }));
    const ws=XLSX.utils.json_to_sheet(rows);
    ws["!cols"]=Array(12).fill({wch:16});
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,ws,"Monthly ECR");
    XLSX.writeFile(wb,`ECR_Monthly_${monthLabel(month).replace(" ","_")}.xlsx`);
    showToast("✅ Exported!");
  }

  async function exportConsolidated(detail:boolean){
    const XLSX=await import("xlsx");
    let rows:any[]=[];
    if(!detail){
      Object.entries(grouped).forEach(([key,recs])=>{
        const inc=recs.reduce((a,r)=>a+r.income,0);
        const exp=recs.reduce((a,r)=>a+r.expenditure,0);
        const avg=recs.length?recs.reduce((a,r)=>a+r.ecr,0)/recs.length:0;
        rows.push({GroupCode:key,Offices:recs.length,TotalIncome:inc,TotalExpend:exp,
          "Net P&L":inc-exp,"Avg ECR%":avg.toFixed(2),
          "≥100% ECR":recs.filter(r=>r.ecr>=100).length,"<80% ECR":recs.filter(r=>r.ecr<80).length});
      });
    }else{
      Object.entries(grouped).forEach(([key,recs])=>{
        recs.sort((a,b)=>b.ecr-a.ecr).forEach((r,i)=>{
          rows.push({Group:key,Rank:i+1,OfficeCode:r.officeCode,OfficeName:r.officeName||r.officeCode,
            Income:r.income,Expenditure:r.expenditure,"P&L":r.income-r.expenditure,
            "ECR%":r.ecr.toFixed(2),Status:r.ecr>=100?"Surplus":r.ecr>=80?"Average":"Deficit",
            "POSB Live":r.heads?.posb_live||0,PLI:r.heads?.pli_premium||0,RPLI:r.heads?.rpli_premium||0});
        });
      });
    }
    const ws=XLSX.utils.json_to_sheet(rows);
    ws["!cols"]=Array(12).fill({wch:16});
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,ws,detail?"Detailed":"Consolidated");
    XLSX.writeFile(wb,`ECR_${detail?"Detailed":"Consolidated"}_${groupBy}_${monthLabel(conMonth).replace(" ","_")}.xlsx`);
    showToast("✅ Exported!");
  }

  async function exportFilterResult(){
    if(!filterResult?.length) return;
    const XLSX=await import("xlsx");
    const rows=filterResult.map((r,i)=>({
      Rank:i+1,OfficeCode:r.officeCode,OfficeName:r.officeName||r.officeCode,
      Month:monthLabel(r.month),"ECR%":r.ecr.toFixed(2),Income:r.income,
      Expenditure:r.expenditure,"P&L":r.income-r.expenditure,
    }));
    const ws=XLSX.utils.json_to_sheet(rows);
    ws["!cols"]=Array(10).fill({wch:16});
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,ws,"Filter Result");
    XLSX.writeFile(wb,`ECR_Filter_${filterParam}_${filterOp}_${filterVal1}.xlsx`);
    showToast("✅ Filter result exported!");
  }

  const allTabs=[
    {id:"myoffice" as TabType,label:"My Office",icon:"🏪",show:true},
    {id:"monthly" as TabType,label:"Monthly",icon:"📅",show:isAdminLevel},
    {id:"compare" as TabType,label:"Compare",icon:"⚖️",show:isAdminLevel},
    {id:"yoy" as TabType,label:"YoY",icon:"📆",show:isAdminLevel},
    {id:"consolidated" as TabType,label:"Consolidated",icon:"🗂️",show:isAdminLevel},
    {id:"filter" as TabType,label:"Filter",icon:"🔍",show:true},
  ].filter(t=>t.show);

  const paramLabel:Record<FilterParam,string>={
    ecr:"ECR %",posb:"POSB Live A/C (count)",pli:"PLI Premium (₹)",rpli:"RPLI Premium (₹)"
  };

  return(
    <div style={{paddingBottom:80,background:"#F0F4F8",minHeight:"100vh",
      fontFamily:"-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"}}>

      {/* Header */}
      <div style={{background:"linear-gradient(135deg,#0D47A1,#1E88E5)",
        padding:"16px 16px 20px",color:"#fff"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
          <div>
            <h1 style={{fontSize:20,fontWeight:700,margin:"0 0 2px"}}>ECR Reports</h1>
            <div style={{fontSize:13,opacity:.85}}>
              {ROLE_LABELS[profile?.role||""]||""} · {ecrData.length} records loaded
            </div>
          </div>
          <button onClick={()=>router.push("/dashboard")} style={hBtn}>← Back</button>
        </div>
      </div>

      {/* Monthly summary stats */}
      {isAdminLevel&&activeTab==="monthly"&&monthlyData.length>0&&(
        <div style={{padding:"12px 12px 0"}}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:8}}>
            <Stat label="Avg ECR" value={`${avgECR.toFixed(1)}%`} color={ecrColor(avgECR)}/>
            <Stat label="≥100% ECR" value={`${goodCount}`} color="#16A34A" sub="offices"/>
            <Stat label="Below 80%" value={`${poorCount}`} color="#DC2626" sub="offices"/>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
            <Stat label="Total Income" value={`₹${(totalInc/100000).toFixed(1)}L`} color="#16A34A"/>
            <Stat label="Total Expend" value={`₹${(totalExp/100000).toFixed(1)}L`} color="#DC2626"/>
            <Stat label="Net P&L"
              value={`${totalPL>=0?"+":"-"}₹${(Math.abs(totalPL)/100000).toFixed(1)}L`}
              color={totalPL>=0?"#16A34A":"#DC2626"}/>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div style={{display:"flex",margin:"12px 12px 0",borderRadius:10,
        overflow:"hidden",border:"1px solid #E2E8F0",background:"#fff"}}>
        {allTabs.map(t=>(
          <button key={t.id} onClick={()=>setActiveTab(t.id)} style={{
            flex:1,padding:"10px 2px",border:"none",cursor:"pointer",
            fontWeight:600,fontSize:9,
            background:activeTab===t.id?"#1565C0":"#fff",
            color:activeTab===t.id?"#fff":"#4A5568",
            display:"flex",flexDirection:"column" as const,alignItems:"center",gap:2,
          }}>
            <span style={{fontSize:15}}>{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      <div style={{padding:"12px 12px 0"}}>
        {loading&&<Empty icon="⏳" title="Loading…" msg="Fetching ECR data"/>}

        {/* MY OFFICE */}
        {activeTab==="myoffice"&&!loading&&(
          <MyOfficeCard records={myRecords}
            name={profile?.officeName||""}
            code={profile?.officeId||profile?.officeCode||""}/>
        )}

        {/* MONTHLY */}
        {activeTab==="monthly"&&!loading&&(
          <>
            <div style={fCard}>
              <div style={{display:"flex",gap:8,marginBottom:10}}>
                <div style={{flex:1}}>
                  <label style={lbl}>Month</label>
                  <input type="month" style={inp} value={month}
                    onChange={e=>setMonth(e.target.value)}/>
                </div>
                <div style={{display:"flex",alignItems:"flex-end"}}>
                  <button onClick={exportMonthly} style={exportBtn}>📥 Export</button>
                </div>
              </div>
              <label style={lbl}>Sort by</label>
              <div style={{display:"flex",flexWrap:"wrap" as const,gap:6}}>
                {([
                  {key:"ecr_desc" as SortKey,label:"ECR ↓ High"},
                  {key:"ecr_asc" as SortKey,label:"ECR ↑ Low"},
                  {key:"name_az" as SortKey,label:"Name A→Z"},
                  {key:"name_za" as SortKey,label:"Name Z→A"},
                  {key:"income_desc" as SortKey,label:"Income ↓"},
                  {key:"pl_desc" as SortKey,label:"P&L ↓"},
                ]).map(s=>(
                  <button key={s.key} onClick={()=>setSortKey(s.key)} style={{
                    padding:"5px 10px",fontSize:11,fontWeight:600,
                    borderRadius:16,cursor:"pointer",border:"1px solid",
                    background:sortKey===s.key?"#1565C0":"#fff",
                    color:sortKey===s.key?"#fff":"#718096",
                    borderColor:sortKey===s.key?"#1565C0":"#E2E8F0",
                  }}>{s.label}</button>
                ))}
              </div>
            </div>
            {monthlyData.length===0
              ?<Empty icon="📅" title="No data for this month" msg="Submit income and expenditure first."/>
              :monthlyData.map((r,i)=><OfficeRow key={r.officeCode} r={r} rank={i+1}/>)
            }
          </>
        )}

        {/* COMPARE */}
        {activeTab==="compare"&&!loading&&(
          <>
            <div style={fCard}>
              <div style={{display:"flex",gap:10}}>
                <div style={{flex:1}}>
                  <label style={lbl}>Month 1</label>
                  <input type="month" style={inp} value={month1}
                    onChange={e=>setMonth1(e.target.value)}/>
                </div>
                <div style={{flex:1}}>
                  <label style={lbl}>Month 2</label>
                  <input type="month" style={inp} value={month2}
                    onChange={e=>setMonth2(e.target.value)}/>
                </div>
              </div>
            </div>
            {compareData.length===0
              ?<Empty icon="⚖️" title="No comparison data" msg="Both months need ECR data."/>
              :<>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:12}}>
                  <div style={{background:"#DCFCE7",borderRadius:10,padding:"12px"}}>
                    <div style={{fontSize:10,color:"#15803D",fontWeight:700}}>IMPROVED</div>
                    <div style={{fontSize:26,fontWeight:800,color:"#15803D"}}>
                      {compareData.filter(d=>d.ecr2>d.ecr1).length}
                    </div>
                    <div style={{fontSize:11,color:"#15803D"}}>offices</div>
                  </div>
                  <div style={{background:"#FEE2E2",borderRadius:10,padding:"12px"}}>
                    <div style={{fontSize:10,color:"#DC2626",fontWeight:700}}>DECLINED</div>
                    <div style={{fontSize:26,fontWeight:800,color:"#DC2626"}}>
                      {compareData.filter(d=>d.ecr2<d.ecr1).length}
                    </div>
                    <div style={{fontSize:11,color:"#DC2626"}}>offices</div>
                  </div>
                </div>
                {compareData.sort((a,b)=>(b.ecr2-b.ecr1)-(a.ecr2-a.ecr1)).map((d,i)=>(
                  <CompareRow key={i} office={d.office}
                    ecr1={d.ecr1} ecr2={d.ecr2}
                    month1={month1} month2={month2}/>
                ))}
              </>
            }
          </>
        )}

        {/* YOY */}
        {activeTab==="yoy"&&!loading&&(
          <>
            <div style={fCard}>
              <label style={lbl}>Month</label>
              <select style={inp} value={yoyMonth} onChange={e=>setYoyMonth(e.target.value)}>
                {Array.from({length:12},(_,i)=>{
                  const m=String(i+1).padStart(2,"0");
                  return <option key={m} value={m}>
                    {new Date(2024,i).toLocaleString("default",{month:"long"})}
                  </option>;
                })}
              </select>
              <div style={{display:"flex",gap:10,marginTop:10}}>
                <div style={{flex:1}}>
                  <label style={lbl}>Year 1</label>
                  <select style={inp} value={year1} onChange={e=>setYear1(e.target.value)}>
                    {[curYear-3,curYear-2,curYear-1,curYear].map(y=>
                      <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
                <div style={{flex:1}}>
                  <label style={lbl}>Year 2</label>
                  <select style={inp} value={year2} onChange={e=>setYear2(e.target.value)}>
                    {[curYear-2,curYear-1,curYear,curYear+1].map(y=>
                      <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
              </div>
            </div>
            {yoyData.length===0
              ?<Empty icon="📆" title="No YoY data" msg="Data needed for both years."/>
              :yoyData.map((d,i)=>(
                <CompareRow key={i} office={d.office}
                  ecr1={d.ecr1} ecr2={d.ecr2}
                  month1={`${year1}-${yoyMonth}`}
                  month2={`${year2}-${yoyMonth}`}/>
              ))
            }
          </>
        )}

        {/* CONSOLIDATED */}
        {activeTab==="consolidated"&&!loading&&(
          <>
            <div style={fCard}>
              <div style={{display:"flex",gap:8,marginBottom:10}}>
                <div style={{flex:1}}>
                  <label style={lbl}>Month</label>
                  <input type="month" style={inp} value={conMonth}
                    onChange={e=>setConMonth(e.target.value)}/>
                </div>
                <div style={{flex:1}}>
                  <label style={lbl}>Group by</label>
                  <select style={inp} value={groupBy} onChange={e=>setGroupBy(e.target.value as GroupBy)}>
                    <option value="circle">Circle</option>
                    <option value="division">Division</option>
                    <option value="subdivision">Sub Division</option>
                  </select>
                </div>
              </div>
              <div style={{display:"flex",gap:8}}>
                <button onClick={()=>exportConsolidated(false)}
                  style={{...exportBtn,flex:1,fontSize:11}}>📥 Summary</button>
                <button onClick={()=>exportConsolidated(true)}
                  style={{...exportBtn,flex:1,fontSize:11,background:"#0F766E"}}>📥 Detailed</button>
              </div>
            </div>
            {conData.length===0
              ?<Empty icon="🗂️" title="No data" msg="Select a month with ECR data."/>
              :Object.entries(grouped)
                .sort((a,b)=>{
                  const avgA=a[1].reduce((s,r)=>s+r.ecr,0)/a[1].length;
                  const avgB=b[1].reduce((s,r)=>s+r.ecr,0)/b[1].length;
                  return avgB-avgA;
                })
                .map(([key,recs])=>(
                  <GroupCard key={key} groupKey={key} records={recs}
                    groupLabel={groupBy==="circle"?"Circle":groupBy==="division"?"Division":"Sub Division"}/>
                ))
            }
          </>
        )}

        {/* FILTER */}
        {activeTab==="filter"&&!loading&&(
          <>
            {/* ── OFFICE SEARCH BOX ── */}
            <div style={fCard}>
              <div style={sHead}>🔍 Search Office by Name / ID</div>
              <div style={{display:"flex",gap:8,marginBottom:8}}>
                <input
                  style={{...inp,flex:1}}
                  placeholder="Type office name or office ID…"
                  value={officeSearch}
                  onChange={e=>{
                    setOfficeSearch(e.target.value);
                    if(!e.target.value.trim()) setOfficeSearchResult(null);
                  }}
                  onKeyDown={e=>e.key==="Enter"&&searchByOffice()}
                />
                <button onClick={searchByOffice} style={{
                  padding:"9px 16px",background:"#1565C0",color:"#fff",
                  border:"none",borderRadius:8,fontSize:13,
                  fontWeight:700,cursor:"pointer",whiteSpace:"nowrap" as const,
                }}>
                  Search
                </button>
              </div>
              {officeSearch&&(
                <div style={{fontSize:11,color:"#A0AEC0"}}>
                  Searching across {ecrData.length} records · Press Enter or click Search
                </div>
              )}
            </div>

            {/* Search results */}
            {officeSearchResult!==null&&(
              <div style={{marginBottom:12}}>
                <div style={{display:"flex",justifyContent:"space-between",
                  alignItems:"center",marginBottom:8}}>
                  <div style={{fontSize:13,fontWeight:700,
                    color:officeSearchResult.length>0?"#1A202C":"#A0AEC0"}}>
                    {officeSearchResult.length===0
                      ?`No offices found for "${officeSearch}"`
                      :`${officeSearchResult.length} office${officeSearchResult.length>1?"s":""} found`}
                  </div>
                  {officeSearchResult.length>0&&(
                    <button onClick={()=>exportOfficeSearch(officeSearchResult)}
                      style={{padding:"5px 12px",background:"#1565C0",color:"#fff",
                        border:"none",borderRadius:6,fontSize:11,
                        fontWeight:600,cursor:"pointer"}}>
                      📥 Export
                    </button>
                  )}
                </div>
                {officeSearchResult.map((r,i)=>{
                  const pl=r.income-r.expenditure;
                  const shortfall=Math.max(0,r.expenditure-r.income);
                  return(
                    <div key={`${r.officeCode}_${i}`} style={{background:"#fff",
                      borderRadius:12,border:`1px solid ${ecrBorder(r.ecr)}`,
                      padding:"12px 14px",marginBottom:8}}>
                      <div style={{display:"flex",justifyContent:"space-between",
                        alignItems:"flex-start",marginBottom:8}}>
                        <div>
                          <div style={{fontSize:14,fontWeight:700,color:"#1A202C"}}>
                            {r.officeName||r.officeCode}
                          </div>
                          <div style={{fontSize:11,color:"#A0AEC0"}}>
                            {r.officeCode} · {monthLabel(r.month)}
                          </div>
                        </div>
                        <div style={{textAlign:"right" as const}}>
                          <div style={{fontSize:22,fontWeight:800,
                            color:ecrColor(r.ecr),lineHeight:1}}>
                            {(r.ecr||0).toFixed(1)}%
                          </div>
                          <span style={{fontSize:10,fontWeight:700,
                            background:ecrBg(r.ecr),color:ecrColor(r.ecr),
                            padding:"2px 8px",borderRadius:10}}>
                            {r.ecr>=100?"✓ Surplus":r.ecr>=80?"~ Average":"✗ Deficit"}
                          </span>
                        </div>
                      </div>
                      {/* Bar */}
                      <div style={{background:"#F1F5F9",borderRadius:6,
                        height:8,overflow:"hidden",marginBottom:8}}>
                        <div style={{width:`${Math.min(r.ecr||0,100)}%`,
                          height:"100%",background:ecrColor(r.ecr),borderRadius:6}}/>
                      </div>
                      {/* Stats */}
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6}}>
                        {[
                          {label:"INCOME",val:fmtR(r.income),bg:"#F0FFF4",color:"#15803D"},
                          {label:"EXPENDITURE",val:fmtR(r.expenditure),bg:"#FFF5F5",color:"#B91C1C"},
                          {label:pl>=0?"SURPLUS":"DEFICIT",
                            val:(pl>=0?"+":"-")+fmtR(pl),
                            bg:pl>=0?"#F0FFF4":"#FFF5F5",
                            color:pl>=0?"#15803D":"#B91C1C"},
                        ].map(m=>(
                          <div key={m.label} style={{background:m.bg,borderRadius:6,padding:"5px 8px"}}>
                            <div style={{fontSize:9,color:m.color,fontWeight:700}}>{m.label}</div>
                            <div style={{fontSize:12,fontWeight:700,color:m.color}}>{m.val}</div>
                          </div>
                        ))}
                      </div>
                      {shortfall>0&&(
                        <div style={{marginTop:8,background:"#FEF2F2",
                          borderRadius:8,padding:"8px 10px",
                          fontSize:12,color:"#B91C1C",fontWeight:600}}>
                          ⚠️ POSB accounts needed: {Math.ceil(shortfall/219.23).toLocaleString()}
                        </div>
                      )}
                      {/* POSB/PLI/RPLI */}
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",
                        gap:6,marginTop:8}}>
                        {[
                          {label:"POSB Live",val:`${r.heads?.posb_live||0} a/c`,color:"#1D4ED8"},
                          {label:"PLI",val:fmtR(r.heads?.pli_premium||0),color:"#0F766E"},
                          {label:"RPLI",val:fmtR(r.heads?.rpli_premium||0),color:"#7C3AED"},
                        ].map(m=>(
                          <div key={m.label} style={{background:"#F7FAFC",borderRadius:6,
                            padding:"5px 8px",border:"1px solid #E2E8F0"}}>
                            <div style={{fontSize:9,color:"#718096",fontWeight:700}}>{m.label}</div>
                            <div style={{fontSize:12,fontWeight:700,color:m.color}}>{m.val}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Divider */}
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
              <div style={{flex:1,height:1,background:"#E2E8F0"}}/>
              <div style={{fontSize:11,color:"#A0AEC0",fontWeight:600,whiteSpace:"nowrap" as const}}>
                OR FILTER BY PARAMETER
              </div>
              <div style={{flex:1,height:1,background:"#E2E8F0"}}/>
            </div>

            {/* Parameter filter */}
            <div style={fCard}>
              <div style={sHead}>Filter by Parameter</div>
              <label style={lbl}>Month</label>
              <div style={{marginBottom:12}}>
                <input type="month" style={inp} value={filterMonth}
                  onChange={e=>setFilterMonth(e.target.value)}/>
              </div>
              <label style={lbl}>Parameter</label>
              <div style={{display:"flex",flexWrap:"wrap" as const,gap:6,marginBottom:12}}>
                {(["ecr","posb","pli","rpli"] as FilterParam[]).map(p=>(
                  <button key={p} onClick={()=>setFilterParam(p)} style={{
                    padding:"7px 12px",fontSize:12,fontWeight:700,
                    borderRadius:20,cursor:"pointer",border:"1px solid",
                    background:filterParam===p?"#1565C0":"#fff",
                    color:filterParam===p?"#fff":"#718096",
                    borderColor:filterParam===p?"#1565C0":"#E2E8F0",
                  }}>
                    {p==="ecr"?"📈 ECR %":p==="posb"?"📮 POSB":p==="pli"?"🛡️ PLI":"🌾 RPLI"}
                  </button>
                ))}
              </div>
              <label style={lbl}>Condition</label>
              <div style={{display:"flex",gap:6,marginBottom:12}}>
                {(["above","below","between"] as FilterOp[]).map(op=>(
                  <button key={op} onClick={()=>setFilterOp(op)} style={{
                    flex:1,padding:"8px 4px",fontSize:12,fontWeight:700,
                    borderRadius:8,cursor:"pointer",border:"1px solid",
                    background:filterOp===op?"#1565C0":"#fff",
                    color:filterOp===op?"#fff":"#718096",
                    borderColor:filterOp===op?"#1565C0":"#E2E8F0",
                    textTransform:"capitalize" as const,
                  }}>{op}</button>
                ))}
              </div>
              <div style={{display:"flex",gap:8,marginBottom:14}}>
                <div style={{flex:1}}>
                  <label style={lbl}>
                    {filterOp==="between"?"From value":"Value"}
                    {" — "}{paramLabel[filterParam]}
                  </label>
                  <input type="number" style={inp} value={filterVal1}
                    placeholder={filterParam==="ecr"?"e.g. 90":"e.g. 100"}
                    onChange={e=>setFilterVal1(e.target.value)}/>
                </div>
                {filterOp==="between"&&(
                  <div style={{flex:1}}>
                    <label style={lbl}>To value</label>
                    <input type="number" style={inp} value={filterVal2}
                      placeholder="e.g. 100"
                      onChange={e=>setFilterVal2(e.target.value)}/>
                  </div>
                )}
              </div>
              <button onClick={applyFilter} style={{
                width:"100%",padding:12,background:"#1565C0",color:"#fff",
                border:"none",borderRadius:10,fontSize:14,fontWeight:700,cursor:"pointer",
              }}>
                🔍 Search Offices
              </button>
            </div>

            {/* Filter results */}
            {filterResult!==null&&(
              <>
                <div style={{display:"flex",justifyContent:"space-between",
                  alignItems:"center",marginBottom:8}}>
                  <div style={{fontSize:13,fontWeight:700,color:"#1A202C"}}>
                    {filterResult.length} offices found
                  </div>
                  {filterResult.length>0&&(
                    <button onClick={exportFilterResult} style={exportBtn}>
                      📥 Download
                    </button>
                  )}
                </div>
                {filterResult.length===0
                  ?<Empty icon="🔍" title="No offices match" msg="Try different filter values."/>
                  :(
                    <div style={{background:"#fff",borderRadius:12,
                      border:"1px solid #E2E8F0",overflow:"hidden",marginBottom:12}}>
                      {/* Header */}
                      <div style={{display:"grid",gridTemplateColumns:"auto 1fr auto auto auto",
                        padding:"10px 14px",background:"#F7FAFC",
                        borderBottom:"1px solid #E2E8F0"}}>
                        {["#","Office","ECR","Income","P&L"].map(h=>(
                          <div key={h} style={{fontSize:10,fontWeight:700,color:"#4A5568",
                            textTransform:"uppercase" as const}}>{h}</div>
                        ))}
                      </div>
                      {/* Rows */}
                      {filterResult.map((r,i)=>{
                        const pl=r.income-r.expenditure;
                        return(
                          <div key={r.officeCode} style={{
                            display:"grid",gridTemplateColumns:"auto 1fr auto auto auto",
                            padding:"10px 14px",
                            borderBottom:i<filterResult.length-1?"1px solid #F7FAFC":"none",
                            background:i%2===0?"#fff":"#FAFAFA",alignItems:"center",
                          }}>
                            <div style={{fontSize:11,color:"#718096",fontWeight:700,marginRight:10}}>
                              {i+1}
                            </div>
                            <div>
                              <div style={{fontSize:13,fontWeight:600,color:"#1A202C"}}>
                                {r.officeName||r.officeCode}
                              </div>
                              <div style={{fontSize:10,color:"#A0AEC0"}}>{r.officeCode}</div>
                            </div>
                            <div style={{textAlign:"center" as const,marginRight:8}}>
                              <span style={{fontSize:13,fontWeight:800,
                                color:ecrColor(r.ecr),background:ecrBg(r.ecr),
                                padding:"3px 8px",borderRadius:10}}>
                                {(r.ecr||0).toFixed(1)}%
                              </span>
                            </div>
                            <div style={{fontSize:12,fontWeight:600,color:"#16A34A",
                              textAlign:"right" as const,marginRight:8}}>
                              {fmtR(r.income)}
                            </div>
                            <div style={{fontSize:12,fontWeight:700,
                              color:pl>=0?"#16A34A":"#DC2626",
                              textAlign:"right" as const}}>
                              {pl>=0?"+":"-"}{fmtR(pl)}
                            </div>
                          </div>
                        );
                      })}
                      {/* Footer */}
                      <div style={{display:"grid",gridTemplateColumns:"auto 1fr auto auto auto",
                        padding:"10px 14px",background:"#EBF8FF",
                        borderTop:"2px solid #BEE3F8"}}>
                        <div/>
                        <div style={{fontSize:12,fontWeight:700,color:"#1D4ED8"}}>
                          TOTAL ({filterResult.length} offices)
                        </div>
                        <div style={{fontSize:12,fontWeight:700,
                          color:ecrColor(filterResult.reduce((a,r)=>a+r.ecr,0)/filterResult.length),
                          textAlign:"center" as const,marginRight:8}}>
                          {(filterResult.reduce((a,r)=>a+r.ecr,0)/filterResult.length).toFixed(1)}%
                        </div>
                        <div style={{fontSize:12,fontWeight:700,color:"#16A34A",
                          textAlign:"right" as const,marginRight:8}}>
                          {fmtR(filterResult.reduce((a,r)=>a+r.income,0))}
                        </div>
                        <div style={{fontSize:12,fontWeight:700,
                          color:filterResult.reduce((a,r)=>a+(r.income-r.expenditure),0)>=0?"#16A34A":"#DC2626",
                          textAlign:"right" as const}}>
                          {fmtR(filterResult.reduce((a,r)=>a+(r.income-r.expenditure),0))}
                        </div>
                      </div>
                    </div>
                  )
                }
              </>
            )}
          </>
        )}
      </div>

      {toast&&(
        <div style={{position:"fixed",bottom:80,left:"50%",
          transform:"translateX(-50%)",background:"#2D3748",color:"#fff",
          padding:"10px 20px",borderRadius:24,fontSize:13,fontWeight:500,zIndex:300}}>
          {toast}
        </div>
      )}
      <BottomNav/>
    </div>
  );
}

const fCard:React.CSSProperties={
  background:"#fff",border:"1px solid #E2E8F0",borderRadius:12,padding:14,marginBottom:12
};
const sHead:React.CSSProperties={
  fontSize:13,fontWeight:700,color:"#718096",
  textTransform:"uppercase",letterSpacing:.5,marginBottom:14
};
const lbl:React.CSSProperties={
  display:"block",fontSize:11,fontWeight:600,color:"#4A5568",
  textTransform:"uppercase",letterSpacing:.3,marginBottom:4
};
const inp:React.CSSProperties={
  width:"100%",padding:"9px 11px",fontSize:14,
  border:"1.5px solid #E2E8F0",borderRadius:8,
  color:"#1A202C",background:"#fff",boxSizing:"border-box",outline:"none"
};
const hBtn:React.CSSProperties={
  background:"rgba(255,255,255,0.2)",border:"1px solid rgba(255,255,255,0.4)",
  color:"#fff",borderRadius:8,padding:"7px 14px",fontSize:13,fontWeight:600,cursor:"pointer"
};
const exportBtn:React.CSSProperties={
  padding:"9px 14px",background:"#1565C0",color:"#fff",
  border:"none",borderRadius:8,fontSize:13,
  fontWeight:600,cursor:"pointer",whiteSpace:"nowrap" as const,
};
