"""Author the NIM Atlas walker in Blender, headlessly.

    blender --background --python build_character.py -- --out <dir>

Why this exists
---------------
v1 assembled the character by writing glTF buffers by hand from ellipsoids and
cylinders. That produced separate intersecting blobs at every joint, no UV set
at all (`textureMaps: 0`), and a 5200 triangle ceiling with only 574 spare, so
limbs were faceted. A play test on real phones on 2026-09-10 reported the
characters as "not close to being human".

This script keeps everything the renderer depends on and replaces the geometry:

- The 23 bone names in rig.json are a hard contract. `character-bones.ts` looks
  them up by exact authored name, `character-gait-rig.ts` drives the walk
  through the spine and leg chains, and `character-animation.ts` drives facial
  cues through eye.L, eye.R, eyelid.L, eyelid.R and mouth.
- `character-gait-rig.ts` derives leg lengths and ankle angles from the loaded
  model rather than hardcoding them, which is why v2 can change proportions
  from 3.7 heads to 6 without touching the gait.

The body is grown along an authored joint graph by Blender's Skin modifier,
then subdivided and smooth shaded. That is not one continuous surface, which an
earlier version of this comment claimed: the modifier emits three
interpenetrating shells, which is why `orient_outward` has to exist. They read
as one body because they overlap, and the seams between them lie inside solid
geometry. The geometry is still original and still script-authored, so the
authorship declaration in character-spec.json holds; only the toolchain
changed.
"""

import json
import math
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parent
SPEC = json.loads((ROOT / 'character-spec.json').read_text(encoding='utf-8'))
RIG = json.loads((ROOT / 'rig.json').read_text(encoding='utf-8'))

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = Path(argv[argv.index('--out') + 1]) if '--out' in argv else ROOT
OUT.mkdir(parents=True, exist_ok=True)

BONES = {entry['name']: entry for entry in RIG['bones']}
RADII = RIG['skinRadii']
PALETTE = SPEC['palette']


def gltf_to_blender(point):
    """Blender is Z-up; the glTF exporter's Y-up conversion maps Blender
    (x, y, z) to glTF (x, z, -y). So a target glTF point (gx, gy, gz) is
    authored here at (gx, -gz, gy). Verified empirically, not assumed."""
    gx, gy, gz = point
    return Vector((gx, -gz, gy))


def srgb_to_linear(component):
    """Blender node colours are linear; the palette is sRGB hex."""
    c = component / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def linear_rgba(hex_colour):
    value = hex_colour.lstrip('#')
    r, g, b = (int(value[i:i + 2], 16) for i in (0, 2, 4))
    return (srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b), 1.0)


# ----------------------------------------------------------------- scene


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = 'METRIC'
    scene.unit_settings.scale_length = 1.0


# --------------------------------------------------------------- armature


def build_armature():
    """Recreate the authored rest pose exactly.

    Bone heads sit on the authored joint positions. Tails point at the average
    of the children so the chain reads as a skeleton in Blender's viewport;
    that choice is cosmetic, because glTF writes each bone's rest transform and
    the exported world positions are verified against rig.json afterwards.
    """
    bpy.ops.object.armature_add(enter_editmode=True, location=(0, 0, 0))
    rig_object = bpy.context.object
    rig_object.name = 'atlas-walker-rig'
    armature = rig_object.data
    armature.name = 'atlas-walker-armature'
    for bone in list(armature.edit_bones):
        armature.edit_bones.remove(bone)

    children = {}
    for entry in RIG['bones']:
        children.setdefault(entry['parent'], []).append(entry['name'])

    created = {}
    for entry in RIG['bones']:
        bone = armature.edit_bones.new(entry['name'])
        head = gltf_to_blender(entry['world'])
        kids = children.get(entry['name'], [])
        if kids:
            tail = sum((gltf_to_blender(BONES[k]['world']) for k in kids), Vector((0, 0, 0))) / len(kids)
            if (tail - head).length < 0.012:
                tail = head + Vector((0, 0, 0.05))
        else:
            parent = entry['parent']
            direction = head - gltf_to_blender(BONES[parent]['world']) if parent else Vector((0, 0, 0.05))
            if direction.length < 0.001:
                direction = Vector((0, 0, 0.05))
            tail = head + direction.normalized() * 0.06
        bone.head, bone.tail = head, tail
        created[entry['name']] = bone

    for entry in RIG['bones']:
        if entry['parent']:
            created[entry['name']].parent = created[entry['parent']]

    bpy.ops.object.mode_set(mode='OBJECT')
    return rig_object


# ------------------------------------------------------------------- body

