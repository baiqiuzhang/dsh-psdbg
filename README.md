# dsh-psdbg

**[English](README.en.md) | 中文**

> **自著插件，MIT。** Photoshop 实机调试桥的 MCP server（DSH bundle）。
>
> **安装后必须改一行**：`cordis.patch.yml` 里 `args` 的 `<install-dir>` 换成实际安装目录（通常是 `~/.dsh/profiles/<profile>/node_modules/dsh-psdbg`），否则 MCP server 起不来。
>
> 依赖本机已安装并运行 **Photoshop**；未配置 `PSDBG_LAUNCHER` 时使用 `~/.psdbg` 配置里的 launcher。本工程只在 Windows + Photoshop 2025 上验证过。

给 AI agent 用的 Photoshop 实机调试桥。目标不是模拟鼠标点像素，而是用 **COM/ExtendScript、UXP CDP、经典 C++ SDK、UXP Hybrid SDK** 四条通道直接操作真实 Photoshop 与插件。

当前只验证了 **Windows + Photoshop 26.0.0 (2025)**，其他版本按同一命令面适配。

**无 UI 说明**：普通经典滤镜的原生 UI 没有通用无 UI 通道；桥接器会返回 `UI_REQUIRED`，不会用像素点击伪装成功。

## 命令

```powershell
node <install-dir>/bin/psdbg.mjs <command>
```

所有命令输出 JSON：`{ok, lane, data}`；失败为 `{ok:false, code, message, detail}`。

| 命令 | 作用 |
|---|---|
| `doctor` | 检查 PS、COM、截图、MSBuild、dumpbin、SDK、UXP 依赖 |
| `status` | PS 版本、文档、保存状态、对话框模式 |
| `panels list/show/hide/toggle <name>` | 打开/隐藏原生面板；UXP 面板用 CDP |
| `jsx <file\|->` | 在 PS 里跑 ExtendScript，返回 JSON |
| `plugin load <dir>` / `plugin info` / `plugin unload` | 加载/查看/卸载 UXP 插件 |
| `eval "<expr>"` | 在 UXP 插件上下文执行，支持 await |
| `ui click/set/text/layout/wait` | 直接操作插件 DOM，不点像素 |
| `shot [--full\|--panel]` | 截 PS 窗口 / 整个虚拟桌面（多显示器）/ 浮动面板 |
| `evidence --name <slug>` | 生成证据包（状态/面板/截图/日志） |
| `dialogs list/dismiss` | 关闭 PS 模态对话框（`PSDialogBox`） |
| `restart [--file <img>] [--discard]` | 正常重启 PS；默认拒绝未保存文档 |
| `capabilities <path>` | 判断 UXP / Hybrid / classic / UI_REQUIRED |
| `native list/inspect/pipl/build/deploy` | 经典 C++ 插件：构建、PE/PiPL 检查、部署 |
| `native probe/invoke <pipl.json>` | 静态判定 classic 是否可 Action 调用；`--execute` 才跑临时文档 |
| `native window list/invoke/set` | UIA 只读枚举/标准 pattern 操作；不做像素点击 |
| `hybrid prepare/build/deploy/test` | UXP Hybrid addon：构建、部署、函数验证 |
| `watch <plugin-dir>` | 监听 UXP 插件目录并热重载；hybrid 不建议常开 |
| `config show/init/set` | `%APPDATA%\ps-debug-bridge\config.json` 与 env 覆盖 |
| `daemon start/status/stop` | 本地 CDP daemon；插件命令会自动启动 |

MCP stdio 服务：`npm run mcp` 或 `node mcp/server.mjs`，提供 9 个薄工具（`ps_status`、`ps_panels`、`ps_jsx`、`ps_plugin_load`、`ps_eval`、`ps_ui`、`ps_screenshot`、`ps_native_probe`、`ps_evidence`）。schema 保持最小，避免每轮上下文膨胀。

示例：

```powershell
node bin\psdbg.mjs doctor
node bin\psdbg.mjs panels show 通道
node bin\psdbg.mjs plugin load D:\path\to\plugin\uxp
node bin\psdbg.mjs ui set "#algoSelect" "N2 理想"
node bin\psdbg.mjs ui click "#generateBtn"
node bin\psdbg.mjs shot --panel --out out\panel.png
node bin\psdbg.mjs evidence --name "panel-smoke"
```

## 四条通道

### 1) COM / ExtendScript

- PowerShell `New-Object -ComObject Photoshop.Application` → `DoJavaScriptFile`。
- 临时 `.jsx` 用 UTF-8 BOM；非 ASCII 会转 `\uXXXX`。
- ExtendScript 没有 `JSON.stringify`，桥接器注入最小 polyfill。
- 面板：`panelList` 读名称/可见性/ID；内置面板用 `app.runMenuItem(toggleXxxPalette)`，动态 UXP 面板不要用 `slct`/`setd`。

