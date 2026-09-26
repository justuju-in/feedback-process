"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, Mail } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "/api";

async function readJson(response) {
  if (!(response.headers.get("content-type") || "").includes("application/json")) {
    throw new Error("Backend is not reachable. Please check that the backend is running.");
  }
  return response.json();
}

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError(""); setMessage("Creating your secure reset link…"); setLoading(true);
    try {
      const response = await fetch(`${API_URL}/auth/forgot-password`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await readJson(response);
      if (!response.ok) throw new Error(data.message || "Could not create reset link");
      setMessage("If this email is registered, a password reset email is on its way. Please check your inbox.");
    } catch (err) { setMessage(""); setError(err.message); }
    finally { setLoading(false); }
  }

  return <AuthPage>
    <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#4c57a7]">Password help</p>
    <h1 className="mt-3 text-3xl font-bold tracking-tight">Reset your password</h1>
    <p className="mt-3 text-base text-slate-600">Enter your registered email to create a secure reset link.</p>
    <form className="mt-8 grid gap-5" onSubmit={handleSubmit}>
      <label className="grid gap-2" htmlFor="email">
        <span className="text-sm font-semibold text-slate-800">Email address</span>
        <span className="relative"><Mail className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={17} />
          <input autoComplete="email" className="min-h-12 w-full rounded-xl border border-slate-300 px-4 pl-11 outline-none focus:border-[#4c57a7] focus:ring-4 focus:ring-indigo-100" id="email" onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required type="email" value={email} />
        </span>
      </label>
      {error && <Notice error>{error}</Notice>}{message && <Notice>{message}</Notice>}
      <button className="min-h-12 rounded-xl bg-[#252d70] px-5 font-semibold text-white disabled:opacity-60" disabled={loading} type="submit">{loading ? "Creating reset link…" : "Create reset link"}</button>
    </form>
    <Link className="mt-7 flex items-center justify-center gap-2 text-sm font-semibold text-[#36429a] hover:underline" href="/login"><ArrowLeft size={16} /> Back to login</Link>
  </AuthPage>;
}

function AuthPage({ children }) {
  return (
    <main className="auth-shell">
      <div className="w-full max-w-md">
        <Brand />
        <section className="auth-card relative overflow-hidden border-slate-200 bg-gradient-to-b from-indigo-50/60 via-white to-white p-7 shadow-[0_28px_80px_rgba(37,45,112,0.18)] sm:p-9">
          <div aria-hidden="true" className="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-[#252d70] via-[#4c57a7] to-emerald-500" />
          {children}
        </section>
      </div>
    </main>
  );
}
function Brand() { return <Link className="mx-auto mb-8 flex w-fit items-center gap-3" href="/login"><span className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-full bg-white shadow-md"><img src="/justuju-logo.png" alt="Justuju" className="h-full w-full object-cover" /></span><span><b className="block text-lg text-[#252d70]">Feedback</b><span className="block text-xs text-slate-500">Feedback Process</span></span></Link>; }
function Notice({ children, error=false }) { return <p className={`rounded-xl px-4 py-3 text-sm font-medium ${error ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-800"}`} role={error ? "alert" : "status"}>{children}</p>; }
