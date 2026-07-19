# Joe's Radial Macros

A FoundryVTT module that pops up a radial (wheel) menu of your macros at the cursor. Middle-click the canvas to open the wheel, then click a button to run a macro or open a sub-folder's sub-wheel.

Targets FoundryVTT **v13 / v14**. Plain ES module, no dependencies.

## Features

- **Open at the cursor** - middle-click the canvas (toggleable) or bind an optional keybinding.
- **Source your macros** from a named Macro folder, or fall back to the current hotbar page when no folder is set.
- **Nested folders** render as folder buttons; click one to open its sub-wheel. The center hub goes back (or closes at the top level).
- **Per-folder icons** - set an image on any Macro folder (via the folder config) to use as its wheel button.
- **Button shapes** - Circle, Square, Hexagon, or **Text Only** (name banners instead of icons).
- **Layout controls** - ring radius, icon size, and even-spread vs. packed arrangement (the gap always sits at the bottom).
- Left-click runs a macro; right-click opens its sheet.

## Usage

1. Enable the module in your world.
2. (Optional) Create a Macro folder, e.g. `Wheel`, and put your macros in it. Sub-folders become sub-wheels.
3. Open **Settings -> Configure Settings -> Joes Radial Macros** and set **Macro Folder** to that folder's name (leave blank to use the current hotbar page).
4. Middle-click the canvas to open the wheel.

## Settings

| Setting | Description |
|---|---|
| Macro Folder | Name of the Macro folder to show. Blank = current hotbar page. |
| Open on Middle-Click | Middle-click the canvas to open the wheel. |
| Ring Radius | Distance from the center to the buttons (also controls the Text Only curve depth). |
| Icon Size | Diameter of each wheel button. |
| Spread Icons Evenly | On: even gaps around each ring. Off: packed, centered on the top (horseshoe). |
| Button Shape | Circle / Square / Hexagon / Text Only. |

A keybinding (**Open Radial Macros**) is available but unbound by default.

## Installation

Manifest URL:

```
https://github.com/thejoester/joes-radial-macros/releases/latest/download/module.json
```

## License

[MIT](LICENSE)
