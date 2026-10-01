// Local-only adapter for an explicitly self-hosted Formbricks instance.
// Keeps provider authentication, CSP directives and a restricted parent allowlist.
import http from 'node:http';
import { pathToFileURL } from 'node:url';
export const upstreamOrigin = 'http://localhost:3217';
export const embedOrigin = 'http://localhost:3218';
export const parents = ['http://localhost:3000','http://localhost:3001','http://localhost:3002','http://localhost:3117'];
export function embeddedCsp(value = "default-src 'self'") {
  return value.split(';').map(s=>s.trim()).filter(s=>s && !s.startsWith('frame-ancestors')).join('; ') + "; frame-ancestors 'self' " + parents.join(' ');
}
const rewrite = value => value.replaceAll(upstreamOrigin,embedOrigin).replaceAll(encodeURIComponent(upstreamOrigin),encodeURIComponent(embedOrigin));
const toUpstream = value => value.replaceAll(embedOrigin,upstreamOrigin).replaceAll(encodeURIComponent(embedOrigin),encodeURIComponent(upstreamOrigin));
export function createEmbedProxy() {
 return http.createServer((req,res)=>{
  if(!['localhost:3218','127.0.0.1:3218'].includes(req.headers.host)) {res.writeHead(403);res.end('Invalid host');return;}
  if(!req.url.startsWith('/') || req.url.startsWith('//')) {res.writeHead(400);res.end();return;}
  if(req.headers.origin && req.headers.origin!==embedOrigin) {res.writeHead(403);res.end('Cross-origin request blocked');return;}
  const headers={...req.headers,host:'localhost:3217','accept-encoding':'identity','x-forwarded-host':'localhost:3217','x-forwarded-proto':'http'};
  if(headers.origin) headers.origin=upstreamOrigin;
  if(headers.referer?.startsWith(embedOrigin+'/'))headers.referer=headers.referer.replace(embedOrigin,upstreamOrigin);
  // Feedback app credentials must never be forwarded to the provider.
  if(headers.cookie)headers.cookie=headers.cookie.split(';').filter(c=>/^(?:__Secure-|__Host-)?formbricks\./.test(c.trim())).join(';');
  delete headers.authorization;
  const rewriteBody=/text\/|application\/(json|x-www-form-urlencoded)/i.test(headers['content-type']||'');
  if(rewriteBody){delete headers['content-length'];delete headers['transfer-encoding'];}
  const remote=http.request({hostname:'127.0.0.1',port:3217,path:toUpstream(req.url),method:req.method,headers},reply=>{
    const responseHeaders={...reply.headers};
    delete responseHeaders['x-frame-options'];
    delete responseHeaders['content-length'];
    delete responseHeaders.etag;
    responseHeaders['content-security-policy']=embeddedCsp(responseHeaders['content-security-policy']);
    responseHeaders['cache-control']='no-store';
    if(responseHeaders.location)responseHeaders.location=rewrite(responseHeaders.location);
    if(responseHeaders['set-cookie'])responseHeaders['set-cookie']=responseHeaders['set-cookie'].map(rewrite);
    const textual=/text\/|application\/(json|javascript)/i.test(responseHeaders['content-type']||'');
    if(!textual){res.writeHead(reply.statusCode,responseHeaders);reply.pipe(res);return;}
    const chunks=[];let size=0;
    reply.on('data',chunk=>{size+=chunk.length;if(size>32*1024*1024){reply.destroy();res.destroy();return;}chunks.push(chunk);});
    reply.on('end',()=>{res.writeHead(reply.statusCode,responseHeaders);res.end(rewrite(Buffer.concat(chunks).toString('utf8')));});
    reply.on('error',()=>res.destroy());
  });
  remote.setTimeout(60000,()=>remote.destroy());
  remote.on('error',()=>{if(!res.headersSent){res.writeHead(502,{'Content-Type':'text/plain'});res.end('Formbricks is unavailable. Start the local Formbricks service.');}else res.destroy();});
  req.on('aborted',()=>remote.destroy());
  if(rewriteBody){
    const chunks=[];let size=0;
    req.on('data',chunk=>{size+=chunk.length;if(size>32*1024*1024){remote.destroy();req.destroy();return;}chunks.push(chunk);});
    req.on('end',()=>remote.end(toUpstream(Buffer.concat(chunks).toString('utf8'))));
  }else req.pipe(remote);
 });
}
if(import.meta.url===pathToFileURL(process.argv[1]||'').href){createEmbedProxy().listen(3218,'127.0.0.1',()=>console.log('Local embedded Formbricks adapter ready on port 3218'));}
