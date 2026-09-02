# Atlas Walker v1

Atlas Walker is the first owner-review 3D character for SFACE NIM Atlas. It is
an original procedural model built only from native mesh primitives generated
by `build_character.py`.

Version 1.1 keeps the approved body silhouette and field equipment while
refining the head toward a smoother East Asian-inspired stylized direction:
softer cheeks and jaw, tapered horizontal eyes, a subtle nose and mouth,
straight brows, and a cleaner side-swept hairstyle. It does not copy a real
person or use caricatured features.

## What is editable

- `character-spec.json` owns the visual intent, palette, proportions, and hard
  mobile budgets.
- `build_character.py` owns every vertex, material, bone, animation key, GLB
  export rule, preview, and validation check.
- `atlas-walker-v1.glb` is the compact runtime asset and can be imported into
  Blender, Godot, Unity, or another glTF-capable editor with its rig intact.

Run from the repository root with Python 3.10 or newer:

```text
python art/atlas/characters/atlas-walker-v1/build_character.py
```

The generator writes the GLB, a four-angle turntable, a front preview, a
96-pixel silhouette check, and `validation.json`. The previews are renders of
the generated mesh itself, not concept images.

## Deliberate mobile constraints

- One skinned mesh with material-grouped primitives.
- Rigid weights per body segment for predictable low-cost deformation.
- No texture maps, normal maps, alpha blending, particles, or hair cards.
- One short looping idle clip.
- A small humanoid skeleton whose names remain stable for later animation.

## Iteration points

Change silhouette and proportions in `build_parts()`, colour in
`character-spec.json`, and motion in `build_idle_animation()`. Re-run the
generator after each change so runtime output and review evidence stay aligned.
