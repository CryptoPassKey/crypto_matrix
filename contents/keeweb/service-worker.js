const VERSION = '1.18.7';

self.addEventListener('install', (event) =>
    event.waitUntil(
        caches.open('v1').then((cache) =>
            fetch('.?v=' + VERSION).then((response) => {
                if (response.ok) {
                    return cache.put('.', response);
                }
            })
        )
    )
);

self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request.url).then((response) => response || fetch(event.request)).then((response) => {
            // A response that went through a redirect cannot be handed back to a
            // navigation request (redirect: 'manual'); rebuild it without history.
            // Subresources keep the original response untouched, and if the
            // rebuild fails the original response is returned as-is.
            // Note: a rebuilt response has an empty Response.url.
            if (!response || !response.redirected || event.request.mode !== 'navigate') {
                return response;
            }
            return response.blob().then((body) => new Response(body, {
                status: response.status,
                statusText: response.statusText,
                headers: response.headers
            })).catch(() => response);
        })
    );
});
