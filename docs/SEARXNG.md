# SearXNG for Acuity.Search

Acuity.Search queries an **external** SearXNG instance over its JSON API:

```
GET {SEARXNG_API_URL}/search?q=…&format=json&categories=general
```

Configure the origin with `SEARXNG_API_URL` (or the alias `SEARXNG_URL`):

```
SEARXNG_API_URL=https://searxng-production-3588.up.railway.app
```

## Symptom: every run is "partial" with `SEARXNG_JSON_DISABLED_OR_FORBIDDEN`

SearXNG returns **HTTP 403** for `format=json` (and `format=rss`) when the
format is not listed in `search.formats`. The stock image only enables `html`.
Check:

```bash
curl -s -o /dev/null -w "%{http_code}\n" "$SEARXNG_API_URL/search?q=test&format=json"
# 403 → JSON disabled     200 → OK
```

### Fix on the SearXNG service (not in this app)

1. Use a `settings.yml` that enables JSON. This repo ships one:
   [`searxng-settings.yml`](../searxng-settings.yml). The essential part:

   ```yaml
   use_default_settings: true
   server:
     secret_key: '<random>' # or set SEARXNG_SECRET
     limiter: false # or keep it on and whitelist the app (below)
     public_instance: false
   search:
     formats:
       - html
       - json
   ```

2. Make the container load it. Either:
   - mount it at **`/etc/searxng/settings.yml`** (Railway: add a volume or bake
     it into a small Dockerfile `FROM searxng/searxng` + `COPY searxng-settings.yml /etc/searxng/settings.yml`), or
   - point the container at it with **`SEARXNG_SETTINGS_PATH=/path/to/settings.yml`**.
3. If the limiter / bot detection stays on, also mount
   [`searxng-limiter.toml`](../searxng-limiter.toml) at
   `/etc/searxng/limiter.toml` with the app's egress IP in `pass_ip`.
4. If a gateway sits in front of SearXNG, set
   `ACUITY_SEARCH_SEARXNG_AUTH_HEADER` / `ACUITY_SEARCH_SEARXNG_AUTH_VALUE`
   in Acuity.Search so the header is forwarded.
5. Redeploy SearXNG and re-run the curl check (expect `200` and
   `content-type: application/json`).

> Note: at the time of writing the upstream engines on the Railway instance
> also reported errors on the HTML page (brave, duckduckgo…), so even the HTML
> page returned no results. Check _Preferences → Engines_ / the
> "Messages from the search engines" box after enabling JSON.

## What the app does when JSON is forbidden

`lib/acuity/search/providers/searxng.ts`:

1. **HTML fallback** — on 401/403 or an HTML/challenge body, it POSTs the same
   query to `/search` (as the SearXNG form does) and parses the simple-theme
   results (`providers/searxng-html.ts`). If that yields results the attempt
   succeeds with `errorCode: SEARXNG_HTML_FALLBACK_AFTER_*` (server-side only).
2. **Typed error** — otherwise the attempt fails with
   `SEARXNG_JSON_DISABLED_OR_FORBIDDEN` / `SEARXNG_NON_JSON_CHALLENGE`.
3. **Circuit breaker** — after 2 consecutive hard failures
   (`lib/acuity/search/provider-health.ts`) SearXNG is skipped
   (`skipped-disabled`, `SEARXNG_CIRCUIT_OPEN`) for 5 minutes, then probed
   again. Skipped attempts do not mark the run `partial`.
4. `GET /api/acuity-search/admin/health` reports the circuit state.

## Private Acuity instance (deploy/searxng)

`deploy/searxng/Dockerfile` builds a private SearXNG for Acuity.Search:

- `settings.yml`: `html` + `json` formats, port `8080`, limiter on, no real secret committed.
- `limiter.toml`: private-network ranges pass the limiter.
- `entrypoint.sh` refuses to start without `SEARXNG_SECRET` (>=32 chars).

Deploy it as its own Railway service with **no public domain** and point
Acuity.Search at `SEARXNG_API_URL=http://<service>.railway.internal:8080`.
The existing Morphic-project instance is left untouched (its JSON format returns 403).
The base-image entrypoint path (`/usr/local/searxng/entrypoint.sh`) should be
confirmed against the pinned image tag at deploy time.
