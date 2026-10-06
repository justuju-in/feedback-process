"use client";

import { useState } from "react";

const types = [
  ["text", "Short text"], ["longText", "Long text"], ["single", "Single choice"], ["multiple", "Multiple choice"],
  ["dropdown", "Dropdown"], ["multiDropdown", "Multiple-select dropdown"], ["stars", "Star rating"],
  ["smileys", "Smiley rating"], ["rating", "Number rating"],
  ["csat", "Satisfaction (CSAT)"], ["ces", "Effort (CES)"], ["email", "Email"], ["number", "Number"], ["consent", "Consent checkbox"],
];

const typeHelp = {
  text: "A short written answer.", longText: "A detailed written answer.", single: "Choose one option.", multiple: "Choose one or more options.",
  dropdown: "Choose one option from a compact list.", multiDropdown: "Choose multiple options from a compact list.", stars: "Rate from 1 to 5 stars.",
  smileys: "Rate from very unhappy to very happy.", rating: "Rate from 1 to 5.",
  csat: "A quick satisfaction score.", ces: "Measure how easy or difficult something was.", email: "Accepts a valid email address.",
  number: "Accepts numbers only.", consent: "Ask the feedback giver to confirm an agreement.",
};

const blank = () => ({ key: crypto.randomUUID(), title: "", type: "text", required: false, options: ["", ""], consentLabel: "", showWhen: null });
const choiceTypes = ["single", "multiple", "dropdown", "multiDropdown"];
const field = "w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100";
const subtleButton = "inline-flex min-h-10 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-40";

