# Joes Radial Macros Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2026-07-29

### Added
- Folder entries now show a leading hollow folder icon in their label, so folders read distinct from macros, most notably in Text Only mode where the icon graphic is hidden.
- New "Text Only - Buttons" button shape (the original Text Only is now "Text Only - Parchment"). Entries render as plain rounded boxes with a semi-transparent dark background and white text instead of the parchment banner; folder boxes use a hollow white folder glyph.

### Fixed
- Back / close hub button no longer sits hidden behind the name banners in a folder with only a couple of macros; the innermost banner now always clears the center hub.

## [1.1.0] - 2026-07-25

### Added
- Separate GM Macro Folder and Player Macro Folder settings (both world-scoped). GMs draw from the GM folder, non-GM players from the Player folder.
- Edge Margin setting (200-1000px). When the wheel opens within that distance of the left/right screen edge, entries render on the opposite side: icon rings collapse to a half-wheel facing away from the edge, and Text Only bows the other way.

### Changed
- Wheel entries now follow the folder's own sort mode: alphabetical folders sort by name, manual folders keep their drag order. Previously they always used the raw `sort` value, which ignored alphabetical sorting (most visible in Text Only mode).
- Text Only mode mirrors its banner column to the left of the cursor when opened near the right screen edge (see Edge Margin), so the list stays on screen.
- The wheel now clamps to the screen by its actual per-side content extent (with a small ~20px buffer and the hub always kept on screen) instead of a symmetric full-ring margin, so it no longer jumps far inward near an edge; the hub stays near the cursor while entries fan out on the open side.

## [1.0.0] - 2026-07-18

### Added
- Radial (wheel) macro menu opened at the cursor via middle-click or an optional keybinding.
- Macro source from a named Macro folder, with a fallback to the current hotbar page.
- Nested sub-folders open as sub-wheels; the center hub navigates back / closes.
- Per-folder icons stored as a folder flag, set via the Macro folder config.
- Button shapes: Circle, Square, Hexagon, and Text Only (name banners).
- Layout controls: ring radius, icon size, even-spread vs. packed (the gap always sits at the bottom).
- Left-click runs a macro; right-click opens its sheet.
- Targets FoundryVTT v13 / v14.
