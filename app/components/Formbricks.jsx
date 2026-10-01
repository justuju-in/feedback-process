"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "/api";
async function request(path, body) {
  const response = await fetch(`${API_URL}/formbricks${path}`, {
    method: body === undefined ? "GET" : "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || "Could not connect to Formbricks");
  return data;
}

export function FormbricksConnect({ onOpenBuilder, onConnect, canConnect = false, templates = [], selectedTemplateId, onSelect }) {
  const [config, setConfig] = useState(null);
  const [survey, setSurvey] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    request("/config").then((value) => { if (active) setConfig(value); }).catch((err) => { if (active) setError(err.message); });
    return () => { active = false; };
  }, []);
  async function connect() {
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await onConnect({ provider: "formbricks", survey, name });
      if (!result.ok) throw new Error(result.message);
      setSurvey(""); setName(""); setNotice(`${result.template.name} connected and selected.`);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  async function test() {
    setBusy(true); setError(""); setNotice("");
    try { await request("/test", {}); setNotice("Connection verified. You can connect a published feedback form."); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <details className="rounded-xl border border-teal-200 bg-teal-50/50 p-4">
    <summary className="cursor-pointer font-bold text-teal-950">Saved Formbricks forms</summary>
    <div className="mt-4 grid gap-3">
      <p className="text-sm leading-6 text-slate-600">Choose a saved form, open the original Formbricks builder here, or use Custom below for the quick editor.</p>
      {!config && !error ? <p role="status" className="text-sm text-slate-600">Checking connection…</p> : null}
      {config && !config.configured ? <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Formbricks is not connected yet. Ask your administrator to configure the server connection.</p> : null}
      {config?.builder?.enabled && onOpenBuilder ? <button className="btn btn-secondary" type="button" onClick={onOpenBuilder}>Open Formbricks builder here</button> : config && canConnect ? <a className="text-sm font-semibold text-teal-800 underline" href={config.origin} target="_blank" rel="noreferrer">Open Formbricks builder & results ↗</a> : null}
      {templates.length ? <div className="grid gap-2">
        <p className="text-sm font-semibold text-teal-950">Use a saved feedback form</p>
        {templates.map((template) => <button key={template.id} type="button"
          className="rounded-lg border border-teal-300 bg-white px-3 py-2 text-left text-sm font-semibold text-teal-900 hover:bg-teal-100"
          aria-pressed={Number(selectedTemplateId) === template.id}
          onClick={() => onSelect?.(template)}>
          {template.name}{Number(selectedTemplateId) === template.id ? " — Selected" : " — Use form"}
        </button>)}
        <p className="text-sm text-slate-600">Select a feedback form, choose who will give feedback, then send your request. They will fill the form from Feedback Requests.</p>
      </div> : <p className="text-sm text-slate-600">No feedback forms are connected yet.</p>}
      {canConnect ? <>
      <p className="text-xs leading-5 text-slate-600">Publish a link-based feedback form, enable single-use links and switch URL encryption off before connecting it. Keep a separate form version when changing questions.</p>
      <label className="grid gap-1 text-sm font-semibold">Feedback form link or ID<input className="field-control" value={survey} onChange={(event) => setSurvey(event.target.value)} placeholder="https://app.formbricks.com/s/…" disabled={!config?.configured || busy} /></label>
      <label className="grid gap-1 text-sm font-semibold">Template name (optional)<input className="field-control" value={name} onChange={(event) => setName(event.target.value)} placeholder="Use the feedback form name" maxLength={100} disabled={!config?.configured || busy} /></label>
      <div className="flex flex-wrap gap-2"><button className="btn btn-primary disabled:opacity-50" type="button" onClick={() => void connect()} disabled={!config?.configured || busy || !survey.trim()}>{busy ? "Please wait…" : "Connect feedback form"}</button><button className="btn btn-secondary disabled:opacity-50" type="button" onClick={() => void test()} disabled={!config?.configured || busy}>Test connection</button></div>
      </> : null}
      <p className="text-xs leading-5 text-slate-500">Features and response limits depend on your Formbricks plan. Feedback results are also stored in your connected Formbricks workspace.</p>
      {notice ? <p role="status" className="text-sm text-teal-800">{notice}</p> : null}
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
    </div>
  </details>;
}

export function FormbricksSurvey({ requestId, onCompleted }) {
  const [session, setSession] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const frame = useRef(null);
  const inFlight = useRef(false);
  const completed = useRef(false);
  const completionHandler = useRef(onCompleted);
  completionHandler.current = onCompleted;
  const sync = useCallback(async () => {
    if (inFlight.current || completed.current) return;
    inFlight.current = true;
    try {
      const result = await request(`/requests/${requestId}/sync`, {});
      setError("");
      if (result.completed) {
        completed.current = true;
        setNotice("Feedback submitted. Updating your request…");
        await completionHandler.current();
      } else {
        setNotice(result.state === "partial" ? "Your response is in progress. Finish the feedback form to share your feedback." : "Waiting for your completed response. Finish the feedback form, then check again.");
      }
    } catch (err) { setError(err.message); }
    finally { inFlight.current = false; }
  }, [requestId]);
  useEffect(() => {
    if (!session) return undefined;
    const onMessage = (event) => {
      if (event.origin !== session.origin || event.source !== frame.current?.contentWindow) return;
      if (event.data === "formbricksSurveyCompleted") void sync();
    };
    const onFocus = () => void sync();
    window.addEventListener("message", onMessage);
    window.addEventListener("focus", onFocus);
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void sync(); }, 15000);
    return () => { window.removeEventListener("message", onMessage); window.removeEventListener("focus", onFocus); window.clearInterval(timer); };
  }, [session, sync]);
  async function open() {
    setBusy(true); setError("");
    try { setSession(await request(`/requests/${requestId}/session`, {})); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  if (session?.local) return <LocalFormbricksForm requestId={requestId} questions={session.questions || []} blocks={session.blocks || []} onCompleted={onCompleted} />;
  return <section className="grid gap-3 rounded-xl border border-teal-200 bg-teal-50/40 p-4">
    <div><h3 className="font-bold text-teal-950">Your feedback form</h3><p className="mt-1 text-sm leading-6 text-slate-600">Complete the feedback form below. Your request updates after the completed response is verified.</p></div>
    {!session ? <button className="btn btn-primary w-fit" type="button" onClick={() => void open()} disabled={busy}>{busy ? "Opening feedback form…" : "Open feedback form"}</button> : <>
      <iframe ref={frame} src={session.embedUrl} title="Feedback form powered by Formbricks" className="h-[65vh] min-h-[400px] w-full rounded-lg border border-slate-200 bg-white" referrerPolicy="no-referrer" />
      <div className="flex flex-wrap items-center gap-3"><a href={session.link} target="_blank" rel="noreferrer" className="text-sm font-semibold text-teal-800 underline">Open feedback form in a new tab ↗</a><button className="btn btn-secondary" type="button" onClick={() => void sync()}>Check submission</button></div>
      <p className="text-xs text-slate-500">This invitation is only for your feedback. Keep its link private. Reopen this request to resume an unfinished feedback form.</p>
    </>}
    {notice ? <p role="status" className="text-sm text-teal-800">{notice}</p> : null}
    {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
  </section>;
}

function choiceLabel(choice) {
  return labelText(choice?.label || choice);
}
function Field({ label, children }) {
  return <label className="grid gap-2 text-sm font-semibold text-slate-900">{label}<div className="grid gap-2 font-normal text-slate-700">{children}</div></label>;
}
function conditionalBlockRules(blocks) {
  const rules = new Map();
  for (const block of blocks || []) {
    for (const rule of block.logic || []) {
      const sourceId = rule.conditions?.conditions?.[0]?.leftOperand?.value;
      const choiceId = rule.conditions?.conditions?.[0]?.rightOperand?.value;
      for (const action of rule.actions || []) {
        if (action.objective === "jumpToBlock" && action.target && sourceId && choiceId) {
          rules.set(action.target, { sourceId, choiceId });
        }
      }
    }
  }
  return rules;
}
function visibleLocalQuestions(questions, blocks, answers) {
  if (!blocks?.length) return questions;
  const questionById = new Map(questions.map((question) => [question.id, question]));
  const conditionalRules = conditionalBlockRules(blocks);
  return blocks.flatMap((block) => {
    const condition = conditionalRules.get(block.id);
    if (condition) {
      const source = questionById.get(condition.sourceId);
      const expected = choiceLabel(source?.choices?.find((choice) => choice.id === condition.choiceId));
      if (answers[condition.sourceId] !== expected) return [];
    }
    return (block.elements || []).filter((element) => questionById.has(element.id));
  });
}
function LocalFormbricksForm({ requestId, questions, blocks, onCompleted }) {
  const [answers, setAnswers] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const visibleQuestions = visibleLocalQuestions(questions, blocks, answers);
  const update = (id, value) => setAnswers((current) => {
    const next = { ...current, [id]: value };
    const visibleIds = new Set(visibleLocalQuestions(questions, blocks, next).map((question) => question.id));
    for (const questionId of Object.keys(next)) if (!visibleIds.has(questionId)) delete next[questionId];
    return next;
  });
  function isAnswered(question) {
    const value = answers[question.id];
    if (Array.isArray(value)) return value.length > 0;
    return value !== undefined && value !== null && value !== "" && value !== false;
  }
  async function submit() {
    const unanswered = visibleQuestions.find((question) => question.required && !isAnswered(question));
    if (unanswered) {
      setError(`Please answer: ${labelText(unanswered.headline) || "required question"}`);
      return;
    }
    setBusy(true); setError("");
    try {
      await request(`/requests/${requestId}/local-submit`, { answers });
      await onCompleted();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return <section className="grid gap-4 rounded-xl border border-teal-200 bg-teal-50/40 p-4">
    <div><h3 className="font-bold text-teal-950">Local test feedback form</h3><p className="mt-1 text-sm leading-6 text-slate-600">This form is running locally for temporary testing. No external Formbricks server is used.</p></div>
    <div className="grid gap-5">
      {visibleQuestions.map((question, index) => <LocalQuestion key={question.id} question={question} index={index} value={answers[question.id]} onChange={(value) => update(question.id, value)} />)}
      {error ? <p role="alert" className="text-sm font-semibold text-red-700">{error}</p> : null}
      <button className="btn btn-primary w-fit" type="button" onClick={() => void submit()} disabled={busy}>{busy ? "Submitting…" : "Submit feedback"}</button>
    </div>
  </section>;
}
function LocalQuestion({ question, index, value, onChange }) {
  const title = labelText(question.headline) || `Question ${index + 1}`;
  const required = question.required === true;
  const choices = question.choices || [];
  const commonLabel = <span className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-700">{index + 1}</span><span>{title}{required ? <span className="text-red-600"> *</span> : null}</span></span>;

  if (question.type === "cta") {
    return <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-700"><p className="font-semibold">{title}</p>{question.subheader ? <p className="mt-1">{labelText(question.subheader)}</p> : null}</div>;
  }
  if (question.type === "openText") {
    const inputType = question.inputType === "email" ? "email" : question.inputType === "number" ? "number" : "text";
    return <Field label={commonLabel}>{question.longAnswer ? <textarea className="field-control min-h-28" value={value || ""} onChange={(event) => onChange(event.target.value)} /> : <input className="field-control" type={inputType} value={value || ""} onChange={(event) => onChange(inputType === "number" ? Number(event.target.value) : event.target.value)} />}</Field>;
  }
  if (question.type === "multipleChoiceSingle") {
    return <Field label={commonLabel}>{question.displayType === "dropdown" ? <select className="field-control" value={value || ""} onChange={(event) => onChange(event.target.value)}><option value="">Choose an option</option>{choices.map((choice) => <option key={choice.id} value={choiceLabel(choice)}>{choiceLabel(choice)}</option>)}</select> : <div className="grid gap-2">{choices.map((choice) => <label key={choice.id} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2"><input type="radio" name={question.id} checked={value === choiceLabel(choice)} onChange={() => onChange(choiceLabel(choice))} />{choiceLabel(choice)}</label>)}</div>}</Field>;
  }
  if (question.type === "multipleChoiceMulti") {
    const selected = Array.isArray(value) ? value : [];
    const toggle = (option) => onChange(selected.includes(option) ? selected.filter((item) => item !== option) : [...selected, option]);
    return <Field label={commonLabel}>{question.displayType === "dropdown" ? <select className="field-control min-h-28" multiple value={selected} onChange={(event) => onChange(Array.from(event.target.selectedOptions).map((option) => option.value))}>{choices.map((choice) => <option key={choice.id} value={choiceLabel(choice)}>{choiceLabel(choice)}</option>)}</select> : <div className="grid gap-2">{choices.map((choice) => <label key={choice.id} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2"><input type="checkbox" checked={selected.includes(choiceLabel(choice))} onChange={() => toggle(choiceLabel(choice))} />{choiceLabel(choice)}</label>)}</div>}</Field>;
  }
  if (["rating", "nps", "csat", "ces"].includes(question.type)) {
    const start = question.type === "nps" ? 0 : 1;
    const end = question.type === "nps" ? 10 : question.range || 5;
    return <Field label={commonLabel}><div className="flex flex-wrap gap-2">{Array.from({ length: end - start + 1 }, (_, offset) => start + offset).map((score) => <button key={score} type="button" className={`h-10 min-w-10 rounded-lg border px-3 font-bold ${Number(value) === score ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-700"}`} onClick={() => onChange(score)}>{score}</button>)}</div></Field>;
  }
  if (question.type === "consent") {
    return <Field label={commonLabel}><label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2"><input type="checkbox" checked={value === true} onChange={(event) => onChange(event.target.checked)} />{labelText(question.label) || "I agree"}</label></Field>;
  }
  return <Field label={commonLabel}><input className="field-control" value={value || ""} onChange={(event) => onChange(event.target.value)} /></Field>;
}

function labelText(value) {
  if (typeof value === "string") return value.replace(/<[^>]*>/g, "");
  return value && typeof value === "object" ? labelText(value.default || Object.values(value).find((item) => typeof item === "string") || "") : "";
}
function AnswerValue({ value }) {
  if (value === null || value === undefined || value === "") return <span className="text-slate-500">Not answered</span>;
  if (Array.isArray(value)) return <ul className="list-inside list-disc space-y-1">{value.map((item, index) => <li key={index}><AnswerValue value={item} /></li>)}</ul>;
  if (typeof value === "object") return <dl className="grid gap-2">{Object.entries(value).map(([key, item]) => <div key={key}><dt className="font-medium">{key}</dt><dd><AnswerValue value={item} /></dd></div>)}</dl>;
  // Render file URLs and user input as text; never inject external HTML.
  return <span className="whitespace-pre-wrap break-words">{String(value)}</span>;
}
export function FormbricksAnswers({ feedback }) {
  if (!feedback?.completed) return <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">The feedback giver has not submitted this feedback form yet.</p>;
  const answered = feedback.questions.filter((question) => Object.hasOwn(feedback.answers || {}, question.id));
  return <section className="grid gap-4"><h3 className="font-bold text-slate-900">Submitted feedback</h3>{answered.length ? answered.map((question, index) => <div key={question.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4"><p className="mb-2 font-semibold text-slate-900">{index + 1}. {labelText(question.headline) || "Feedback answer"}</p><div className="text-sm leading-6 text-slate-700"><AnswerValue value={feedback.answers[question.id]} /></div></div>) : <p className="text-sm text-slate-500">The feedback form was completed without answers to display.</p>}</section>;
}
