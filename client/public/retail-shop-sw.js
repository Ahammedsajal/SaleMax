'use strict';

const scope=new URL(self.registration.scope);
// Hosted storefronts share one origin but have distinct scopes. Keep each
// merchant's shell cache separate so activating one tenant's worker cannot
// evict another tenant's offline shell.
const CACHE_PREFIX='7network-storefront-shell-'+encodeURIComponent(scope.pathname)+'-';
const CACHE=CACHE_PREFIX+'20261107-orders-email1';
const shell=[
  scope.href,
  new URL('/retail-shop.css?v=ec07-consented-notices1',scope.origin).href,
  new URL('/retail-shop.js?v=20261107-orders-email1',scope.origin).href
];

self.addEventListener('install',event=>event.waitUntil((async()=>{
  const cache=await caches.open(CACHE);
  await cache.addAll(shell);
  await self.skipWaiting();
})()));

self.addEventListener('activate',event=>event.waitUntil((async()=>{
  const keys=await caches.keys();
  await Promise.all(keys.filter(key=>key.startsWith(CACHE_PREFIX)&&key!==CACHE).map(key=>caches.delete(key)));
  await self.clients.claim();
})()));

self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET')return;
  const url=new URL(request.url);
  if(url.origin!==scope.origin)return;
  const inScope=url.pathname.startsWith(scope.pathname);
  const isShellPage=inScope&&request.mode==='navigate'&&url.pathname===scope.pathname;
  const isStaticAsset=['/retail-shop.css','/retail-shop.js'].includes(url.pathname)&&
    url.searchParams.get('v')==='20261107-orders-email1';
  if(!isShellPage&&!isStaticAsset)return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    const cached=await cache.match(request);
    if(cached)return cached;
    const response=await fetch(request);
    if(response.ok&&response.type==='basic')await cache.put(request,response.clone());
    return response;
  })());
});
