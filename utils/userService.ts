import { db } from "../app/firebase"; // Adjust this path if your firebase configuration is elsewhere
import { collection, query, where, getDocs, doc, updateDoc } from "firebase/firestore";

// 1. Fetch users based on the admin's role hierarchy
export async function listUsers(profile: any) {
  if (!profile) return [];
  
  const usersRef = collection(db, "users");
  let q;

  // Superadmins see everyone. Others only see users under their specific jurisdiction.
  if (profile.role === "superadmin") {
    q = query(usersRef);
  } else if (profile.role === "circle_admin") {
    q = query(usersRef, where("circleCode", "==", profile.circleCode));
  } else if (profile.role === "division_admin") {
    q = query(usersRef, where("divisionCode", "==", profile.divisionCode));
  } else if (profile.role === "subdivision_admin") {
    q = query(usersRef, where("subDivCode", "==", profile.subDivCode));
  } else {
    return []; // Regular office users shouldn't be fetching user lists
  }

  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() }));
}

// 2. Toggle a user's active status (Suspend/Activate)
export async function toggleUserActive(uid: string, currentStatus: boolean) {
  const userRef = doc(db, "users", uid);
  await updateDoc(userRef, { 
    isActive: !currentStatus 
  });
}

// 3. Load offices for dropdowns when creating new users
export async function loadHierarchy(profile: any) {
  if (!profile) return [];

  const officesRef = collection(db, "offices");
  let q;

  // Filter the available offices an admin can assign based on their own level
  if (profile.role === "superadmin") {
    q = query(officesRef);
  } else if (profile.role === "circle_admin") {
    q = query(officesRef, where("circleCode", "==", profile.circleCode));
  } else if (profile.role === "division_admin") {
    q = query(officesRef, where("divisionCode", "==", profile.divisionCode));
  } else if (profile.role === "subdivision_admin") {
    q = query(officesRef, where("subDivCode", "==", profile.subDivCode));
  } else {
    return [];
  }

  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

// If you previously had getOfficeScopeFields in here, you can leave it at the bottom!
export function getOfficeScopeFields(profile: any) {
  // Utility to auto-fill upper hierarchy codes when a lower-level admin creates a user
  return {
    circleCode: profile?.circleCode || "",
    divisionCode: profile?.divisionCode || "",
    subDivCode: profile?.subDivCode || "",
  };
}
