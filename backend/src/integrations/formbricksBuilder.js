import { randomBytes } from 'node:crypto';
import { ServiceError } from '../services/serviceError.js';
const id = () => 'c' + randomBytes(12).toString('hex').slice(0,23);
const label = (text) => ({ default: text });
const fail = (message) => { throw new ServiceError(400, message); };
const plain = (value, max, field) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail(`${field} must contain 1–${max} characters`);
  // Builder accepts plain text only; Formbricks renders headline content as rich text.
  return value.trim().replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
};
export function buildFormbricksSurvey(input, workspaceId) {
  if (typeof input?.name !== 'string' || input.name.trim().length < 3 || input.name.trim().length > 100) fail('Form name must contain 3–100 characters');
  if (!Array.isArray(input.questions) || !input.questions.length || input.questions.length > 30) fail('Add between 1 and 30 questions');
  const elements = input.questions.map((q,index) => {
    if (!q || typeof q !== 'object') fail(`Question ${index+1} is invalid`);
    const base = {id:id(),headline:label(plain(q.title,500,`Question ${index+1}`)),required:q.required === true};
    if (['text','longText','email','number'].includes(q.type)) return {...base,type:'openText',inputType:['email','number'].includes(q.type)?q.type:'text',longAnswer:q.type==='longText'};
    if (['single','dropdown','multiple','multiDropdown'].includes(q.type)) {
      if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 30) fail(`Question ${index+1} needs 2–30 options`);
      const options=q.options.map(v=>plain(v,150,`Question ${index+1} option`));
      if(new Set(options.map(v=>v.toLowerCase())).size!==options.length) fail(`Question ${index+1} has duplicate options`);
      return {...base,type:['single','dropdown'].includes(q.type)?'multipleChoiceSingle':'multipleChoiceMulti',displayType:['dropdown','multiDropdown'].includes(q.type)?'dropdown':'list',choices:options.map(v=>({id:id(),label:label(v)}))};
    }
    if(['stars','smileys','rating','csat','ces'].includes(q.type)) return {...base,type:['csat','ces'].includes(q.type)?q.type:'rating',scale:q.type==='stars'?'star':['smileys','csat'].includes(q.type)?'smiley':'number',range:q.type==='ces'?7:5};
    if(q.type==='nps')return {...base,type:'nps'};
    if(q.type==='consent')return {...base,type:'consent',label:label(plain(q.consentLabel,250,`Question ${index+1} checkbox label`))};
    fail(`Question ${index+1} has an unsupported type`);
  });
  // Only earlier, always-visible single-choice questions can be a condition source.
  // This avoids dependencies on unanswered/skipped questions and forbids cycles.
  const conditions = input.questions.map((q, index) => {
    if (q.showWhen == null) return null;
    const { questionIndex, optionIndex } = q.showWhen;
    const source = input.questions[questionIndex];
    if (!Number.isInteger(questionIndex) || questionIndex < 0 || questionIndex >= index ||
        !source || source.showWhen != null || !['single', 'dropdown'].includes(source.type)) {
      fail(`Question ${index + 1}: choose an earlier always-visible Single choice or Dropdown question for its condition`);
    }
    if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= source.options.length) {
      fail(`Question ${index + 1}: select a valid answer for its condition`);
    }
    return { source: elements[questionIndex].id, choice: elements[questionIndex].choices[optionIndex].id };
  });
  const ending = {id:id(),type:'endScreen',headline:label('Thank you for your feedback!'),subheader:label('Return to Feedback Process to view your submission.')};
  const blocks = elements.map((element,index)=>({id:id(),name:`Question ${index+1}`,elements:[element],buttonLabel:label(index===elements.length-1?'Submit feedback':'Next'),backButtonLabel:label('Back')}));
  blocks.forEach((block, index) => {
    const rules = [];
    let next = index + 1;
    // Route to the first matching conditional question, otherwise the next common
    // question (or ending). Recompute on every visited block so adjacent branches
    // are skipped correctly even after completing another conditional question.
    while (next < blocks.length && conditions[next]) {
      const condition = conditions[next];
      rules.push({id:id(),conditions:{id:id(),connector:'and',conditions:[{
        id:id(),leftOperand:{type:'element',value:condition.source},operator:'equals',
        rightOperand:{type:'static',value:condition.choice}
      }]},actions:[{id:id(),objective:'jumpToBlock',target:blocks[next].id}]});
      next++;
    }
    if (rules.length) {
      block.logic = rules;
      block.logicFallback = blocks[next]?.id || ending.id;
      block.buttonLabel = label('Next');
    }
  });
  return {workspaceId,name:input.name.trim(),type:'link',status:'inProgress',singleUse:{enabled:true,isEncrypted:false},questions:[],blocks,welcomeCard:{enabled:false},endings:[ending]};
}
