# dsh-psdbg

**[中文](README.md) | English**

MCP server for **live Photoshop debugging** from an agent. It does not click pixels; it drives Photoshop through four lanes: COM/ExtendScript, UXP over CDP, classic C++ SDK, and UXP Hybrid SDK.

## Tools

| Tool | Purpose |
|---|---|
| `ps_status` | Photoshop version, open documents, process state (call this first) |
| `ps_jsx` | Run ExtendScript (COM), returns JSON-serialisable data |
| `ps_plugin_load` | Load a UXP plugin over Adobe DevTools/CDP |
| `ps_ui` / `ps_eval` | Drive or evaluate inside the loaded UXP plugin DOM |
| `ps_screenshot` | Capture the main window, desktop, or a floating UXP panel |
| `ps_panels` | List / show / hide native panels |
| `ps_native_probe` | Classify a classic plug-in / PiPL, optional Action Manager probe |
| `ps_evidence` | Build an evidence bundle (state, panels, logs, screenshots) |

## Install

```
dsh plugin --profile desktop add https://github.com/baiqiuzhang/dsh-psdbg/releases/download/v0.1.0/dsh-psdbg-0.1.0.tgz
```

**Then edit one line**: in the installed `cordis.patch.yml`, replace `<install-dir>` with the package directory (usually `~/.dsh/profiles/<profile>/node_modules/dsh-psdbg`). Restart DSH; the tools appear as `mcp__psdbg__*`.

## Requirements

- Windows + a running Photoshop; verified on Photoshop 2025 (26.0.0).
- A launcher script for your Photoshop install, set via `PSDBG_LAUNCHER` or the `~/.psdbg` config file. There is no machine-specific default.

## Limits

- Classic filters with native UI return `UI_REQUIRED` instead of pretending a click worked.
- The UXP lane needs Adobe's DevTools/CDP endpoint enabled.
- Tool descriptions cost prompt tokens every turn; keep the bundle only if you actually debug Photoshop.

## License

MIT
