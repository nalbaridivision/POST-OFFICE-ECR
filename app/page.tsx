"use client";

import { useState } from "react";
import { signInWithEmailAndPassword, setPersistence, browserSessionPersistence } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "./firebase";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [employeeId, setEmployeeId] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleLogin = async () => {
    if (!employeeId || !password) {
      setError("Please enter Employee ID and Password");
      return;
    }
    setError("");
    setLoading(true);

    try {
      // Look up email from Firestore using employeeId
      const { getDocs, collection, query, where } = await import("firebase/firestore");
      const q = query(collection(db, "users"), where("employeeId", "==", employeeId.toUpperCase()));
      const snap = await getDocs(q);

      if (snap.empty) {
        setError("Employee ID not found");
        setLoading(false);
        return;
      }

      const userDoc = snap.docs[0].data();
      const email = userDoc.email; // Use actual email stored in Firestore

      await setPersistence(auth, browserSessionPersistence);
      const cred = await signInWithEmailAndPassword(auth, email, password);

      // Verify profile exists
      const profileSnap = await getDoc(doc(db, "users", cred.user.uid));
      if (!profileSnap.exists()) throw new Error("User profile not found");

      router.push("/dashboard");

    } catch (err: any) {
      console.error(err);
      if (err.code === "auth/invalid-credential" || err.code === "auth/user-not-found") {
        setError("Invalid Employee ID or password");
      } else if (err.code === "auth/too-many-requests") {
        setError("Too many attempts. Please wait a few minutes.");
      } else {
        setError(err.message || "Login failed");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center",
      justifyContent: "center", background: "#EFF6FF", padding: 16,
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    }}>
      <div style={{
        background: "#fff", borderRadius: 16, padding: "36px 28px",
        width: "100%", maxWidth: 400, boxSizing: "border-box",
        borderTop: "4px solid #1565C0", boxShadow: "0 4px 24px rgba(0,0,0,0.08)"
      }}>

        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ fontSize: 44 }}>📮</div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "#1A365D", margin: "8px 0 4px" }}>
            ECR Analytics Portal
          </h1>
          <p style={{ fontSize: 13, color: "#718096" }}>
            India Post — Office Performance Tracker
          </p>
        </div>

        {error && (
          <div style={{
            background: "#FFF5F5", border: "1px solid #FC8181", borderRadius: 8,
            padding: "10px 14px", color: "#C53030", fontSize: 13, marginBottom: 20
          }}>
            {error}
          </div>
        )}

        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>Employee ID</label>
          <input
            style={inputStyle}
            placeholder="e.g. SUPERADMIN"
            value={employeeId}
            onChange={e => setEmployeeId(e.target.value)}
            autoComplete="off"
            autoCapitalize="off"
          />
        </div>

        <div style={{ marginBottom: 28 }}>
          <label style={labelStyle}>Password</label>
          <div style={{ position: "relative" }}>
            <input
              style={{ ...inputStyle, paddingRight: 44 }}
              type={showPass ? "text" : "password"}
              placeholder="Enter password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleLogin()}
            />
            <button onClick={() => setShowPass(s => !s)} style={{
              position: "absolute", right: 12, top: "50%",
              transform: "translateY(-50%)", background: "none",
              border: "none", cursor: "pointer", fontSize: 16, color: "#A0AEC0"
            }}>
              {showPass ? "🙈" : "👁"}
            </button>
          </div>
        </div>

        <button onClick={handleLogin} disabled={loading} style={{
          width: "100%", padding: "13px",
          background: loading ? "#90CDF4" : "#1565C0",
          color: "#fff", border: "none", borderRadius: 10,
          fontSize: 15, fontWeight: 700,
          cursor: loading ? "not-allowed" : "pointer",
        }}>
          {loading ? "Signing in…" : "Sign In"}
        </button>

        <p style={{ fontSize: 12, color: "#A0AEC0", textAlign: "center", marginTop: 20, lineHeight: 1.7 }}>
          Login with your Employee ID assigned by your admin.
        </p>

      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block", fontSize: 12, fontWeight: 600,
  color: "#4A5568", marginBottom: 6,
  textTransform: "uppercase", letterSpacing: "0.4px"
};

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "10px 12px", fontSize: 15,
  border: "1.5px solid #E2E8F0", borderRadius: 8,
  color: "#1A202C", background: "#fff",
  boxSizing: "border-box", outline: "none"
};