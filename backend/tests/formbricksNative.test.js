import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeIdentity,assertNativeOwner,nativeBuilderConfig} from '../src/services/formbricksNativeService.js';
import {embeddedCsp} from '../../scripts/formbricks-embed-proxy.mjs';
const env={NODE_ENV:'development',FORMBRICKS_URL:'http://localhost:3217',FORMBRICKS_API_KEY:'local-test-key',FORMBRICKS_WORKSPACE_ID:'trusted-workspace'};
Object.assign(process.env,env);
test('native identity requires provider sign-in as the same feedback member and filters cookies',async()=>{
 const actor={id:1,email:'member@example.com',role:'member'};
 await assert.rejects(nativeIdentity(actor,{}),/Sign in/);
 await assert.rejects(nativeIdentity({...actor,role:'external'},{}),/cannot connect/);
 let headers;
 const fetchImpl=async(_url,opts)=>{assert.equal(_url,'http://localhost:3217/api/auth/get-session');headers=opts.headers;return {ok:true,json:async()=>({user:{id:'provider-user',email:'member@example.com'}})};};
 assert.equal(await nativeIdentity(actor,{'formbricks.session_token':'signed-token',feedback_token:'private-app-token'},{fetchImpl}),'provider-user');
 assert.equal(headers.cookie,'formbricks.session_token=signed-token');
 await assert.rejects(nativeIdentity({...actor,email:'someone-else@example.com'},{'formbricks.session_token':'signed-token'},{fetchImpl}),/same email/);
});
test('member can connect only own forms in the configured workspace',()=>{
 assert.doesNotThrow(()=>assertNativeOwner({createdBy:'me',workspaceId:'trusted-workspace'},'me'));
 assert.throws(()=>assertNativeOwner({createdBy:'other',workspaceId:'trusted-workspace'},'me'),/only forms/);
 assert.throws(()=>assertNativeOwner({createdBy:'me',workspaceId:'foreign'},'me'),/only forms/);
});
test('embedding preserves security directives and limits parent origins',()=>{
 const csp=embeddedCsp("default-src 'self'; script-src 'self'; frame-ancestors 'self'");
 assert.match(csp,/script-src 'self'/);assert.match(csp,/http:\/\/localhost:3002/);
 assert.equal(csp.match(/frame-ancestors/g).length,1);assert.ok(!csp.includes('*'));
 assert.equal(nativeBuilderConfig().enabled,true);
 process.env.NODE_ENV='production';assert.equal(nativeBuilderConfig().enabled,false);process.env.NODE_ENV='development';
});