# The joint graph the Skin modifier grows a surface along. Most nodes are
# bones; a few are shape-only helpers with no bone behind them, because a
# skull, a palm and a toe need volume that no joint position provides.
# Each entry is (name, glTF position, radius, parent).
def body_graph():
    """The joint graph the Skin modifier grows a surface along.

    Three kinds of node:

    - **Bones**, which carry weights and must keep their authored positions.
    - **Volume helpers** (skull, crown, jaw, shoulder, palm, heel, toe), because
      a skull about 0.19 wide and a foot pointing forward are volumes no joint
      position provides.
    - **Boundary rings** (hem, cuff, bootTop, hairline). The Skin modifier emits
      an edge ring at every node, so putting a node exactly where a clothing
      edge belongs makes that edge land on a ring. The first pass assigned
      materials by height alone and the jacket hem came out as a torn zigzag,
      because the boundary cut through the middle of faces.

    Catmull-Clark subdivision shrinks volume, so radii here are authored about
    12 percent over the intended surface and the result is measured rather than
    assumed.
    """
    def bone(name):
        return BONES[name]['world']

    def offset(name, dx=0.0, dy=0.0, dz=0.0):
        x, y, z = bone(name)
        return [x + dx, y + dy, z + dz]

    landmarks = RIG['landmarks']
    hip, chin, crown = landmarks['hip'], landmarks['chin'], landmarks['crown']

    graph = [
        ('hips', bone('hips'), RADII['hips'], None),
        ('hem', [0.0, hip * 1.07, 0.0], RADII['hips'] * 1.02, 'hips'),
        ('spine', bone('spine'), RADII['spine'], 'hem'),
        ('chest', bone('chest'), RADII['chest'], 'spine'),
        ('collar', [0.0, landmarks['shoulder'] - 0.01, 0.0], RADII['chest'] * 0.86, 'chest'),
        ('neck', bone('neck'), RADII['neck'] * 1.16, 'collar'),
        ('jaw', [0.0, chin + 0.012, 0.028], 0.086, 'neck'),
        ('head', bone('head'), 0.104, 'jaw'),
        ('skull', offset('head', dy=0.082, dz=-0.004), 0.132, 'head'),
        ('hairline', offset('head', dy=0.152, dz=-0.008), 0.116, 'skull'),
        ('crown', [0.0, crown - 0.028, -0.012], 0.078, 'hairline'),
    ]

    for side, sign in (('L', 1.0), ('R', -1.0)):
        graph += [
            # A deltoid mass between the chest and the arm. Without it the
            # shoulders slope straight into the neck and the figure reads as a
            # mannequin.
            (f'shoulder.{side}', [sign * 0.152, landmarks['shoulder'] + 0.012, 0.0], 0.084, 'chest'),
            (f'upper_arm.{side}', bone(f'upper_arm.{side}'), RADII['upper_arm'] * 1.12, f'shoulder.{side}'),
            (f'cuff.{side}', [sign * 0.229, 1.19, 0.0], RADII['lower_arm'] * 1.16, f'upper_arm.{side}'),
            (f'lower_arm.{side}', bone(f'lower_arm.{side}'), RADII['lower_arm'] * 1.04, f'cuff.{side}'),
            (f'hand.{side}', bone(f'hand.{side}'), RADII['hand'] * 1.1, f'lower_arm.{side}'),
            (f'palm.{side}', offset(f'hand.{side}', dx=sign * 0.008, dy=-0.058, dz=0.012), 0.052, f'hand.{side}'),
            (f'fingers.{side}', offset(f'hand.{side}', dx=sign * 0.012, dy=-0.122, dz=0.016), 0.036, f'palm.{side}'),

            (f'upper_leg.{side}', bone(f'upper_leg.{side}'), RADII['upper_leg'] * 1.06, 'hips'),
            (f'lower_leg.{side}', bone(f'lower_leg.{side}'), RADII['lower_leg'] * 1.06, f'upper_leg.{side}'),
            (f'bootTop.{side}', [sign * 0.108, 0.255, 0.0], RADII['lower_leg'] * 1.02, f'lower_leg.{side}'),
            (f'foot.{side}', bone(f'foot.{side}'), RADII['foot'] * 1.14, f'bootTop.{side}'),
            (f'heel.{side}', offset(f'foot.{side}', dy=-0.038, dz=-0.052), 0.046, f'foot.{side}'),
            (f'toe.{side}', offset(f'foot.{side}', dy=-0.048, dz=0.128), 0.049, f'foot.{side}'),
        ]
    return graph


