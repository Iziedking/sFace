# NIM Atlas art source

The current approval direction is the editable SVG source:

- `characters/avatar-key-art.svg`
- `characters/mara-key-art.svg`
- `environments/pay-harbor-layout.svg`

The first native 3D iteration now lives in
`characters/atlas-walker-v1/`. Its tracked specification and Python generator
create an original rigged GLB and deterministic mesh previews without generated
images, image-to-3D conversion, stock models, or external meshes. Version 1 is
an owner-review asset, not yet an approved production character.

These files use deterministic vector paths and the repository's exact Sface
tokens. They contain no embedded diffusion-generated raster, external image,
real-person likeness, copied character, private information, or wallet
credential. They remain approval references rather than production sprites.

The PNG files are preserved as rejected image-generation references for audit
history. They must not ship and must not be used to derive production art.

Production use is blocked until the owner approves the exact character and
environment vectors. After approval, a designer can refine the SVG geometry in
Figma, Illustrator, or Inkscape and export the versioned sprite atlases while
preserving the provenance records in `licenses.json`.
