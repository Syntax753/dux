import type { RadialAction } from "../../shared/types.js";

let menuEl: HTMLElement | null = null;
let activeCallback: ((action: string) => void) | null = null;
let actions: RadialAction[] = [];
let selectedIndex = 0;

export function initRadialMenu(): void {
  menuEl = document.getElementById("radial-menu");
}

export function showRadialMenu(
  config: {
    entityName: string;
    actions: RadialAction[];
    screenX: number;
    screenY: number;
  },
  onSelect: (action: string) => void
): void {
  if (!menuEl) return;
  activeCallback = onSelect;
  actions = config.actions;
  selectedIndex = 0;

  menuEl.innerHTML = "";
  menuEl.style.display = "block";
  menuEl.style.left = `${config.screenX}px`;
  menuEl.style.top = `${config.screenY}px`;

  const title = document.createElement("div");
  title.className = "radial-title";
  title.textContent = config.entityName;
  menuEl.appendChild(title);

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    const btn = document.createElement("button");
    btn.className = "radial-action";
    btn.dataset.index = String(i);
    if (!action.enabled) btn.classList.add("disabled");
    if (i === selectedIndex) btn.classList.add("selected");
    btn.innerHTML = `<span class="radial-label">${action.label}</span><span class="radial-desc">${action.description}</span>`;
    btn.disabled = !action.enabled;
    if (action.reason) btn.title = action.reason;

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (action.enabled && activeCallback) {
        activeCallback(action.action);
      }
    });

    menuEl.appendChild(btn);
  }

  // Keyboard navigation
  document.addEventListener("keydown", keyHandler);

  // Click outside to dismiss
  setTimeout(() => {
    document.addEventListener("click", dismissHandler, { once: true });
  }, 0);
}

export function hideRadialMenu(): void {
  if (!menuEl) return;
  menuEl.style.display = "none";
  menuEl.innerHTML = "";
  activeCallback = null;
  actions = [];
  selectedIndex = 0;
  document.removeEventListener("keydown", keyHandler);
  document.removeEventListener("click", dismissHandler);
}

function updateSelection(): void {
  if (!menuEl) return;
  const buttons = menuEl.querySelectorAll(".radial-action");
  buttons.forEach((btn, i) => {
    btn.classList.toggle("selected", i === selectedIndex);
  });
}

function keyHandler(e: KeyboardEvent): void {
  if (e.key === "Escape") {
    e.preventDefault();
    dismiss();
    return;
  }

  if (e.key === "ArrowUp" || e.key === "w" || e.key === "W") {
    e.preventDefault();
    selectedIndex = (selectedIndex - 1 + actions.length) % actions.length;
    console.log(`%c  ↑ [radial] Highlight: "${actions[selectedIndex].label}" (${actions[selectedIndex].action})`, "color: #9575cd");
    updateSelection();
    return;
  }

  if (e.key === "ArrowDown" || e.key === "s" || e.key === "S") {
    e.preventDefault();
    selectedIndex = (selectedIndex + 1) % actions.length;
    console.log(`%c  ↓ [radial] Highlight: "${actions[selectedIndex].label}" (${actions[selectedIndex].action})`, "color: #9575cd");
    updateSelection();
    return;
  }

  if (e.key === "Enter") {
    e.preventDefault();
    const action = actions[selectedIndex];
    if (action?.enabled && activeCallback) {
      console.log(`%c  ⏎ [radial] Confirmed: "${action.label}" (${action.action})`, "color: #9575cd; font-weight: bold");
      activeCallback(action.action);
    } else if (action && !action.enabled) {
      console.log(`%c  ⏎ [radial] Blocked: "${action.label}" is disabled${action.reason ? ` — ${action.reason}` : ""}`, "color: #616161");
    }
    return;
  }
}

function dismissHandler(): void {
  dismiss();
}

function dismiss(): void {
  console.log(`%c  ✗ [radial] Dismissed`, "color: #616161");
  hideRadialMenu();
  window.dispatchEvent(new CustomEvent("radial-dismissed"));
}
