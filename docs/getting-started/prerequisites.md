# Prerequisites

| Requirement | Version | Needed for | Notes |
| --- | --- | --- | --- |
| **Node.js** | **22.13 or newer** (22 LTS or 24 LTS; tested with 22.23 and 24.14) | running, developing and building the application | `package.json` declares `engines.node >= 22.13.0`. The backend uses Node's built-in `node:sqlite`, so there is **no native module to compile**. |
| **npm** | **10 or newer** (tested with 11.12) | installing dependencies | The lockfile is `package-lock.json`; no other package manager is supported. |
| **Python** | **3.10 or newer** (tested with 3.13 and 3.14) | **only the documentation toolchain** | The application itself does not use Python. If you do not build the documentation, you do not need Python; `/docs/` then shows a "not built" message. |
| A modern browser | Chrome, Edge, Firefox or Safari | using the UI | End-to-end tests run on Chrome. |
| Docker + Compose | optional | the [Docker deployment](../guides/docker.md) | Tested with Docker 29. |
| PostgreSQL / MySQL | optional | [other database engines](../operations/databases.md) | PostgreSQL 13+ (tested 17.11), MySQL 8.0.16+ (tested 8.4.13). |

No administrator rights are needed. If you cannot install Node.js system-wide, download the zip/tar archive from nodejs.org, extract it into your home folder and put its folder first on `PATH` for the session.

## Check your tools

=== "macOS / Linux"

    ```bash
    node -v     # must print v22.13.0 or higher
    npm -v      # must print 10.x or higher
    python3 --version   # only if you will build the docs: 3.10 or higher
    ```

=== "Windows PowerShell"

    ```powershell
    node -v     # must print v22.13.0 or higher
    npm -v      # must print 10.x or higher
    py --version   # only if you will build the docs: 3.10 or higher
    ```

!!! note "Corporate networks"
    Dependencies are downloaded once by `npm ci` (and `pip` for the docs). Configure your proxy or internal registry if needed (`npm config set proxy ...`, `npm config set registry ...`, `pip --proxy`). After installation OpsDesk works fully offline.

!!! tip "PowerShell script policy"
    If PowerShell refuses to run `npm` ("running scripts is disabled"), use `npm.cmd` instead (for example `npm.cmd ci`). No policy change is needed.