def build_body(rig_object):
    graph = body_graph()
    index_of = {name: index for index, (name, *_rest) in enumerate(graph)}
    vertices = [gltf_to_blender(position) for _name, position, _radius, _parent in graph]
    edges = [(index_of[parent], index_of[name]) for name, _position, _radius, parent in graph if parent]

    mesh = bpy.data.meshes.new('atlas-walker-body')
    mesh.from_pydata([tuple(v) for v in vertices], edges, [])
    mesh.update()
    body = bpy.data.objects.new('atlas-walker-body', mesh)
    bpy.context.collection.objects.link(body)
    bpy.context.view_layer.objects.active = body
    body.select_set(True)

    skin = body.modifiers.new('skin', 'SKIN')
    skin.use_smooth_shade = True
    skin.branch_smoothing = 0.35

    layer = mesh.skin_vertices[0].data
    for name, _position, radius, _parent in graph:
        layer[index_of[name]].radius = (radius, radius)
    layer[index_of['hips']].use_root = True
    # Elliptical cross sections: a torso is wider than it is deep, and a skull
    # is slightly narrower than it is tall. The Skin modifier takes an x and a
    # z radius per node, which is the only shaping control it offers.
    for name, (wide, deep) in {
        'hips': (1.14, 0.84), 'hem': (1.12, 0.84), 'spine': (1.1, 0.8),
        'chest': (1.24, 0.82), 'collar': (1.18, 0.8),
        'skull': (0.94, 1.0), 'hairline': (0.92, 1.0),
    }.items():
        base = layer[index_of[name]].radius[0]
        layer[index_of[name]].radius = (base * wide, base * deep)

    bpy.ops.object.modifier_apply(modifier='skin')

    subsurf = body.modifiers.new('subsurf', 'SUBSURF')
    subsurf.levels = subsurf.render_levels = 2
    bpy.ops.object.modifier_apply(modifier='subsurf')

    bpy.ops.object.shade_smooth()

    # The Skin modifier leaves coincident vertices and slivers where limbs
    # branch off the torso. A shell copied from that surface and pushed along a
    # degenerate normal produced a visible shard across the chest, so the
    # surface is welded before anything is copied.
    mesh = bmesh.new()
    mesh.from_mesh(body.data)
    bmesh.ops.remove_doubles(mesh, verts=mesh.verts, dist=0.0008)
    bmesh.ops.recalc_face_normals(mesh, faces=mesh.faces)
    orient_outward(mesh, graph)
    mesh.to_mesh(body.data)
    mesh.free()
    body.data.update()
    return body


def outward_at(graph):
    """A direction that is outward by construction, for any point on the body.

    Returns a function giving the direction from the closest point on the
    authored joint graph to the queried point. Every part of the surface is
    grown around that graph, so pointing away from the nearest limb axis is
    outward everywhere, and it is exactly mirror symmetric because the graph
    is — which the surface's own normals turn out not to be.
    """
    positions = {name: gltf_to_blender(point) for name, point, _radius, _parent in graph}
    segments = [(positions[parent], positions[name]) for name, _p, _r, parent in graph if parent]

    def direction(point):
        nearest, nearest_distance = None, float('inf')
        for start, end in segments:
            span = end - start
            length_squared = span.length_squared
            along = 0.0 if length_squared == 0.0 else max(0.0, min(1.0, (point - start).dot(span) / length_squared))
            offset = point - (start + span * along)
            if offset.length < nearest_distance:
                nearest_distance, nearest = offset.length, offset
        return nearest.normalized() if nearest is not None and nearest.length > 1e-9 else None

    return direction


def orient_outward(mesh, graph):
    """Point every face outward, judged against the joint graph.

    The Skin modifier does not emit one connected surface here: it emits three
    interpenetrating shells, and welding fuses the +X arm into the torso shell
    while the -X arm stays its own. `recalc_face_normals` orients each shell
    consistently, which is the wrong thing to want, because the torso shell is
    self intersecting: its head branch is wound opposite to its torso branch,
    so no single winding is outward everywhere on it. Whichever one
    `recalc_face_normals` picked, some region came out inside out. It picked
    the torso, so the +X arm faced inward, its jacket sleeve and glove were
    offset into the limb instead of over it, and the arm read as bare with a
    torn flap across the chest. It would have been backface culled in three.js
    too, so this was a shipping bug and not only a preview one.

    The surface's own normals cannot arbitrate, because the shell that is wrong
    is self consistent. The graph can, so each face is judged on its own. A
    per-shell vote was tried first and could not work for the same reason
    `recalc_face_normals` could not: a shell holding two conflicting sub
    surfaces has no right answer at shell granularity, and voting merely moved
    the inversion from the arm to the head, which silently ate the hair.

    Flipping faces individually leaves the winding inconsistent across the
    boundary between two sub surfaces, which would normally show as a black
    seam under smooth shading. It does not here, because those sub surfaces
    interpenetrate: the boundary lies inside solid geometry where no camera
    reaches it. That is verified by rendering, not assumed.
    """
    direction_at = outward_at(graph)
    mesh.normal_update()
    inverted = []
    for face in mesh.faces:
        outward = direction_at(face.calc_center_median())
        if outward is not None and face.normal.dot(outward) < 0.0:
            inverted.append(face)
    if inverted:
        bmesh.ops.reverse_faces(mesh, faces=inverted)
    mesh.normal_update()
    return len(inverted)


def normalise_height(body):
    """Land the figure on the authored height with its soles on y=0.

    Subdivision shrinks the surface and the clothing shells push back outward,
    so neither stage alone lands on 1.76. This runs last, after the garments
    exist, because normalising before them left the crown 2.9 cm proud.
    """
    lows = [vertex.co.z for vertex in body.data.vertices]
    height = max(lows) - min(lows)
    target = SPEC['scaleMeters']['height']
    if height <= 0.01:
        return
    factor = target / height
    floor = min(lows)
    for vertex in body.data.vertices:
        vertex.co.z = (vertex.co.z - floor) * factor
        vertex.co.x *= factor
        vertex.co.y *= factor
    body.data.update()


