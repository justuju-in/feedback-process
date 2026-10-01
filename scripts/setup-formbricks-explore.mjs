import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
const id = () => 'c' + randomBytes(12).toString('hex').slice(0,23);
const label = (text) => ({default:text});
const question = (key,type,title,extra={}) => ({id:key,type,headline:label(title),required:false,...extra});
const choices = (...texts) => texts.map((text,i)=>({id:`choice${i+1}`,label:label(text)}));
const block = (name,elements) => ({id:id(),name,elements,buttonLabel:label('Next'),backButtonLabel:label('Back')});
const blocks = [
  block('1. Single choice, dropdown and checkboxes',[
    question('single','multipleChoiceSingle','Single choice: How was the teamwork?',{required:true,choices:choices('Good','Average','Needs improvement'),displayType:'list'}),
    question('dropdown','multipleChoiceSingle','Dropdown: Which area would you like to improve?',{required:true,choices:choices('Communication','Planning','Technical skills','Time management'),displayType:'dropdown'}),
    question('multiple','multipleChoiceMulti','Checkboxes: What went well? Select more than one.',{required:true,choices:choices('Communication','Teamwork','Ownership','Problem solving'),displayType:'list'}),
    question('multi_dropdown','multipleChoiceMulti','Multi-select dropdown: Choose skills to practise.',{choices:choices('Listening','Writing','Presenting','Planning'),displayType:'dropdown'}),
  ]),
  block('2. Written answers and validation',[
    question('short_text','openText','Short text: Describe your experience in a few words.',{required:true,inputType:'text',longAnswer:false,placeholder:label('Helpful and supportive')}),
    question('long_text','openText','Long text: What should we continue or change?',{inputType:'text',longAnswer:true,placeholder:label('Write a detailed example here.')}),
    question('email','openText','Email validation: Enter a sample email (optional).',{inputType:'email',placeholder:label('tester@example.com')}),
    question('number','openText','Number input: How many sessions did you attend?',{inputType:'number',placeholder:label('3')}),
  ]),
  block('3. Rating styles',[
    question('stars','rating','Star rating: How was our collaboration?',{scale:'star',range:5}),
    question('smileys','rating','Smiley rating: How did you feel after the session?',{scale:'smiley',range:5}),
    question('numeric_rating','rating','Number rating: How clear were the next steps?',{scale:'number',range:5,lowerLabel:label('Not clear'),upperLabel:label('Very clear')}),
  ]),
  block('4. Feedback scores',[
    question('nps','nps','NPS: How likely are you to recommend this session?',{lowerLabel:label('Not likely'),upperLabel:label('Very likely')}),
    question('csat','csat','Satisfaction: How satisfied were you?',{scale:'smiley',range:5}),
    question('ces','ces','Effort: How easy was it to complete the work?',{scale:'number',range:7,lowerLabel:label('Very difficult'),upperLabel:label('Very easy')}),
  ]),
  block('5. Consent and conditional follow-up',[
    question('consent','consent','Consent checkbox (optional)',{label:label('I am comfortable sharing this test feedback.')}),
    question('followup','multipleChoiceSingle','Would you like a follow-up discussion?',{required:true,choices:choices('Yes','No'),subheader:label('Yes shows an extra question. No skips it.')}),
  ]),
  block('6. Follow-up details — shown after Yes',[
    question('followup_details','openText','What would you like to discuss?',{required:true,longAnswer:true,placeholder:label('Tell us what support would help.')}),
  ]),
  block('7. Statement and finish',[
    question('statement','cta','You have explored the available core question types.',{subheader:label('Click Submit feedback. Then return to the feedback app and choose Check submission to see your saved answers.'),buttonExternal:false}),
  ]),
];
blocks[4].logic = [{id:id(),conditions:{id:id(),connector:'and',conditions:[{id:id(),leftOperand:{type:'element',value:'followup'},operator:'equals',rightOperand:{type:'static',value:'choice2'}}]},actions:[{id:id(),objective:'jumpToBlock',target:blocks[6].id}]}];
blocks[6].buttonLabel=label('Submit feedback');
const config = JSON.parse(await readFile(new URL('../.local/formbricks/connection.json',import.meta.url),'utf8'));
if (!['localhost','127.0.0.1'].includes(new URL(config.origin).hostname)) throw new Error('This setup is only for local testing.');
const surveyName='Formbricks Explore — Choices, Dropdowns & More';
const marker=new URL('../.local/formbricks/explore.json',import.meta.url);
let surveyId;
try { surveyId=JSON.parse(await readFile(marker,'utf8')).surveyId; } catch(e) {if(e.code!=='ENOENT')throw e;}
if (!surveyId) {
  const existing=await fetch(`${config.origin}/api/v1/management/surveys/${config.surveyId}`,{headers:{'x-api-key':config.apiKey}});
  if(!existing.ok)throw new Error(`Workspace lookup failed: ${existing.status}`);
  const original=(await existing.json()).data;
  const payload={workspaceId:original.workspaceId,name:surveyName,type:'link',status:'inProgress',blocks,questions:[],welcomeCard:{enabled:false},endings:[{id:id(),type:'endScreen',headline:label('Thank you! Your exploration feedback is submitted.'),subheader:label('Return to the feedback app and click Check submission.'),}] ,singleUse:{enabled:true,isEncrypted:false}};
  const response=await fetch(`${config.origin}/api/v1/management/surveys`,{method:'POST',headers:{'x-api-key':config.apiKey,'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const result=await response.json();
  if(!response.ok) throw new Error(JSON.stringify(result));
  surveyId=result.data.id;
  await writeFile(marker,JSON.stringify({surveyId,name:surveyName,blocks:blocks.length,questions:blocks.reduce((n,b)=>n+b.elements.length,0)}),{mode:0o600});
}
Object.assign(process.env,{FORMBRICKS_URL:config.origin,FORMBRICKS_API_KEY:config.apiKey,DB_HOST:'127.0.0.1',DB_PORT:'3317',DB_NAME:'feedback_process_local_test',DB_USER:'root',DB_PASSWORD:''});
const {getDatabasePool}=await import('../backend/src/db/connection.js');
const {connectFormbricksTemplate}=await import('../backend/src/services/formbricksService.js');
const pool=getDatabasePool();
try {
 const [[existing]]=await pool.execute('SELECT id FROM feedback_templates WHERE name=?',[surveyName]);
 const [[rani]]=await pool.execute('SELECT id FROM users WHERE email=?',['rani@justuju.in']);
 const template=existing || await connectFormbricksTemplate({survey:surveyId,name:surveyName,actorId:rani.id});
 console.log(JSON.stringify({surveyId,templateId:template.id,name:surveyName,blocks:blocks.length,questions:blocks.reduce((n,b)=>n+b.elements.length,0)}));
} finally {await pool.end();}
