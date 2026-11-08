export function serviceWorkerSource(
  cacheName: string,
  assets: string[],
  root: string,
): string {
  return `const CACHE=${JSON.stringify(cacheName)};const PREFIX=${JSON.stringify(cacheName.slice(0, cacheName.lastIndexOf("-") + 1))};const ASSETS=${JSON.stringify(assets)};const ROOT=${JSON.stringify(root)};
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith(PREFIX)&&key!==CACHE).map(key=>caches.delete(key)))));});
self.addEventListener('fetch',event=>{const request=event.request;const url=new URL(request.url);if(request.method!=='GET'||url.origin!==self.location.origin||url.search)return;const path=url.pathname;const navigation=request.mode==='navigate'&&(path===ROOT||path===ROOT+'index.html');if(!navigation&&!ASSETS.includes(path))return;event.respondWith(caches.open(CACHE).then(async cache=>{const response=await cache.match(navigation?ROOT+'index.html':path);return response||fetch(request);}));});
`;
}
export function registerOfflineShell() {
  if (import.meta.env.PROD && "serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      void navigator.serviceWorker
        .register(`${import.meta.env.BASE_URL}sw.js`, {
          scope: import.meta.env.BASE_URL,
        })
        .catch(() => {
          window.dispatchEvent(new CustomEvent("notes-offline-unavailable"));
        });
    });
  }
}
