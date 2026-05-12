const { ItemView, Notice, Plugin, PluginSettingTab, Setting } = require("obsidian");

const VIEW_TYPE = "digital-garden-timer-view";
const FOCUS_BLOCK_MS = 10 * 60 * 1000;
const CREDITS_PER_BLOCK = 10;
const SVG_NS = "http://www.w3.org/2000/svg";
const DEFAULT_PROGRESS_NOTE_PATH = "Digital Garden Progress.md";
const PROGRESS_NOTE_WRITE_INTERVAL_MS = 30 * 1000;

const BASE_SCENE_WIDTH = 2400;
const BASE_SCENE_HEIGHT = 1200;
const BASE_GRID_SIZE = 8;
const TILE_W = 200;
const TILE_H = 100;
const GRID_ORIGIN_Y = 255;

const DEFAULT_DATA = {
  running: false,
  startedAt: 0,
  elapsedBeforeStart: 0,
  totalFocusMs: 0,
  creditedBlocks: 0,
  credits: 0,
  totalCreditsEarned: 0,
  spentCredits: 0,
  plants: [],
  progressNotePath: DEFAULT_PROGRESS_NOTE_PATH
};

const SHOP_ITEMS = [
  { id: "stone",    label: "Stone",    cost: 20,  kind: "stone",    color: "#b8b8b0", scale: 0.95 },
  { id: "mushroom", label: "Mushroom", cost: 30,  kind: "mushroom", color: "#e74c3c", scale: 0.95 },
  { id: "flower",   label: "Flower",   cost: 50,  kind: "flower",   color: "#ec7eb3", scale: 0.98 },
  { id: "shrub",    label: "Pine",     cost: 120, kind: "shrub",    color: "#4a8c53", scale: 1.05 },
  { id: "lantern",  label: "Cabin",    cost: 200, kind: "lantern",  color: "#d97757", scale: 1.05 },
  { id: "pond",     label: "Pond",     cost: 300, kind: "pond",     color: "#6cb4e3", scale: 1.20 },
  { id: "tree",     label: "Tree",     cost: 500, kind: "tree",     color: "#67b568", scale: 1.30 }
];

const LEGACY_KINDS = ["flower", "mushroom", "shrub", "lantern", "stone", "pond"];