def fit_triangle_budget(body):
    """Collapse down to the stated budget rather than restating the budget.

    The shells roughly double the surface, which took the figure to about 12.4k
    against a 12k ceiling. The ceiling is the constraint, so the mesh yields to
    it; a budget edited to match whatever the build happened to emit would not
    be a budget.
    """
    budget = SPEC['mobileBudget']['maxTriangles']
    triangles = sum(len(polygon.vertices) - 2 for polygon in body.data.polygons)
    if triangles <= budget:
        return
    decimate = body.modifiers.new('decimate', 'DECIMATE')
    decimate.decimate_type = 'COLLAPSE'
    # Aim a little under so the export's own triangulation cannot cross back
    # over the line.
    decimate.ratio = (budget * 0.96) / triangles
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.modifier_apply(modifier='decimate')
    bpy.ops.object.shade_smooth()


# -------------------------------------------------------------- materials


def make_material(name, hex_colour, roughness=0.62):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    principled = material.node_tree.nodes.get('Principled BSDF')
    principled.inputs['Base Color'].default_value = linear_rgba(hex_colour)
    principled.inputs['Roughness'].default_value = roughness
    if 'Specular IOR Level' in principled.inputs:
        principled.inputs['Specular IOR Level'].default_value = 0.28
    return material


def region_of(point):
    """Which garment covers a point on the body, in glTF space.

    Used to carve clothing shells out of copies of the body surface. Boundaries
    are decided per face here too, but the consequence is different: a face
    either belongs to a shell or is deleted from it, so the visible edge is the
    shell's own border rather than a colour change running through the middle
    of a face.
    """
    gx, gy, gz = point.x, point.z, -point.y
    landmarks = RIG['landmarks']
    hip, chin, crown = landmarks['hip'], landmarks['chin'], landmarks['crown']
    shoulder = landmarks['shoulder']
    side = abs(gx)

    if gy >= chin + (crown - chin) * 0.4:
        """Hair caps the skull and stops short of the face.

        The hairline is a single sloping plane through the skull rather than a
        depth test crossed with a height test. Mixing the two cut a notch out
        of the forehead, because a face could satisfy one and fail the other.
        """
        brow = chin + (crown - chin) * 0.62
        hairline = brow + (gz - 0.02) * 0.55
        return 'hair' if gy >= hairline else None
    if gy < 0.26:
        return 'boots'
    if gy < hip * 1.07:
        return 'trousers'
    if gy < shoulder + 0.05:
        # The jacket covers the torso and the upper arms, stopping at the cuff
        # ring so the forearms show as sleeves of their own.
        if side > 0.15 and gy < 1.19:
            return None
        return 'jacket'
    return None


SHELLS = {
    'jacket': {'material': 'orange', 'thickness': 0.014},
    'trousers': {'material': 'workwear', 'thickness': 0.012},
    'boots': {'material': 'leather', 'thickness': 0.016},
    'hair': {'material': 'ink', 'thickness': 0.013},
}


def build_shell(body, name, settings):
    """Copy the body surface, keep only the covered faces, push it outward.

    This is how clothing is normally made: a fitted shell over the body rather
    than a recolour of it. It also gives the garment real thickness, so a hem
    reads as an edge instead of a colour boundary.
    """
    shell_mesh = body.data.copy()
    shell = bpy.data.objects.new(f'atlas-walker-{name}', shell_mesh)
    bpy.context.collection.objects.link(shell)
    # A garment is cut from the body, so it should be skinned like the body.
    # The copied mesh already carries the body's per-vertex weights, but those
    # are stored as group *indices*, and an object with no vertex groups leaves
    # them dangling. Recreating the groups by name in the same order makes them
    # resolve, and `join` then merges them by name.
    #
    # Letting ARMATURE_AUTO weight the garments instead was the first attempt
    # and it does not work: the shells float 12 to 16 mm off the body as
    # separate islands, so bone heat left 38 percent of the trousers with no
    # weight at all and bound the sleeves to the chest rather than the arm.
    # Walking tore the character apart, with trousers and sleeves standing
    # still while the limbs inside them swung.
    for group in body.vertex_groups:
        shell.vertex_groups.new(name=group.name)

    mesh = bmesh.new()
    mesh.from_mesh(shell_mesh)
    mesh.normal_update()
    # Capture each vertex's outward normal from the closed surface, keyed by the
    # vertex itself. Two earlier attempts got this wrong: recomputing normals
    # after the uncovered faces are deleted leaves border vertices facing
    # inward, and keying the captured normals by `vertex.index` is invalid
    # because bmesh.ops.delete re-indexes the vertices, so the offsets were
    # applied in arbitrary directions and the garments came out as patches.
    outward = {vertex: vertex.normal.copy() for vertex in mesh.verts}

    doomed = [face for face in mesh.faces if region_of(face.calc_center_median()) != name]
    bmesh.ops.delete(mesh, geom=doomed, context='FACES')
    if not mesh.faces:
        mesh.free()
        bpy.data.objects.remove(shell, do_unlink=True)
        return None
    for vertex in mesh.verts:
        vertex.co += outward[vertex] * settings['thickness']
    mesh.to_mesh(shell_mesh)
    mesh.free()

    shell_mesh.materials.clear()
    shell_mesh.materials.append(make_material(f'atlas-{settings["material"]}', PALETTE[settings['material']]))
    for polygon in shell_mesh.polygons:
        polygon.material_index = 0
    return shell


