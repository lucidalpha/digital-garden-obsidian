# Digital Garden Timer

Digital Garden Timer is a focus timer for Obsidian. Focus time earns credits every 10 minutes, and credits can be spent on objects for a small digital garden.

## Features

- Start, pause, and reset the current focus timer.
- Keep an all-time focus total that is not reset with the current timer.
- Earn 10 credits for every completed 10-minute focus block.
- Spend credits on garden objects.
- Automatically write a Markdown progress note inside your vault.
- Configure the Markdown progress note path in the plugin settings.

## Progress Note

By default, the plugin writes progress to:

```text
Digital Garden Progress.md
```

You can change this path in `Settings -> Digital Garden Timer -> Markdown progress note path`.

The progress note includes the current timer, all-time focus duration, credit totals, and placed garden objects.

## Manual Installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest release.
2. Create this folder in your vault:

```text
.obsidian/plugins/digital-garden-timer/
```

3. Place the downloaded files in that folder.
4. Reload Obsidian.
5. Enable `Digital Garden Timer` under Community plugins.

## Development

This plugin is currently distributed as plain JavaScript and does not require a build step.

To validate the plugin file:

```bash
node --check main.js
```
