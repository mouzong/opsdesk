# Documentation toolchain

This site is built with [MkDocs](https://www.mkdocs.org/) and the [Material](https://squidfunnel.github.io/mkdocs-material/) theme from the Markdown files in `docs/`. It is committed to the repository, built into `dist/docs`, and **served by the OpsDesk application itself at `/docs/`**. No external hosting is assumed and nothing is published anywhere by the build.

!!! info "Python is required only for the documentation"
    OpsDesk itself is a Node.js application and does not use Python at runtime or for building the app. Python **3.10 or newer** (tested with 3.13 and 3.14) is needed only to build or preview these pages. Without it, everything else works and `/docs/` shows a "not built" message.

## Commands

All commands run in the **repository root**. They wrap the cross-platform helper `scripts/docs.mjs`, which finds Python, creates the virtual environment in `.venv-docs/` and calls the pinned MkDocs.

| Step | Command |
| --- | --- |
| Create the virtual environment and install the pinned packages (once) | `npm run docs:setup` |
| Live-reloading preview on <http://127.0.0.1:8000> | `npm run docs:serve` |
| Strict build into `dist/docs` | `npm run docs:build` |
| Application and documentation together | `npm run build:all` |

### Doing it by hand

=== "macOS / Linux"

    ```bash
    python3 -m venv .venv-docs
    source .venv-docs/bin/activate
    pip install -r requirements-docs.txt
    mkdocs serve --strict      # preview at http://127.0.0.1:8000
    mkdocs build --strict      # output: dist/docs
    deactivate
    ```

=== "Windows PowerShell"

    ```powershell
    py -m venv .venv-docs
    .\.venv-docs\Scripts\Activate.ps1
    pip install -r requirements-docs.txt
    mkdocs serve --strict      # preview at http://127.0.0.1:8000
    mkdocs build --strict      # output: dist/docs
    deactivate
    ```

    If activation is blocked by the execution policy, skip it and call `.\.venv-docs\Scripts\python.exe -m mkdocs build --strict`.

`requirements-docs.txt` pins **every** package (MkDocs 1.6.1, Material 9.7.7 and their dependencies), so builds are reproducible.

## Strict mode and link checking

The build always uses `--strict`, and `mkdocs.yml` sets `validation:` so that **broken internal links, missing anchors, links to files that are not part of the site, files missing from the navigation, and unknown configuration** are warnings, which strict mode turns into a failing build. Run `npm run docs:build` before committing documentation changes; CI does the same.

## Where the built site is served

`server/app.ts` mounts `dist/docs` at **`/docs/`**:

- `http://127.0.0.1:4310/docs/` and every nested page (for example `/docs/operations/health/`) are static files, so direct refreshes work. `/docs` redirects to `/docs/`.
- MkDocs writes **relative** asset URLs, so no `site_url` or base path is needed.
- The application's single-page fallback explicitly excludes `/docs` and `/api`; the frontend router only handles `/`, `/w/<id>` and `/settings`. The three cannot collide.
- Build the docs **while the server runs** and reload: availability is checked per request. A missing build yields a plain "not built" message with the command to run.
- Development: `npm run dev` proxies `/docs` from the Vite port to the API, so the link works there too after `npm run docs:build`; `npm run docs:serve` is the live preview for writing.
- The sidebar **Documentation** link and the one in Settings > About point to the relative path `/docs/`, never to a development address.
- Docker: the `Dockerfile` has a Python stage that builds the docs and copies them to `dist/docs` in the final image.

### Offline by design

`theme.font: false` stops Material from using Google Fonts; the OpsDesk typeface (Inter, SIL OFL licence included) is bundled in `docs/assets/fonts`. Only the built-in search plugin is enabled; there is no analytics, no social cards and no CDN. The `/docs` Content-Security-Policy allows only `'self'` sources (plus inline scripts for Material's colour-scheme bootstrap, see [Security model](../operations/security.md)).

## Writing pages

- Put Markdown under `docs/`, add the page to `nav:` in `mkdocs.yml`, and link with **relative file links** (`../operations/health.md#how-the-checks-work`).
- Tabs for platform variants: `=== "macOS / Linux"` and `=== "Windows PowerShell"` blocks.
- Take commands, ports and settings from the code; update the page in the same change as the code.

## Continuous integration

`.github/workflows/ci.yml` defines three jobs:

| Job | Steps |
| --- | --- |
| `app` (Node 22 and 24) | `npm ci`, `npm run typecheck`, `npm test`, `npm run build` |
| `databases` (Node 24, PostgreSQL 17 and MySQL 8.4 service containers) | `npm ci`, `npm test` with `TEST_POSTGRES_URL` / `TEST_MYSQL_URL` |
| `docs` (Python 3.13) | `pip install -r requirements-docs.txt`, `mkdocs build --strict` |

!!! warning "CI platform is an assumption"
    The repository had no CI configuration, no git remote and no hosting information when this was added. The workflow targets **GitHub Actions** because it is the most common choice. It has been checked for YAML validity, but **it has not run on a real remote**, so no status badge is shown anywhere. If you use another platform, translate the same commands (they are plain `npm`/`pip`/`mkdocs` invocations). After pushing to GitHub you can add a badge such as `![CI](https://github.com/<owner>/<repo>/actions/workflows/ci.yml/badge.svg)` once the first run has succeeded.
