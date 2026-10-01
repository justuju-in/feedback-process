import { formbricksGet } from '../integrations/formbricks.js';
import { buildFormbricksSurvey } from '../integrations/formbricksBuilder.js';
import { connectFormbricksTemplate } from './formbricksService.js';
import { getDatabasePool } from '../db/connection.js';
import { ServiceError } from './serviceError.js';
export async function createFormbricksForm(input, actor) {
  if (!['member','admin','hr','sc'].includes(String(actor.role).toLowerCase())) throw new ServiceError(403,'This account cannot create feedback forms');
  const workspaceId = process.env.FORMBRICKS_WORKSPACE_ID;
  if (!workspaceId) throw new ServiceError(503,'Form creation is not configured yet. The Formbricks workspace must be connected on the server.');
  const payload=buildFormbricksSurvey(input,workspaceId);
  const pool=getDatabasePool();
  // A per-name database lock prevents double clicks/concurrent creates from producing duplicates.
  const connection=await pool.getConnection();
  const lock='fb-create:'+ (await import('node:crypto')).createHash('sha256').update(payload.name.toLowerCase()).digest('hex').slice(0,48);
  let acquired=false;
  try {
    const [[result]]=await connection.execute('SELECT GET_LOCK(?, 0) AS acquired',[lock]);
    acquired=Number(result.acquired)===1;
    if(!acquired)throw new ServiceError(409,'This form is already being saved. Please wait.');
    const [[existing]]=await connection.execute('SELECT id FROM feedback_templates WHERE name=?',[payload.name]);
    if(existing)throw new ServiceError(409,'A feedback form with this name already exists. Choose another name.');
    const survey=await formbricksGet('surveys',{method:'POST',body:payload});
    if(!survey?.id)throw new ServiceError(502,'Formbricks did not return the created form');
    return await connectFormbricksTemplate({survey:survey.id,name:payload.name,actorId:actor.id});
  } finally {
    if(acquired)await connection.execute('SELECT RELEASE_LOCK(?)',[lock]);
    connection.release();
  }
}
