"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

export default function VerifyEmailPage() {
  return <Suspense fallback={<main className="flex min-h-screen items-center justify-center bg-[#f5f7ff] p-6">Loading…</main>}><VerificationContent /></Suspense>;
}

function VerificationContent() {
  const token = useSearchParams().get("token");
  const [message, setMessage] = useState("Verifying your email…");
  const [success, setSuccess] = useState(false);
  useEffect(() => {
    if (!token) { setMessage("This verification link is missing its token."); return; }
    fetch("/api/auth/verify-email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) })
      .then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.message); setSuccess(true); setMessage(data.message); })
      .catch((error) => setMessage(error.message || "We could not verify this email."));
  }, [token]);
  return <main className="auth-shell"><section className="auth-card w-full max-w-md text-center"><div className="mx-auto flex h-14 w-14 items-center justify-center overflow-hidden rounded-full bg-white shadow-md"><img src="/justuju-logo.png" alt="Justuju" className="h-full w-full object-cover" /></div><h1 className="mt-5 text-2xl font-bold text-slate-950">Email verification</h1><p className={`mt-4 ${success ? "text-emerald-700" : "text-slate-600"}`}>{message}</p><Link className="btn btn-primary mt-7" href="/login">Go to login</Link></section></main>;
}
