"use client";
import {useEffect,useState} from 'react';
const base=process.env.NEXT_PUBLIC_API_URL||'/api';
async function api(path,body){const r=await fetch(`${base}/formbricks${path}`,{method:body?'POST':'GET',credentials:'include',headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const data=await r.json();if(!r.ok)throw Error(data.message||'Could not load Formbricks');return data;}
export default function FormbricksNativeBuilder({email,onUse}){
 const [config,setConfig]=useState(null),[forms,setForms]=useState([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[loaded,setLoaded]=useState(false);
 useEffect(()=>{let active=true;api('/config').then(c=>{if(active)setConfig(c.builder);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[]);
 async function refresh(){setBusy(true);setError('');try{setForms((await api('/builder/forms')).forms);setLoaded(true);}catch(e){setForms([]);setError(e.message);}finally{setBusy(false);}}
 async function useForm(id){setBusy(true);setError('');try{await onUse((await api('/builder/use',{id})).template);}catch(e){setError(e.message);}finally{setBusy(false);}}
 return <section className="grid min-w-0 gap-4">
  <div className="rounded-xl border border-teal-200 bg-teal-50 p-4 text-sm text-teal-950">
    <p className="font-bold">Original Formbricks builder</p>
    <p className="mt-1">Create and publish your form below. Then refresh your forms and choose Use for feedback. Sending a request is a separate step.</p>
    <p className="mt-2">If asked, sign in inside the builder with your Formbricks account: <strong>{email}</strong>. Formbricks manages its own workspace access.</p>
  </div>
  {config?.enabled?<iframe title="Original Formbricks form builder" src={config.url} className="h-[78vh] min-h-[650px] w-full rounded-xl border border-slate-300 bg-white" referrerPolicy="same-origin"/>:config?<p role="status">The embedded builder is not configured on this deployment.</p>:<p role="status">Loading builder…</p>}
  {config?.enabled?<div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-bold">My Formbricks forms</h2><button className="btn btn-secondary" type="button" disabled={busy} onClick={()=>void refresh()}>{busy?'Please wait…':'Refresh my forms'}</button></div>
    <p className="text-sm text-slate-600">Only link forms created by your matching Formbricks account appear here. Use for feedback enables single-use invitations. After connecting, duplicate the form before changing its questions.</p>
    {forms.map(f=><div key={f.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"><div><strong>{f.name}</strong><p className="text-sm text-slate-600">{f.status==='inProgress'?'Published':f.status==='draft'?'Draft — publish in the builder first':f.status}</p></div><button className="btn btn-primary" type="button" disabled={busy||f.status!=='inProgress'} onClick={()=>void useForm(f.id)}>Use for feedback</button></div>)}
    {loaded&&!forms.length?<p>No link forms found. Create a link form in the builder, then refresh.</p>:null}
  </div>:null}
  {error?<p role="alert" className="rounded-lg bg-red-50 p-3 text-red-700">{error}</p>:null}
 </section>;
}
