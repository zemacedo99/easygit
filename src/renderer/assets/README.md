# App image assets

`logo.svg` — the EasyGit logo, shown in the app **header** next to the title.

It is a single flat mark that merges three identities:

- **brand** — the red square with the curved "sail" cut at the top-right (the background).
- **mascot** — the white circuit-creature in the centre (domed head, two eyes, antennae).
- **Git** — the creature's legs are drawn as a branch/fork with commit nodes.

It's an SVG, so it scales crisply at any size. To restyle the brand, edit
`logo.svg` (the red is `#C8102E`; the inner mark is white). To swap it out, keep
the same filename or update the `src="./assets/logo.svg"` reference in
`src/renderer/index.html`.