class GardenTimerView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.renderedPlantCount = -1;
    this.shopButtons = new Map();
    this.zoom = 1;
  }

  getViewType()    { return VIEW_TYPE; }
  getDisplayText() { return "Digital Garden Timer"; }
  getIcon()        { return "sprout"; }

  async onOpen()  { this.render(); }
  async onClose() {}

  render() {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("dgt-view");
    this.shopButtons = new Map();

    const shell = container.createDiv({ cls: "dgt-shell" });
    const focusBar = shell.createDiv({ cls: "dgt-focusbar" });
    const garden = shell.createDiv({ cls: "dgt-garden-panel" });

    const brand = focusBar.createDiv({ cls: "dgt-brand" });
    const brandRow = brand.createDiv({ cls: "dgt-brand-row" });
    brandRow.createDiv({ cls: "dgt-brand-dot" });
    brandRow.createEl("h2", { text: "Digital Garden" });
    this.modeText = brand.createDiv({ cls: "dgt-muted" });

    const timerBlock = focusBar.createDiv({ cls: "dgt-timer-block" });
    this.timeText = timerBlock.createDiv({ cls: "dgt-time" });
    this.statusText = timerBlock.createDiv({ cls: "dgt-muted dgt-status" });

    const controlBlock = focusBar.createDiv({ cls: "dgt-control-block" });
    const buttons = controlBlock.createDiv({ cls: "dgt-buttons" });
    this.toggleButton = buttons.createEl("button", { cls: "mod-cta dgt-primary" });
    this.toggleButton.addEventListener("click", () => this.plugin.toggleTimer());
    this.resetButton = buttons.createEl("button", { cls: "dgt-secondary" });
    this.resetButton.type = "button";
    this.resetButton.setText("Reset");
    this.resetButton.addEventListener("click", () => this.plugin.resetTimer());

    const metrics = controlBlock.createDiv({ cls: "dgt-metrics" });
    this.creditMetric = this.createMetric(metrics, "Credits", "is-credits");
    this.itemMetric = this.createMetric(metrics, "Items");
    this.blockMetric = this.createMetric(metrics, "Blocks");
    this.totalFocusMetric = this.createMetric(metrics, "Total");

    const progress = controlBlock.createDiv({ cls: "dgt-progress" });
    const progressTop = progress.createDiv({ cls: "dgt-progress-top" });
    progressTop.createSpan({ text: "Next 10 credits in" });
    this.nextCreditText = progressTop.createEl("strong");
    const bar = progress.createDiv({ cls: "dgt-progress-bar" });
    this.progressFill = bar.createDiv({ cls: "dgt-progress-fill" });

    const gardenHeader = garden.createDiv({ cls: "dgt-garden-header" });
    const gardenTitle = gardenHeader.createDiv({ cls: "dgt-garden-title" });
    gardenTitle.createEl("h3", { text: "Your forest" });
    this.captionText = gardenTitle.createDiv({ cls: "dgt-muted" });

    const shop = garden.createDiv({ cls: "dgt-shop" });
    const shopHead = shop.createDiv({ cls: "dgt-shop-head" });
    shopHead.createEl("strong", { text: "Shop" });
    this.shopHint = shopHead.createSpan({ text: "10 min focus = 10 credits" });
    const shopGrid = shop.createDiv({ cls: "dgt-shop-grid" });

    SHOP_ITEMS.forEach((item) => {
      const button = shopGrid.createEl("button", { cls: "dgt-shop-item" });
      button.type = "button";
      button.dataset.itemId = item.id;
      button.addEventListener("click", () => this.plugin.buyItem(item.id));

      const icon = button.createSpan({ cls: "dgt-shop-icon" });
      const iconSvg = svgEl("svg", { class: "dgt-shop-svg", viewBox: "-60 -80 120 120" });
      iconSvg.appendChild(createItemSvg(item.kind, item.color, 0, 18, 0.62));
      icon.appendChild(iconSvg);

      const copy = button.createSpan({ cls: "dgt-shop-copy" });
      copy.createSpan({ cls: "dgt-shop-name", text: item.label });
      copy.createSpan({ cls: "dgt-shop-cost", text: `${item.cost} Credits` });
      this.shopButtons.set(item.id, button);
    });

    this.field = garden.createDiv({ cls: "dgt-field" });
    this.field.addEventListener("wheel", (event) => this.handleGardenWheel(event), { passive: false });
    this.scene = svgEl("svg", {
      class: "dgt-scene",
      viewBox: `0 0 ${BASE_SCENE_WIDTH} ${BASE_SCENE_HEIGHT}`,
      preserveAspectRatio: "xMidYMid meet"
    });
    this.field.appendChild(this.scene);
    buildSceneBase(this.scene, this.plugin.data.plants.length, this.zoom);
    this.sceneItems = svgEl("g", { class: "dgt-scene-items" });
    this.scene.appendChild(this.sceneItems);
    this.emptyState = this.field.createDiv({
      cls: "dgt-empty",
      text: "Earn credits with focus time and grow your forest piece by piece."
    });

    this.renderedPlantCount = -1;
    this.update();
  }

  createMetric(parent, label, extraClass) {
    const metric = parent.createDiv({ cls: "dgt-metric" + (extraClass ? ` ${extraClass}` : "") });
    const value = metric.createEl("strong", { text: "0" });
    metric.createSpan({ text: label });
    return value;
  }

  handleGardenWheel(event) {
    if (!event.ctrlKey) return;

    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
    const nextZoom = Math.min(3, Math.max(0.08, this.zoom * factor));
    if (Math.abs(nextZoom - this.zoom) < 0.001) return;

    this.zoom = nextZoom;
    this.renderPlants();
  }

  update() {
    if (!this.timeText) return;

    const elapsed = this.plugin.getElapsed();
    const completedBlocks = Math.floor(elapsed / FOCUS_BLOCK_MS);
    const remainder = elapsed % FOCUS_BLOCK_MS;
    const untilNext = FOCUS_BLOCK_MS - remainder;
    const itemCount = this.plugin.data.plants.length;
    const elapsedText = formatDuration(elapsed);
    const running = !!this.plugin.data.running;

    this.containerEl.children[1].classList.toggle("is-running", running);

    this.timeText.setText(elapsedText);
    this.toggleButton.setText(running ? "Pause" : "Start");
    this.modeText.setText(running
      ? "Focus is running. Credits grow with every minute."
      : "Paused. Your forest and credits are saved.");
    this.statusText.setText(this.plugin.data.credits >= 50
      ? "You can buy an item in the shop."
      : "Every 10 minutes adds 10 credits.");
    this.creditMetric.setText(String(this.plugin.data.credits));
    this.itemMetric.setText(String(itemCount));
    this.blockMetric.setText(String(completedBlocks));
    this.totalFocusMetric.setText(formatTotalFocus(this.plugin.getTotalFocusMs()));
    this.nextCreditText.setText(formatShort(untilNext === FOCUS_BLOCK_MS && completedBlocks > 0 ? FOCUS_BLOCK_MS : untilNext));
    this.progressFill.style.width = `${Math.min(100, (remainder / FOCUS_BLOCK_MS) * 100)}%`;
    this.captionText.setText(itemCount
      ? `${itemCount} item${itemCount === 1 ? "" : "s"} in your clearing.`
      : "Buy items in the shop and shape your forest.");

    this.updateShop();

    if (this.renderedPlantCount !== itemCount) {
      this.renderPlants();
    }
  }

  updateShop() {
    SHOP_ITEMS.forEach((item) => {
      const button = this.shopButtons.get(item.id);
      if (!button) return;
      const affordable = this.plugin.data.credits >= item.cost;
      button.disabled = !affordable;
      button.classList.toggle("is-affordable", affordable);
    });
  }

  renderPlants() {
    const plants = this.plugin.data.plants;
    this.scene.textContent = "";
    buildSceneBase(this.scene, plants.length, this.zoom);
    this.sceneItems = svgEl("g", { class: "dgt-scene-items" });
    this.scene.appendChild(this.sceneItems);
    this.sceneItems.textContent = "";
    this.emptyState.style.display = plants.length ? "none" : "grid";

    // Render back-to-front for correct isometric overlap.
    const positioned = plants.map((plant, index) => ({
      ...plant,
      ...gardenPosition(index, plants.length)
    }));
    positioned.sort((a, b) => a.y - b.y);
    positioned.forEach((plant) => {
      this.sceneItems.appendChild(createItemSvg(plant.kind, plant.color, plant.x, plant.y, plant.scale));
    });

    this.renderedPlantCount = plants.length;
  }
}

class DigitalGardenTimerSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Digital Garden Timer" });

    new Setting(containerEl)
      .setName("Markdown progress note path")
      .setDesc("Vault-relative path for the automatically updated progress note.")
      .addText((text) => text
        .setPlaceholder(DEFAULT_PROGRESS_NOTE_PATH)
        .setValue(this.plugin.data.progressNotePath || DEFAULT_PROGRESS_NOTE_PATH)
        .onChange(async (value) => {
          this.plugin.data.progressNotePath = normalizeProgressNotePath(value);
          await this.plugin.saveData(this.plugin.data);
          await this.plugin.saveProgressNote(true);
        }));
  }
}

module.exports = class DigitalGardenTimerPlugin extends Plugin {
  async onload() {
    this.lastProgressNoteWrite = 0;
    this.data = Object.assign({}, DEFAULT_DATA, await this.loadData());
    this.data.credits = Number(this.data.credits || 0);
    this.data.totalCreditsEarned = Number(this.data.totalCreditsEarned || 0);
    this.data.spentCredits = Number(this.data.spentCredits || 0);
    this.data.creditedBlocks = Number(this.data.creditedBlocks || 0);
    this.data.totalFocusMs = Number(this.data.totalFocusMs || this.data.elapsedBeforeStart || 0);
    this.data.progressNotePath = normalizeProgressNotePath(this.data.progressNotePath);
    this.data.plants = Array.isArray(this.data.plants)
      ? this.data.plants.map((plant, index) => normalizeGardenItem(plant, index))
      : [];

    await this.saveData(this.data);
    await this.saveProgressNote(true);

    this.addSettingTab(new DigitalGardenTimerSettingTab(this.app, this));

    this.registerView(VIEW_TYPE, (leaf) => new GardenTimerView(leaf, this));

    this.addRibbonIcon("sprout", "Digital Garden Timer", () => {
      this.activateView();
    });

    this.addCommand({
      id: "open-digital-garden-timer",
      name: "Open Digital Garden Timer",
      callback: () => this.activateView()
    });

    this.addCommand({
      id: "toggle-digital-garden-timer",
      name: "Start/stop Digital Garden Timer",
      callback: () => this.toggleTimer()
    });

    this.addCommand({
      id: "reset-digital-garden-timer",
      name: "Reset Digital Garden Timer",
      callback: () => this.resetTimer()
    });

    this.timer = window.setInterval(() => {
      this.syncCredits();
      this.updateViews();
      this.saveProgressNote(false);
    }, 1000);

    this.registerInterval(this.timer);
    this.syncCredits();
    this.saveProgressNote(true);
  }

  onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
  }

  async activateView() {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE);
    let leaf = leaves[0];

    if (!leaf) {
      leaf = this.app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }

    this.app.workspace.revealLeaf(leaf);
  }

  getElapsed() {
    if (!this.data.running) return this.data.elapsedBeforeStart;
    return this.data.elapsedBeforeStart + Date.now() - this.data.startedAt;
  }

  getTotalFocusMs() {
    if (!this.data.running) return this.data.totalFocusMs;
    return this.data.totalFocusMs + Date.now() - this.data.startedAt;
  }

  async toggleTimer() {
    if (this.data.running) {
      this.syncCredits();
      this.data.totalFocusMs = this.getTotalFocusMs();
      this.data.elapsedBeforeStart = this.getElapsed();
      this.data.running = false;
      this.data.startedAt = 0;
      new Notice("Digital Garden Timer paused.");
    } else {
      this.data.startedAt = Date.now();
      this.data.running = true;
      new Notice("Digital Garden Timer started.");
    }

    await this.saveData(this.data);
    await this.saveProgressNote(true);
    this.updateViews();
  }

  async resetTimer() {
    if (this.data.running) {
      this.syncCredits();
      this.data.totalFocusMs = this.getTotalFocusMs();
      this.data.startedAt = Date.now();
    } else {
      this.data.startedAt = 0;
    }

    this.data.elapsedBeforeStart = 0;
    this.data.creditedBlocks = 0;
    await this.saveData(this.data);
    await this.saveProgressNote(true);
    this.updateViews();
    new Notice("Digital Garden Timer reset. Total focus time is preserved.");
  }

  syncCredits() {
    const completedBlocks = Math.floor(this.getElapsed() / FOCUS_BLOCK_MS);
    const newBlocks = completedBlocks - this.data.creditedBlocks;
    if (newBlocks <= 0) return;

    const earned = newBlocks * CREDITS_PER_BLOCK;
    this.data.credits += earned;
    this.data.totalCreditsEarned += earned;
    this.data.creditedBlocks = completedBlocks;
    this.saveData(this.data);
    this.saveProgressNote(true);
    new Notice(`+${earned} credits for focus time.`);
  }

  async buyItem(itemId) {
    const item = SHOP_ITEMS.find((candidate) => candidate.id === itemId);
    if (!item) return;

    if (this.data.credits < item.cost) {
      new Notice(`Not enough credits for ${item.label}.`);
      return;
    }

    this.data.credits -= item.cost;
    this.data.spentCredits += item.cost;
    this.data.plants.push(createGardenItem(item, this.data.plants.length));
    await this.saveData(this.data);
    await this.saveProgressNote(true);
    this.updateViews();
    new Notice(`${item.label} placed.`);
  }

  async saveProgressNote(force) {
    const now = Date.now();
    if (!force && now - this.lastProgressNoteWrite < PROGRESS_NOTE_WRITE_INTERVAL_MS) return;

    this.lastProgressNoteWrite = now;
    try {
      await this.ensureProgressNoteFolder();
      await this.app.vault.adapter.write(this.data.progressNotePath, this.buildProgressNote(now));
    } catch (error) {
      console.error("Digital Garden Timer could not write the Markdown progress note.", error);
    }
  }

  async ensureProgressNoteFolder() {
    const parts = this.data.progressNotePath.split("/").slice(0, -1).filter(Boolean);
    let current = "";

    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!(await this.app.vault.adapter.exists(current))) {
        await this.app.vault.adapter.mkdir(current);
      }
    }
  }

  buildProgressNote(now) {
    const elapsed = this.getElapsed();
    const totalFocusMs = this.getTotalFocusMs();
    const completedBlocks = Math.floor(elapsed / FOCUS_BLOCK_MS);
    const remainder = elapsed % FOCUS_BLOCK_MS;
    const untilNext = FOCUS_BLOCK_MS - remainder;
    const plants = Array.isArray(this.data.plants) ? this.data.plants : [];
    const plantCounts = plants.reduce((counts, plant) => {
      const key = plant && plant.kind ? plant.kind : "unknown";
      counts[key] = (counts[key] || 0) + 1;
      return counts;
    }, {});
    const plantRows = Object.entries(plantCounts)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([kind, count]) => `| ${kind} | ${count} |`)
      .join("\n") || "| No items | 0 |";

    return [
      "# Digital Garden Progress",
      "",
      `Last updated: ${new Date(now).toLocaleString()}`,
      "",
      "## Status",
      "",
      `- Timer running: ${this.data.running ? "Yes" : "No"}`,
      `- Current timer: ${formatDuration(elapsed)}`,
      `- Total focus time: ${formatTotalFocus(totalFocusMs)}`,
      `- Completed 10-minute blocks: ${completedBlocks}`,
      `- Time until next 10 credits: ${formatShort(untilNext === FOCUS_BLOCK_MS && completedBlocks > 0 ? FOCUS_BLOCK_MS : untilNext)}`,
      "",
      "## Credits",
      "",
      `- Available credits: ${this.data.credits}`,
      `- Total credits earned: ${this.data.totalCreditsEarned}`,
      `- Spent credits: ${this.data.spentCredits}`,
      "",
      "## Garden",
      "",
      `- Placed items: ${plants.length}`,
      "",
      "| Item kind | Count |",
      "| --- | ---: |",
      plantRows,
      ""
    ].join("\n");
  }

  updateViews() {
    this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach((leaf) => {
      if (leaf.view && leaf.view.update) leaf.view.update();
    });
  }
};