def assign_materials(body):
    """One skin material on the body; every garment is its own shell."""
    body.data.materials.clear()
    body.data.materials.append(make_material('atlas-skin', PALETTE['skin']))
    for polygon in body.data.polygons:
        polygon.material_index = 0


def clothe(body):
    shells = [shell for name, settings in SHELLS.items() if (shell := build_shell(body, name, settings))]
    bpy.ops.object.select_all(action='DESELECT')
    body.select_set(True)
    for shell in shells:
        shell.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.join()
    joined = bpy.context.object
    bpy.ops.object.shade_smooth()
    return joined


def unwrap(body):
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.02)
    bpy.ops.object.mode_set(mode='OBJECT')


def bind(body, rig_object):
    """Automatic weights from the armature.

    Runs on the bare body, before the clothing shells exist. Bone heat wants
    one closed surface around the bones; the garments are separate islands
    hovering off it, and weighting them here produced a character that came
    apart as soon as it walked. They inherit the body's weights in
    `build_shell` instead.
    """
    bpy.ops.object.select_all(action='DESELECT')
    body.select_set(True)
    rig_object.select_set(True)
    bpy.context.view_layer.objects.active = rig_object
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')


# --------------------------------------------------------------- animation

TAU = math.pi * 2.0
FPS = 24

# Rotations are authored in glTF terms, which is what the renderer speaks:
# +X is the character's left, +Y is up, +Z is forward. Every bone is given the
# same rest orientation by align_bones_for_export, so a bone's local axes are
# the world's and a rotation about X is a clean forward-and-back swing. A
# positive X rotation carries a downward-hanging limb backward, because it
# turns -Y towards -Z, so forward motion is authored as a negative X angle and
# spelled that way at the call site rather than left as a sign to rediscover.


def align_bones_for_export(rig_object):
    """Give every bone the same rest orientation, after the mesh is bound.

    This is not cosmetic, which an earlier comment here claimed. The glTF
    exporter writes each bone's rest orientation into its node, and pointing a
    bone's tail at its children makes that orientation arbitrary: upper_leg and
    upper_arm came out carrying a 180 degree rest rotation. The renderer's
    `character-gait-rig.ts` then sets leg rotations *absolutely* --
    `blendRotation(leg.upper, pose.hip, 0, 0, amount)` -- so as soon as the
    player walked, that 180 degrees was replaced by a small pitch and both legs
    snapped upright. v1 exported every bone with an identity rotation and never
    hit this; v2 quietly regressed it.

    Anatomically aimed bones are still what `ARMATURE_AUTO` needs to compute
    sane weights, so they are kept for the bind and flattened afterwards. The
    mesh does not move: Blender deforms by pose matrix against rest matrix, and
    at the rest pose that product stays identity however the rest is oriented.
    """
    bpy.context.view_layer.objects.active = rig_object
    bpy.ops.object.mode_set(mode='EDIT')
    for bone in rig_object.data.edit_bones:
        bone.use_connect = False
    for bone in rig_object.data.edit_bones:
        bone.tail = bone.head + Vector((0.0, 0.0, 0.06))
        bone.roll = 0.0
    bpy.ops.object.mode_set(mode='OBJECT')


def stride(phase, hip, knee, ankle):
    """One leg through one gait cycle, as (hip, knee, ankle) glTF X angles.

    phase 0 is the foot planted underneath the hip and moving back; 0.5 is mid
    swing. The knee is clamped to bend one way only, because a knee that goes
    negative hyperextends and reads instantly as broken.
    """
    reach = math.sin(phase * TAU)
    bend = max(0.0, math.sin(phase * TAU + 0.9)) ** 1.4
    return (-reach * hip, knee * (0.10 + 0.90 * bend), -ankle * math.sin(phase * TAU + 0.5))


def arm_swing(phase, shoulder, elbow):
    """The arm opposing a leg at the same phase."""
    reach = math.sin(phase * TAU)
    return (reach * shoulder, -elbow * (0.35 + 0.65 * max(0.0, math.sin(phase * TAU + 1.5))))


def idle_pose(t):
    """Four seconds of standing: two slow breaths and one weight shift."""
    breath = math.sin(t * TAU * 2.0)
    shift = math.sin(t * TAU)
    return {
        'hips': {'location': (0.004 * shift, 0.005 * breath, 0.0),
                 'rotation': (0.010 * breath, 0.018 * shift, 0.016 * shift)},
        'spine': {'rotation': (-0.012 * breath, 0.010 * shift, -0.010 * shift)},
        'chest': {'rotation': (-0.030 * breath, 0.014 * shift, -0.008 * shift)},
        'neck': {'rotation': (0.014 * breath, -0.020 * shift, 0.0)},
        'head': {'rotation': (0.010 * breath, -0.052 * math.sin(t * TAU * 0.5), 0.014 * shift)},
        'upper_arm.L': {'rotation': (0.030 * breath, 0.0, 0.036 * breath)},
        'upper_arm.R': {'rotation': (0.030 * breath, 0.0, -0.036 * breath)},
        'lower_arm.L': {'rotation': (-0.10 - 0.028 * breath, 0.0, 0.0)},
        'lower_arm.R': {'rotation': (-0.10 - 0.028 * breath, 0.0, 0.0)},
        'hand.L': {'rotation': (-0.06 - 0.03 * breath, 0.0, 0.0)},
        'hand.R': {'rotation': (-0.06 - 0.03 * breath, 0.0, 0.0)},
    }


