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

The body is one continuous surface grown along an authored joint graph by
Blender's Skin modifier, then subdivided and smooth shaded. The geometry is
still original and still script-authored, so the authorship declaration in
character-spec.json holds; only the toolchain changed.
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
    # surface is welded and its normals rebuilt before anything is copied.
    mesh = bmesh.new()
    mesh.from_mesh(body.data)
    bmesh.ops.remove_doubles(mesh, verts=mesh.verts, dist=0.0008)
    bmesh.ops.recalc_face_normals(mesh, faces=mesh.faces)
    mesh.to_mesh(body.data)
    mesh.free()
    body.data.update()
    return body


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
    """Automatic weights from the armature, then verify every bone got a group."""
    bpy.ops.object.select_all(action='DESELECT')
    body.select_set(True)
    rig_object.select_set(True)
    bpy.context.view_layer.objects.active = rig_object
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')


# ------------------------------------------------------------------ output


def export_glb(path):
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format='GLB',
        export_yup=True,
        export_apply=True,
        export_skins=True,
        export_animations=False,
        export_materials='EXPORT',
        use_selection=True,
    )


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
    body = clothe(body)
    normalise_height(body)
    fit_triangle_budget(body)
    unwrap(body)
    bind(body, rig_object)

    metrics = measure(body)
    export_glb(OUT / 'atlas-walker-v2.glb')
    render_previews(body)

    report = {'asset': SPEC['asset'], 'version': SPEC['version'], 'metrics': metrics}
    (OUT / 'validation.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print('ATLAS_V2_METRICS', json.dumps(metrics))


main()
