export interface ViewState {
	scale: number;
	tx: number;
	ty: number;
}

const MIN_SCALE = 0.1;
const MAX_SCALE = 4;
/** Movement in px before a press becomes a drag (so taps still open links). */
const DRAG_THRESHOLD = 5;

/**
 * Pan and zoom for an SVG <g>. Mouse drag and one-finger drag pan; pinch and
 * Ctrl/Cmd + wheel zoom. Plain wheel is left alone so the note still scrolls.
 */
export class PanZoom {
	state: ViewState = { scale: 1, tx: 0, ty: 0 };
	/** True once the user has moved the view, so live refreshes keep their position. */
	touched = false;

	private pointers = new Map<number, { x: number; y: number }>();
	private dragStart: { x: number; y: number; state: ViewState } | null = null;
	private pinchStart: { dist: number; mid: { x: number; y: number }; state: ViewState } | null = null;
	private dragging = false;
	private suppressClick = false;
	private cleanups: (() => void)[] = [];
	private resizeObserver: ResizeObserver | null = null;
	private fitted = false;

	constructor(
		private viewport: HTMLElement,
		private stage: SVGGElement,
		private content: { width: number; height: number },
	) {
		this.listen(viewport, "pointerdown", this.onPointerDown);
		this.listen(viewport, "pointermove", this.onPointerMove);
		this.listen(viewport, "pointerup", this.onPointerUp);
		this.listen(viewport, "pointercancel", this.onPointerUp);
		this.listen(viewport, "wheel", this.onWheel, { passive: false });
		// Swallow the click that ends a drag, before it reaches a name link.
		this.listen(viewport, "click", this.onClickCapture, { capture: true });
		// Keep touches inside the view away from Obsidian mobile's sidebar swipe gestures.
		const stop = (e: Event) => e.stopPropagation();
		this.listen(viewport, "touchstart", stop, { passive: true });
		this.listen(viewport, "touchmove", stop, { passive: true });

		// Fit once the view has a size (code blocks are often rendered detached).
		this.resizeObserver = new ResizeObserver(() => {
			if (!this.viewport.clientWidth || !this.viewport.clientHeight) return;
			if (!this.fitted || !this.touched) this.fit();
		});
		this.resizeObserver.observe(viewport);
	}

	/** Start from a previous view instead of fitting (used on live refresh). */
	restore(state: ViewState): void {
		this.state = { ...state };
		this.touched = true;
		this.fitted = true;
		this.apply();
	}

	fit(): void {
		const w = this.viewport.clientWidth;
		const h = this.viewport.clientHeight;
		if (!w || !h) return;
		const pad = 16;
		const scale = clamp(Math.min((w - 2 * pad) / this.content.width, (h - 2 * pad) / this.content.height, 1.5));
		this.state = {
			scale,
			tx: (w - this.content.width * scale) / 2,
			ty: (h - this.content.height * scale) / 2,
		};
		this.fitted = true;
		this.touched = false;
		this.apply();
	}

	destroy(): void {
		this.cleanups.forEach((c) => c());
		this.cleanups = [];
		this.resizeObserver?.disconnect();
		this.resizeObserver = null;
	}

	private apply() {
		const { scale, tx, ty } = this.state;
		this.stage.setAttribute("transform", `translate(${tx} ${ty}) scale(${scale})`);
	}

	private listen<K extends keyof HTMLElementEventMap>(
		target: HTMLElement,
		type: K,
		fn: (e: HTMLElementEventMap[K]) => void,
		opts?: AddEventListenerOptions,
	) {
		const bound = fn.bind(this) as EventListener;
		target.addEventListener(type, bound, opts);
		this.cleanups.push(() => target.removeEventListener(type, bound, opts));
	}

	private local(e: PointerEvent | WheelEvent) {
		const r = this.viewport.getBoundingClientRect();
		return { x: e.clientX - r.left, y: e.clientY - r.top };
	}