def locomotion_pose(t, hip, knee, ankle, shoulder, elbow, bob, lean, roll):
    """Walk and run share one cycle and differ only in how far it is pushed.

    The left leg leads at the cycle start and the right is half a cycle behind,
    matching `atlasGaitFoot(phase + index * 0.5)` in the renderer's procedural
    gait, so the two agree while the gait blends in over the first stride
    instead of fighting each other into a limp.
    """
    left = stride(t, hip, knee, ankle)
    right = stride(t + 0.5, hip, knee, ankle)
    left_arm = arm_swing(t + 0.5, shoulder, elbow)
    right_arm = arm_swing(t, shoulder, elbow)
    # The pelvis rises twice per cycle, once over each supporting leg.
    rise = -math.cos(t * TAU * 2.0) * bob
    sway = math.sin(t * TAU) * roll
    return {
        'hips': {'location': (sway * 0.5, rise, 0.0),
                 'rotation': (lean * 0.35, math.sin(t * TAU) * 0.10, sway)},
        'spine': {'rotation': (lean * 0.25, math.sin(t * TAU) * -0.06, -sway * 0.4)},
        'chest': {'rotation': (lean * 0.40, math.sin(t * TAU) * -0.13, -sway * 0.6)},
        'neck': {'rotation': (-lean * 0.30, math.sin(t * TAU) * 0.05, 0.0)},
        'head': {'rotation': (-lean * 0.45, math.sin(t * TAU) * 0.06, sway * 0.3)},
        'upper_leg.L': {'rotation': (left[0], 0.0, 0.012)},
        'lower_leg.L': {'rotation': (left[1], 0.0, 0.0)},
        'foot.L': {'rotation': (left[2], 0.0, 0.0)},
        'upper_leg.R': {'rotation': (right[0], 0.0, -0.012)},
        'lower_leg.R': {'rotation': (right[1], 0.0, 0.0)},
        'foot.R': {'rotation': (right[2], 0.0, 0.0)},
        'upper_arm.L': {'rotation': (left_arm[0], 0.0, 0.10)},
        'lower_arm.L': {'rotation': (left_arm[1], 0.0, 0.0)},
        'upper_arm.R': {'rotation': (right_arm[0], 0.0, -0.10)},
        'lower_arm.R': {'rotation': (right_arm[1], 0.0, 0.0)},
        'hand.L': {'rotation': (-0.12, 0.0, 0.0)},
        'hand.R': {'rotation': (-0.12, 0.0, 0.0)},
    }


def walk_pose(t):
    return locomotion_pose(t, hip=0.42, knee=0.62, ankle=0.20, shoulder=0.30,
                           elbow=0.34, bob=0.013, lean=0.05, roll=0.030)


def run_pose(t):
    return locomotion_pose(t, hip=0.72, knee=1.25, ankle=0.30, shoulder=0.62,
                           elbow=0.78, bob=0.030, lean=0.22, roll=0.044)


def talk_pose(t):
    """Standing and explaining something, with both hands in the conversation.

    The renderer drives the mouth and eyes itself through `createFacialRig`, so
    this clip carries only the body. It is one of the two clips that plays
    unopposed: the procedural gait blends in with speed, so at a standstill
    idle and talk are seen exactly as authored, which is why the gesture is
    worth more detail than the stride is.
    """
    beat = math.sin(t * TAU)
    accent = math.sin(t * TAU * 2.0 + 0.6)
    nod = math.sin(t * TAU * 3.0)
    return {
        'hips': {'location': (0.006 * beat, 0.003 * accent, 0.0),
                 'rotation': (0.0, 0.030 * beat, 0.020 * beat)},
        'spine': {'rotation': (-0.020 * accent, 0.040 * beat, -0.014 * beat)},
        'chest': {'rotation': (-0.045 * accent, 0.075 * beat, -0.020 * beat)},
        'neck': {'rotation': (0.030 * nod, -0.050 * beat, 0.0)},
        'head': {'rotation': (0.045 * nod, -0.090 * beat, 0.020 * beat)},
        'upper_arm.L': {'rotation': (-0.34 - 0.20 * accent, 0.10, 0.20 + 0.08 * beat)},
        'lower_arm.L': {'rotation': (-0.85 - 0.34 * accent, 0.16, 0.0)},
        'hand.L': {'rotation': (-0.18 - 0.22 * accent, 0.0, 0.10)},
        'upper_arm.R': {'rotation': (-0.22 + 0.18 * accent, -0.10, -0.18 - 0.06 * beat)},
        'lower_arm.R': {'rotation': (-0.66 + 0.28 * accent, -0.16, 0.0)},
        'hand.R': {'rotation': (-0.14 + 0.20 * accent, 0.0, -0.10)},
    }


