import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createServer} from '../server.js';
async function serve(t, options) {
  const server = createServer(options);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}
test('tokens are short lived, cached, and do not expose the key', async t => {
  let calls = 0;
  const url = await serve(t, {key:'secret-key', region:'eastasia', fetcher:async (endpoint, options) => {
    calls++; assert.match(endpoint,/eastasia/); assert.equal(options.headers['Ocp-Apim-Subscription-Key'],'secret-key');
    return new Response('temporary-token');
  }});
  for (let i = 0; i < 2; i++) {
    const response = await fetch(`${url}/api/token`, {method:'POST'});
    assert.equal(response.status,200); assert.equal(response.headers.get('cache-control'),'no-store');
    const body = await response.text(); assert.ok(!body.includes('secret-key')); assert.equal(JSON.parse(body).token,'temporary-token');
  }
  assert.equal(calls,1);
});
test('cross-origin and DNS rebinding requests cannot mint tokens', async t => {
  const url = await serve(t, {key:'secret', fetcher:() => {throw Error('must not reach Azure');}});
  assert.equal((await fetch(`${url}/api/token`, {method:'POST',headers:{Origin:'https://other.example'}})).status,403);
  const reboundStatus = await new Promise(resolve => { const req = http.request(`${url}/api/token`, {method:'POST', headers:{Host:'attacker.example'}}, res => {res.resume(); resolve(res.statusCode);}); req.end(); });
  assert.equal(reboundStatus,403);
  assert.equal((await fetch(`${url}/api/token`)).status,405);
});
test('errors do not expose Azure response or key', async t => {
  const url = await serve(t, {key:'secret', fetcher:async () => new Response('sensitive upstream error', {status:401})});
  const response = await fetch(`${url}/api/token`, {method:'POST'});
  assert.equal(response.status,502); assert.ok(!(await response.text()).includes('sensitive'));
  assert.equal((await fetch(`${url}/.env`)).status,404);
});
test('missing configuration returns actionable error', async t => {
  const url = await serve(t, {key:''});
  const response = await fetch(`${url}/api/token`, {method:'POST'});
  assert.equal(response.status,503); assert.match((await response.json()).error,/AZURE_SPEECH_KEY/);
});
