'use strict';

const CACHE='7network-storefront-shell-ec04';
const scope=new URL(self.registration.scope);
const shell=[
  scope.href,
  new URL('/retail-shop.css?v=ec04-delivery-proof1',scope.origin).href,
  new URL('/retail-shop.js?v=ec04-delivery-proof1',scope.origin).href
];

self.addEventListener('install',event=>event.waitUntil((async()=>{
  const cache=await caches.open(CACHE);
  await cache.addAll(shell);
  await self.skipWaiting();
})()));

self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));

self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET')return;
  const url=new URL(request.url);
  if(url.origin!==scope.origin)return;
  const inScope=url.pathname.startsWith(scope.pathname);
  const isShellPage=inScope&&request.mode==='navigate'&&url.pathname===scope.pathname;
  const isStaticAsset=['/retail-shop.css','/retail-shop.js'].includes(url.pathname)&&
    url.searchParams.get('v')==='ec04-delivery-proof1';
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