export default function FormbricksBuilder({ onSave }) {
  const [name, setName] = useState("");
  const [questions, setQuestions] = useState(() => [blank()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function update(index, patch) {
    setQuestions((items) => items.map((question, itemIndex) => itemIndex === index ? { ...question, ...patch } : question));
  }

  function move(index, delta) {
    setQuestions((items) => {
      const next = [...items];
      [next[index], next[index + delta]] = [next[index + delta], next[index]];
      return next;
    });
  }

  function conditionSources(index) {
    return questions.slice(0, index).filter((question) => ["single", "dropdown"].includes(question.type) && !question.showWhen);
  }

  function conditionError(question, index) {
    if (!question.showWhen) return "";
    const source = conditionSources(index).find((item) => item.key === question.showWhen.questionKey);
    if (!source) return `Question ${index + 1}: choose an earlier always-visible Single choice or Dropdown question.`;
    if (!question.showWhen.answer || !source.options.includes(question.showWhen.answer)) return `Question ${index + 1}: choose the answer that will show this question.`;
    return "";
  }

  async function save() {
    setError("");
    if (name.trim().length < 3) { setError("Enter a form name with at least 3 characters."); return; }
    for (const [index, question] of questions.entries()) {
      const invalidCondition = conditionError(question, index);
      if (invalidCondition) { setError(invalidCondition); return; }
      if (!question.title.trim()) { setError(`Enter question ${index + 1}.`); return; }
      if (choiceTypes.includes(question.type) && (question.options.some((option) => !option.trim()) || new Set(question.options.map((option) => option.trim().toLowerCase())).size !== question.options.length)) {
        setError(`Question ${index + 1}: fill every option and keep each option different.`); return;
      }
      if (question.type === "consent" && !question.consentLabel.trim()) { setError(`Question ${index + 1}: enter the checkbox label.`); return; }
    }
    setBusy(true);
    try {
      const result = await onSave({
        provider: "formbricks",
        createSurvey: true,
        name: name.trim(),
        questions: questions.map(({ key, showWhen, ...question }) => ({
          ...question,
          ...(showWhen ? { showWhen: { questionIndex: questions.findIndex((item) => item.key === showWhen.questionKey), optionIndex: questions.find((item) => item.key === showWhen.questionKey).options.indexOf(showWhen.answer) } } : {}),
        })),
      });
      if (!result.ok) setError(result.message || "Could not save your form. Your questions are still here.");
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <fieldset disabled={busy} className="mt-5 grid min-w-0 gap-5">
      <section className="rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50 via-white to-emerald-50 p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-slate-900">Build with Formbricks</p>
            <p className="mt-1 text-sm leading-6 text-slate-600">Create reusable feedback questions. Your form is saved securely in Formbricks when you choose Save and use form.</p>
          </div>
          <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-blue-700 shadow-sm">{questions.length} {questions.length === 1 ? "question" : "questions"}</span>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <label className="grid gap-1.5 text-sm font-bold text-slate-800">
          Form name
          <input className={field} maxLength={100} placeholder="Example: Project completion feedback" value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <p className="mt-2 text-xs leading-5 text-slate-500">Use a clear name so you can find this form again for future feedback requests.</p>
      </section>

      <div className="grid gap-4">
        {questions.map((question, index) => {
          const sources = conditionSources(index);
          const selectedSource = sources.find((item) => item.key === question.showWhen?.questionKey);
          return <section key={question.key} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-label={`Question ${index + 1} editor`}>
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/80 px-4 py-3">
              <div className="flex items-center gap-2.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">{index + 1}</span>
                <div><p className="text-sm font-bold text-slate-900">Question {index + 1}</p><p className="text-xs text-slate-500">Choose how the feedback giver should respond.</p></div>
              </div>
              <div className="flex items-center gap-1.5">
                <button type="button" className={`${subtleButton} h-9 min-h-0 px-2.5`} aria-label={`Move question ${index + 1} up`} disabled={index === 0} onClick={() => move(index, -1)}>↑</button>
                <button type="button" className={`${subtleButton} h-9 min-h-0 px-2.5`} aria-label={`Move question ${index + 1} down`} disabled={index === questions.length - 1} onClick={() => move(index, 1)}>↓</button>
                <button type="button" className={`${subtleButton} h-9 min-h-0 border-red-200 px-2.5 text-red-600 hover:border-red-300 hover:bg-red-50 hover:text-red-700`} disabled={questions.length === 1} aria-label={`Remove question ${index + 1}`} onClick={() => setQuestions((items) => items.filter((_, itemIndex) => itemIndex !== index))}>Remove</button>
              </div>
            </header>

            <div className="grid gap-4 p-4">
              <label className="grid gap-1.5 text-sm font-semibold text-slate-800">Question text
                <input className={field} maxLength={500} placeholder="Write a clear question" value={question.title} onChange={(event) => update(index, { title: event.target.value })} />
              </label>

              <label className="grid gap-1.5 text-sm font-semibold text-slate-800">Answer format
                <select className={field} value={question.type} onChange={(event) => update(index, { type: event.target.value })}>{types.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
                <span className="font-normal text-xs leading-5 text-slate-500">{typeHelp[question.type]}</span>
              </label>

              {choiceTypes.includes(question.type) ? <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                <div className="mb-2 flex items-center justify-between gap-3"><p className="text-sm font-bold text-slate-800">Answer options</p><span className="text-xs text-slate-500">At least 2</span></div>
                <div className="grid gap-2">{question.options.map((option, optionIndex) => <div key={optionIndex} className="flex gap-2"><input aria-label={`Question ${index + 1} option ${optionIndex + 1}`} className={field} maxLength={150} placeholder={`Option ${optionIndex + 1}`} value={option} onChange={(event) => update(index, { options: question.options.map((value, itemIndex) => itemIndex === optionIndex ? event.target.value : value) })} /><button type="button" className={`${subtleButton} w-10 shrink-0 px-0 text-slate-500`} disabled={question.options.length <= 2} aria-label={`Remove option ${optionIndex + 1} from question ${index + 1}`} onClick={() => update(index, { options: question.options.filter((_, itemIndex) => itemIndex !== optionIndex) })}>×</button></div>)}</div>
                <button type="button" className={`${subtleButton} mt-3 w-full border-dashed text-blue-700`} disabled={question.options.length >= 30} onClick={() => update(index, { options: [...question.options, ""] })}>+ Add option</button>
              </div> : null}

              {question.type === "consent" ? <label className="grid gap-1.5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-slate-800">Checkbox label
                <input aria-label={`Question ${index + 1} consent checkbox label`} className={field} maxLength={250} placeholder="Example: I agree to share this feedback." value={question.consentLabel} onChange={(event) => update(index, { consentLabel: event.target.value })} />
              </label> : null}

              <section className="rounded-xl border border-blue-100 bg-blue-50/60 p-3">
                <label className="grid gap-1.5 text-sm font-bold text-slate-800">Show this question
                  <select className={field} value={question.showWhen ? "conditional" : "always"} onChange={(event) => update(index, { showWhen: event.target.value === "always" ? null : { questionKey: "", answer: "" } })}>
                    <option value="always">Always show</option>
                    <option value="conditional" disabled={!sources.length && !question.showWhen}>Only when an answer matches</option>
                  </select>
                </label>
                {!sources.length && !question.showWhen ? <p className="mt-2 text-xs leading-5 text-slate-600">To use a condition, add an earlier Single choice or Dropdown question first.</p> : null}
                {question.showWhen ? <div className="mt-3 grid gap-3">
                  <label className="grid gap-1.5 text-sm font-medium text-slate-700">Earlier question<select className={field} value={selectedSource ? question.showWhen.questionKey : ""} onChange={(event) => update(index, { showWhen: { questionKey: event.target.value, answer: "" } })}><option value="">Choose a question</option>{sources.map((source) => <option key={source.key} value={source.key}>Question {questions.indexOf(source) + 1}: {source.title || "Untitled question"}</option>)}</select></label>
                  <label className="grid gap-1.5 text-sm font-medium text-slate-700">Show when answer is<select className={field} value={selectedSource?.options.includes(question.showWhen.answer) ? question.showWhen.answer : ""} onChange={(event) => update(index, { showWhen: { ...question.showWhen, answer: event.target.value } })}><option value="">Choose an answer</option>{(selectedSource?.options || []).filter((value) => value.trim()).map((value, optionIndex) => <option key={optionIndex} value={value}>{value}</option>)}</select></label>
                  <p className="text-xs leading-5 text-slate-600">Other answers will skip this question, even when it is required.</p>
                  {conditionError(question, index) ? <p className="text-xs font-medium text-red-700">{conditionError(question, index)}</p> : null}
                </div> : null}
              </section>

              <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-semibold text-slate-800"><input className="h-4 w-4 accent-blue-600" type="checkbox" checked={question.required} onChange={(event) => update(index, { required: event.target.checked })} />Required answer</label>
            </div>
          </section>;
        })}
      </div>

      <button className={`${subtleButton} w-full border-dashed border-blue-300 py-3 text-blue-700`} type="button" disabled={questions.length >= 30} onClick={() => setQuestions((items) => [...items, blank()])}>+ Add another question</button>
      <p className="rounded-xl bg-slate-50 px-3 py-2.5 text-xs leading-5 text-slate-600">Tip: create a new form for later question changes so existing feedback remains unchanged.</p>
      {error ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm font-medium text-red-700">{error}</p> : null}
      <button className="btn btn-primary flex min-h-12 w-full items-center justify-center gap-2 text-base" type="button" onClick={() => void save()}>{busy ? "Saving form…" : "Save and use form →"}</button>
    </fieldset>
  );
}
