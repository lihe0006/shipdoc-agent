"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { FileSearch } from "lucide-react";

function LoginForm() {
  const params = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
    if (r.ok) {
      const next = params.get("next");
      window.location.href = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
    } else {
      setError((await r.json().catch(() => ({}))).error ?? "Sign-in failed.");
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      style={{ width: 360, background: "var(--white)", border: "1px solid var(--border)", borderRadius: "var(--radius-xl)", padding: 32, textAlign: "center" }}
    >
      <div
        style={{ width: 56, height: 56, margin: "0 auto 16px", borderRadius: "var(--radius-xl)", background: "linear-gradient(150deg, var(--teal-500), var(--teal-600))", display: "flex", alignItems: "center", justifyContent: "center" }}
      >
        <FileSearch size={28} color="#fff" strokeWidth={1.7} />
      </div>
      <h1 style={{ fontSize: "var(--text-xl)", fontWeight: 700, color: "var(--ink-900)", margin: "0 0 6px" }}>Shipment document check</h1>
      <p style={{ color: "var(--ink-400)", margin: "0 0 20px", fontSize: "var(--text-sm)" }}>Enter the access password to continue.</p>
      <input
        type="password"
        autoFocus
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
        aria-label="Password"
        style={{ width: "100%", height: 40, padding: "0 12px", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", fontSize: "var(--text-base)", marginBottom: 12, outline: "none" }}
      />
      {error && <div style={{ color: "#b42318", fontSize: "var(--text-sm)", marginBottom: 12 }}>{error}</div>}
      <button className="btn btn--primary" type="submit" disabled={busy || !password} style={{ width: "100%", justifyContent: "center", height: 40 }}>
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}
