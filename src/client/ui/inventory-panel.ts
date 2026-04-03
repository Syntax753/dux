let panelEl: HTMLElement | null = null;

export function initInventoryPanel(): void {
  panelEl = document.getElementById("inventory-panel");
}

export function renderInventoryPanel(
  items: Array<{ id: string; name: string }>
): void {
  if (!panelEl) return;

  if (items.length === 0) {
    panelEl.textContent = "Inventory: empty";
    return;
  }

  panelEl.textContent = "Inventory: " + items.map((i) => i.name).join(", ");
}