/* ---------- Isometric grid positioning ---------- */

function createGardenItem(item, index) {
  const position = gardenPosition(index);
  return {
    x: position.x,
    y: position.y,
    color: item.color,
    kind: item.kind,
    scale: item.scale
  };
}

function normalizeGardenItem(plant, index) {
  const position = gardenPosition(index);
  if (plant && plant.kind && plant.color) {
    const item = SHOP_ITEMS.find((candidate) => candidate.kind === plant.kind) || SHOP_ITEMS[0];
    return {
      x: position.x,
      y: position.y,
      color: item.color,
      kind: item.kind,
      scale: item.scale
    };
  }
  const item = SHOP_ITEMS.find((candidate) => candidate.kind === LEGACY_KINDS[index % LEGACY_KINDS.length]) || SHOP_ITEMS[0];
  return createGardenItem(item, index);
}

function normalizeProgressNotePath(path) {
  const normalized = String(path || DEFAULT_PROGRESS_NOTE_PATH)
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .trim();

  if (!normalized) return DEFAULT_PROGRESS_NOTE_PATH;
  return normalized.toLowerCase().endsWith(".md") ? normalized : `${normalized}.md`;
}

/* Isometric: index 0 sits at back, higher index moves toward front.
 * (col, row) -> screen (x, y) using a 2:1 isometric projection.
 * Slight jitter keeps the forest from looking like a perfect grid. */
function gridMetrics(itemCount) {
  const cols = Math.max(BASE_GRID_SIZE, Math.ceil(Math.sqrt(Math.max(1, itemCount))));
  const rows = Math.max(BASE_GRID_SIZE, Math.ceil(Math.max(1, itemCount) / cols));
  const size = Math.max(BASE_GRID_SIZE, cols, rows);
  const sceneWidth = Math.max(BASE_SCENE_WIDTH, size * TILE_W + 800);
  const sceneHeight = Math.max(BASE_SCENE_HEIGHT, GRID_ORIGIN_Y + size * TILE_H + 475);
  const centerX = sceneWidth / 2;
  return { cols, rows, size, sceneWidth, sceneHeight, centerX };
}

