import {formbricksConfig, formbricksGet, surveyIdFromInput, snapshotHash, surveySnapshot} from '../integrations/formbricks.js';
import {connectFormbricksTemplate} from './formbricksService.js';
import {getDatabasePool} from '../db/connection.js';
import {ServiceError} from './serviceError.js';
export function nativeBuilderConfig() {
 const {origin,configured}=formbricksConfig();
 const enabled=configured && origin==='http://localhost:3217' && process.env.NODE_ENV!=='production' && Boolean(process.env.FORMBRICKS_WORKSPACE_ID);
 return {enabled,url:enabled?`http://localhost:3218/workspaces/${encodeURIComponent(process.env.FORMBRICKS_WORKSPACE_ID)}/surveys`:null};
}
export async function nativeIdentity(actor,cookies,{fetchImpl=fetch}={}) {
 if(!nativeBuilderConfig().enabled)throw new ServiceError(503,'The embedded Formbricks builder is not configured for this deployment.');
 if(!['member','admin','hr','sc'].includes(String(actor.role).toLowerCase()))throw new ServiceError(403,'This account cannot connect feedback forms.');
 const cookie=Object.entries(cookies||{}).filter(([key])=>/^(?:__Secure-)?formbricks\.session_token$/.test(key)).map(([key,value])=>`${key}=${encodeURIComponent(value)}`).join('; ');
 if(!cookie)throw new ServiceError(401,'Sign in to Formbricks inside the builder using the same email as your Feedback Process account, then refresh your forms.');
 let response;
 try{response=await fetchImpl(`${formbricksConfig().origin}/api/auth/get-session`,{headers:{cookie},redirect:'error',signal:AbortSignal.timeout(10000)});}catch{throw new ServiceError(502,'Could not verify your Formbricks login.');}
 if(!response.ok)throw new ServiceError(401,'Sign in to Formbricks again.');
 const session=await response.json();
 if(!session?.user?.id || !actor.email || String(session.user.email).toLowerCase()!==String(actor.email).toLowerCase())throw new ServiceError(403,'Your Formbricks login must use the same email as your Feedback Process account.');
 return session.user.id;
}
export function assertNativeOwner(form,providerUserId) {
 if(!form || form.workspaceId!==process.env.FORMBRICKS_WORKSPACE_ID || form.createdBy!==providerUserId)throw new ServiceError(403,'You can connect only forms you created in the connected workspace.');
}
export async function listNativeForms(actor,cookies) {
 const providerId=await nativeIdentity(actor,cookies);
 const forms=[];
 for(let skip=0;skip<5000;skip+=250){
  const page=await formbricksGet(`surveys?limit=250&skip=${skip}`);
  if(!Array.isArray(page))throw new ServiceError(502,'Formbricks returned an invalid form list.');
  for(const form of page)if(form.createdBy===providerId && form.workspaceId===process.env.FORMBRICKS_WORKSPACE_ID && form.type==='link')forms.push({id:form.id,name:form.name,status:form.status});
  if(page.length<250)return forms;
 }
 throw new ServiceError(422,'Too many forms to list. Use a smaller connected workspace.');
}
export async function useNativeForm(input,actor,cookies) {
 const providerId=await nativeIdentity(actor,cookies);
 const id=surveyIdFromInput(input?.id,formbricksConfig().origin);
 let form=await formbricksGet(`surveys/${id}`);assertNativeOwner(form,providerId);
 if(form.type!=='link'||form.status!=='inProgress')throw new ServiceError(409,'Publish your link-based feedback form in the builder first, then refresh the list.');
 const [[existing]]=await getDatabasePool().execute('SELECT t.id, t.name, t.description, t.created_by AS createdBy, t.is_active AS isActive, f.snapshot_hash AS snapshotHash FROM feedback_templates t JOIN formbricks_templates f ON f.template_id=t.id WHERE f.survey_id=? AND f.origin=? AND t.created_by=? ORDER BY t.id DESC LIMIT 1',[id,formbricksConfig().origin,actor.id]);
 if(existing){
  if(existing.snapshotHash!==snapshotHash(surveySnapshot(form)))throw new ServiceError(409,'This connected form has changed. Duplicate it in Formbricks and connect the new version to preserve previous feedback.');
  if(!existing.isActive)throw new ServiceError(409,'This connected template is disabled. Create a new form version.');
  return {id:existing.id,name:existing.name,description:existing.description,createdBy:existing.createdBy,isActive:true,provider:'formbricks'};
 }
 // The user explicitly selects Use for feedback; enable per-request invitations.
 if(!form.singleUse?.enabled || form.singleUse.isEncrypted!==false){
   form=await formbricksGet(`surveys/${id}`,{method:'PUT',body:{singleUse:{enabled:true,isEncrypted:false}}});
   assertNativeOwner(form,providerId);
 }
 return connectFormbricksTemplate({survey:id,actorId:actor.id});
}
