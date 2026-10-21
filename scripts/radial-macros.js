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

/* ==========================================================================
	Small helpers
========================================================================== */

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

/* ==========================================================================
	Settings + keybinding
========================================================================== */

Hooks.once("init", () => {
	game.settings.register(MODULE_ID, "folderName", {
		name: L("Settings.GMFolderName.Name"),
		hint: L("Settings.GMFolderName.Hint"),
		scope: "world",
		config: true,
		type: String,
		default: ""
	});

	game.settings.register(MODULE_ID, "playerFolderName", {
		name: L("Settings.PlayerFolderName.Name"),
		hint: L("Settings.PlayerFolderName.Hint"),
		scope: "world",
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
			text: L("Settings.ButtonShape.Text"),
			textbtn: L("Settings.ButtonShape.TextButtons")
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

	game.settings.register(MODULE_ID, "edgeMargin", {
		name: L("Settings.EdgeMargin.Name"),
		hint: L("Settings.EdgeMargin.Hint"),
		scope: "client",
		config: true,
		type: Number,
		default: 200,
		range: { min: 200, max: 1000, step: 10 }
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

/* ==========================================================================
	Activation: middle-click on the canvas
========================================================================== */

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

/* ==========================================================================
	Macro source resolution
========================================================================== */

//	Resolve the entries to show for a given folder (or the top level when null).
// 	Returns an array of { type:"folder"|"macro", ...display }.
// Resolve a GM/Player folder setting that is either a Macro folder name or a Folder UUID,
// world ("Folder.<id>") or compendium ("Compendium.<pkg>.<pack>.Folder.<id>").
async function resolveFolderSetting(value) {
	if (/^(Compendium\.|Folder\.)/.test(value)) {
		let doc = null;
		try { doc = await fromUuid(value); } catch (_) { doc = null; }
		if (doc?.documentName !== "Folder") {
			ui.notifications.warn(L("FolderNotFound", { name: value }));
			return null;
		}
		return doc;
	}
	const folder = game.folders.find((f) => f.type === "Macro" && f.name === value);
	if (!folder) ui.notifications.warn(L("FolderNotFound", { name: value }));
	return folder ?? null;
}

async function getEntries(folder) {
	let entries = [];

	if (!folder) {
		// GMs use the GM Macro Folder; everyone else uses the Player Macro Folder.
		const key = game.user.isGM ? "folderName" : "playerFolderName";
		const value = (getSetting(key) ?? "").trim();
		if (!value) return getHotbarEntries();
		folder = await resolveFolderSetting(value);
		if (!folder) return [];
	}

	// Compendium folders expose index entries (plain objects), world folders live documents.
	const pack = folder.compendium ?? null;

	// Sub-folders first.
	const subFolders = (folder.children ?? []).map((c) => c.folder ?? c).filter((f) => f);
	for (const sub of subFolders) {
		entries.push({
			type: "folder",
			id: sub.id,
			folder: sub,
			name: sub.name,
			sort: sub.sort ?? 0,
			// Folder docs keep their icon flag in a compendium too, so read it either way.
			img: sub.getFlag?.(MODULE_ID, "icon") || defaultFolderIcon()
		});
	}

	// Then macros. Compendium entries carry a UUID to load on click; world entries the live doc.
	if (pack) {
		// Only a Macro pack yields runnable entries; other pack types contribute folders only.
		if (pack.documentName === "Macro") {
			// img is not a default index field in every build; request it so icons resolve.
			try { await pack.getIndex({ fields: ["img", "sort"] }); } catch (_) {}
			for (const idx of folder.contents ?? []) {
				entries.push({
					type: "macro",
					id: idx._id,
					uuid: `${pack.collection}.Macro.${idx._id}`,
					name: idx.name,
					sort: idx.sort ?? 0,
					img: idx.img
				});
			}
		}
	} else {
		const macros = (folder.contents ?? []).filter((m) => m?.canUserExecute?.(game.user) ?? m?.canExecute ?? true);
		for (const macro of macros) {
			entries.push({
				type: "macro",
				id: macro.id,
				macro,
				name: macro.name,
				sort: macro.sort ?? 0,
				img: macro.img
			});
		}
	}

	// Folders first, then macros; within each, folder's sort mode ("a" = alpha, else manual `sort`)
	const alpha = folder.sorting === "a";
	entries.sort((a, b) => {
		if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
		if (alpha) return a.name.localeCompare(b.name, undefined, { numeric: true });
		return (a.sort ?? 0) - (b.sort ?? 0);
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

/* ==========================================================================
	The wheel
========================================================================== */

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

	// Text-only layout
	layoutText(entries) {
		const n = entries.length;
		// Folder banners carry a leading icon the canvas measure can't see; pad for it.
		const widths = entries.map((e) => this.measureBanner(e.name) + (e.type === "folder" ? 22 : 0));
		const maxW = Math.max(...widths, 0);
		const rowH = this.shape === "textbtn" ? 54 : 44; // vertical step: banner height (+5px gap for boxes)
		const yMax = ((n - 1) / 2) * rowH; // column is centered vertically on the hub
		const bow = this.radius; // max horizontal distance of the bulge (bounded, count-independent)
		const HUB = 22; // hub radius; every banner must clear it horizontally
		const xBase = maxW / 2 + HUB + 12; // innermost banner's left edge clears the hub, any count

		// Bow right of the hub, but flip to the left when the cursor is near the right
		// edge (within the Edge Margin setting) so the column has room on screen.
		const edge = getSetting("edgeMargin");
		const side = (window.innerWidth - this.originX) <= edge ? -1 : 1;

		const positions = [];
		const bounds = { left: 0, right: 0, top: 0, bottom: 0 };
		for (let i = 0; i < n; i++) {
			const y = -yMax + i * rowH; // top -> bottom
			const t = yMax > 0 ? y / yMax : 0; // -1..1 along the column
			const x = side * (xBase + bow * (1 - t * t)); // parabola: farthest out at the middle
			positions.push({ entry: entries[i], x, y });
			const hw = widths[i] / 2, hh = rowH / 2;
			bounds.left = Math.max(bounds.left, -(x - hw));
			bounds.right = Math.max(bounds.right, x + hw);
			bounds.top = Math.max(bounds.top, -(y - hh));
			bounds.bottom = Math.max(bounds.bottom, y + hh);
		}
		// Clamp margin must cover the rightmost banner edge and the vertical extent.
		const outerRadius = Math.max(xBase + bow + maxW / 2, yMax + rowH);
		return { positions, outerRadius, bounds };
	}

	// Distribute entries across one or more concentric rings so buttons never crowd.
	// Fills the innermost ring to capacity, then spills outward.
	layout(entries) {
		if (this.shape === "text" || this.shape === "textbtn") return this.layoutText(entries);

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

		// Near one screen edge, collapse to the semicircle facing away from it (both edges = stay full)
		const edge = getSetting("edgeMargin");
		const nearRight = (window.innerWidth - this.originX) <= edge;
		const nearLeft = this.originX <= edge;
		const half = (nearRight ? 1 : 0) + (nearLeft ? 1 : 0) === 1;
		const arcCenter = half ? (nearRight ? 180 : 0) : -90;
		const arcSpan = half ? 180 : 360;

		const positions = [];
		const bhalf = BTN / 2;
		const bounds = { left: bhalf, right: bhalf, top: bhalf, bottom: bhalf };
		let idx = 0;
		let ring = 0;
		let outerRadius = this.radius;
		while (idx < entries.length) {
			const r = this.radius + ring * ringStep;
			outerRadius = r;
			const packedStep = (2 * Math.asin(Math.min(1, minSpacing / (2 * r)))) * (180 / Math.PI);

			// How many buttons fit on this ring's arc.
			let usable;
			if (half) {
				usable = Math.max(1, Math.floor(arcSpan / packedStep) + 1);
			} else {
				// In spread mode one slot is the bottom gap, so a ring holds one fewer icon.
				const cap = ringCapacity(r);
				usable = spread ? Math.max(1, cap - 1) : cap;
			}
			const count = Math.min(entries.length - idx, usable);

			const spreadStep = 360 / (count + 1); // +1 reserves the bottom gap slot (full ring)
			const halfStep = arcSpan / (count + 1); // even fan across the arc, gaps at both ends

			for (let i = 0; i < count; i++) {
				// Half wheel: fan across the arc (spread = even, packed = tight from center).
				// Full wheel: top is -90deg; spread skips the bottom slot, packed fans from center.
				let deg;
				if (half) {
					deg = spread
						? arcCenter - arcSpan / 2 + (i + 1) * halfStep
						: arcCenter + (i - (count - 1) / 2) * packedStep;
				} else {
					deg = spread
						? 90 + (i + 1) * spreadStep
						: -90 + (i - (count - 1) / 2) * packedStep;
				}
				const angle = deg * (Math.PI / 180);
				const x = Math.cos(angle) * r;
				const y = Math.sin(angle) * r;
				positions.push({ entry: entries[idx++], x, y });
				bounds.left = Math.max(bounds.left, -x + bhalf);
				bounds.right = Math.max(bounds.right, x + bhalf);
				bounds.top = Math.max(bounds.top, -y + bhalf);
				bounds.bottom = Math.max(bounds.bottom, y + bhalf);
			}
			ring++;
		}
		return { positions, outerRadius, bounds };
	}

	async render() {
		const entries = await getEntries(this.currentFolder);
		if (!this.root) return; // wheel closed while entries were loading
		this.root.replaceChildren();

		const { positions, outerRadius, bounds } = this.layout(entries);

		// Clamp the hub on screen by per-side content extent, not full ring radius
		const BUFFER = 20; // gap kept between content and the screen edge
		const HUB = 22; // hub is 44px; never let it be clipped even if content is one-sided
		const b = bounds ?? { left: outerRadius, right: outerRadius, top: outerRadius, bottom: outerRadius };
		const loX = Math.max(b.left, HUB) + BUFFER, hiX = window.innerWidth - Math.max(b.right, HUB) - BUFFER;
		const loY = Math.max(b.top, HUB) + BUFFER, hiY = window.innerHeight - Math.max(b.bottom, HUB) - BUFFER;
		const cx = Math.min(Math.max(this.originX, loX), Math.max(loX, hiX));
		const cy = Math.min(Math.max(this.originY, loY), Math.max(loY, hiY));
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
			if (entry.type === "folder") {
				const esc = foundry.utils.escapeHTML?.(entry.name) ?? entry.name;
				label.innerHTML = `<i class="fas fa-folder"></i>${esc}`;
			} else {
				label.textContent = entry.name;
			}
			btn.appendChild(label);

			btn.addEventListener("click", (ev) => {
				ev.stopPropagation();
				this._onEntryClick(entry);
			});
			// Right-click a macro opens its sheet without dismissing.
			if (entry.type === "macro") {
				btn.addEventListener("contextmenu", async (ev) => {
					ev.preventDefault();
					ev.stopPropagation();
					const macro = entry.macro ?? (entry.uuid ? await fromUuid(entry.uuid).catch(() => null) : null);
					macro?.sheet?.render(true);
				});
			}

			this.root.appendChild(btn);
		});
	}

	async _onEntryClick(entry) {
		if (entry.type === "folder") {
			this.navStack.push(entry.folder);
			this.render();
			return;
		}
		// World macros are live; compendium macros load from their UUID on demand.
		let macro = game.macros.get(entry.id) ?? entry.macro;
		if (!macro && entry.uuid) macro = await fromUuid(entry.uuid).catch(() => null);
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

/* ==========================================================================
	Folder config: image picker for Macro folders
========================================================================== */

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
