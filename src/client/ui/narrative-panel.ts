let panelEl: HTMLElement | null = null;

export function initNarrativePanel(): void {
  panelEl = document.getElementById("narrative-panel");
}

export function renderNarrativePanel(
  log: Array<{ text: string; timestamp: number }>
): void {
  if (!panelEl) return;

  panelEl.innerHTML = "";
  for (const entry of log) {
    const div = document.createElement("div");
    div.className = "narrative-entry";
    div.textContent = entry.text;
    panelEl.appendChild(div);
  }
  panelEl.scrollTop = panelEl.scrollHeight;
}

export function addNarrativeEntry(text: string): void {
  if (!panelEl) return;
  const div = document.createElement("div");
  div.className = "narrative-entry";
  div.textContent = text;
  panelEl.appendChild(div);
  panelEl.scrollTop = panelEl.scrollHeight;
}
