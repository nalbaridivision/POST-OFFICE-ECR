"use client";

import { useState, useEffect } from "react";
import { useAuth, ROLE_LABELS } from "../../context/AuthContext";
import { useRouter } from "next/navigation";
import { db } from "../firebase";
import {
  getInbox, getSent, sendMessage,
  markAsRead, replyToMessage, getUsersInScope
} from "../../utils/messageService";
import BottomNav from "../../components/BottomNav";

type Tab     = "inbox" | "sent" | "compose";
type MsgView = "list" | "detail";

export default function MessagesPage() {
  const { profile, user } = useAuth();
  const router = useRouter();

  const [tab,         setTab]         = useState<Tab>("inbox");
  const [msgView,     setMsgView]     = useState<MsgView>("list");
  const [inbox,       setInbox]       = useState<any[]>([]);
  const [sent,        setSent]        = useState<any[]>([]);
  const [selected,    setSelected]    = useState<any>(null);
  const [loading,     setLoading]     = useState(false);
  const [sending,     setSending]     = useState(false);
  const [toast,       setToast]       = useState("");
  const [replyText,   setReplyText]   = useState("");
  const [usersInScope,setUsersInScope]= useState<any[]>([]);
  const [unread,      setUnread]      = useState(0);

  // Compose form
  const [subject,     setSubject]     = useState("");
  const [body,        setBody]        = useState("");
  const [priority,    setPriority]    = useState<"normal"|"urgent">("normal");
  const [targetScope, setTargetScope] = useState<"all" | "specific">("all");
  const [selectedUIDs,setSelectedUIDs]= useState<string[]>([]);

  const uid = profile?.uid || "";

  useEffect(() => {
    if (!user) { router.push("/"); return; }
    if (profile) {
      fetchMessages();
      fetchUsersInScope();
    }
  }, [user, profile, tab]);

  async function fetchMessages() {
    setLoading(true);
    try {
      if (tab === "inbox" || tab === "compose") {
        const msgs = await getInbox(uid);
        setInbox(msgs);
        setUnread(msgs.filter(m => !m.isRead?.[uid]).length);
      }
      if (tab === "sent") {
        const msgs = await getSent(uid);
        setSent(msgs);
      }
    } catch (e: any) { showToast("Error: " + e.message); }
    finally { setLoading(false); }
  }

  async function fetchUsersInScope() {
    try {
      const users = await getUsersInScope(profile);
      // Exclude self
      setUsersInScope(users.filter(u => u.uid !== uid && u.id !== uid));
    } catch (e) { console.error(e); }
  }

  async function openMessage(msg: any) {
    setSelected(msg);
    setMsgView("detail");
    setReplyText("");
    // Mark as read
    if (!msg.isRead?.[uid]) {
      await markAsRead(msg.id, uid);
      fetchMessages();
    }
  }

  async function handleSend() {
    if (!subject.trim()) { showToast("Subject is required"); return; }
    if (!body.trim())    { showToast("Message body is required"); return; }

    let recipientUIDs: string[] = [];

    if (targetScope === "all") {
      recipientUIDs = usersInScope.map(u => u.uid || u.id).filter(Boolean);
    } else {
      recipientUIDs = selectedUIDs;
    }

    if (recipientUIDs.length === 0) {
      showToast("No recipients selected"); return;
    }

    setSending(true);
    try {
      await sendMessage({
        subject,
        body,
        senderId:      uid,
        senderName:    profile?.name || "",
        senderRole:    profile?.role || "",
        recipients:    recipientUIDs,
        recipientScope:targetScope === "all" ? `all_${profile?.role}` : "specific",
        scopeCode:     profile?.subDivCode || profile?.divisionCode || profile?.circleCode || "",
        isRead:        { [uid]: true },
        replies:       [],
        priority,
      });
      showToast(`✅ Message sent to ${recipientUIDs.length} recipients`);
      setSubject(""); setBody(""); setSelectedUIDs([]);
      setPriority("normal"); setTargetScope("all");
      setTab("sent");
      fetchMessages();
    } catch (e: any) { showToast("Error: " + e.message); }
    finally { setSending(false); }
  }

  async function handleReply() {
    if (!replyText.trim()) { showToast("Reply cannot be empty"); return; }
    try {
      await replyToMessage(selected.id, {
        senderId:   uid,
        senderName: profile?.name || "",
        body:       replyText,
        createdAt:  new Date().toISOString(),
      });
      showToast("✅ Reply sent");
      setReplyText("");
      // Refresh selected message
      const msgs = await getInbox(uid);
      const updated = msgs.find(m => m.id === selected.id);
      if (updated) setSelected(updated);
    } catch (e: any) { showToast("Error: " + e.message); }
  }

  function toggleSelectUID(uid: string) {
    setSelectedUIDs(prev =>
      prev.includes(uid) ? prev.filter(u => u !== uid) : [...prev, uid]
    );
  }

  function showToast(msg: string) {
    setToast(msg); setTimeout(() => setToast(""), 3000);
  }

  function timeAgo(ts: any): string {
    if (!ts) return "";
    const date = ts.toDate ? ts.toDate() : new Date(ts);
    const diff = Date.now() - date.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1)   return "Just now";
    if (mins < 60)  return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24)   return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }

  const currentList = tab === "inbox" ? inbox : sent;

  // ── MESSAGE DETAIL VIEW ───────────────────────────────────────
  if (msgView === "detail" && selected) {
    return (
      <div style={{ paddingBottom: 80, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
        {/* Header */}
        <div style={{ background: "linear-gradient(135deg, #0D47A1, #1E88E5)",
          padding: "16px 16px 20px", color: "#fff" }}>
          <button onClick={() => { setMsgView("list"); setSelected(null); }}
            style={hBtn}>← Back</button>
          <h1 style={{ fontSize: 18, fontWeight: 700, margin: "12px 0 2px" }}>
            {selected.priority === "urgent" && (
              <span style={{ background: "#DC2626", fontSize: 11,
                padding: "2px 8px", borderRadius: 10, marginRight: 8 }}>
                🚨 URGENT
              </span>
            )}
            {selected.subject}
          </h1>
          <div style={{ fontSize: 12, opacity: .8 }}>
            From: {selected.senderName} ({ROLE_LABELS[selected.senderRole] || selected.senderRole})
            · {timeAgo(selected.createdAt)}
          </div>
        </div>

        <div style={{ padding: "12px 12px 0" }}>
          {/* Message body */}
          <div style={{ background: "#fff", borderRadius: 12,
            border: "1px solid #E2E8F0", padding: 16, marginBottom: 12 }}>
            <div style={{ fontSize: 14, color: "#2D3748", lineHeight: 1.8,
              whiteSpace: "pre-wrap" as const }}>
              {selected.body}
            </div>
          </div>

          {/* Replies */}
          {selected.replies && selected.replies.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#718096",
                textTransform: "uppercase" as const, marginBottom: 8 }}>
                Replies ({selected.replies.length})
              </div>
              {selected.replies.map((r: any, i: number) => (
                <div key={r.id || i} style={{
                  background: r.senderId === uid ? "#EBF8FF" : "#F7FAFC",
                  borderRadius: 10, padding: "10px 14px", marginBottom: 8,
                  borderLeft: `3px solid ${r.senderId === uid ? "#1565C0" : "#CBD5E0"}`
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between",
                    marginBottom: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 700,
                      color: r.senderId === uid ? "#1D4ED8" : "#4A5568" }}>
                      {r.senderId === uid ? "You" : r.senderName}
                    </span>
                    <span style={{ fontSize: 11, color: "#A0AEC0" }}>
                      {typeof r.createdAt === "string"
                        ? new Date(r.createdAt).toLocaleString()
                        : timeAgo(r.createdAt)}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, color: "#2D3748",
                    lineHeight: 1.6, whiteSpace: "pre-wrap" as const }}>
                    {r.body}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Reply box — only for recipients not sender */}
          {selected.senderId !== uid && (
            <div style={{ background: "#fff", borderRadius: 12,
              border: "1px solid #E2E8F0", padding: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#718096",
                textTransform: "uppercase" as const, marginBottom: 8 }}>
                Reply
              </div>
              <textarea
                style={{ ...inputStyle, height: 100,
                  resize: "none" as const, lineHeight: 1.6 }}
                value={replyText}
                onChange={e => setReplyText(e.target.value)}
                placeholder="Type your reply here…" />
              <button onClick={handleReply} style={{ ...primaryBtn, marginTop: 10 }}>
                📤 Send Reply
              </button>
            </div>
          )}

          {/* Sender can see replies but cannot reply to own message */}
          {selected.senderId === uid && (
            <div style={{ background: "#F0FFF4", borderRadius: 10,
              padding: "10px 14px", fontSize: 13, color: "#276749",
              border: "1px solid #9AE6B4" }}>
              ✅ You sent this message to {selected.recipients?.length || 0} recipients.
            </div>
          )}
        </div>

        {toast && (
          <div style={toastStyle}>{toast}</div>
        )}
        <BottomNav />
      </div>
    );
  }

  // ── MAIN LIST VIEW ─────────────────────────────────────────────
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
              Messages
            </h1>
            <div style={{ fontSize: 13, opacity: .85 }}>
              {unread > 0
                ? `🔴 ${unread} unread message${unread > 1 ? "s" : ""}`
                : "No unread messages"}
            </div>
          </div>
          <button onClick={() => router.push("/dashboard")} style={hBtn}>← Back</button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", background: "#fff",
        borderBottom: "1px solid #E2E8F0" }}>
        {[
          { id: "inbox"   as Tab, label: `📥 Inbox${unread>0?` (${unread})`:""}` },
          { id: "sent"    as Tab, label: "📤 Sent"    },
          { id: "compose" as Tab, label: "✏️ Compose" },
        ].map(t => (
          <button key={t.id} onClick={() => { setTab(t.id); setMsgView("list"); }}
            style={{
              flex: 1, padding: "12px 4px", border: "none", cursor: "pointer",
              fontWeight: 600, fontSize: 12,
              borderBottom: tab===t.id ? "3px solid #1565C0" : "3px solid transparent",
              color:    tab===t.id ? "#1565C0" : "#718096",
              background: "#fff",
            }}>
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ padding: "12px 12px 0" }}>

        {/* ── COMPOSE TAB ── */}
        {tab === "compose" && (
          <div>
            {/* Priority */}
            <div style={card}>
              <div style={sHead}>Priority</div>
              <div style={{ display: "flex", gap: 8 }}>
                {(["normal","urgent"] as const).map(p => (
                  <button key={p} onClick={() => setPriority(p)} style={{
                    flex: 1, padding: "9px", border: "1px solid",
                    borderRadius: 8, cursor: "pointer", fontWeight: 700,
                    fontSize: 13, textTransform: "capitalize" as const,
                    background: priority===p
                      ? p==="urgent" ? "#DC2626" : "#1565C0"
                      : "#fff",
                    color:      priority===p ? "#fff" : "#718096",
                    borderColor:priority===p
                      ? p==="urgent" ? "#DC2626" : "#1565C0"
                      : "#E2E8F0",
                  }}>
                    {p==="urgent" ? "🚨 Urgent" : "📋 Normal"}
                  </button>
                ))}
              </div>
            </div>

            {/* Recipients */}
            <div style={card}>
              <div style={sHead}>Recipients</div>
              <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                <button onClick={() => setTargetScope("all")} style={{
                  flex: 1, padding: "9px", border: "1px solid",
                  borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 12,
                  background: targetScope==="all" ? "#1565C0" : "#fff",
                  color:      targetScope==="all" ? "#fff"    : "#718096",
                  borderColor:targetScope==="all" ? "#1565C0" : "#E2E8F0",
                }}>
                  👥 All in my scope ({usersInScope.length})
                </button>
                <button onClick={() => setTargetScope("specific")} style={{
                  flex: 1, padding: "9px", border: "1px solid",
                  borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 12,
                  background: targetScope==="specific" ? "#1565C0" : "#fff",
                  color:      targetScope==="specific" ? "#fff"    : "#718096",
                  borderColor:targetScope==="specific" ? "#1565C0" : "#E2E8F0",
                }}>
                  🎯 Select specific
                </button>
              </div>

              {targetScope === "specific" && (
                <div>
                  <div style={{ fontSize: 12, color: "#718096", marginBottom: 8 }}>
                    Select recipients ({selectedUIDs.length} selected):
                  </div>
                  <div style={{ maxHeight: 200, overflowY: "auto" as const,
                    border: "1px solid #E2E8F0", borderRadius: 8 }}>
                    {usersInScope.map(u => {
                      const uid = u.uid || u.id;
                      const selected = selectedUIDs.includes(uid);
                      return (
                        <div key={uid} onClick={() => toggleSelectUID(uid)}
                          style={{ display: "flex", alignItems: "center", gap: 10,
                            padding: "10px 12px", cursor: "pointer",
                            borderBottom: "1px solid #F7FAFC",
                            background: selected ? "#EBF8FF" : "#fff" }}>
                          <div style={{
                            width: 20, height: 20, borderRadius: "50%",
                            border: `2px solid ${selected ? "#1565C0" : "#CBD5E0"}`,
                            background: selected ? "#1565C0" : "#fff",
                            display: "flex", alignItems: "center",
                            justifyContent: "center", flexShrink: 0,
                          }}>
                            {selected && <span style={{ color: "#fff", fontSize: 12 }}>✓</span>}
                          </div>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 600,
                              color: "#1A202C" }}>
                              {u.name}
                            </div>
                            <div style={{ fontSize: 11, color: "#718096" }}>
                              {u.employeeId} · {ROLE_LABELS[u.role] || u.role}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    {usersInScope.length === 0 && (
                      <div style={{ padding: 16, textAlign: "center" as const,
                        color: "#A0AEC0", fontSize: 13 }}>
                        No users in your scope
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Subject */}
            <div style={card}>
              <div style={sHead}>Subject</div>
              <input style={inputStyle} value={subject}
                onChange={e => setSubject(e.target.value)}
                placeholder="Enter message subject…" />
            </div>

            {/* Body */}
            <div style={card}>
              <div style={sHead}>Message</div>
              <textarea style={{ ...inputStyle, height: 160,
                resize: "none" as const, lineHeight: 1.7 }}
                value={body}
                onChange={e => setBody(e.target.value)}
                placeholder="Type your message here…" />
            </div>

            {/* Send button */}
            <button onClick={handleSend} disabled={sending} style={{
              width: "100%", padding: 14,
              background: sending ? "#90CDF4"
                : priority==="urgent" ? "#DC2626" : "#1565C0",
              color: "#fff", border: "none", borderRadius: 10,
              fontSize: 15, fontWeight: 700,
              cursor: sending ? "not-allowed" : "pointer",
              marginBottom: 12
            }}>
              {sending ? "Sending…"
                : `📤 Send to ${targetScope==="all"
                    ? usersInScope.length
                    : selectedUIDs.length} recipient${
                    (targetScope==="all"?usersInScope.length:selectedUIDs.length)!==1?"s":""}`}
            </button>
          </div>
        )}

        {/* ── INBOX / SENT LIST ── */}
        {(tab === "inbox" || tab === "sent") && (
          <>
            {loading ? (
              <div style={{ textAlign: "center" as const, padding: 40,
                color: "#A0AEC0" }}>Loading…</div>
            ) : currentList.length === 0 ? (
              <div style={{ textAlign: "center" as const, padding: 40,
                color: "#A0AEC0" }}>
                <div style={{ fontSize: 44, marginBottom: 12 }}>
                  {tab==="inbox" ? "📭" : "📤"}
                </div>
                <div style={{ fontSize: 15, fontWeight: 600, color: "#718096" }}>
                  {tab==="inbox" ? "Inbox is empty" : "No sent messages"}
                </div>
                {tab==="inbox" && (
                  <button onClick={() => setTab("compose")}
                    style={{ marginTop: 16, padding: "8px 20px",
                      background: "#1565C0", color: "#fff",
                      border: "none", borderRadius: 8,
                      fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                    ✏️ Compose Message
                  </button>
                )}
              </div>
            ) : (
              currentList.map((msg: any) => {
                const isUnread = tab==="inbox" && !msg.isRead?.[uid];
                return (
                  <div key={msg.id}
                    onClick={() => openMessage(msg)}
                    style={{
                      background: isUnread ? "#EBF8FF" : "#fff",
                      border: `1px solid ${isUnread ? "#BEE3F8" : "#E2E8F0"}`,
                      borderRadius: 12, padding: "12px 14px",
                      marginBottom: 8, cursor: "pointer",
                      borderLeft: `4px solid ${
                        msg.priority==="urgent" ? "#DC2626"
                        : isUnread ? "#1565C0" : "#E2E8F0"}`,
                    }}>
                    <div style={{ display: "flex", justifyContent: "space-between",
                      alignItems: "flex-start", marginBottom: 4 }}>
                      <div style={{ flex: 1, marginRight: 8 }}>
                        {msg.priority === "urgent" && (
                          <span style={{ fontSize: 10, fontWeight: 700,
                            background: "#DC2626", color: "#fff",
                            padding: "1px 6px", borderRadius: 8, marginRight: 6 }}>
                            🚨 URGENT
                          </span>
                        )}
                        <span style={{ fontSize: 14, fontWeight: isUnread ? 700 : 600,
                          color: "#1A202C" }}>
                          {msg.subject}
                        </span>
                      </div>
                      <span style={{ fontSize: 11, color: "#A0AEC0",
                        flexShrink: 0 }}>
                        {timeAgo(msg.createdAt)}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: "#718096", marginBottom: 4 }}>
                      {tab==="inbox"
                        ? `From: ${msg.senderName}`
                        : `To: ${msg.recipients?.length || 0} recipients`}
                    </div>
                    <div style={{ fontSize: 12, color: "#A0AEC0",
                      overflow: "hidden", textOverflow: "ellipsis",
                      whiteSpace: "nowrap" as const }}>
                      {msg.body}
                    </div>
                    {msg.replies?.length > 0 && (
                      <div style={{ fontSize: 11, color: "#1565C0",
                        marginTop: 4, fontWeight: 600 }}>
                        💬 {msg.replies.length} repl{msg.replies.length===1?"y":"ies"}
                      </div>
                    )}
                    {isUnread && (
                      <div style={{ width: 8, height: 8, borderRadius: "50%",
                        background: "#1565C0", float: "right" as const,
                        marginTop: -20 }} />
                    )}
                  </div>
                );
              })
            )}
          </>
        )}
      </div>

      {toast && <div style={toastStyle}>{toast}</div>}
      <BottomNav />
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────
const card: React.CSSProperties = {
  background: "#fff", border: "1px solid #E2E8F0",
  borderRadius: 12, padding: 16, marginBottom: 12
};
const sHead: React.CSSProperties = {
  fontSize: 13, fontWeight: 700, color: "#718096",
  textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 12
};
const inputStyle: React.CSSProperties = {
  width: "100%", padding: "9px 11px", fontSize: 14,
  border: "1.5px solid #E2E8F0", borderRadius: 8,
  color: "#1A202C", background: "#fff",
  boxSizing: "border-box", outline: "none"
};
const primaryBtn: React.CSSProperties = {
  width: "100%", padding: 12, background: "#1565C0", color: "#fff",
  border: "none", borderRadius: 10, fontSize: 14,
  fontWeight: 700, cursor: "pointer"
};
const hBtn: React.CSSProperties = {
  background: "rgba(255,255,255,0.2)", border: "1px solid rgba(255,255,255,0.4)",
  color: "#fff", borderRadius: 8, padding: "7px 14px",
  fontSize: 12, fontWeight: 600, cursor: "pointer"
};
const toastStyle: React.CSSProperties = {
  position: "fixed", bottom: 80, left: "50%",
  transform: "translateX(-50%)", background: "#2D3748", color: "#fff",
  padding: "10px 20px", borderRadius: 24, fontSize: 13,
  fontWeight: 500, zIndex: 300
};