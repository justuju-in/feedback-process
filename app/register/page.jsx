"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  ArrowRight,
  LockKeyhole,
} from "lucide-react";

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  function updateField(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");

    if (form.password !== form.confirmPassword) {
      setError("Password and confirm password must match.");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(
        "/api/auth/register",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: form.name,
            email: form.email,
            password: form.password,
          }),
        },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Could not create account");
      router.push("/login?verification=sent");
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="auth-shell bg-slate-50">
      <div className="w-full max-w-xl">
          <Link className="mx-auto mb-6 flex w-fit items-center gap-3" href="/">
            <span className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white shadow-md">
              <img src="/justuju-logo.png" alt="Justuju" className="h-full w-full object-cover" />
            </span>
            <span>
              <span className="block text-xl font-bold tracking-tight text-slate-900">Feedback</span>
              <span className="block text-sm text-slate-500">Feedback Process</span>
            </span>
          </Link>

          <div className="auth-card relative xl:p-10">
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-emerald-700">Get started</p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">Create your account</h2>
            <p className="mt-3 text-base text-slate-600">Enter your details to join your feedback workspace.</p>

            <form className="mt-8 grid gap-5" onSubmit={handleSubmit}>
              <AuthField autoComplete="name" id="name" label="Full name" onChange={updateField} placeholder="Enter your full name" type="text" value={form.name} />
              <div>
                <AuthField autoComplete="email" id="email" label="Justuju work email" onChange={updateField} placeholder="name@justuju.in" type="email" value={form.email} />
                <p className="mt-2 text-xs font-medium text-slate-500">Only <span className="font-semibold text-[#36429a]">@justuju.in</span> email addresses can create an account.</p>
              </div>
              <div className="grid gap-5 sm:grid-cols-2">
                <AuthField autoComplete="new-password" id="password" label="Password" onChange={updateField} placeholder="Minimum 8 characters" type="password" value={form.password} />
                <AuthField autoComplete="new-password" id="confirmPassword" label="Confirm password" onChange={updateField} placeholder="Enter it again" type="password" value={form.confirmPassword} />
              </div>

              {error ? <p className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700" role="alert">{error}</p> : null}

              <p className="flex items-start gap-2 text-sm text-slate-500">
                <LockKeyhole aria-hidden="true" className="mt-0.5 shrink-0 text-[#4c57a7]" size={16} />
                Use at least 8 characters. Your password will be securely protected.
              </p>

              <button className="btn btn-primary mt-1 min-h-12 w-full" disabled={isSubmitting} type="submit">
                {isSubmitting ? "Creating account…" : "Create Account"}
                <ArrowRight aria-hidden="true" size={18} />
              </button>
            </form>

            <p className="mt-7 text-center text-sm text-slate-600">
              Already have an account?{" "}
              <Link className="font-semibold text-[#36429a] hover:underline" href="/login">Log in</Link>
            </p>
          </div>
      </div>
    </main>
  );
}

function AuthField({ autoComplete, id, label, onChange, placeholder, type, value }) {
  return (
    <label className="grid gap-2" htmlFor={id}>
      <span className="text-sm font-semibold text-slate-800">{label}</span>
      <input
        autoComplete={autoComplete}
        className="min-h-12 rounded-xl border border-slate-300 bg-white px-4 text-base outline-none transition placeholder:text-slate-400 focus:border-[#4c57a7] focus:ring-4 focus:ring-indigo-100"
        id={id}
        name={id}
        onChange={onChange}
        placeholder={placeholder}
        required
        type={type}
        value={value}
      />
    </label>
  );
}
