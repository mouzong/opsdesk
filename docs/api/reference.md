# Interactive API reference

Explore and call the API with Swagger UI. Everything on this page is served by this site: **no CDN, no external validator, no analytics**, and it works offline.

!!! info "How it behaves"
    - **Deployed** (this page opened from your OpsDesk server at `/docs/`): the live contract is loaded from `/api/v1/openapi.json` and **Try it out** calls the same server (same origin, so no CORS is involved).
    - **Standalone preview** (`npm run docs:serve`, `mkdocs serve`): the bundled copy `api/openapi.json` is used and a small form lets you choose the API server. That server must list this preview's origin in `OPSDESK_CORS_ORIGINS` (there is no wildcard).
    - **Authorize** (top right of the reference) takes your bearer token. It is kept **in memory only**: reloading the page forgets it, nothing is written to browser storage, and nothing is ever prefilled from server configuration.
    - **Nothing runs automatically.** "Try it out" is opt-in per operation and requests are sent only when you press **Execute**.
    - Operations marked **⚠** (red border) are **destructive**: deleting data, replacing the dashboard, restoring or deleting backups. Their description states the confirmation they require (`mode`, `confirmReplace`, `confirm`, `If-Match`). Use a scratch server.

<div id="opsdesk-swagger" markdown="0">
  <noscript>The interactive reference needs JavaScript. The contract is available as <a href="../openapi.json">openapi.json</a>.</noscript>
</div>

## Machine-readable contract

| Where | URL |
| --- | --- |
| Running server (authoritative) | `GET /api/v1/openapi.json` |
| This documentation site | [api/openapi.json](openapi.json) |

The document is generated from the server's route definitions and request validators, so it cannot drift; the build fails if the committed copy is stale. Import it into Postman, Insomnia or a code generator.

```bash
curl -s "$BASE/openapi.json" | jq '.info.version, (.paths | length)'
```

## Standalone preview with a custom API server

1. Start OpsDesk allowing the preview origin and with a token (nothing else is opened up):

    ```bash
    OPSDESK_CORS_ORIGINS=http://127.0.0.1:8000 OPSDESK_API_TOKEN=<token> npm start
    ```

2. `npm run docs:serve`, open <http://127.0.0.1:8000/api/reference/>, enter `http://127.0.0.1:4310` in the **API server** field, press **Use this server**, then **Authorize** and paste the token.

Only exact origins are accepted by `OPSDESK_CORS_ORIGINS`; `*`, paths and non-http(s) schemes are rejected at start-up.

## Instant navigation

The site does not enable Material's "instant navigation". If you enable it, the loader (`assets/swagger/loader.js`) already subscribes to Material's `document$` observable and re-mounts the reference on every page switch.
