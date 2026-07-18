/**
 * Radial Macros
 * A radial menu of macros shown at the cursor.
 *
 * Clean-room implementation from the public feature concept only.
 * No source, assets, or manifest from any protected module is used.
 *
 * Load order: this is the only esmodule. Everything hangs off the `init` and
 * `ready` hooks plus a module-level singleton `activeWheel`.
 */

const MODULE_ID = "joes-radial-macros";
const MAX_ENTRIES = 48; // safety cap; entries spill across concentric rings

// Routed so paths resolve under a Foundry route prefix (a bare relative path can 404).
function routed(path) {
	return foundry?.utils?.getRoute ? foundry.utils.getRoute(path) : path;
}

// Default when a folder has no icon flag (bundled module asset).
function defaultFolderIcon() {
	return routed(`modules/${MODULE_ID}/assets/folder.webp`);
}

// Default when a macro has no image (Foundry core's default macro icon).
function defaultMacroIcon() {
	return routed("icons/svg/dice-target.svg");
}

function defaultIconFor(type) {
	return type === "folder" ? defaultFolderIcon() : defaultMacroIcon();
}

/* ------------------------------------------------------------------ */
/*  Small helpers                                                       */
/* ------------------------------------------------------------------ */

function L(key, data) {
	return data ? game.i18n.format(`RADIALMACROS.${key}`, data) : game.i18n.localize(`RADIALMACROS.${key}`);
}

function getSetting(key) {
	return game.settings.get(MODULE_ID, key);
}

// v13/v14 namespaced FilePicker with a global fallback.
function getFilePicker() {
	return foundry?.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
}

/* ------------------------------------------------------------------ */
/*  Settings + keybinding                                              */
/* ------------------------------------------------------------------ */

Hooks.once("init", () => {
	game.settings.register(MODULE_ID, "folderName", {
		name: L("Settings.FolderName.Name"),
		hint: L("Settings.FolderName.Hint"),
		scope: "client",
		config: true,
		type: String,
		default: ""
	});

	game.settings.register(MODULE_ID, "buttonShape", {
		name: L("Settings.ButtonShape.Name"),
		hint: L("Settings.ButtonShape.Hint"),
		scope: "client",
		config: true,
		type: String,
		default: "circle",
		choices: {
			circle: L("Settings.ButtonShape.Circle"),
			square: L("Settings.ButtonShape.Square"),
			hex: L("Settings.ButtonShape.Hex"),
			text: L("Settings.ButtonShape.Text")
		}
	});

	game.settings.register(MODULE_ID, "activateOnMiddleClick", {
		name: L("Settings.MiddleClick.Name"),
		hint: L("Settings.MiddleClick.Hint"),
		scope: "client",
		config: true,
		type: Boolean,
		default: true
	});

	game.settings.register(MODULE_ID, "radius", {
		name: L("Settings.Radius.Name"),
		hint: L("Settings.Radius.Hint"),
		scope: "client",
		config: true,
		type: Number,
		default: 110,
		range: { min: 70, max: 220, step: 5 }
	});

	game.settings.register(MODULE_ID, "buttonSize", {
		name: L("Settings.ButtonSize.Name"),
		hint: L("Settings.ButtonSize.Hint"),
		scope: "client",
		config: true,
		type: Number,
		default: 56,
		range: { min: 32, max: 96, step: 2 }
	});

	game.settings.register(MODULE_ID, "spreadEvenly", {
		name: L("Settings.SpreadEvenly.Name"),
		hint: L("Settings.SpreadEvenly.Hint"),
		scope: "client",
		config: true,
		type: Boolean,
		default: true
	});
	
	// Optional keyboard path, no default key. onDown toggles the wheel at the cursor.
	game.keybindings.register(MODULE_ID, "openWheel", {
		name: L("Keybindings.OpenWheel.Name"),
		hint: L("Keybindings.OpenWheel.Hint"),
		editable: [],
		onDown: () => {
			toggleWheelAtCursor();
			return true;
		},
		precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL
	});
});

