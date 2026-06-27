"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { db } from "../firebase";
import { auth } from "../firebase";
import { collection, query, where, getDocs } from "firebase/firestore";
import { sendPasswordResetEmail } from "firebase/auth";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [employeeId, setEmployeeId] = useState("");
  const [loading,    setLoading]    = useState(false);
  const [sent,       setSent]       = useState(false);
  const [error,      setError]      = useState("");
  const [maskedEmail,setMaskedEmail]= useState("");

  async function handleReset() {
    if (!employeeId.trim()) {
      setError("Please enter your Employee ID"); return;
    }
    setError(""); setLoading(true);
    try {
      // Look up user by employeeId in Firestore
      const q    = query(collection(db, "users"),
        where("employeeId", "==", employeeId.toUpperCase().trim()));
      const snap = await getDocs(q);

      if (snap.empty) {
        setError("Employee ID not found. Please check and try again.");
        setLoading(false); return;
      }

      const userData = snap.docs[0].data();
      const email    = userData.email;

      if (!email) {
        setError("No email found for this Employee ID. Contact your admin.");
        setLoading(false); return;
      }

      // Send Firebase password reset email
      await sendPasswordResetEmail(auth, email);

      // Mask email for display — show only first 3 chars
      const [local, domain] = email.split("@");
      const masked = `${local.substring(0,3)}***@${domain}`;
      setMaskedEmail(masked);
      setSent(true);

    } catch (e: any) {
      if (e.code === "auth/user-not-found") {
        setError("No account found for this Employee ID.");
      } else if (e.code === "auth/too-many-requests") {
        setError("Too many attempts. Please wait a few minutes.");
      } else {
        setError(e.message || "Something went wrong.");
      }
    } finally { setLoading(false); }
  }

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center",
      justifyContent: "center", background: "#EFF6FF", padding: 16,
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    }}>
      <div style={{
        background: "#fff", borderRadius: 16, padding: "36px 28px",
        width: "100%", maxWidth: 400, boxSizing: "border-box" as const,
        borderTop: "4px solid #1565C0", boxShadow: "0 4px 24px rgba(0,0,0,0.08)"
      }}>

        {!sent ? (
          <>
            {/* Header */}
            <div style={{ textAlign: "center" as const, marginBottom: 28 }}>
              <div style={{ fontSize: 44, marginBottom: 8 }}>🔐</div>
              <h1 style={{ fontSize: 22, fontWeight: 700, color: "#1A365D",
                margin: "0 0 6px" }}>
                Forgot Password
              </h1>
              <p style={{ fontSize: 13, color: "#718096", margin: 0 }}>
                Enter your Employee ID and we'll send a password reset link to your registered email.
              </p>
            </div>

            {/* Error */}
            {error && (
              <div style={{ background: "#FFF5F5", border: "1px solid #FC8181",
                borderRadius: 8, padding: "10px 14px", color: "#C53030",
                fontSize: 13, marginBottom: 20 }}>
                {error}
              </div>
            )}

            {/* Employee ID */}
            <div style={{ marginBottom: 20 }}>
              <label style={labelStyle}>Employee ID</label>
              <input
                style={inputStyle}
                placeholder="e.g. EMP001"
                value={employeeId}
                onChange={e => setEmployeeId(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleReset()}
                autoComplete="off"
                autoCapitalize="off"
              />
            </div>

            {/* Submit */}
            <button onClick={handleReset} disabled={loading} style={{
              width: "100%", padding: "13px",
              background: loading ? "#90CDF4" : "#1565C0",
              color: "#fff", border: "none", borderRadius: 10,
              fontSize: 15, fontWeight: 700,
              cursor: loading ? "not-allowed" : "pointer",
              marginBottom: 16
            }}>
              {loading ? "Sending…" : "Send Reset Link"}
            </button>

            {/* Back to login */}
            <button onClick={() => router.push("/")} style={{
              width: "100%", padding: "11px",
              background: "none", color: "#718096",
              border: "1px solid #E2E8F0", borderRadius: 10,
              fontSize: 14, fontWeight: 500, cursor: "pointer"
            }}>
              ← Back to Login
            </button>
          </>
        ) : (
          <>
            {/* Success state */}
            <div style={{ textAlign: "center" as const }}>
              <div style={{ fontSize: 60, marginBottom: 16 }}>📧</div>
              <h2 style={{ fontSize: 20, fontWeight: 700, color: "#1A365D",
                margin: "0 0 12px" }}>
                Reset Link Sent!
              </h2>
              <p style={{ fontSize: 14, color: "#718096", lineHeight: 1.7,
                margin: "0 0 8px" }}>
                A password reset link has been sent to:
              </p>
              <div style={{ background: "#EBF8FF", borderRadius: 8,
                padding: "10px 14px", fontSize: 15, fontWeight: 700,
                color: "#2B6CB0", marginBottom: 16 }}>
                {maskedEmail}
              </div>
              <p style={{ fontSize: 13, color: "#A0AEC0", lineHeight: 1.7,
                margin: "0 0 24px" }}>
                Check your email and click the link to reset your password.
                The link expires in <strong>1 hour</strong>.
                <br /><br />
                If you don't see it, check your <strong>spam/junk</strong> folder.
              </p>

              {/* Resend */}
              <button onClick={() => setSent(false)} style={{
                width: "100%", padding: "11px", background: "#EBF8FF",
                color: "#1565C0", border: "1px solid #BEE3F8",
                borderRadius: 10, fontSize: 14, fontWeight: 600,
                cursor: "pointer", marginBottom: 10
              }}>
                🔄 Send Again
              </button>

              {/* Back to login */}
              <button onClick={() => router.push("/")} style={{
                width: "100%", padding: "11px", background: "#1565C0",
                color: "#fff", border: "none", borderRadius: 10,
                fontSize: 14, fontWeight: 700, cursor: "pointer"
              }}>
                ← Back to Login
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block", fontSize: 12, fontWeight: 600, color: "#4A5568",
  marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.4px"
};
const inputStyle: React.CSSProperties = {
  width: "100%", padding: "10px 12px", fontSize: 15,
  border: "1.5px solid #E2E8F0", borderRadius: 8,
  color: "#1A202C", background: "#fff",
  boxSizing: "border-box" as const, outline: "none"
};