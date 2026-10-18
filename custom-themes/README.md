# Custom themes

Ready-made community themes for Artemis. Each `.json` file in this folder is one theme. No rebuild is needed to use them.

| File | Theme | Group |
| --- | --- | --- |
| `artemis.json` | Artemis | Comunity |
| `evangelion.json` | Evangelion | Anime |
| `hermes.json` | Hermes Blue | comunity |

## Install a theme

1. Open **Settings → Appearance**.
2. Under **Custom themes**, press **Import .json** and pick a file from this folder. (Or press **Open folder** and copy the file there yourself.)
3. Press **Refresh**. The theme appears in the grid under its group. Click it to apply.

Themes apply to the main window, the Quick window and the Sentinel widget.

## Where themes are loaded from

Later sources win when two themes share the same `id`:

1. Built-in themes (`electron/themes`)
2. Your user themes folder (`<userData>/themes`)
3. The open project's `.artemis/themes` folder, so a project can carry its own look

## Make your own

Copy one of these files, change the `id` and `name`, and edit the colors.

```json
{
  "id": "my-theme",
  "name": "My theme",
  "group": "My themes",
  "dark": true,
  "preview": ["#1a1a2e", "#FFBF00", "#4dd0e1"],
  "vars": {
    "--theme-bg": "#1a1a2e",
    "--theme-side": "#161625",
    "--theme-panel": "#1f1f35",
    "--theme-user": "#272740",
    "--theme-code": "#161625",
    "--theme-border": "#CD7F32",
    "--theme-text": "#FFF8DC",
    "--theme-muted": "#9CA3AF",
    "--theme-accent": "#FFBF00",
    "--theme-accent-text": "#1a1a2e",
    "--theme-hover": "rgba(255,191,0,.10)",
    "--theme-active": "rgba(255,191,0,.18)",
    "--theme-add": "rgba(76,208,225,.18)",
    "--theme-del": "rgba(239,83,80,.18)"
  }
}
```

| Field | Meaning |
| --- | --- |
| `id` | Unique name: lowercase letters, digits and dashes. `system` is reserved; reusing a built-in id such as `dark` replaces that theme. |
| `name` | Label shown in Settings. |
| `group` | Section in the theme grid. Defaults to "My themes". |
| `dark` | `true` for a dark theme (default), `false` for light. |
| `preview` | Three colors for the swatch: background, accent, panel. Optional. |
| `vars` | The CSS variables the theme sets (see below). |

### Variables

| Variable | Used for |
| --- | --- |
| `--theme-bg` | Main background |
| `--theme-side` | Sidebar |
| `--theme-panel` | Cards, panels and menus |
| `--theme-user` | Your message bubbles |
| `--theme-code` | Code blocks |
| `--theme-border` | Borders and dividers |
| `--theme-text` | Main text |
| `--theme-muted` | Secondary text |
| `--theme-accent` | Buttons and highlights |
| `--theme-accent-text` | Text on accent-colored buttons |
| `--theme-hover`, `--theme-active` | Hover and selected backgrounds |
| `--theme-add`, `--theme-del` | Added and removed lines in diffs |

Optional: `--theme-danger`, `--theme-ok` and `--theme-warn` (see `electron/themes/dark.json`). Variables you leave out fall back to the light defaults, so copy a full file to be safe. Invalid files are skipped.

## Share yours

Pull requests with new themes are welcome: add one `.json` file here and a row to the table above. See [CONTRIBUTING.md](../CONTRIBUTING.md).

See also the wiki page [Appearance](../docs/wiki/Appearance.md).
