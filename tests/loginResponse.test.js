import test from 'node:test';
import assert from 'node:assert/strict';
import { readLoginResponse } from '../app/lib/loginResponse.js';

test('proxy failures show a service message instead of JSON parser errors', async () => {
  for (const body of ['Internal Server Error', '<!DOCTYPE html><title>Error</title>', '']) {
    await assert.rejects(readLoginResponse(new Response(body, { status: 500 })), /backend and database connection/);
  }
});
test('invalid success responses cannot complete login', async () => {
  await assert.rejects(readLoginResponse(new Response('<html>Login</html>')), /unexpected response/);
  await assert.rejects(readLoginResponse(Response.json({})), /incomplete response/);
});
test('real authentication errors remain visible', async () => {
  await assert.rejects(readLoginResponse(Response.json({message:'Email or password is incorrect'}, {status:401})), /Email or password is incorrect/);
  await assert.rejects(readLoginResponse(Response.json({message:'Please verify your email address'}, {status:403})), /verify your email/);
});
test('valid login response is accepted', async () => {
  const data={user:{id:7,name:'Test'}};
  assert.deepEqual(await readLoginResponse(Response.json(data)),data);
});