### 2) UXP CDP

- 依赖 `@bubblydoo/uxp-devtools-common@0.0.13`（MIT；内含 Adobe patched devtools helper）。
- `plugin load` 通过 Vulcan 加载插件并建立 CDP；`eval` / `ui` 直接操作插件 DOM。
- 关键实测：`element.click()` 不触发监听器，必须 `dispatchEvent(new Event('click',{bubbles:true}))`；`select`/`input` 要用原生 setter 再派发 `input`/`change`。
- 同 ID 插件冲突会让 PS 弹 C++ 运行时错误；用 `scripts/prepare-target-copy.mjs` 生成调试副本。

### 3) 经典 C++ SDK

```powershell
node bin\psdbg.mjs native build <project.vcxproj> --toolset v143
node bin\psdbg.mjs native inspect <output.8bf>
node bin\psdbg.mjs native pipl <PiPLs.json>
node bin\psdbg.mjs native deploy <output.8bf> --plugin-dir <Plug-ins>
```

- 需要 VS 2022 BuildTools 的 v143、Windows SDK、MSBuild。
- SDK 示例的 `.rc` 引用 `afxres.h`；BuildTools 未装 MFC 时，`build` 会把 `src/native-shims/afxres.h` 放到工程目录旁，`rc.exe` 即可通过。
- `inspect` 用 `dumpbin /headers /exports` 验证 x64、`PluginMain` 导出。
- `pipl` 提取 `Kind/Name/Category/HasTerminology`；有 terminology 的经典插件才适合自动 Action 调用，否则用菜单/UIA。

### 4) UXP Hybrid SDK

```powershell
node bin\psdbg.mjs hybrid prepare <template-plugin> <dest-dir> --id com.example.hybrid --name "My Hybrid"
node bin\psdbg.mjs hybrid build <template-dev\win\Sample-Uxp-Addon-1.vcxproj> --toolset v143
node bin\psdbg.mjs hybrid deploy <plugin-dir> <sample-uxp-addon.uxpaddon>
node bin\psdbg.mjs hybrid test <plugin-dir>
```

- Hybrid manifest 用 `manifestVersion:6`、`entryPoints`（大写 P）、`addon.name`、`requiredPermissions.enableAddon`。
- addon 是动态库改名 `.uxpaddon`，放在 `win/x64/`、`mac/x64/`、`mac/arm64/`。
- **一个 PS 会话只稳定支持一个 hybrid addon**。换 addon 时不要反复 unload/load；用新的插件 id/副本，或重启 PS。
- `hybrid test` 默认调用模板的 `my_function` / `my_echo` / `my_echo_async`。

## 安全与边界

- 不自动点“保存/是”；重启默认拒绝未保存文档，必须显式 `--discard`。
- 不暴力遍历 `runMenuItem`：未知菜单 ID 可能弹模态框，阻塞 COM。
- 截图只作证据；控制走 COM/CDP。
- `native deploy` 会备份被覆盖文件到 `.work/backups`；`hybrid deploy` 同样备份旧 addon。
- 不修改用户原图；测试用 `psdbg-test` 文档，结束时 `SaveOptions.DONOTSAVECHANGES` 关闭。

## 目录

```
bin/            CLI
src/            CLI 逻辑、CDP、COM、面板、截图、证据、native/hybrid
src/jsx/        ExtendScript 脚本
src/ps1/        PowerShell COM/截图/窗口/对话框
src/native-shims/ 经典 SDK 的 afxres.h 兼容头
fixtures/       UXP/classic/hybrid 夹具
test/           单元测试与探针
docs/           调研、排障、示例
.work/          SDK 解压、构建、备份、临时插件副本
```

## 已知限制

- 仅 Windows 实测；Mac SDK 只做了文档/结构调研。
- `@bubblydoo` 是第三方 patched Adobe devtools，升级前先跑 `doctor` 与 fixture。
- MCP 仅提供独立 stdio server，尚未注册到 DSH profile；当前 agent 仍以 CLI + `ps-live-debug` skill 为主。
- 经典插件若无 `HasTerminology`，自动调用仍需菜单/UIA 兜底。
- `shot --panel` 取第一个可见浮动 `OWL.Dock`；多面板时用 `--panel <title>`。

## 相关

- agent 使用契约：`~/.agents/skills/ps-live-debug/SKILL.md`
- 同类工程对比：见仓库 `docs/related-work.md`（部分 docs 未随 npm 包发布）
- 无 UI 边界：见仓库 `docs/no-ui.md`
- 验收记录：`docs/acceptance.md`