/* ------------------------------------------------------------------ */
/*  Activation: middle-click on the canvas                            */
/* ------------------------------------------------------------------ */

// Track the last pointer position so the keybind can open at the cursor.
let lastPointer = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
window.addEventListener("pointermove", (ev) => {
	lastPointer = { x: ev.clientX, y: ev.clientY };
}, { passive: true });

Hooks.once("ready", () => {
	// Listen on the document so we can gate to canvas clicks and suppress autoscroll.
	window.addEventListener("pointerdown", onGlobalPointerDown, true);
	// Middle-click on many browsers starts autoscroll on mousedown; suppress it on the board.
	window.addEventListener("mousedown", (ev) => {
		if (ev.button === 1 && isCanvasTarget(ev.target) && getSetting("activateOnMiddleClick")) ev.preventDefault();
	}, true);
	// Suppress the paste-on-middle-click auxclick as well.
	window.addEventListener("auxclick", (ev) => {
		if (ev.button === 1 && isCanvasTarget(ev.target) && getSetting("activateOnMiddleClick")) ev.preventDefault();
	}, true);
});

// True when the event landed on the game canvas rather than a UI panel.
function isCanvasTarget(target) {
	if (!target) return false;
	if (target.id === "board") return true;
	return !!(target.closest && target.closest("#board"));
}

function onGlobalPointerDown(ev) {
	// If a wheel is open, any click outside it dismisses.
	if (ev.button !== 1) return;
	if (!getSetting("activateOnMiddleClick")) return;
	if (!isCanvasTarget(ev.target)) return;
	ev.preventDefault();
	ev.stopPropagation();
	lastPointer = { x: ev.clientX, y: ev.clientY };
	toggleWheelAtCursor();
}

function toggleWheelAtCursor() {
	if (activeWheel) {
		activeWheel.close();
		return;
	}
	openWheel(lastPointer.x, lastPointer.y);
}

/* ------------------------------------------------------------------ */
/*  Macro source resolution                                           */
/* ------------------------------------------------------------------ */

/**
 * Resolve the entries to show for a given folder (or the top level when null).
 * Returns an array of { type:"folder"|"macro", ...display }.
 */
function getEntries(folder) {
	let entries = [];

	if (!folder) {
		const name = (getSetting("folderName") ?? "").trim();
		if (!name) {
			return getHotbarEntries();
		}
		folder = game.folders.find((f) => f.type === "Macro" && f.name === name);
		if (!folder) {
			ui.notifications.warn(L("FolderNotFound", { name }));
			return [];
		}
	}

	// Sub-folders first.
	const subFolders = (folder.children ?? []).map((c) => c.folder ?? c).filter((f) => f);
	for (const sub of subFolders) {
		entries.push({
			type: "folder",
			id: sub.id,
			folder: sub,
			name: sub.name,
			img: sub.getFlag(MODULE_ID, "icon") || defaultFolderIcon()
		});
	}

	// Then macros the user can execute.
	const macros = (folder.contents ?? []).filter((m) => m?.canUserExecute?.(game.user) ?? m?.canExecute ?? true);
	for (const macro of macros) {
		entries.push({
			type: "macro",
			id: macro.id,
			macro,
			name: macro.name,
			img: macro.img
		});
	}

	// Folders keep their child order, macros keep theirs; both already added in sort order.
	entries.sort((a, b) => {
		if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
		const sa = a.type === "folder" ? (a.folder.sort ?? 0) : (a.macro.sort ?? 0);
		const sb = b.type === "folder" ? (b.folder.sort ?? 0) : (b.macro.sort ?? 0);
		return sa - sb;
	});

	return entries.slice(0, MAX_ENTRIES);
}

