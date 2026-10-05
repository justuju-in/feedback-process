import test from 'node:test';
import assert from 'node:assert/strict';
import { getDatabasePool } from '../src/db/connection.js';
import { createFormbricksForm } from '../src/services/formbricksBuilderService.js';
import { openFormbricksSession, submitLocalFormbricksSession } from '../src/services/formbricksService.js';
import { createFeedbackRequest, getFeedbackRequestById } from '../src/services/feedbackRequestService.js';
import { createTemplate, getAllTemplates, updateTemplate } from '../src/services/templateService.js';
import { submitFeedbackAnswers } from '../src/services/feedbackAnswerService.js';

test('staging custom forms retain template privacy and native feedback', {skip:process.env.FORMBRICKS_STAGING_TEST !== '1'}, async t => {
  assert.equal(process.env.DB_HOST,'127.0.0.1');
  assert.notEqual(process.env.DB_PORT,'3306');
  assert.match(process.env.DB_NAME, /verify/);
  for (const key of ['SMTP_HOST','SMTP_USER','SMTP_PASS','MATTERMOST_WEBHOOK_URL','SC_MATTERMOST_WEBHOOK_URL','FORMBRICKS_WORKSPACE_ID']) assert.ok(!process.env[key]);
  const pool=getDatabasePool(); t.after(()=>pool.end());
  const stamp=Date.now(); const users=[];
  for (let i=0;i<3;i++) {
    const [r]=await pool.execute('INSERT INTO users (name,email,password_hash,role,is_active) VALUES (?,?,?,?,TRUE)',[`Verify ${i}`,`verify-${stamp}-${i}@example.invalid`,'unused','member']);
    users.push({id:r.insertId,role:'member'});
  }
  const [owner,giver,other]=users;
  const form=await createFormbricksForm({name:`Custom ${stamp}`,questions:[{title:'Continue?',type:'single',options:['Yes','No'],required:true},{title:'Explain',type:'longText',required:true,showWhen:{questionIndex:0,optionIndex:0}}]},owner);
  await t.test('custom templates stay private, including same-name templates',async()=>{
    assert.ok((await getAllTemplates({userId:owner.id})).some(x=>x.id===form.id&&x.provider==='formbricks'));
    assert.ok(!(await getAllTemplates({userId:other.id})).some(x=>x.id===form.id));
    await createFormbricksForm({name:form.name,questions:[{title:'Other private question',type:'text'}]},other);
    await assert.rejects(createFeedbackRequest({requesterId:other.id,receiverId:other.id,giverId:giver.id,templateId:form.id}), /template|own/i);
    await assert.rejects(updateTemplate({templateId:form.id,name:form.name,questions:['Changed'],actorId:owner.id}), /new form version/);
  });
  const request=await createFeedbackRequest({requesterId:owner.id,receiverId:owner.id,giverId:giver.id,templateId:form.id,purpose:'growth'});
  await t.test('only selected giver responds; hidden required branch is skipped',async()=>{
    await assert.rejects(openFormbricksSession(request.id,other.id), /selected feedback giver/);
    const session=await openFormbricksSession(request.id,giver.id);
    assert.equal(session.local,true);
    const before=await getFeedbackRequestById(request.id);
    assert.equal(before.provider,'formbricks'); assert.equal(before.formbricks.answers,null);
    await assert.rejects(submitFeedbackAnswers(request.id,giver.id,['Bypass']), /Formbricks/);
    await submitLocalFormbricksSession(request.id,giver.id,{answers:{[session.questions[0].id]:'No'}});
    const after=await getFeedbackRequestById(request.id);
    assert.equal(after.status,'submitted');assert.equal(after.formbricks.completed,true);
    assert.deepEqual(after.formbricks.answers,{[session.questions[0].id]:'No'});
    await assert.rejects(submitLocalFormbricksSession(request.id,giver.id,{answers:{}}), /no longer accepting/);
  });
  await t.test('native template editing, direct feedback and request snapshots still work',async()=>{
    const template=await createTemplate({name:`Simple ${stamp}`,questions:['Original'],actorId:owner.id});
    await updateTemplate({templateId:template.id,name:template.name,questions:['Updated'],actorId:owner.id});
    const native=await createFeedbackRequest({requesterId:owner.id,giverId:owner.id,receiverId:other.id,templateId:template.id,isDirectFeedback:true});
    const detail=await getFeedbackRequestById(native.id);
    assert.equal(detail.provider,'native');assert.equal(detail.formbricks,null);
    await submitFeedbackAnswers(native.id,owner.id,detail.questions.map(q=>({questionId:q.id,answer:'Clear, helpful collaboration throughout this task.',rating:null})));
    assert.equal((await getFeedbackRequestById(native.id)).status,'submitted');
    await assert.rejects(updateTemplate({templateId:template.id,name:template.name,questions:['Changed after use'],actorId:owner.id}), /already been used/);
    await assert.rejects(createFeedbackRequest({requesterId:owner.id,giverId:owner.id,receiverId:other.id,templateId:form.id,isDirectFeedback:true}), /Request feedback/);
  });
});
