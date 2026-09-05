# Building & running on Windows

Beyond the Dialogue is Windows-first in design (`%APPDATA%` storage, default wiki at `C:\Users\<you>\Documents\WorkBoard-Wiki`), and `electron-builder.yml` ships a `win: nsis` target. **Build on Windows** — electron-builder cannot cleanly cross-build a Windows NSIS installer from WSL/Linux (it needs Wine and is unsupported), and a Linux `node_modules` contains Linux binaries.

> **Why not just run it in WSLg?** You can, but the window renders through the WSL2 graphics relay — no proper GPU/HiDPI/font handling. For a faithful UI check, run natively on Windows.

## Prerequisites

- **Node.js ≥ 22** from [nodejs.org](https://nodejs.org) — the app uses the built-in `node:sqlite` (no native compilation needed).
- Nothing else. `.npmrc` already points npm and the Electron binary download at the npmmirror mirror, so installs work anywhere.

## 1. Get the source onto Windows

Clone fresh, or copy the folder out of WSL (via `\\wsl$\...` in Explorer):

```powershell
git clone <your-repo-url>
cd <project-folder>
```

## 2. Drop Linux-built artifacts, then install fresh

A WSL/Linux checkout carries Linux-native binaries (esbuild, Electron) that will not run on Windows. Remove them and re-install:

```powershell
Remove-Item -Recurse -Force node_modules, out, release -ErrorAction SilentlyContinue
npm install
```

## 3. Check the UI first — no installer needed

```powershell
npm run dev          # electron-vite dev server + Electron window, native rendering
```

## 4. Make the installer when it looks right

```powershell
npm run dist         # electron-vite build + electron-builder → release\
```

Output: `release\Beyond the Dialogue Setup <version>.exe` (NSIS, lets you choose the install directory).

## Data notes

Data created under a WSLg/Linux run does **not** follow automatically:

| What | Linux (WSL) | Windows |
| ---- | ----------- | ------- |
| App database + vault | `~/.config/<app>/` (in WSL) | `%APPDATA%\<app>\` |
| Default wiki | `~/Documents/WorkBoard-Wiki` (in WSL) | `C:\Users\<you>\Documents\WorkBoard-Wiki` |

- **Simplest:** start fresh on Windows; point Settings → General → Wiki directory at a Windows folder.
- **Carry existing tasks over (optional):** copy the SQLite `app.db` from the Linux userData into the Windows `%APPDATA%\<app>\` folder before first launch. (The vault notes and any existing wiki must be copied to matching locations too; the wiki path is then set in Settings.)

## Troubleshooting

- **SmartScreen warning on install** — the installer is unsigned; click *More info → Run anyway*. Expected until the app is code-signed.
- **`npm install` fails on Electron download** — confirm the `.npmrc` `electron_mirror` line is present; it routes the download through npmmirror.
- **Copying from WSL2 to Windows** — always delete `node_modules`, `out/`, and `release/` in the copy (step 2); they contain Linux binaries.
