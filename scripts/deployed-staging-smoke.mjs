import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
// Manual acceptance only. The worker probe requires an empty staging queue.
// This is an operator-signed empty batch, not proof of HubSpot-origin delivery.
assert.equal(process.env.ALLOW_STAGING_SMOKE,'true','Explicit staging opt-in required');
for(const name of ['APP_BASE_URL','ADMIN_API_KEY','CRON_SECRET','HUBSPOT_CLIENT_SECRET']) {
  assert.ok(process.env[name],`Missing ${name}`);
}
const base=process.env.APP_BASE_URL;
assert.equal(base,'https://wix-hubspot-sync-staging.vercel.app');
const results=[];
const call=async(path,init={})=>fetch(base+path,{...init,redirect:'error',signal:AbortSignal.timeout(30_000)});
async function check(name,path,expected,init={},validate){const response=await call(path,init);assert.equal(response.status,expected,name);if(validate)await validate(response);else await response.body?.cancel();results.push({name,status:response.status});}
await check('health','/api/health',200,{},async r=>{assert.equal((await r.json()).status,'ok');assert.equal(r.headers.get('x-frame-options'),'DENY');assert.equal(r.headers.get('x-content-type-options'),'nosniff');});
await check('readiness denied without auth','/api/health/ready',401);
await check('deployed database readiness','/api/health/ready',200,{headers:{authorization:'Bearer '+process.env.ADMIN_API_KEY}},async r=>{const value=await r.json();assert.equal(value.database,'reachable');assert.equal(value.retryableEvents,0,'Drain or investigate the staging queue before this smoke check');});
await check('worker denied without auth','/api/worker/dispatch',401,{method:'POST'});
await check('authenticated staging worker','/api/worker/dispatch',200,{method:'POST',headers:{authorization:'Bearer '+process.env.CRON_SECRET}},async r=>{const v=await r.json();assert.equal(v.failed,0);assert.equal(v.requested,0);});
await check('customer access stays disabled','/api/customer/overview',503);
await check('operator OAuth start denied without auth','/api/oauth/hubspot/start',401);
await check('invalid Wix signature denied','/api/webhooks/wix',401,{method:'POST',body:'invalid.synthetic.jwt'});
await check('unsigned HubSpot request denied','/api/webhooks/hubspot',401,{method:'POST',body:'[]'});
const timestamp=String(Date.now());const body='[]';const path='/api/webhooks/hubspot';
const sign=(url,time)=>createHmac('sha256',process.env.HUBSPOT_CLIENT_SECRET).update('POST'+url+body+time).digest('base64');
const headers={'content-type':'application/json','x-hubspot-request-timestamp':timestamp,'x-hubspot-signature-v3':sign(base+path,timestamp)};
await check('operator-signed empty HubSpot batch','/api/webhooks/hubspot',202,{method:'POST',headers,body},async r=>assert.equal((await r.json()).accepted,0));
await check('wrong signed URL denied','/api/webhooks/hubspot',401,{method:'POST',headers:{...headers,'x-hubspot-signature-v3':sign(base+'/wrong',timestamp)},body});
const old=String(Date.now()-10*60_000);
await check('expired HubSpot signature denied','/api/webhooks/hubspot',401,{method:'POST',headers:{...headers,'x-hubspot-request-timestamp':old,'x-hubspot-signature-v3':sign(base+path,old)},body});
console.log(JSON.stringify({result:'PASS',checks:results.length,results,eventsPersisted:0,providerContactWrites:0},null,2));
