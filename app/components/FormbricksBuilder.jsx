"use client";
import { useState } from "react";
const types = [["text","Short text"],["longText","Long text"],["single","Single choice"],["multiple","Multiple choice"],["dropdown","Dropdown"],["multiDropdown","Multiple-select dropdown"],["stars","Star rating"],["smileys","Smiley rating"],["rating","Number rating"],["nps","NPS (0–10)"],["csat","Satisfaction (CSAT)"],["ces","Effort (CES)"],["email","Email"],["number","Number"],["consent","Consent checkbox"]];
const blank = () => ({key:crypto.randomUUID(),title:"",type:"text",required:false,options:["",""],consentLabel:"",showWhen:null});
const choiceTypes = ["single","multiple","dropdown","multiDropdown"];
const field = "w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900";
const button = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold disabled:opacity-40";
export default function FormbricksBuilder({onSave}) {
  const [name,setName]=useState("");
  const [questions,setQuestions]=useState(()=>[blank()]);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  function update(index,patch){setQuestions(items=>items.map((q,i)=>i===index?{...q,...patch}:q));}
  function move(index,delta){setQuestions(items=>{const next=[...items];[next[index],next[index+delta]]=[next[index+delta],next[index]];return next;});}
  function conditionSources(index) {
    return questions.slice(0,index).filter(q=>['single','dropdown'].includes(q.type) && !q.showWhen);
  }
  function conditionError(q,index) {
    if (!q.showWhen) return '';
    const source = conditionSources(index).find(item=>item.key===q.showWhen.questionKey);
    if (!source) return `Question ${index+1}: select an earlier always-visible Single choice or Dropdown question. Its source may have been changed, moved or removed.`;
    if (!q.showWhen.answer || !source.options.includes(q.showWhen.answer)) return `Question ${index+1}: select the answer that should show this question. Its option may have been changed or removed.`;
    return '';
  }
  async function save(){
    setError("");
    if(name.trim().length<3){setError("Enter a form name with at least 3 characters.");return;}
    for(const [i,q] of questions.entries()){
      const invalidCondition=conditionError(q,i);if(invalidCondition){setError(invalidCondition);return;}
      if(!q.title.trim()){setError(`Enter question ${i+1}.`);return;}
      if(choiceTypes.includes(q.type) && (q.options.some(o=>!o.trim()) || new Set(q.options.map(o=>o.trim().toLowerCase())).size!==q.options.length)){setError(`Question ${i+1}: fill each option and use different choices.`);return;}
      if(q.type==="consent"&&!q.consentLabel.trim()){setError(`Question ${i+1}: enter the checkbox label.`);return;}
    }
    setBusy(true);
    try{const result=await onSave({provider:"formbricks",createSurvey:true,name:name.trim(),questions:questions.map(({key,showWhen,...q})=>({...q,...(showWhen?{showWhen:{questionIndex:questions.findIndex(item=>item.key===showWhen.questionKey),optionIndex:questions.find(item=>item.key===showWhen.questionKey).options.indexOf(showWhen.answer)}}:{})}))});if(!result.ok)setError(result.message||"Could not save your form. Your questions are still here.");}
    catch(err){setError(err.message);}
    finally{setBusy(false);}
  }
  return <fieldset disabled={busy} className="mt-5 grid min-w-0 gap-4">
    <legend className="font-bold text-slate-900">Create your feedback form</legend>
    <label className="grid gap-1 text-sm font-semibold">Form name<input className={field} maxLength={100} placeholder="Enter your form name" value={name} onChange={e=>setName(e.target.value)} /></label>
    {questions.map((q,i)=><section key={q.key} className="grid min-w-0 gap-3 rounded-xl border border-slate-200 bg-white p-3" aria-label={`Question ${i+1} editor`}>
      <div className="flex flex-wrap items-center justify-between gap-2"><strong>Question {i+1}</strong><div className="flex gap-1"><button type="button" className={button} aria-label={`Move question ${i+1} up`} disabled={i===0} onClick={()=>move(i,-1)}>↑</button><button type="button" className={button} aria-label={`Move question ${i+1} down`} disabled={i===questions.length-1} onClick={()=>move(i,1)}>↓</button><button type="button" className={button} disabled={questions.length===1} aria-label={`Remove question ${i+1}`} onClick={()=>setQuestions(items=>items.filter((_,index)=>index!==i))}>Remove</button></div></div>
      <label className="grid gap-1 text-sm">Question text<input className={field} maxLength={500} placeholder="Write your question" value={q.title} onChange={e=>update(i,{title:e.target.value})}/></label>
      <label className="grid gap-1 text-sm">Question type<select className={field} value={q.type} onChange={e=>update(i,{type:e.target.value})}>{types.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      {choiceTypes.includes(q.type)?<div className="grid gap-2"><p className="text-sm font-semibold">Answer options</p>{q.options.map((option,j)=><div key={j} className="flex gap-2"><input aria-label={`Question ${i+1} option ${j+1}`} className={field} maxLength={150} placeholder={`Option ${j+1}`} value={option} onChange={e=>update(i,{options:q.options.map((v,k)=>k===j?e.target.value:v)})}/><button type="button" className={button} disabled={q.options.length<=2} aria-label={`Remove option ${j+1} from question ${i+1}`} onClick={()=>update(i,{options:q.options.filter((_,k)=>k!==j)})}>×</button></div>)}<button type="button" className={button} disabled={q.options.length>=30} onClick={()=>update(i,{options:[...q.options,""]})}>Add option</button></div>:null}
      {q.type==="consent"?<label className="grid gap-1 text-sm">Checkbox label<input className={field} maxLength={250} value={q.consentLabel} onChange={e=>update(i,{consentLabel:e.target.value})}/></label>:null}
      <div className="grid gap-2 rounded-lg border border-blue-100 bg-blue-50/40 p-3">
        <label className="grid gap-1 text-sm font-semibold">When to show this question
          <select className={field} value={q.showWhen?'conditional':'always'} onChange={e=>update(i,{showWhen:e.target.value==='always'?null:{questionKey:'',answer:''}})}>
            <option value="always">Always show</option>
            <option value="conditional" disabled={!conditionSources(i).length && !q.showWhen}>Only when an answer matches</option>
          </select>
        </label>
        {!conditionSources(i).length && !q.showWhen?<p className="text-xs text-slate-600">For a conditional question, first add an always-visible Single choice or Dropdown question above it.</p>:null}
        {q.showWhen?<>
          <label className="grid gap-1 text-sm">Earlier question<select className={field} value={conditionSources(i).some(item=>item.key===q.showWhen.questionKey)?q.showWhen.questionKey:''} onChange={e=>update(i,{showWhen:{questionKey:e.target.value,answer:''}})}>
            <option value="">Choose a question</option>
            {conditionSources(i).map(source=><option key={source.key} value={source.key}>Question {questions.indexOf(source)+1}: {source.title || 'Untitled question'}</option>)}
          </select></label>
          <label className="grid gap-1 text-sm">Answer must be<select className={field} value={questions.find(item=>item.key===q.showWhen.questionKey)?.options.includes(q.showWhen.answer)?q.showWhen.answer:''} onChange={e=>update(i,{showWhen:{...q.showWhen,answer:e.target.value}})}>
            <option value="">Choose an answer</option>
            {(conditionSources(i).find(item=>item.key===q.showWhen.questionKey)?.options || []).filter(value=>value.trim()).map((value,j)=><option key={j} value={value}>{value}</option>)}
          </select></label>
          <p className="text-xs text-slate-600">This question appears only for the selected answer. Other answers skip it, even if Required answer is checked.</p>
          {conditionError(q,i)?<p className="text-xs text-red-700">{conditionError(q,i)}</p>:null}
        </>:null}
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={q.required} onChange={e=>update(i,{required:e.target.checked})}/>Required answer</label>
    </section>)}
    <button className={button} type="button" disabled={questions.length>=30} onClick={()=>setQuestions(items=>[...items,blank()])}>+ Add question</button>
    <p className="text-xs text-slate-600">Saving makes this form available for feedback requests. Create a new form for later question changes to preserve existing responses.</p>
    {error?<p role="alert" className="text-sm text-red-700">{error}</p>:null}
    <button className="btn btn-primary w-full" type="button" onClick={()=>void save()}>{busy?"Saving form…":"Save and use form"}</button>
  </fieldset>;
}
