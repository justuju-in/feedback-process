"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Eye, EyeOff, LockKeyhole } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const emailRef = useRef(null);
  const passwordRef = useRef(null);
  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const clearLoginFields = () => {
      setForm({ email: "", password: "" });
      if (emailRef.current) emailRef.current.value = "";
      if (passwordRef.current) passwordRef.current.value = "";
    };

    clearLoginFields();
    const clearTimer = window.setTimeout(clearLoginFields, 100);
    return () => window.clearTimeout(clearTimer);
  }, []);

  function updateField(event) {
    setForm((current) => ({ ...current, [event.target.dataset.field]: event.target.value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      const response = await fetch(
        "/api/auth/login",
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        },
      );
      const data = await response.json();
      if (response.status === 401) {
        throw new Error("Password is incorrect");
      }
      if (!response.ok) throw new Error(data.message || "Could not log in");

      router.push("/");
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f5f7ff] px-4 py-8 text-slate-950 sm:px-8">
      <div className="w-full max-w-md">
        <Link className="mx-auto mb-8 flex w-fit items-center gap-3" href="/">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white shadow-md">
            <img src="/justuju-logo.png" alt="Justuju" className="h-full w-full object-cover" />
          </span>
          <span>
            <span className="block text-lg font-bold text-[#252d70]">Feedback</span>
            <span className="block text-xs text-slate-500">Feedback Process</span>
          </span>
        </Link>

        <section className="rounded-3xl border border-slate-200/80 bg-white p-6 shadow-[0_24px_70px_rgba(37,45,112,0.12)] sm:p-9">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#4c57a7]">
            Welcome back
          </p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight">Log in to your account</h1>
          <p className="mt-3 text-base text-slate-600">
            Enter your email and password to continue.
          </p>

          <form autoComplete="off" className="mt-8 grid gap-5" onSubmit={handleSubmit}>
            <AuthField
              autoComplete="off"
              fieldName="email"
              id="email"
              label="Email address"
              onChange={updateField}
              placeholder="you@example.com"
              inputRef={emailRef}
              type="email"
              value={form.email}
            />
            <AuthField
              autoComplete="new-password"
              fieldName="password"
              id="password"
              label="Password"
              onChange={updateField}
              placeholder="Enter your password"
              inputRef={passwordRef}
              type="password"
              value={form.password}
            />
            <Link className="-mt-2 justify-self-end text-sm font-semibold text-[#36429a] hover:underline" href="/forgot-password">
              Forgot password?
            </Link>

            {error ? <p className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700" role="alert">{error}</p> : null}

            <button
              className="mt-1 inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#252d70] px-5 text-base font-semibold text-white shadow-lg shadow-indigo-950/15 transition hover:bg-[#1e255e] focus:outline-none focus:ring-4 focus:ring-indigo-200"
              disabled={isSubmitting}
              type="submit"
            >
              {isSubmitting ? "Logging in…" : "Log in"}
              <ArrowRight aria-hidden="true" size={18} />
            </button>
          </form>

          <p className="mt-7 text-center text-sm text-slate-600">
            Don&apos;t have an account?{" "}
            <Link className="font-semibold text-[#36429a] hover:underline" href="/register">
              Create account
            </Link>
          </p>
        </section>
      </div>
    </main>
  );
}

function AuthField({ autoComplete, fieldName, id, inputRef, label, onChange, placeholder, type, value }) {
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isEditable, setIsEditable] = useState(false);
  const isPasswordField = type === "password";

  return (
    <label className="grid gap-2" htmlFor={id}>
      <span className="text-sm font-semibold text-slate-800">{label}</span>
      <span className="relative">
        {isPasswordField ? (
          <LockKeyhole
            aria-hidden="true"
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
            size={17}
          />
        ) : null}
        <input
          autoComplete={autoComplete}
          className={`min-h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-base outline-none transition placeholder:text-slate-400 focus:border-[#4c57a7] focus:ring-4 focus:ring-indigo-100 ${
            isPasswordField ? "pl-11 pr-11" : ""
          }`}
          id={id}
          data-field={fieldName}
          name={`feedback-${fieldName}`}
          onChange={onChange}
          onFocus={() => setIsEditable(true)}
          placeholder={placeholder}
          readOnly={!isEditable}
          ref={inputRef}
          required
          type={isPasswordField && isPasswordVisible ? "text" : type}
          value={value}
        />
        {isPasswordField ? (
          <button
            aria-label={isPasswordVisible ? "Hide password" : "Show password"}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-[#252d70] focus:outline-none focus:ring-2 focus:ring-indigo-200"
            onClick={() => setIsPasswordVisible((visible) => !visible)}
            type="button"
          >
            {isPasswordVisible ? <EyeOff aria-hidden="true" size={18} /> : <Eye aria-hidden="true" size={18} />}
          </button>
        ) : null}
      </span>
    </label>
  );
}