# The renderer looks these names up in the GLB and throws if one is absent, so
# they are a hard contract: CLIP_NAMES in character-animation.ts. Frame counts
# are chosen so the last frame repeats the first and the cycle loops.
CLIPS = (
    ('Atlas_Idle', 96, idle_pose),
    ('Atlas_Walk', 29, walk_pose),
    ('Atlas_Run', 17, run_pose),
    ('Atlas_Talk', 48, talk_pose),
)


# Every clip keys every one of these, at rest where it has nothing to say.
# A clip that simply omits a bone does not leave it at rest: it leaves it
# wherever the last clip put it, both while Blender evaluates the action and in
# the baked GLB. That shipped a talk clip standing in a full walking stride.
#
# The face is deliberately excluded. `createFacialRig` in character-animation.ts
# owns eye.L, eye.R, eyelid.L, eyelid.R and mouth, and runs after the mixer
# every frame, so keying them here would only add channels it immediately
# overwrites.
FACE_BONES = frozenset({'eye.L', 'eye.R', 'eyelid.L', 'eyelid.R', 'mouth'})
ANIMATED_BONES = tuple(
    entry['name'] for entry in RIG['bones']
    if entry['name'] != 'root' and entry['name'] not in FACE_BONES
)

REST_CHANNELS = {'rotation': (0.0, 0.0, 0.0)}


def clear_pose(rig_object):
    for bone in rig_object.pose.bones:
        bone.location = (0.0, 0.0, 0.0)
        bone.rotation_euler = (0.0, 0.0, 0.0)
        bone.scale = (1.0, 1.0, 1.0)


def author_animations(rig_object):
    """Bake the four required clips as actions, one NLA track each.

    Every frame is sampled rather than a few extremes with Bezier handles
    between them, because the exporter resamples those on its own terms and
    would quietly change the timing. The clips are short enough that writing
    each frame costs a few kilobytes.
    """
    bpy.context.scene.render.fps = FPS
    bpy.context.view_layer.objects.active = rig_object
    bpy.ops.object.mode_set(mode='POSE')
    for bone in rig_object.pose.bones:
        bone.rotation_mode = 'XYZ'

    rig_object.animation_data_create()
    authored = []
    for name, frames, evaluate in CLIPS:
        clear_pose(rig_object)
        action = bpy.data.actions.new(name)
        action.use_fake_user = True
        rig_object.animation_data.action = action
        for frame in range(frames + 1):
            phase = (frame % frames) / frames
            pose = evaluate(phase)
            bpy.context.scene.frame_set(frame)
            unknown = set(pose) - set(ANIMATED_BONES)
            if unknown:
                raise RuntimeError(name + ' targets unknown bones: ' + ', '.join(sorted(unknown)))
            for bone_name in ANIMATED_BONES:
                channels = pose.get(bone_name, REST_CHANNELS)
                bone = rig_object.pose.bones[bone_name]
                bone.rotation_euler = channels.get('rotation', (0.0, 0.0, 0.0))
                bone.keyframe_insert('rotation_euler', frame=frame)
                bone.location = channels.get('location', (0.0, 0.0, 0.0))
                bone.keyframe_insert('location', frame=frame)
        rig_object.animation_data.action = None
        track = rig_object.animation_data.nla_tracks.new()
        track.name = name
        track.strips.new(name, 0, action)
        authored.append((name, frames / FPS))

    clear_pose(rig_object)
    bpy.context.scene.frame_set(0)
    bpy.ops.object.mode_set(mode='OBJECT')
    return authored


# ------------------------------------------------------------------ output


def export_glb(path):
    bpy.ops.object.select_all(action='SELECT')
    export_selected(path)


def export_selected(path):
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format='GLB',
        export_yup=True,
        export_apply=True,
        export_skins=True,
        export_animations=True,
        export_animation_mode='ACTIONS',
        export_nla_strips=True,
        export_bake_animation=False,
        export_optimize_animation_size=True,
        export_frame_range=False,
        export_materials='EXPORT',
        use_selection=True,
    )


def silence_animation(rig_object):
    """Put the rig back on its rest pose for still renders.

    Every clip's NLA strip starts at frame 0, so while they are live the pose
    at frame 0 is whichever strip evaluates last, not the rest pose. The first
    contact sheet rendered a talk gesture under all four clip names before this
    was noticed, which is exactly the kind of thing metrics cannot catch.
    """
    rig_object.animation_data.action = None
    for track in rig_object.animation_data.nla_tracks:
        track.mute = True
    clear_pose(rig_object)
    bpy.context.scene.frame_set(0)


# The renderer draws citizens at two detail levels and the verifier holds each
# to its own ceiling: 3300 triangles for LOD1 and 800 for LOD2. Both still need
# all 23 joints and all four clips, because `atlasCitizenDetailLevel` swaps
# between them mid-stride and the animator throws on a missing clip.
LODS = (('lod1', 3300), ('lod2', 800))


