# Beacon Commons gameplay blockout

This is an owner-review sketch for the populated SFACE city direction. It is
not wired into the game runtime.

`build_scene.py` creates every visible triangle from native primitives and
renders the same seeded scene each time. The character proportions and helper
geometry come from the editable Atlas Walker source. No image model, stock
asset, scan, image-to-3D input, external mesh, or texture is read.

The portrait frame tests the real intended camera: the player walks through a
working city while Nimiq team and community NPCs trade, repair, carry, plan,
queue, and travel around them.

Run `python build_scene.py` from this directory to regenerate the PNG and
validation report.
