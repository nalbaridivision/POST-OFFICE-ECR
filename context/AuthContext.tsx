"use client";

import { createContext, useContext, useEffect, useState } from "react";
import {
  onAuthStateChanged,
  signOut,
  setPersistence,
  browserLocalPersistence   // ← changed from browserSessionPersistence
} from "firebase/auth";
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
  officeId?: string;
  officeCode?: string;
  officeName?: string;
  hoCode?: string;
  soCode?: string;
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
  user: null,
  profile: null,
  loading: true,
  logout: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user,    setUser]    = useState<any>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // ── LOCAL persistence — stays logged in after browser closes ──
    setPersistence(auth, browserLocalPersistence).catch(console.error);

    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        try {
          const snap = await getDoc(doc(db, "users", firebaseUser.uid));
          if (snap.exists()) {
            setProfile({ uid: firebaseUser.uid, ...snap.data() } as UserProfile);
          } else {
            setProfile(null);
          }
        } catch (e) {
          console.error("Profile fetch error:", e);
          setProfile(null);
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

// ── Role display labels ───────────────────────────────────────────
export const ROLE_LABELS: Record<string, string> = {
  superadmin:        "Super Admin",
  circle_admin:      "Circle Office",
  region_admin:      "Region Office",
  division_admin:    "Division Office",
  subdivision_admin: "Sub Division",
  ho_admin:          "Head Post Office",
  so_admin:          "Sub Post Office",
  office_user:       "Branch Post Office (BO)",
};

// ── Roles each role can create ────────────────────────────────────
export const CREATABLE_ROLES: Record<string, string[]> = {
  superadmin:        ["circle_admin", "region_admin", "division_admin",
                      "subdivision_admin", "ho_admin", "so_admin", "office_user"],
  circle_admin:      ["region_admin", "division_admin"],
  region_admin:      ["division_admin"],
  division_admin:    ["subdivision_admin", "ho_admin", "so_admin", "office_user"],
  subdivision_admin: ["ho_admin", "so_admin", "office_user"],
  ho_admin:          [],
  so_admin:          [],
  office_user:       [],
};

// ── Numeric level — lower = higher authority ──────────────────────
export const ROLE_LEVEL: Record<string, number> = {
  superadmin:        0,
  circle_admin:      1,
  region_admin:      2,
  division_admin:    3,
  subdivision_admin: 4,
  ho_admin:          5,
  so_admin:          6,
  office_user:       7,
};
