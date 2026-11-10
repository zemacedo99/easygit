# App image assets

`logo.svg` — the EasyGit logo, shown in the app **header** next to the title and
used as the source for the app icon (`npm run make-icons` writes
`build/icon.png` and `build/icon.ico`).

It is a simple, original mark: a white Git branch glyph (three commit nodes and
a branch line) on a rounded slate-blue square (`#2f6f8f`).

It's an SVG, so it scales crisply at any size. To swap it out, keep the same
filename or update the `src="./assets/logo.svg"` reference in
`src/renderer/index.html`, then regenerate the icons.