def export_lods(body, rig_object):
    """Collapse copies of the hero mesh down to each LOD budget and export them.

    The armature, its weights and all four clips come along unchanged, so a
    citizen that crosses the detail threshold keeps the same skeleton and the
    same clip names on the other side. Only the surface gets cheaper.
    """
    exported = []
    for name, budget in LODS:
        triangles = sum(len(polygon.vertices) - 2 for polygon in body.data.polygons)
        lod = body.copy()
        lod.data = body.data.copy()
        lod.name = f'atlas-walker-{name}'
        bpy.context.collection.objects.link(lod)
        bpy.context.view_layer.objects.active = lod
        if triangles > budget:
            decimate = lod.modifiers.new('decimate', 'DECIMATE')
            decimate.decimate_type = 'COLLAPSE'
            # Aim under the line so the exporter's own triangulation of any
            # remaining quads cannot push it back over.
            decimate.ratio = (budget * 0.94) / triangles
            bpy.ops.object.modifier_apply(modifier='decimate')
        bpy.ops.object.shade_smooth()

        bpy.ops.object.select_all(action='DESELECT')
        lod.select_set(True)
        rig_object.select_set(True)
        bpy.context.view_layer.objects.active = rig_object
        path = OUT / f'atlas-walker-v2-{name}.glb'
        export_selected(path)
        exported.append({
            'name': name,
            'triangles': sum(len(polygon.vertices) - 2 for polygon in lod.data.polygons),
            'budget': budget,
            'file': path.name,
        })
        bpy.data.objects.remove(lod, do_unlink=True)
    return exported


def render_previews(body):
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x = scene.render.resolution_y = 640
    scene.render.film_transparent = False
    scene.world = bpy.data.worlds.new('atlas-world')
    scene.world.use_nodes = True
    scene.world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.94, 0.93, 0.89, 1.0)

    bpy.ops.object.light_add(type='SUN', location=(2.4, -3.2, 3.4))
    sun = bpy.context.object
    sun.data.energy = 4.2
    sun.rotation_euler = (math.radians(56), 0, math.radians(38))

    bpy.ops.object.camera_add(location=(0, -3.4, 0.95))
    camera = bpy.context.object
    camera.data.lens = 62
    scene.camera = camera

    for name, (x, y, rotation_z) in {
        'preview-front': (0.0, -3.4, 0.0),
        'preview-three-quarter': (-2.3, -2.5, math.radians(-42)),
    }.items():
        camera.location = (x, y, 0.95)
        camera.rotation_euler = (math.radians(88), 0, rotation_z)
        scene.render.filepath = str(OUT / name)
        bpy.ops.render.render(write_still=True)
    return camera


def render_clip_contact_sheets(rig_object, camera):
    """Render each clip at four points in its cycle, from the side.

    Metrics cannot see a limb bending the wrong way and a rest-pose render
    cannot either, so every clip is looked at. The camera sits off the
    character's left, because a stride reads as a stride in profile and reads
    as almost nothing head on.
    """
    scene = bpy.context.scene
    camera.location = (3.2, -1.5, 0.95)
    camera.rotation_euler = (math.radians(88), 0, math.radians(65))
    for name, frames, _evaluate in CLIPS:
        # Assign the action directly. Muting every other NLA track looks like
        # it should isolate a clip and does not reliably, so the clip under
        # test is the only thing driving the rig here.
        rig_object.animation_data.action = bpy.data.actions[name]
        for index in range(4):
            scene.frame_set(round(frames * index / 4))
            scene.render.filepath = str(OUT / f'clip-{name.replace("Atlas_", "").lower()}-{index}')
            bpy.ops.render.render(write_still=True)
    rig_object.animation_data.action = None
    clear_pose(rig_object)
    scene.frame_set(0)


def measure(body):
    mesh = body.data
    triangles = sum(len(polygon.vertices) - 2 for polygon in mesh.polygons)
    lows = [vertex.co for vertex in mesh.vertices]
    height = max(v.z for v in lows) - min(v.z for v in lows)
    skull = [v.z for v in lows if v.z >= RIG['landmarks']['chin'] - 0.001]
    heads_tall = height / (max(skull) - min(skull)) if skull and max(skull) > min(skull) else 0.0
    return {
        'vertices': len(mesh.vertices),
        'triangles': triangles,
        'polygons': len(mesh.polygons),
        'materials': len(mesh.materials),
        'uvLayers': len(mesh.uv_layers),
        'vertexGroups': len(body.vertex_groups),
        'heightMeters': round(height, 4),
        'headsTall': round(heads_tall, 3),
    }


def main():
    reset_scene()
    rig_object = build_armature()
    body = build_body(rig_object)
    assign_materials(body)
    bind(body, rig_object)
    body = clothe(body)
    normalise_height(body)
    fit_triangle_budget(body)
    unwrap(body)
    align_bones_for_export(rig_object)
    clips = author_animations(rig_object)

    metrics = measure(body)
    metrics['animationClips'] = len(clips)
    export_glb(OUT / 'atlas-walker-v2.glb')
    lods = export_lods(body, rig_object)
    metrics['lods'] = lods
    silence_animation(rig_object)
    camera = render_previews(body)
    render_clip_contact_sheets(rig_object, camera)

    report = {
        'asset': SPEC['asset'],
        'version': SPEC['version'],
        'metrics': metrics,
        'clips': [{'name': name, 'seconds': round(seconds, 4)} for name, seconds in clips],
    }
    (OUT / 'validation.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print('ATLAS_V2_METRICS', json.dumps(metrics))


main()