function gardenPosition(index, itemCount = index + 1) {
  const grid = gridMetrics(itemCount);
  const row = Math.floor(index / grid.cols);
  const col = index % grid.cols;
  const centeredCol = col + (grid.size - grid.cols) / 2;
  const centeredRow = row + (grid.size - grid.rows) / 2;

  const isoX = grid.centerX + (centeredCol - centeredRow) * (TILE_W / 2);
  const isoY = GRID_ORIGIN_Y + (centeredCol + centeredRow) * (TILE_H / 2) + 42;

  const jx = (pseudoRand(index * 11.7) - 0.5) * 24;
  const jy = (pseudoRand(index * 23.3) - 0.5) * 10;

  return { x: isoX + jx, y: isoY + jy };
}

function pseudoRand(seed) {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

/* ---------- Scene: isometric platform ---------- */

function sceneMetrics(itemCount) {
  const grid = gridMetrics(itemCount);
  const halfW = grid.size * TILE_W / 2;
  const halfH = grid.size * TILE_H / 2;
  return {
    rows: grid.rows,
    size: grid.size,
    sceneWidth: grid.sceneWidth,
    sceneHeight: grid.sceneHeight,
    platform: {
      topTip:    { x: grid.centerX, y: GRID_ORIGIN_Y },
      rightTip:  { x: grid.centerX + halfW, y: GRID_ORIGIN_Y + halfH },
      bottomTip: { x: grid.centerX, y: GRID_ORIGIN_Y + grid.size * TILE_H },
      leftTip:   { x: grid.centerX - halfW, y: GRID_ORIGIN_Y + halfH },
      depth: 200
    }
  };
}

function buildSceneBase(svg, itemCount = 0, zoom = 1) {
  const metrics = sceneMetrics(itemCount);
  svg.setAttribute("viewBox", `0 0 ${metrics.sceneWidth} ${metrics.sceneHeight}`);
  svg.style.width = `${Math.max(10, (metrics.size / BASE_GRID_SIZE) * 100 * zoom)}%`;
  svg.style.height = `${metrics.sceneHeight * zoom}px`;

  const defs = svgEl("defs", {});

  defs.appendChild(linearGradient("dgt-bg-grad", [
    { offset: "0%",   color: "#3a4640" },
    { offset: "100%", color: "#262f2a" }
  ], "0%", "0%", "0%", "100%"));

  defs.appendChild(linearGradient("dgt-grass-grad", [
    { offset: "0%",   color: "#a3c585" },
    { offset: "55%",  color: "#7fb069" },
    { offset: "100%", color: "#5e8d4f" }
  ], "0%", "0%", "0%", "100%"));

  defs.appendChild(linearGradient("dgt-earth-left", [
    { offset: "0%",   color: "#8b5e3c" },
    { offset: "100%", color: "#5d3e22" }
  ], "0%", "0%", "0%", "100%"));

  defs.appendChild(linearGradient("dgt-earth-right", [
    { offset: "0%",   color: "#a87545" },
    { offset: "100%", color: "#704726" }
  ], "0%", "0%", "0%", "100%"));

  svg.appendChild(defs);

  // Background
  svg.appendChild(svgEl("rect", { x: 0, y: 0, width: metrics.sceneWidth, height: metrics.sceneHeight, fill: "url(#dgt-bg-grad)" }));

  // Subtle overhead light pooling on platform area
  svg.appendChild(svgEl("ellipse", {
    cx: metrics.sceneWidth / 2, cy: GRID_ORIGIN_Y - 110, rx: Math.max(700, metrics.size * 105), ry: 180,
    fill: "#ffffff", opacity: 0.04
  }));

  const T = metrics.platform.topTip;
  const R = metrics.platform.rightTip;
  const B = metrics.platform.bottomTip;
  const L = metrics.platform.leftTip;
  const D = metrics.platform.depth;

  // Ground shadow halo
  svg.appendChild(svgEl("ellipse", {
    cx: 1200, cy: B.y + D + 50, rx: 920, ry: 70,
    fill: "#000000", opacity: 0.28
  }));

  // Right earth side (catches more light)
  svg.appendChild(svgEl("polygon", {
    points: `${B.x},${B.y} ${R.x},${R.y} ${R.x},${R.y + D} ${B.x},${B.y + D}`,
    fill: "url(#dgt-earth-right)"
  }));

  // Left earth side (in shadow)
  svg.appendChild(svgEl("polygon", {
    points: `${L.x},${L.y} ${B.x},${B.y} ${B.x},${B.y + D} ${L.x},${L.y + D}`,
    fill: "url(#dgt-earth-left)"
  }));

  // Edge highlight where grass meets earth (lighter rim around top)
  svg.appendChild(svgEl("polygon", {
    points: `${L.x},${L.y} ${B.x},${B.y} ${R.x},${R.y}`,
    fill: "none",
    stroke: "#3a5a2c",
    "stroke-width": 3,
    "stroke-linejoin": "round",
    opacity: 0.55
  }));

  // Grass surface (rhombus)
  svg.appendChild(svgEl("polygon", {
    points: `${T.x},${T.y} ${R.x},${R.y} ${B.x},${B.y} ${L.x},${L.y}`,
    fill: "url(#dgt-grass-grad)"
  }));

  // Grass top highlight near back edge
  svg.appendChild(svgEl("polygon", {
    points: `${T.x},${T.y} ${(T.x + R.x) / 2},${(T.y + R.y) / 2} ${T.x},${(T.y + B.y) / 2.2} ${(T.x + L.x) / 2},${(T.y + L.y) / 2}`,
    fill: "#a3c585",
    opacity: 0.55
  }));

  // Earth fringe (dripping dirt clumps along grass edge)
  drawEarthFringe(svg, L, B, R, "#3a5a2c");

  // Small grass tufts on platform (decorative)
  drawGrassTufts(svg, metrics);

  // Platform outline (subtle)
  svg.appendChild(svgEl("polygon", {
    points: `${T.x},${T.y} ${R.x},${R.y} ${B.x},${B.y} ${L.x},${L.y}`,
    fill: "none",
    stroke: "#3a5a2c",
    "stroke-width": 1.5,
    opacity: 0.18
  }));
}

function drawEarthFringe(svg, L, B, R, color) {
  // Bumps along the grass/earth seam on left side
  const leftCount = 8;
  for (let i = 0; i <= leftCount; i++) {
    const t = i / leftCount;
    const cx = L.x + (B.x - L.x) * t;
    const cy = L.y + (B.y - L.y) * t;
    const r = 6 + (i % 3) * 3;
    svg.appendChild(svgEl("ellipse", {
      cx, cy: cy + 2, rx: r, ry: r * 0.6, fill: color, opacity: 0.7
    }));
  }
  // Bumps on right side
  for (let i = 0; i <= leftCount; i++) {
    const t = i / leftCount;
    const cx = B.x + (R.x - B.x) * t;
    const cy = B.y + (R.y - B.y) * t;
    const r = 6 + ((i + 2) % 3) * 3;
    svg.appendChild(svgEl("ellipse", {
      cx, cy: cy + 2, rx: r, ry: r * 0.6, fill: color, opacity: 0.7
    }));
  }
}

function drawGrassTufts(svg, metrics = sceneMetrics(0)) {
  const group = svgEl("g", { opacity: 0.7 });
  const baseX = metrics.sceneWidth / 2 - 1200;
  const tufts = [
    [1050, 320], [1200, 280], [1380, 310],
    [780, 480],  [1050, 460], [1380, 470], [1620, 490],
    [900, 660],  [1200, 700], [1500, 680],
    [1100, 820], [1320, 820]
  ].map(([x, y]) => [x + baseX, y]);
  const extraRows = Math.max(0, metrics.size - BASE_GRID_SIZE);
  for (let row = 0; row < extraRows; row += 2) {
    const y = 930 + row * TILE_H;
    tufts.push([metrics.sceneWidth / 2 - 300, y], [metrics.sceneWidth / 2, y + 28], [metrics.sceneWidth / 2 + 300, y + 4]);
  }
  tufts.forEach(([x, y]) => {
    group.appendChild(svgEl("path", {
      d: `M${x - 4} ${y} l 2 -8 M${x} ${y} l 0 -10 M${x + 4} ${y} l -2 -8`,
      stroke: "#5e8d4f", "stroke-width": 2.2, "stroke-linecap": "round", fill: "none"
    }));
  });
  svg.appendChild(group);
}

/* ---------- Garden objects (Forest style) ---------- */

function createItemSvg(kind, color, x, y, scale) {
  const group = svgEl("g", {
    class: `dgt-svg-item dgt-svg-${kind}`,
    transform: `translate(${x} ${y}) scale(${scale || 1})`
  });

  // Soft ground shadow (skip for pond which IS the shadow shape)
  if (kind !== "pond") {
    group.appendChild(svgEl("ellipse", {
      cx: 0, cy: 14, rx: 30, ry: 8, fill: "#3a5a2c", opacity: 0.25
    }));
  }

  if (kind === "stone")    drawStone(group, color);
  else if (kind === "mushroom") drawMushroom(group, color);
  else if (kind === "flower")   drawFlower(group, color);
  else if (kind === "shrub")    drawPine(group, color);
  else if (kind === "lantern")  drawHut(group, color);
  else if (kind === "pond")     drawPond(group, color);
  else if (kind === "tree")     drawTree(group, color);

  return group;
}

function drawStone(group, color) {
  // Rounded squat stone
  group.appendChild(svgEl("path", {
    d: "M-22 8 C -24 -6 -8 -16 6 -14 C 22 -12 26 4 22 10 C 18 16 -18 16 -22 8 Z",
    fill: color
  }));
  // Top highlight
  group.appendChild(svgEl("path", {
    d: "M-14 -6 C -8 -12 8 -12 14 -8 C 8 -10 -8 -10 -14 -6 Z",
    fill: "#ffffff", opacity: 0.5
  }));
  // Bottom shade
  group.appendChild(svgEl("path", {
    d: "M-20 6 C -10 12 14 12 22 8 C 18 14 -18 14 -20 6 Z",
    fill: "#000000", opacity: 0.18
  }));
  // Small moss
  group.appendChild(svgEl("circle", { cx: -8, cy: -2, r: 3, fill: "#7fb069", opacity: 0.85 }));
  group.appendChild(svgEl("circle", { cx: -4, cy: -3, r: 1.8, fill: "#a3c585", opacity: 0.85 }));
}

function drawMushroom(group, color) {
  // Stem
  group.appendChild(svgEl("path", {
    d: "M-7 14 C -6 0 6 0 7 14 L 8 22 L -8 22 Z",
    fill: "#fffaeb",
    stroke: "#e3d6b6", "stroke-width": 1.2
  }));
  // Cap base (small skirt)
  group.appendChild(svgEl("ellipse", { cx: 0, cy: 0, rx: 12, ry: 3, fill: "#f5ede0" }));
  // Cap (rounded dome)
  group.appendChild(svgEl("path", {
    d: "M-22 -2 C -22 -24 22 -24 22 -2 C 22 6 -22 6 -22 -2 Z",
    fill: color
  }));
  // Cap shine
  group.appendChild(svgEl("path", {
    d: "M-16 -14 C -10 -22 8 -22 16 -16 C 8 -18 -10 -18 -16 -14 Z",
    fill: "#ffffff", opacity: 0.35
  }));
  // White spots
  group.appendChild(svgEl("circle", { cx: -10, cy: -8, r: 3.6, fill: "#ffffff" }));
  group.appendChild(svgEl("circle", { cx: 6,  cy: -12, r: 3.0, fill: "#ffffff" }));
  group.appendChild(svgEl("circle", { cx: 14, cy: -4,  r: 2.4, fill: "#ffffff" }));
  group.appendChild(svgEl("circle", { cx: -2, cy: -16, r: 2.0, fill: "#ffffff" }));
}

function drawFlower(group, color) {
  // Stem
  group.appendChild(svgEl("path", {
    d: "M0 14 Q -2 2 0 -16",
    fill: "none", stroke: "#5e8d4f", "stroke-width": 2.5, "stroke-linecap": "round"
  }));
  // Leaf
  group.appendChild(svgEl("path", {
    d: "M0 2 Q -12 -2 -10 8 Q -2 6 0 2 Z",
    fill: "#5e8d4f"
  }));
  group.appendChild(svgEl("path", {
    d: "M0 -4 Q 11 -8 10 2 Q 2 0 0 -4 Z",
    fill: "#7fb069"
  }));
  // Petals — 5 round, almost cartoonish
  const petals = [
    [0,   -28], [10,  -22], [-10, -22], [6,   -34], [-6,  -34]
  ];
  petals.forEach(([cx, cy]) => {
    group.appendChild(svgEl("circle", { cx, cy, r: 8, fill: color }));
  });
  // Petal highlights
  petals.forEach(([cx, cy]) => {
    group.appendChild(svgEl("circle", { cx: cx - 2.5, cy: cy - 2.5, r: 2.2, fill: "#ffffff", opacity: 0.55 }));
  });
  // Center
  group.appendChild(svgEl("circle", { cx: 0, cy: -28, r: 5, fill: "#f4a957" }));
  group.appendChild(svgEl("circle", { cx: -1, cy: -29, r: 1.8, fill: "#d97757" }));
}

function drawPine(group, color) {
  // Trunk
  group.appendChild(svgEl("rect", { x: -5, y: 6, width: 10, height: 14, rx: 2, fill: "#8b5e3c" }));
  group.appendChild(svgEl("rect", { x: -5, y: 6, width: 3,  height: 14, rx: 1.5, fill: "#a87545" }));
  // Bottom cone (largest)
  group.appendChild(svgEl("path", {
    d: "M-26 8 L 0 -18 L 26 8 Z",
    fill: color
  }));
  // Middle cone
  group.appendChild(svgEl("path", {
    d: "M-22 -10 L 0 -34 L 22 -10 Z",
    fill: "#5fa172"
  }));
  // Top cone
  group.appendChild(svgEl("path", {
    d: "M-16 -28 L 0 -50 L 16 -28 Z",
    fill: "#6ec07a"
  }));
  // Subtle highlight stripes (left side a touch lighter)
  group.appendChild(svgEl("path", {
    d: "M-22 6 L 0 -16 L -4 -14 L -20 8 Z",
    fill: "#ffffff", opacity: 0.20
  }));
  group.appendChild(svgEl("path", {
    d: "M-18 -12 L 0 -32 L -4 -30 L -16 -10 Z",
    fill: "#ffffff", opacity: 0.20
  }));
  // White sparkle
  spark(group, 4, -38, 3);
}

function drawHut(group, color) {
  // Tiny wooden hut with a peaked roof
  // Base (front face)
  group.appendChild(svgEl("rect", { x: -16, y: -10, width: 32, height: 28, rx: 1.5, fill: "#e8d09a" }));
  // Side shadow (right thin band for depth)
  group.appendChild(svgEl("rect", { x: 10, y: -10, width: 6, height: 28, fill: "#c9a96a" }));
  // Roof
  group.appendChild(svgEl("path", {
    d: "M-22 -10 L 0 -34 L 22 -10 Z",
    fill: color
  }));
  // Roof shadow underside
  group.appendChild(svgEl("path", {
    d: "M-22 -10 L 22 -10 L 18 -6 L -18 -6 Z",
    fill: "#000000", opacity: 0.18
  }));
  // Roof highlight
  group.appendChild(svgEl("path", {
    d: "M-22 -10 L 0 -34 L -4 -30 L -16 -10 Z",
    fill: "#ffffff", opacity: 0.18
  }));
  // Door
  group.appendChild(svgEl("path", {
    d: "M-6 18 L -6 2 Q -6 -4 0 -4 Q 6 -4 6 2 L 6 18 Z",
    fill: "#5d3e22"
  }));
  // Doorknob
  group.appendChild(svgEl("circle", { cx: 3, cy: 10, r: 1.2, fill: "#f4a957" }));
  // Tiny window
  group.appendChild(svgEl("rect", { x: -12, y: 0, width: 6, height: 6, fill: "#fbeaa8" }));
  group.appendChild(svgEl("path", { d: "M-12 3 L -6 3 M-9 0 L -9 6", stroke: "#5d3e22", "stroke-width": 0.8 }));
  // Roof beam tip
  group.appendChild(svgEl("circle", { cx: 0, cy: -33, r: 2, fill: "#5d3e22" }));
}

function drawPond(group, color) {
  // Soft shadow under water
  group.appendChild(svgEl("ellipse", {
    cx: 0, cy: 14, rx: 50, ry: 12, fill: "#3a5a2c", opacity: 0.25
  }));
  // Water body
  group.appendChild(svgEl("ellipse", {
    cx: 0, cy: 4, rx: 50, ry: 18, fill: color
  }));
  // Inner darker ring for depth
  group.appendChild(svgEl("ellipse", {
    cx: 0, cy: 6, rx: 42, ry: 13, fill: "#3a8bb8", opacity: 0.5
  }));
  // Highlight band
  group.appendChild(svgEl("ellipse", {
    cx: -8, cy: -2, rx: 24, ry: 4, fill: "#ffffff", opacity: 0.55
  }));
  // Lily pad
  group.appendChild(svgEl("ellipse", { cx: 26, cy: 2, rx: 8, ry: 4, fill: "#5e8d4f" }));
  group.appendChild(svgEl("path", {
    d: "M26 -1 L 34 2 M26 -1 L 19 3",
    stroke: "#3a5a2c", "stroke-width": 0.8, fill: "none"
  }));
  // Lily flower
  group.appendChild(svgEl("circle", { cx: 22, cy: 0, r: 2, fill: "#ec7eb3" }));
  group.appendChild(svgEl("circle", { cx: 22, cy: 0, r: 0.8, fill: "#fef9ec" }));
}

function drawTree(group, color) {
  // Trunk
  group.appendChild(svgEl("rect", { x: -8, y: -4, width: 16, height: 22, rx: 4, fill: "#8b5e3c" }));
  // Trunk light side
  group.appendChild(svgEl("rect", { x: -8, y: -4, width: 5, height: 22, rx: 2.5, fill: "#a87545" }));
  // Trunk bark line
  group.appendChild(svgEl("path", {
    d: "M-2 2 q -3 5 1 9",
    stroke: "#6b4423", "stroke-width": 1.2, fill: "none", "stroke-linecap": "round"
  }));
  // Foliage — multi-layered for a "Forest" look
  group.appendChild(svgEl("circle", { cx: -18, cy: -22, r: 22, fill: "#3a7d44" }));
  group.appendChild(svgEl("circle", { cx: 20,  cy: -22, r: 22, fill: "#3a7d44" }));
  group.appendChild(svgEl("circle", { cx: -2,  cy: -42, r: 24, fill: color }));
  group.appendChild(svgEl("circle", { cx: -14, cy: -30, r: 20, fill: color }));
  group.appendChild(svgEl("circle", { cx: 14,  cy: -32, r: 20, fill: color }));
  group.appendChild(svgEl("circle", { cx: 4,   cy: -50, r: 18, fill: "#7bc77c" }));
  // Top highlight
  group.appendChild(svgEl("circle", { cx: -2,  cy: -52, r: 8,  fill: "#a3df9a", opacity: 0.8 }));
  group.appendChild(svgEl("circle", { cx: -10, cy: -34, r: 6,  fill: "#a3df9a", opacity: 0.55 }));
  // Forest-style white sparkle highlights
  spark(group, 0, -52, 4);
  spark(group, 16, -30, 3);
  spark(group, -16, -24, 2.5);
}

function spark(group, x, y, size) {
  group.appendChild(svgEl("polygon", {
    points: `${x},${y - size} ${x + size},${y} ${x},${y + size} ${x - size},${y}`,
    fill: "#ffffff"
  }));
}

/* ---------- SVG helpers ---------- */

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, String(value)));
  return el;
}

function linearGradient(id, stops, x1, y1, x2, y2) {
  const grad = svgEl("linearGradient", { id, x1, y1, x2, y2 });
  stops.forEach((stop) => grad.appendChild(svgEl("stop", { offset: stop.offset, "stop-color": stop.color })));
  return grad;
}

/* ---------- Formatting ---------- */

function formatDuration(ms) {
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

function formatShort(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatTotalFocus(ms) {
  const totalMinutes = Math.floor(ms / 60000);
  if (totalMinutes <= 0) return "0h 00m";
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${String(minutes).padStart(2, "0")}m`;
}