// Macros on the current hotbar page (used when no folder name is set).
function getHotbarEntries() {
	const page = ui.hotbar?.page ?? 1;
	const slots = game.user.getHotbarMacros?.(page) ?? [];
	const entries = [];
	for (const slot of slots) {
		const macro = slot?.macro;
		if (!macro) continue;
		if (macro.canUserExecute && !macro.canUserExecute(game.user)) continue;
		entries.push({ type: "macro", id: macro.id, macro, name: macro.name, img: macro.img });
	}
	return entries.slice(0, MAX_ENTRIES);
}

/* ------------------------------------------------------------------ */
/*  The wheel                                                          */
/* ------------------------------------------------------------------ */

let activeWheel = null;

class RadialWheel {
	constructor(x, y) {
		this.originX = x;
		this.originY = y;
		this.navStack = []; // stack of folders; empty = top level
		this.radius = getSetting("radius");
		this.shape = getSetting("buttonShape");
		this.buttonSize = getSetting("buttonSize");
		this.root = null;
		this._onKeyDown = this._onKeyDown.bind(this);
		this._onOutsidePointer = this._onOutsidePointer.bind(this);
	}

	get currentFolder() {
		return this.navStack.length ? this.navStack[this.navStack.length - 1] : null;
	}

	open() {
		this.root = document.createElement("div");
		this.root.className = `radial-macros shape-${this.shape}`;
		this.root.style.setProperty("--rm-radius", `${this.radius}px`);
		this.root.style.setProperty("--rm-btn", `${this.buttonSize}px`);
		const mount = document.getElementById("interface") ?? document.body;
		mount.appendChild(this.root);
		this.render();

		document.addEventListener("keydown", this._onKeyDown, true);
		// Delay outside-pointer binding so the opening click does not immediately dismiss.
		setTimeout(() => document.addEventListener("pointerdown", this._onOutsidePointer, true), 0);
	}

	close() {
		if (!this.root) return;
		document.removeEventListener("keydown", this._onKeyDown, true);
		document.removeEventListener("pointerdown", this._onOutsidePointer, true);
		this.root.classList.add("rm-closing");
		const el = this.root;
		this.root = null;
		setTimeout(() => el.remove(), 120);
		if (activeWheel === this) activeWheel = null;
	}

	// Measure a text-only banner's rendered width (text + horizontal padding, capped
	// at the label max-width) so text mode can space by real width, not icon size.
	measureBanner(text) {
		const ctx = (RadialWheel._measureCtx ??= document.createElement("canvas").getContext("2d"));
		const ff = getComputedStyle(document.body).fontFamily || "sans-serif";
		ctx.font = `600 16px ${ff}`; // matches .rm-label (1rem, weight 600)
		return Math.min(ctx.measureText(text).width + 48, 220); // +padding, cap at max-width
	}

	// Text-only layout: banners are wide, so instead of a full ring they run down the
	// right-side arc. Banners are spaced by a fixed vertical step >= their height so 
	// consecutive ones never overlap. The horizontal offset is a parabolic bow whose 
	// depth is capped by the Ring Radius setting, so adding more macros grows the 
	// column downward but NOT farther from the center. (spreadEvenly is not used here.)
	layoutText(entries) {
		const n = entries.length;
		const widths = entries.map((e) => this.measureBanner(e.name));
		const maxW = Math.max(...widths, 0);
		const rowH = 44; // vertical step: at least one banner height so no vertical overlap
		const yMax = ((n - 1) / 2) * rowH; // column is centered vertically on the hub
		const bow = this.radius; // max horizontal distance of the bulge (bounded, count-independent)
		const xBase = 40; // keep the middle banners clear of the center hub

		const positions = [];
		for (let i = 0; i < n; i++) {
			const y = -yMax + i * rowH; // top -> bottom
			const t = yMax > 0 ? y / yMax : 0; // -1..1 along the column
			const x = xBase + bow * (1 - t * t); // parabola: farthest right at the middle
			positions.push({ entry: entries[i], x, y });
		}
		// Clamp margin must cover the rightmost banner edge and the vertical extent.
		const outerRadius = Math.max(xBase + bow + maxW / 2, yMax + rowH);
		return { positions, outerRadius };
	}