	private onPointerDown(e: PointerEvent) {
		if (e.pointerType === "mouse" && e.button !== 0) return;
		if ((e.target as Element).closest?.(".lineage-toolbar")) return;
		this.pointers.set(e.pointerId, this.local(e));
		if (this.pointers.size === 1) {
			this.dragStart = { ...this.local(e), state: { ...this.state } };
			this.dragging = false;
		} else if (this.pointers.size === 2) {
			this.startPinch();
			// Both fingers belong to the view now.
			for (const id of this.pointers.keys()) this.capture(id);
		}
	}

	private onPointerMove(e: PointerEvent) {
		if (!this.pointers.has(e.pointerId)) return;
		this.pointers.set(e.pointerId, this.local(e));

		if (this.pointers.size >= 2 && this.pinchStart) {
			const [a, b] = Array.from(this.pointers.values());
			const dist = Math.hypot(a.x - b.x, a.y - b.y);
			const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
			const s0 = this.pinchStart.state;
			const scale = clamp((s0.scale * dist) / Math.max(this.pinchStart.dist, 1));
			// Keep the content point that was under the fingers under them.
			const cx = (this.pinchStart.mid.x - s0.tx) / s0.scale;
			const cy = (this.pinchStart.mid.y - s0.ty) / s0.scale;
			this.state = { scale, tx: mid.x - cx * scale, ty: mid.y - cy * scale };
			this.touched = true;
			this.apply();
			e.preventDefault();
			return;
		}

		if (!this.dragStart) return;
		const p = this.local(e);
		const dx = p.x - this.dragStart.x;
		const dy = p.y - this.dragStart.y;
		if (!this.dragging) {
			if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
			this.dragging = true;
			this.viewport.classList.add("is-dragging");
			this.capture(e.pointerId);
		}
		this.state = { ...this.dragStart.state, tx: this.dragStart.state.tx + dx, ty: this.dragStart.state.ty + dy };
		this.touched = true;
		this.apply();
		e.preventDefault();
	}

	private onPointerUp(e: PointerEvent) {
		if (!this.pointers.has(e.pointerId)) return;
		this.pointers.delete(e.pointerId);
		if (this.dragging || this.pinchStart) this.suppressClick = true;
		if (this.pointers.size === 1) {
			// Lifting one finger of a pinch: carry on panning with the other, without a jump.
			const [p] = Array.from(this.pointers.values());
			this.pinchStart = null;
			this.dragStart = { ...p, state: { ...this.state } };
			this.dragging = true;
		} else if (this.pointers.size === 0) {
			this.pinchStart = null;
			this.dragStart = null;
			this.dragging = false;
			this.viewport.classList.remove("is-dragging");
			// A tap produces no click on some touch devices; clear the flag soon either way.
			if (this.suppressClick) window.setTimeout(() => (this.suppressClick = false), 50);
		}
	}

	private onClickCapture(e: MouseEvent) {
		if (!this.suppressClick) return;
		this.suppressClick = false;
		e.stopPropagation();
		e.preventDefault();
	}

	private onWheel(e: WheelEvent) {
		// Plain wheel scrolls the note. Ctrl/Cmd + wheel (and trackpad pinch,
		// which browsers report as ctrl + wheel) zooms the tree.
		if (!e.ctrlKey && !e.metaKey) return;
		e.preventDefault();
		const p = this.local(e);
		const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
		const factor = Math.exp(-e.deltaY * unit * 0.0025);
		this.zoomAt(p, this.state.scale * factor);
	}

	private zoomAt(p: { x: number; y: number }, target: number) {
		const s0 = this.state;
		const scale = clamp(target);
		const cx = (p.x - s0.tx) / s0.scale;
		const cy = (p.y - s0.ty) / s0.scale;
		this.state = { scale, tx: p.x - cx * scale, ty: p.y - cy * scale };
		this.touched = true;
		this.apply();
	}

	private startPinch() {
		const [a, b] = Array.from(this.pointers.values());
		this.pinchStart = {
			dist: Math.hypot(a.x - b.x, a.y - b.y),
			mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
			state: { ...this.state },
		};
		this.dragStart = null;
	}

	private capture(id: number) {
		try {
			this.viewport.setPointerCapture(id);
		} catch {
			// Pointer already released.
		}
	}
}

function clamp(s: number): number {
	return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
}
