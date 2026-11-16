# Polyscape Studio — Development

Polyscape Studio is a Photoshop [UXP](https://developer.adobe.com/photoshop/uxp/) plugin written in plain JavaScript, with no build step and no dependencies.

## Layout

```
polyscape-studio/          the plugin
  manifest.json            UXP manifest (id, version, the menu command)
  index.html               the dialog markup
  styles.css               the dialog styles
  js/polyscape-core.js     the renderer: shapes, transforms, filters, blending (no host APIs)
  js/presets.js            the built-in presets
  js/main.js               the dialog UI and the host bridges
  icons/                   plugin icons
installer/                 Windows install / uninstall scripts shipped in the release zip
tools/
  build.ps1                builds dist/PolyscapeStudio.ccx and the installer zip
  serve.js                 static server for running the UI in a browser
  make-icons.js            regenerates the icons
test/sheet.html            renders every preset as a contact sheet
LICENSE                    MIT license, also shipped inside the plugin and the installer zip
```

### How it fits together

- `polyscape-core.js` exposes `window.Polyscape`. `render(src, doc, opts)` takes an RGBA image and a design (a tree of shape nodes) and returns the rendered image plus guide geometry for the preview. It runs the same way in Photoshop and in a browser.
- `main.js` holds the UI state, builds the controls from a schema (`SECTIONS`), and talks to the host through a **bridge**:
  - the **UXP bridge** reads pixels with `imaging.getPixels`, writes the result with `imaging.putPixels` inside `executeAsModal`, and shows the dialog with `uxpShowModal`;
  - the **browser bridge** loads an image file and downloads the result as a PNG.
- Photoshop can refuse to read pixels while a modal dialog is open, so **Apply** and **Sample** close the dialog, do the work, and reopen it.
- The design, saved presets and UI settings live in `localStorage` (`polyscape.state.v1`, `polyscape.userPresets.v1`, `polyscape.ui.v1`).

### Dialog layout notes

UXP does not reliably honour percentage heights and does not keep a modal dialog on screen, so:

- `layoutAll()` sizes the columns, the preview and the scrolling controls in pixels from the dialog's measured size, and re-runs on resize and on a timer.
- `showDialog()` picks a size that fits the screen (`window.screen` when available, otherwise a conservative default), and only remembers a size the user set by dragging.
- Wheel events are routed by pointer position (`onWheel`), because UXP can deliver them to the preview while the pointer is over the controls.

## Running the UI in a browser

```bash
node tools/serve.js
```

Then open <http://localhost:5178/polyscape-studio/index.html>. It loads a demo image; use **Choose file** for your own, or pass `?img=<url>`. **Apply** and **OK** download the result as a PNG.

To render every preset against an image: <http://localhost:5178/test/sheet.html?img=your-image.jpg> (put the image in `test/`; image files there are git-ignored).

## Running in Photoshop

Load `polyscape-studio/manifest.json` with Adobe's **UXP Developer Tool** for live reload and the debugger, or build and install the package as below.

The plugin writes a diagnostic log to
`%APPDATA%\Adobe\UXP\PluginsStorage\PHSP\<version>\External\com.claxo.polyscapestudio\PluginData\polyscape-log.txt`.

## Building

Run from PowerShell (or `powershell -File` from any shell):

```powershell
powershell -File tools/build.ps1
```

This writes `dist/PolyscapeStudio.ccx` (the plugin package) and `dist/PolyscapeStudio-<version>-Installer.zip` (the package plus the install scripts). Both include `LICENSE`. The version comes from `manifest.json`.

To install the build locally:

```powershell
powershell -ExecutionPolicy Bypass -File installer/install.ps1 -Ccx dist/PolyscapeStudio.ccx
```

## Releasing

Releases are built by GitHub Actions ([`.github/workflows/release.yml`](../.github/workflows/release.yml)):

1. Bump `version` in `polyscape-studio/manifest.json` and add a `## <version>` section to `CHANGELOG.md`.
2. Commit and push.
3. Tag the commit `v<version>` and push the tag:
   ```bash
   git tag v1.0.1
   git push origin v1.0.1
   ```

The workflow checks the tag matches `manifest.json`, syntax-checks the scripts, runs `tools/build.ps1`, and publishes a GitHub release with both files from `dist/`. The release notes are install instructions plus that version's `CHANGELOG.md` section.
