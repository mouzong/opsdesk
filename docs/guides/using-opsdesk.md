# Using OpsDesk

## Workspace selection (home)

The **logo and product name** at the top of the sidebar are one link ("Go to workspace selection") to `/`: a screen listing all workspaces with their number of groups and bookmarks and a "Last opened" marker. Opening it changes nothing; the selected workspace changes only when you open one. From here you can open, create, rename, reorder and delete workspaces.

| Route | Screen |
| --- | --- |
| `/` | Workspace selection |
| `/w/<id>` | A workspace (deep links and reload work; an unknown id shows "Workspace not found") |
| `/settings` | Settings, data, backups, import, About |
| `/docs/` | This documentation (served by the same server, not part of the UI router) |

Browser Back/Forward work between all of them.

## Workspaces, groups and bookmarks

A **workspace** (for example *Observability*) contains **groups** (*Elastic Stack*, *Metrics*) which contain **bookmark cards**.

Bookmark fields: title, URL (only `http://` and `https://`; internal host names, ports, paths and fragments are fine; embedded `user:password@` is rejected), description, environment (Production, Preproduction, Staging, Development, Lab, Other), service owner/team, icon (bundled), tags, pinned/favourite, plain-text note, creation and modification time.

| Task | How |
| --- | --- |
| Add | **Add bookmark** (top bar) or a group's `+` |
| Edit, duplicate, move, delete | Card `⋮` menu; deleting asks for confirmation |
| Reorder | Drag cards and group handles, **or** use *Move earlier/later* and *Move up/down* in the menus |
| Move between groups/workspaces | Card menu *Move to group...*, group menu *Move to workspace...* |
| Delete a non-empty group/workspace | Choose **move the contents elsewhere** or **delete them**; applied in one transaction |
| Pin | Star on the card; pinned bookmarks appear in **Pinned** above every workspace |
| Recently opened | Recorded when you open a link through the dashboard |
| Copy URL / open | Card buttons; links open with `noopener noreferrer` |
| Layout | Compact or comfortable (top bar or Settings); dark, light or system theme |

## Search and filters

- Type in the search bar (`/` focuses it). Matching is **case-insensitive** across **title, description, URL, tags and owner**; several words must all match.
- The **This workspace / All workspaces** switch decides the scope; the result heading repeats it.
- Filters: **Environment** (any selected), **Tags** (all selected), **Favorites**. Everything combines with AND.
- *Clear filters* and *Reset search* are always visible; empty results offer shortcuts.
- `Ctrl/Cmd+K` opens the **command palette**: jump to any bookmark across all workspaces, switch workspace, create items, toggle theme/layout.

## Keyboard

Arrow keys move between cards, `Esc` clears the search box, dialogs trap focus and restore it, focus rings are always visible, and animation respects `prefers-reduced-motion`.

## Release version and About

The current release is shown at the bottom of the sidebar (`OpsDesk · v1.2.0`; just `v1.2.0` when the sidebar is collapsed or on narrow screens) on every screen, and in **Settings > About** together with the build time and commit id **when the build recorded them**. See [Releases and versioning](../project/releases.md).
