"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { onAuthStateChanged, signOut, setPersistence, browserSessionPersistence } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "../app/firebase";

interface UserProfile {
  uid: string;
  employeeId: string;
  name: string;
  designation?: string;
  role: string;
  circleCode?: string;
  regionId?: string;
  divisionCode?: string;
  subDivCode?: string;
  officeCode?: string;
  officeId?: string;
  officeName?: string;
  email: string;
  isActive: boolean;
}

interface AuthContextType {
  user: any;
  profile: UserProfile | null;
  loading: boolean;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null, profile: null, loading: true, logout: async () => {}
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setPersistence(auth, browserSessionPersistence);
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        const snap = await getDoc(doc(db, "users", firebaseUser.uid));
        if (snap.exists()) {
          setProfile({ uid: firebaseUser.uid, ...snap.data() } as UserProfile);
        }
        setUser(firebaseUser);
      } else {
        setUser(null);
        setProfile(null);
      }
      setLoading(false);
    });
    return () => unsub();
  }, []);

  async function logout() {
    await signOut(auth);
    window.location.href = "/";
  }

  return (
    <AuthContext.Provider value={{ user, profile, loading, logout }}>
      {!loading && children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

export const ROLE_LABELS: Record<string, string> = {
  superadmin:        "Super Admin",
  circle_admin:      "Circle Office",
  region_admin:      "Region Office",
  division_admin:    "Division Office",
  subdivision_admin: "Sub Division",
  ho_admin:          "Head Post Office (HO)",
  so_admin:          "Sub Post Office (SO)",
  office_user:       "Branch Post Office (BO)",
};

export const CREATABLE_ROLES: Record<string, string[]> = {
  superadmin: [
    "circle_admin",
    "region_admin",
    "division_admin",
    "subdivision_admin",
    "ho_admin",
    "so_admin",
    "office_user",
  ],
  circle_admin:      ["region_admin", "division_admin"],
  region_admin:      ["division_admin"],
  division_admin:    ["subdivision_admin", "ho_admin", "so_admin", "office_user"],
  subdivision_admin: ["ho_admin", "so_admin", "office_user"],
  ho_admin:          ["so_admin", "office_user"],
  so_admin:          ["office_user"],
  office_user:       [],
};
export const ADMIN_ROLES = [
  "superadmin", "circle_admin", "region_admin",
  "division_admin", "subdivision_admin"
];

export const DATA_ENTRY_ROLES = [
  "superadmin", "circle_admin", "region_admin",
  "division_admin", "subdivision_admin", "ho_admin"
];

export function canAccessUsers(role: string): boolean {
  return ADMIN_ROLES.includes(role);
}

export function canAccessHierarchy(role: string): boolean {
  return ADMIN_ROLES.includes(role);
}

export function canAccessDataEntry(role: string): boolean {
  return DATA_ENTRY_ROLES.includes(role);
}

export function canAccessReports(role: string): boolean {
  return true; // everyone can see reports
}