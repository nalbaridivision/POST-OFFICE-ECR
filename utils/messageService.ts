import {
  collection, doc, setDoc, getDocs, getDoc,
  updateDoc, query, where, orderBy,
  serverTimestamp, addDoc
} from "firebase/firestore";
import { db } from "../app/firebase";

export interface Message {
  id?: string;
  subject: string;
  body: string;
  senderId: string;
  senderName: string;
  senderRole: string;
  recipients: string[];        // array of user UIDs
  recipientScope: string;      // "all_subdivision" | "all_division" | "specific"
  scopeCode: string;           // subdivision code, division code etc
  isRead: Record<string, boolean>; // uid → boolean
  replies: Reply[];
  createdAt: any;
  updatedAt: any;
  priority: "normal" | "urgent";
}

export interface Reply {
  id: string;
  senderId: string;
  senderName: string;
  body: string;
  createdAt: any;
}

// ── SEND MESSAGE ──────────────────────────────────────────────────
export async function sendMessage(msg: Omit<Message, "id">) {
  const ref = await addDoc(collection(db, "messages"), {
    ...msg,
    createdAt:  serverTimestamp(),
    updatedAt:  serverTimestamp(),
  });
  return ref.id;
}

// ── GET INBOX (messages where I am a recipient) ───────────────────
export async function getInbox(uid: string) {
  const snap = await getDocs(
    query(collection(db, "messages"),
      where("recipients", "array-contains", uid),
      orderBy("createdAt", "desc")
    )
  );
  return snap.docs.map(d => ({ id: d.id, ...d.data() })) as Message[];
}

// ── GET SENT (messages I sent) ────────────────────────────────────
export async function getSent(uid: string) {
  const snap = await getDocs(
    query(collection(db, "messages"),
      where("senderId", "==", uid),
      orderBy("createdAt", "desc")
    )
  );
  return snap.docs.map(d => ({ id: d.id, ...d.data() })) as Message[];
}

// ── MARK AS READ ──────────────────────────────────────────────────
export async function markAsRead(messageId: string, uid: string) {
  await updateDoc(doc(db, "messages", messageId), {
    [`isRead.${uid}`]: true,
    updatedAt: serverTimestamp(),
  });
}

// ── REPLY TO MESSAGE ──────────────────────────────────────────────
export async function replyToMessage(messageId: string, reply: Omit<Reply, "id">) {
  const msgRef  = doc(db, "messages", messageId);
  const msgSnap = await getDoc(msgRef);
  if (!msgSnap.exists()) return;
  const data    = msgSnap.data();
  const replies = data.replies || [];
  replies.push({ ...reply, id: Date.now().toString(), createdAt: new Date().toISOString() });
  await updateDoc(msgRef, { replies, updatedAt: serverTimestamp() });
}

// ── GET USERS IN SCOPE ────────────────────────────────────────────
export async function getUsersInScope(profile: any): Promise<any[]> {
  const role = profile.role;
  let q;
  const col = collection(db, "users");

  if      (role === "superadmin")
    q = query(col);
  else if (role === "circle_admin")
    q = query(col, where("circleCode",   "==", profile.circleCode));
  else if (role === "region_admin")
    q = query(col, where("regionId",     "==", profile.regionId));
  else if (role === "division_admin")
    q = query(col, where("divisionCode", "==", profile.divisionCode));
  else if (role === "subdivision_admin")
    q = query(col, where("subDivCode",   "==", profile.subDivCode));
  else
    q = query(col, where("officeCode",   "==", profile.officeCode));

  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ── COUNT UNREAD ──────────────────────────────────────────────────
export async function countUnread(uid: string): Promise<number> {
  const msgs = await getInbox(uid);
  return msgs.filter(m => !m.isRead?.[uid]).length;
}