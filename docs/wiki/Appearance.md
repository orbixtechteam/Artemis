# Appearance

**Settings → Appearance** sets the color theme, the text size and how the model's reasoning is shown. You can add your own themes as small JSON files without rebuilding the app.

## How to use

1. Open **Settings → Appearance**.
2. Under **Theme**, click a swatch. **System** follows your operating system's light or dark mode; **Light** and **Dark** are built in.
3. Under **Text**, pick a **Text size**: Small (13px), Medium (14px) or Large (16px). It applies across the whole app.
4. Pick how **Thinking** shows in replies: **Collapsed** (a "Thought for Ns" block you can open), **Expanded** or **Hidden**.

### Add a custom theme

1. Under **Custom themes**, press **Open folder** to open your themes folder.
2. Drop a theme `.json` file there (or press **Import .json** to copy files in).
3. Press **Refresh**. The new theme appears in the grid. No rebuild is needed.

A theme file looks like this:

```json
{
  "id": "my-theme",
  "name": "My theme",
  "group": "Gods",
  "dark": true,
  "preview": ["#130808", "#c9923a", "#8c1c1c"],
  "vars": { "--theme-bg": "#130808" }
}
```

`preview` gives the three swatch colors; `vars` sets the CSS variables the theme overrides. Use the built-in `electron/themes/dark.json` and `light.json` as a reference for the available variables.

## Settings

| Setting | Where | What it does |
| --- | --- | --- |
| Theme | Appearance → Theme | The color theme for the main window, the Quick window and the Sentinel widget. |
| Custom themes | Appearance → Theme | **Refresh**, **Open folder** and **Import .json** for your own themes. |
| Text size | Appearance → Text | Small, Medium or Large. |
| Thinking | Appearance → Text | Collapsed, Expanded or Hidden reasoning blocks. |

## Tips

- Themes load in this order, and a later one with the same `id` wins: built-in (`electron/themes`), your user themes folder, then the project's `.artemis/themes` folder. A project can carry its own themes.
- When a project with a folder is open, **Open folder** and **Import .json** use the project's themes folder.
- An MCP client can switch the theme with `artemis_set_theme` (see [MCP](MCP.md)).

## Limits and safety

- Thinking is never sent back to the model or read aloud, whatever you pick here.

## See also

- [Custom themes folder](../../custom-themes/README.md): ready-made themes and the full variable list
- [MCP](MCP.md)
- [Quick Window and Shortcuts](Quick-Window-and-Shortcuts.md)
- [Getting Started](Getting-Started.md)
