import test from 'node:test';
import assert from 'node:assert/strict';
import {buildFormbricksSurvey} from '../src/integrations/formbricksBuilder.js';
import {createFormbricksForm} from '../src/services/formbricksBuilderService.js';
test('member form compiler controls workspace, publication and invitation settings',()=>{
 const s=buildFormbricksSurvey({name:'My feedback',workspaceId:'foreign',singleUse:{enabled:false},questions:[{type:'dropdown',title:'<img src=x>',options:['First','Second'],required:true}]},'trusted');
 assert.equal(s.workspaceId,'trusted');assert.equal(s.singleUse.enabled,true);assert.equal(s.blocks[0].elements[0].headline.default,'&lt;img src=x&gt;');assert.equal(s.blocks[0].elements[0].displayType,'dropdown');assert.equal(s.blocks[0].elements[0].required,true);
});
test('incomplete and ambiguous choice questions cannot be published',()=>{
 for(const options of [['Only one'],['Same','same'],['Valid',' ']])assert.throws(()=>buildFormbricksSurvey({name:'My feedback',questions:[{type:'single',title:'Pick',options}]},'trusted'));
 assert.throws(()=>buildFormbricksSurvey({name:'My feedback',questions:[{type:'rawHtml',title:'Pick'}]},'trusted'));
});
test('external accounts cannot create provider surveys',async()=>{
 await assert.rejects(createFormbricksForm({}, {role:'external',id:99}),/cannot create/);
});

const source = {type:'single',title:'Any problems?',options:['Yes','No'],required:true};
const followup = (optionIndex) => ({type:'longText',title:'Tell us more',required:true,showWhen:{questionIndex:0,optionIndex}});
function route(survey, blockIndex, selectedOption) {
 const sourceId=survey.blocks[0].elements[0].id;
 const answerId=survey.blocks[0].elements[0].choices[selectedOption]?.id;
 const block=survey.blocks[blockIndex];
 const match=block.logic?.find(rule=>rule.conditions.conditions.every(c=>c.leftOperand.value===sourceId && c.rightOperand.value===answerId));
 return match?.actions[0].target || block.logicFallback || survey.blocks[blockIndex+1]?.id || survey.endings[0].id;
}
test('Yes/No branches skip irrelevant required questions and rejoin the common question',()=>{
 const s=buildFormbricksSurvey({name:'Branch test',questions:[source,followup(0),followup(1),{type:'stars',title:'Overall'}]},'trusted');
 assert.equal(route(s,0,0),s.blocks[1].id);
 assert.equal(route(s,1,0),s.blocks[3].id);
 assert.equal(route(s,0,1),s.blocks[2].id);
 assert.equal(route(s,2,1),s.blocks[3].id);
 assert.equal(route(s,0,undefined),s.blocks[3].id);
 assert.equal(s.blocks[1].elements[0].required,true);
});
test('adjacent matching follow-ups are visited; final unmatched follow-ups route to ending',()=>{
 const s=buildFormbricksSurvey({name:'Branch test',questions:[source,followup(0),followup(0)]},'trusted');
 assert.equal(route(s,0,0),s.blocks[1].id);
 assert.equal(route(s,1,0),s.blocks[2].id);
 assert.equal(route(s,0,1),s.endings[0].id);
 assert.equal(route(s,1,1),s.endings[0].id);
});
test('conditions reject missing, forward, unsupported and conditional sources or removed answers',()=>{
 for(const showWhen of [{questionIndex:1,optionIndex:0},{questionIndex:-1,optionIndex:0},{questionIndex:0,optionIndex:2},{questionIndex:0,optionIndex:'0'}]) {
   assert.throws(()=>buildFormbricksSurvey({name:'Invalid rule',questions:[source,{...followup(0),showWhen}]},'trusted'));
 }
 assert.throws(()=>buildFormbricksSurvey({name:'Invalid rule',questions:[{...source,type:'multiple'},followup(0)]},'trusted'));
 assert.throws(()=>buildFormbricksSurvey({name:'Invalid rule',questions:[source,{...source,showWhen:{questionIndex:0,optionIndex:0}},{...followup(0),showWhen:{questionIndex:1,optionIndex:0}}]},'trusted'));
});
