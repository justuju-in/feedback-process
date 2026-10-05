import { formbricksGet, LOCAL_FORMBRICKS_ORIGIN } from '../integrations/formbricks.js';
import { buildFormbricksSurvey } from '../integrations/formbricksBuilder.js';
import { connectFormbricksTemplate } from './formbricksService.js';
import { getDatabasePool } from '../db/connection.js';
import { ServiceError } from './serviceError.js';

async function createLocalTestingForm(payload, actor) {
  if (process.env.NODE_ENV === 'production') {
    throw new ServiceError(503, 'Form creation is not configured yet. The Formbricks workspace must be connected on the server.');
  }

  const pool = getDatabasePool();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[existing]] = await connection.execute('SELECT id FROM feedback_templates WHERE name=? AND (created_by IS NULL OR created_by=?)', [payload.name, actor.id]);
    if (existing) throw new ServiceError(409, 'A feedback form with this name already exists. Choose another name.');

    const [created] = await connection.execute(
      'INSERT INTO feedback_templates (name, description, created_by) VALUES (?, ?, ?)',
      [payload.name, 'Local testing form created without external Formbricks', actor.id],
    );
    await connection.execute(
      'INSERT INTO formbricks_templates (template_id, survey_id, origin, snapshot, snapshot_hash) VALUES (?, ?, ?, ?, ?)',
      [
        created.insertId,
        `local-${created.insertId}`,
        LOCAL_FORMBRICKS_ORIGIN,
        JSON.stringify({ questions: payload.blocks.flatMap((block) => block.elements || []), blocks: payload.blocks, languages: [], hiddenFields: null, variables: [] }),
        'local-testing',
      ],
    );
    await connection.commit();
    return {
      id: created.insertId,
      name: payload.name,
      description: 'Local testing form created without external Formbricks',
      createdBy: actor.id,
      isActive: true,
      provider: 'formbricks',
      localTesting: true,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function createFormbricksForm(input, actor) {
  if (String(actor.role).toLowerCase() === 'external') throw new ServiceError(403,'This account cannot create feedback forms');
  const workspaceId = process.env.FORMBRICKS_WORKSPACE_ID;
  const payload=buildFormbricksSurvey(input,workspaceId || 'local-testing');
  if (!workspaceId) return createLocalTestingForm(payload, actor);
  const pool=getDatabasePool();
  // A per-name database lock prevents double clicks/concurrent creates from producing duplicates.
  const connection=await pool.getConnection();
  const lock='fb-create:'+ (await import('node:crypto')).createHash('sha256').update(`${actor.id}:${payload.name.toLowerCase()}`).digest('hex').slice(0,48);
  let acquired=false;
  try {
    const [[result]]=await connection.execute('SELECT GET_LOCK(?, 0) AS acquired',[lock]);
    acquired=Number(result.acquired)===1;
    if(!acquired)throw new ServiceError(409,'This form is already being saved. Please wait.');
    const [[existing]]=await connection.execute('SELECT id FROM feedback_templates WHERE name=? AND (created_by IS NULL OR created_by=?)',[payload.name, actor.id]);
    if(existing)throw new ServiceError(409,'A feedback form with this name already exists. Choose another name.');
    const survey=await formbricksGet('surveys',{method:'POST',body:payload});
    if(!survey?.id)throw new ServiceError(502,'Formbricks did not return the created form');
    return await connectFormbricksTemplate({survey:survey.id,name:payload.name,actorId:actor.id});
  } finally {
    if(acquired)await connection.execute('SELECT RELEASE_LOCK(?)',[lock]);
    connection.release();
  }
}
