"use strict";

const API_BASE = "https://api.cloudflare.com/client/v4";
const REQUEST_TIMEOUT_MS = 10000;

// Purges one URL from Cloudflare's cache. Does nothing unless CLOUDFLARE_ZONE_ID
// and CLOUDFLARE_API_TOKEN are set.
const purgeUrl = async (url, env = process.env, fetchImpl = fetch) => {
    const zoneId = env.CLOUDFLARE_ZONE_ID;
    const apiToken = env.CLOUDFLARE_API_TOKEN;
    if (!zoneId || !apiToken) {
        return;
    }
    try {
        const response = await fetchImpl(`${ API_BASE }/zones/${ zoneId }/purge_cache`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${ apiToken }`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ files: [url] }),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        });
        const result = await response.json();
        if (!response.ok || !result.success) {
            const messages = (result.errors || []).map(e => e.message).join("; ");
            console.log(`cloudflare: Failed to purge ${ url }: ${ messages || response.status }.`);
            return;
        }
        console.log(`cloudflare: Purged ${ url }.`);
    } catch (err) {
        console.log(`cloudflare: Failed to purge ${ url }: ${ err.message }.`);
    }
};

module.exports.purgeUrl = purgeUrl;
