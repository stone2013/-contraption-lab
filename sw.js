/* Contraption Lab v0.8.0 — project-scoped cache, same-folder GitHub Pages hosting. */
const VERSION='0.8.0';
const SCOPE=self.registration.scope;
const PREFIX='contraption-lab:'+new URL(SCOPE).pathname+':';
const CACHE=PREFIX+VERSION;
const ASSETS=['index.html','manifest.webmanifest','icon-180.png','icon-192.png','icon-512.png'];
const assetURLs=ASSETS.map(path=>new URL(path,SCOPE).href);
const indexURL=assetURLs[0];
self.addEventListener('install',event=>{
 event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(assetURLs.map(url=>new Request(url,{cache:'reload'})))).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
 event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith(PREFIX)&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('message',event=>{
 if(event.data?.type==='SKIP_WAITING')self.skipWaiting();
 if(event.data?.type==='VERSION')event.ports?.[0]?.postMessage({version:VERSION});
});
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==new URL(SCOPE).origin||!url.href.startsWith(SCOPE))return;
 if(request.mode==='navigate'){
  event.respondWith((async()=>{
   const cache=await caches.open(CACHE);
   try{
    const response=await fetch(request);
    if(response.ok&&(response.headers.get('content-type')||'').includes('text/html')){
     const html=await response.clone().text();
     if(html.includes('application-version')&&html.includes('Contraption Lab'))await cache.put(indexURL,response.clone());
     return response;
    }
    return await cache.match(indexURL)||response;
   }catch(_){return await cache.match(indexURL)||new Response('首次使用需要联网加载完整游戏。',{status:503,headers:{'Content-Type':'text/plain;charset=utf-8'}});}
  })());
 }else if(assetURLs.includes(url.href)){
  event.respondWith((async()=>{
   const cache=await caches.open(CACHE),cached=await cache.match(url.href);
   if(cached)return cached;
   try{const response=await fetch(request);if(response.ok)await cache.put(url.href,response.clone());return response;}
   catch(_){return new Response('',{status:503});}
  })());
 }
});