	// Distribute entries across one or more concentric rings so buttons never crowd.
	// Fills the innermost ring to capacity, then spills outward.
	layout(entries) {
		if (this.shape === "text") return this.layoutText(entries);

		const BTN = this.buttonSize; // matches the --rm-btn CSS var set on the root
		const GAP = 12; // minimum gap between adjacent buttons
		const minSpacing = BTN + GAP; // required center-to-center distance
		const ringStep = BTN + GAP; // radial distance between rings

		// How many buttons fit on a ring of the given radius without overlapping.
		const ringCapacity = (r) => {
			const ratio = minSpacing / (2 * r);
			if (ratio >= 1) return 1;
			return Math.max(1, Math.floor(Math.PI / Math.asin(ratio)));
		};

		const spread = getSetting("spreadEvenly");

		const positions = [];
		let idx = 0;
		let ring = 0;
		let outerRadius = this.radius;
		while (idx < entries.length) {
			const r = this.radius + ring * ringStep;
			outerRadius = r;
			// In spread mode one slot is the bottom gap, so a ring holds one fewer icon.
			const cap = ringCapacity(r);
			const usable = spread ? Math.max(1, cap - 1) : cap;
			const count = Math.min(entries.length - idx, usable);

			// Spread: even gaps, symmetric about the top, with one slot left empty
			//   centered at the bottom (so the gap is always at the bottom).
			// Packed: fixed adjacent spacing, the group centered on the top so any
			//   leftover gap sits at the bottom (a horseshoe opening downward).
			const packedStep = (2 * Math.asin(minSpacing / (2 * r))) * (180 / Math.PI);
			const spreadStep = 360 / (count + 1); // +1 reserves the bottom gap slot

			for (let i = 0; i < count; i++) {
				// Top is -90deg. Spread skips the bottom slot; packed fans out from center.
				const deg = spread
					? 90 + (i + 1) * spreadStep
					: -90 + (i - (count - 1) / 2) * packedStep;
				const angle = deg * (Math.PI / 180);
				positions.push({
					entry: entries[idx++],
					x: Math.cos(angle) * r,
					y: Math.sin(angle) * r
				});
			}
			ring++;
		}
		return { positions, outerRadius };
	}

	render() {
		const entries = getEntries(this.currentFolder);
		this.root.replaceChildren();

		const { positions, outerRadius } = this.layout(entries);

		// Clamp the ring center to the viewport so the full (outer) ring stays visible.
		const margin = outerRadius + 44;
		const cx = Math.min(Math.max(this.originX, margin), window.innerWidth - margin);
		const cy = Math.min(Math.max(this.originY, margin), window.innerHeight - margin);
		this.root.style.left = `${cx}px`;
		this.root.style.top = `${cy}px`;

		// Center hub: dismiss dot at top level, back arrow inside a sub-wheel.
		const hub = document.createElement("button");
		hub.type = "button";
		hub.className = "rm-hub" + (this.navStack.length ? " rm-hub-back" : "");
		hub.title = this.navStack.length ? L("Back") : L("Close");
		hub.innerHTML = this.navStack.length
			? '<i class="fas fa-arrow-left"></i>'
			: '<i class="fas fa-xmark"></i>';
		hub.addEventListener("click", (ev) => {
			ev.stopPropagation();
			if (this.navStack.length) {
				this.navStack.pop();
				this.render();
			} else {
				this.close();
			}
		});
		this.root.appendChild(hub);

		if (!entries.length) {
			const empty = document.createElement("div");
			empty.className = "rm-empty";
			empty.textContent = L("Empty");
			this.root.appendChild(empty);
			return;
		}

		positions.forEach(({ entry, x, y }) => {
			const btn = document.createElement("button");
			btn.type = "button";
			btn.className = `rm-button rm-${entry.type}`;
			btn.style.setProperty("--rm-x", `${x}px`);
			btn.style.setProperty("--rm-y", `${y}px`);
			btn.title = entry.name;

			// Inner wrapper carries the shape/clip so the label (a sibling) is never clipped.
			const shape = document.createElement("div");
			shape.className = "rm-shape";

			const img = document.createElement("img");
			img.className = "rm-img";
			const fallbackIcon = defaultIconFor(entry.type);
			img.src = entry.img || fallbackIcon;
			img.alt = entry.name;
			// Fall back to the type default if the image is missing/broken.
			img.addEventListener("error", () => {
				if (!img.src.endsWith(fallbackIcon)) img.src = fallbackIcon;
			});
			shape.appendChild(img);
			btn.appendChild(shape);

			const label = document.createElement("span");
			label.className = "rm-label";
			label.textContent = entry.name;
			btn.appendChild(label);

			btn.addEventListener("click", (ev) => {
				ev.stopPropagation();
				this._onEntryClick(entry);
			});
			// Right-click a macro opens its sheet without dismissing.
			if (entry.type === "macro") {
				btn.addEventListener("contextmenu", (ev) => {
					ev.preventDefault();
					ev.stopPropagation();
					entry.macro.sheet?.render(true);
				});
			}

			this.root.appendChild(btn);
		});
	}

	_onEntryClick(entry) {
		if (entry.type === "folder") {
			this.navStack.push(entry.folder);
			this.render();
			return;
		}
		const macro = game.macros.get(entry.id) ?? entry.macro;
		this.close();
		macro?.execute();
	}

	_onKeyDown(ev) {
		if (ev.key === "Escape") {
			ev.preventDefault();
			ev.stopPropagation();
			this.close();
		}
	}

	_onOutsidePointer(ev) {
		if (!this.root) return;
		if (this.root.contains(ev.target)) return;
		this.close();
	}
}

function openWheel(x, y) {
	if (activeWheel) activeWheel.close();
	activeWheel = new RadialWheel(x, y);
	activeWheel.open();
}

/* ------------------------------------------------------------------ */
/*  Folder config: image picker for Macro folders                     */
/* ------------------------------------------------------------------ */

Hooks.on("renderFolderConfig", (app, element) => {
	const folder = app.document;
	if (!folder || folder.type !== "Macro") return;

	// v13/v14 render hook passes an HTMLElement; guard for a jQuery-wrapped value too.
	const html = element instanceof HTMLElement ? element : element?.[0];
	if (!html) return;

	// Avoid double-injection on re-render.
	if (html.querySelector(".radial-macros-icon-field")) return;

	const current = folder.getFlag(MODULE_ID, "icon") ?? "";

	const group = document.createElement("div");
	group.className = "form-group radial-macros-icon-field";
	group.innerHTML = `
		<label>${L("FolderIcon.Label")}</label>
		<div class="form-fields">
			<button type="button" class="rm-file-picker" data-tooltip="${L("FolderIcon.Pick")}">
				<i class="fas fa-file-import"></i>
			</button>
			<input type="text" name="flags.${MODULE_ID}.icon" value="${foundry.utils.escapeHTML?.(current) ?? current}" placeholder="${defaultFolderIcon()}">
		</div>
		<p class="hint">${L("FolderIcon.Hint")}</p>
	`;

	const footer = html.querySelector("footer") ?? html.querySelector(".form-footer");
	if (footer) footer.parentElement.insertBefore(group, footer);
	else html.querySelector("form")?.appendChild(group) ?? html.appendChild(group);

	const input = group.querySelector("input");
	const saveIcon = (value) => {
		const v = (value ?? "").trim();
		if (v) folder.setFlag(MODULE_ID, "icon", v);
		else folder.unsetFlag(MODULE_ID, "icon");
	};

	input.addEventListener("change", () => saveIcon(input.value));

	group.querySelector(".rm-file-picker").addEventListener("click", () => {
		const FP = getFilePicker();
		new FP({
			type: "image",
			current: input.value || defaultFolderIcon(),
			callback: (path) => {
				input.value = path;
				saveIcon(path);
			}
		}).browse();
	});
});
