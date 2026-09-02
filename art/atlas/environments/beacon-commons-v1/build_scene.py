"""Render the SFACE Beacon Commons owner-review blockout from native 3D primitives.

The script reads no image, texture, stock model, scan, or external mesh. It
imports only the procedural primitive helpers from the approved Atlas Walker
source, builds a seeded low-poly city, and rasterizes it with Pillow.
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import math
import struct
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parent
SPEC_PATH = ROOT / "scene-spec.json"
OUTPUT_PATH = ROOT / "preview-gameplay-portrait.png"
OVERVIEW_PATH = ROOT / "preview-city-overview.png"
GLB_PATH = ROOT / "beacon-commons-v1.glb"
REVIEW_GLB_PATH = ROOT / "beacon-commons-review-v2.glb"
VALIDATION_PATH = ROOT / "validation.json"
CHARACTER_SOURCE = ROOT.parents[1] / "characters" / "atlas-walker-v1" / "build_character.py"

Vec3 = tuple[float, float, float]


def load_character_source():
    spec = importlib.util.spec_from_file_location("atlas_walker_source", CHARACTER_SOURCE)
    if spec is None or spec.loader is None:
        raise RuntimeError("Atlas Walker procedural source could not be loaded.")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


CHAR = load_character_source()


def add(a: Vec3, b: Vec3) -> Vec3:
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def sub(a: Vec3, b: Vec3) -> Vec3:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def mul(a: Vec3, value: float) -> Vec3:
    return (a[0] * value, a[1] * value, a[2] * value)


def dot(a: Vec3, b: Vec3) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def cross(a: Vec3, b: Vec3) -> Vec3:
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def unit(value: Vec3) -> Vec3:
    length = math.sqrt(max(dot(value, value), 1e-12))
    return (value[0] / length, value[1] / length, value[2] / length)


def rgb(value: str) -> tuple[int, int, int]:
    return CHAR.hex_rgb(value)


def rotate_y(point: Vec3, degrees: float) -> Vec3:
    angle = math.radians(degrees)
    cosine, sine = math.cos(angle), math.sin(angle)
    return (point[0] * cosine + point[2] * sine, point[1], -point[0] * sine + point[2] * cosine)


@dataclass
class Mesh:
    name: str
    colour: tuple[int, int, int]
    positions: list[Vec3]
    indices: list[int]
    outline: bool = False


class Scene:
    def __init__(self, palette: dict[str, str]) -> None:
        self.palette = {name: rgb(value) for name, value in palette.items()}
        self.meshes: list[Mesh] = []

    def add_part(
        self,
        part,
        colour: str | tuple[int, int, int],
        position: Vec3 = (0.0, 0.0, 0.0),
        yaw: float = 0.0,
        scale: float = 1.0,
        outline: bool = False,
    ) -> None:
        base = self.palette[colour] if isinstance(colour, str) else colour
        points = [add(rotate_y(mul(point, scale), yaw), position) for point in part.positions]
        self.meshes.append(Mesh(part.name, base, points, list(part.indices), outline))

    def box(self, name: str, colour: str, center: Vec3, size: Vec3, yaw: float = 0.0, taper: float = 0.0, outline: bool = False) -> None:
        part = CHAR.faceted_box(name, colour, "root", (0.0, 0.0, 0.0), size, taper)
        self.add_part(part, colour, center, yaw, outline=outline)

    def cylinder(self, name: str, colour: str, start: Vec3, end: Vec3, r0: float, r1: float | None = None, segments: int = 8, outline: bool = False) -> None:
        part = CHAR.cylinder_between(name, colour, "root", start, end, r0, r1, segments)
        self.add_part(part, colour, outline=outline)

    def ellipsoid(self, name: str, colour: str, center: Vec3, radii: Vec3, segments: int = 10, rings: int = 5, outline: bool = False) -> None:
        part = CHAR.ellipsoid(name, colour, "root", center, radii, segments, rings)
        self.add_part(part, colour, outline=outline)

    def polygon(self, name: str, colour: str, vertices: list[Vec3], outline: bool = False) -> None:
        part = CHAR.wedge(name, colour, "root", vertices, [tuple(range(len(vertices)))])
        self.add_part(part, colour, outline=outline)


class GlbWriter:
    """Small native GLB writer used only for the generated Beacon Commons mesh."""

    def __init__(self) -> None:
        self.data = bytearray()
        self.views: list[dict] = []
        self.accessors: list[dict] = []

    def align(self) -> None:
        while len(self.data) % 4:
            self.data.append(0)

    def add_view(self, payload: bytes, target: int | None = None) -> int:
        self.align()
        offset = len(self.data)
        self.data.extend(payload)
        view = {"buffer": 0, "byteOffset": offset, "byteLength": len(payload)}
        if target is not None:
            view["target"] = target
        self.views.append(view)
        return len(self.views) - 1

    def add_accessor(
        self,
        payload: bytes,
        component_type: int,
        count: int,
        accessor_type: str,
        target: int,
        minimum: list[float] | list[int] | None = None,
        maximum: list[float] | list[int] | None = None,
    ) -> int:
        view = self.add_view(payload, target)
        accessor = {"bufferView": view, "componentType": component_type, "count": count, "type": accessor_type}
        if minimum is not None:
            accessor["min"] = minimum
        if maximum is not None:
            accessor["max"] = maximum
        self.accessors.append(accessor)
        return len(self.accessors) - 1


def pack_float_values(values: Iterable[float]) -> bytes:
    numbers = list(values)
    return struct.pack("<" + "f" * len(numbers), *numbers)


def pack_index_values(values: Iterable[int], component_type: int) -> bytes:
    numbers = list(values)
    if component_type == 5123:
        return struct.pack("<" + "H" * len(numbers), *numbers)
    return struct.pack("<" + "I" * len(numbers), *numbers)


def export_city_glb(scene: Scene, output_path: Path = GLB_PATH) -> dict:
    """Export the generated scene meshes as a texture-free, unskinned GLB."""
    writer = GlbWriter()
    grouped: dict[tuple[int, int, int], list[Mesh]] = {}
    for mesh in scene.meshes:
        grouped.setdefault(mesh.colour, []).append(mesh)

    materials = []
    primitives = []
    total_vertices = 0
    total_triangles = 0
    for material_index, (colour, meshes) in enumerate(grouped.items()):
        positions: list[Vec3] = []
        indices: list[int] = []
        for mesh in meshes:
            base = len(positions)
            positions.extend(mesh.positions)
            indices.extend(base + index for index in mesh.indices)
        normals = [(0.0, 0.0, 0.0) for _ in positions]
        for index in range(0, len(indices), 3):
            a, b, c = (positions[indices[index + offset]] for offset in range(3))
            normal = unit(cross(sub(b, a), sub(c, a)))
            for vertex_index in indices[index : index + 3]:
                normals[vertex_index] = add(normals[vertex_index], normal)
        normals = [unit(normal) for normal in normals]
        position_values = [value for point in positions for value in point]
        normal_values = [value for point in normals for value in point]
        max_index = max(indices)
        component_type = 5123 if max_index <= 65535 else 5125
        position_accessor = writer.add_accessor(
            pack_float_values(position_values),
            5126,
            len(positions),
            "VEC3",
            34962,
            [min(point[index] for point in positions) for index in range(3)],
            [max(point[index] for point in positions) for index in range(3)],
        )
        normal_accessor = writer.add_accessor(pack_float_values(normal_values), 5126, len(normals), "VEC3", 34962)
        index_accessor = writer.add_accessor(
            pack_index_values(indices, component_type),
            component_type,
            len(indices),
            "SCALAR",
            34963,
            [0],
            [max_index],
        )
        primitives.append({
            "attributes": {"POSITION": position_accessor, "NORMAL": normal_accessor},
            "indices": index_accessor,
            "material": material_index,
            "mode": 4,
        })
        materials.append({
            "name": "BeaconCommons_" + "".join(f"{channel:02x}" for channel in colour),
            "pbrMetallicRoughness": {
                "baseColorFactor": [channel / 255.0 for channel in colour] + [1.0],
                "metallicFactor": 0.0,
                "roughnessFactor": 0.9,
            },
        })
        total_vertices += len(positions)
        total_triangles += len(indices) // 3

    document = {
        "asset": {"version": "2.0", "generator": "SFACE native procedural Beacon Commons builder 1.0"},
        "scene": 0,
        "scenes": [{"name": "Beacon Commons", "nodes": [0]}],
        "nodes": [{"name": "BeaconCommons_Mesh", "mesh": 0}],
        "meshes": [{"name": "BeaconCommons_Low", "primitives": primitives}],
        "materials": materials,
        "buffers": [{"byteLength": len(writer.data)}],
        "bufferViews": writer.views,
        "accessors": writer.accessors,
    }
    json_bytes = json.dumps(document, separators=(",", ":")).encode("utf-8")
    while len(json_bytes) % 4:
        json_bytes += b" "
    writer.align()
    binary_bytes = bytes(writer.data)
    payload = struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(json_bytes) + 8 + len(binary_bytes))
    payload += struct.pack("<I4s", len(json_bytes), b"JSON") + json_bytes
    payload += struct.pack("<I4s", len(binary_bytes), b"BIN\x00") + binary_bytes
    output_path.write_bytes(payload)
    return {"glbBytes": len(payload), "vertices": total_vertices, "triangles": total_triangles, "materials": len(materials), "meshParts": len(scene.meshes)}


def add_shadow(scene: Scene, x: float, z: float, sx: float, sz: float) -> None:
    vertices = []
    segments = 14
    for index in range(segments):
        angle = 2 * math.pi * index / segments
        vertices.append((x + math.cos(angle) * sx, 0.018, z + math.sin(angle) * sz))
    scene.polygon("blob_shadow", "charcoal", vertices)


def local_point(point: Vec3, position: Vec3, yaw: float, scale: float) -> Vec3:
    return add(rotate_y(mul(point, scale), yaw), position)


def limb(scene: Scene, name: str, colour: str, a: Vec3, b: Vec3, radius_a: float, radius_b: float, position: Vec3, yaw: float, scale: float) -> None:
    scene.cylinder(name, colour, local_point(a, position, yaw, scale), local_point(b, position, yaw, scale), radius_a * scale, radius_b * scale, 7)


def add_character(
    scene: Scene,
    name: str,
    position: Vec3,
    yaw: float,
    jacket: str,
    pose: str,
    scale: float = 1.0,
    player: bool = False,
    carrying: bool = False,
) -> None:
    """Build one rig-friendly person from the Atlas Walker proportions."""
    add_shadow(scene, position[0], position[2], 0.42 * scale, 0.24 * scale)
    skin = "skin" if int(abs(position[0] * 9 + position[2] * 7)) % 2 == 0 else "skinShadow"
    pants = "charcoal" if name[-1:] not in {"2", "5", "8"} else "leather"

    face_segments = 14 if player or name == "guide" else 10
    for part, colour in (
        (CHAR.cylinder_between(f"{name}_torso", jacket, "root", (0.0, 1.02, 0.0), (0.0, 1.49, 0.0), 0.225, 0.275, 12), jacket),
        (CHAR.ellipsoid(f"{name}_shoulders", jacket, "root", (0.0, 1.46, 0.0), (0.29, 0.14, 0.18), 12, 6), jacket),
        (CHAR.cylinder_between(f"{name}_belt", "ink", "root", (-0.22, 1.04, 0.0), (0.22, 1.04, 0.0), 0.035, 0.035, 7), "ink"),
        (CHAR.ellipsoid(f"{name}_hips", pants, "root", (0.0, 0.91, 0.0), (0.24, 0.17, 0.17), 10, 5), pants),
        (CHAR.cylinder_between(f"{name}_neck", skin, "root", (0.0, 1.58, 0.0), (0.0, 1.67, 0.0), 0.065, 0.06, 8), skin),
        (CHAR.ellipsoid(f"{name}_head", skin, "root", (0.0, 1.81, 0.01), (0.165, 0.205, 0.145), face_segments, 7), skin),
        (CHAR.ellipsoid(f"{name}_hair", "ink", "root", (-0.006, 1.94, -0.01), (0.174, 0.092, 0.151), face_segments, 6), "ink"),
        (CHAR.ellipsoid(f"{name}_fringe_l", "ink", "root", (-0.064, 1.91, 0.133), (0.078, 0.030, 0.022), 8, 4), "ink"),
        (CHAR.ellipsoid(f"{name}_fringe_r", "ink", "root", (0.061, 1.916, 0.133), (0.066, 0.025, 0.020), 8, 4), "ink"),
    ):
        scene.add_part(part, colour, position, yaw, scale)

    if player or name == "guide":
        for side, x in (("l", 0.056), ("r", -0.056)):
            eye = CHAR.ellipsoid(f"{name}_eye_{side}", "ink", "root", (x, 1.85, 0.150), (0.038, 0.009, 0.006), 8, 4)
            scene.add_part(eye, "ink", position, yaw, scale)
        nose = CHAR.ellipsoid(f"{name}_nose", "skinShadow", "root", (0.0, 1.802, 0.151), (0.015, 0.025, 0.011), 8, 4)
        scene.add_part(nose, "skinShadow", position, yaw, scale)

    if pose == "walk-a":
        left_hand, right_hand = (0.25, 0.98, -0.20), (-0.24, 1.03, 0.22)
        left_foot, right_foot = (0.17, 0.04, 0.22), (-0.16, 0.04, -0.16)
    elif pose == "walk-b":
        left_hand, right_hand = (0.25, 1.03, 0.22), (-0.24, 0.98, -0.20)
        left_foot, right_foot = (0.17, 0.04, -0.16), (-0.16, 0.04, 0.22)
    elif pose == "gesture":
        left_hand, right_hand = (0.34, 1.18, 0.10), (-0.38, 1.58, 0.08)
        left_foot, right_foot = (0.17, 0.04, 0.04), (-0.17, 0.04, -0.03)
    elif pose == "repair":
        left_hand, right_hand = (0.30, 0.92, 0.26), (-0.28, 0.88, 0.27)
        left_foot, right_foot = (0.19, 0.04, 0.10), (-0.19, 0.04, -0.08)
    elif pose == "carry":
        left_hand, right_hand = (0.29, 1.02, 0.28), (-0.29, 1.02, 0.28)
        left_foot, right_foot = (0.17, 0.04, 0.16), (-0.17, 0.04, -0.10)
    else:
        left_hand, right_hand = (0.29, 0.93, 0.06), (-0.29, 0.93, 0.06)
        left_foot, right_foot = (0.17, 0.04, 0.04), (-0.17, 0.04, -0.03)

    limb(scene, f"{name}_upper_arm_l", jacket, (0.25, 1.44, 0.0), (0.29, 1.20, 0.02), 0.075, 0.062, position, yaw, scale)
    limb(scene, f"{name}_lower_arm_l", pants, (0.29, 1.20, 0.02), left_hand, 0.062, 0.048, position, yaw, scale)
    limb(scene, f"{name}_upper_arm_r", jacket, (-0.25, 1.44, 0.0), (-0.29, 1.20, 0.02), 0.075, 0.062, position, yaw, scale)
    limb(scene, f"{name}_lower_arm_r", pants, (-0.29, 1.20, 0.02), right_hand, 0.062, 0.048, position, yaw, scale)
    limb(scene, f"{name}_leg_l", pants, (0.14, 0.89, 0.0), (0.15, 0.48, left_foot[2] * 0.35), 0.098, 0.084, position, yaw, scale)
    limb(scene, f"{name}_shin_l", pants, (0.15, 0.48, left_foot[2] * 0.35), left_foot, 0.084, 0.068, position, yaw, scale)
    limb(scene, f"{name}_leg_r", pants, (-0.14, 0.89, 0.0), (-0.15, 0.48, right_foot[2] * 0.35), 0.098, 0.084, position, yaw, scale)
    limb(scene, f"{name}_shin_r", pants, (-0.15, 0.48, right_foot[2] * 0.35), right_foot, 0.084, 0.068, position, yaw, scale)
    for side, foot in (("l", left_foot), ("r", right_foot)):
        part = CHAR.ellipsoid(f"{name}_boot_{side}", "ink", "root", (foot[0], 0.11, foot[2] + 0.07), (0.105, 0.08, 0.155), 8, 4)
        scene.add_part(part, "ink", position, yaw, scale)

    if player:
        pack = CHAR.ellipsoid(f"{name}_signal_pack", "seafoam", "root", (-0.08, 1.29, -0.20), (0.20, 0.24, 0.09), 10, 5)
        latch = CHAR.faceted_box(f"{name}_pack_latch", "cream", "root", (-0.08, 1.33, -0.33), (0.15, 0.13, 0.04), 0.12)
        scene.add_part(pack, "seafoam", position, yaw, scale, outline=True)
        scene.add_part(latch, "cream", position, yaw, scale)
        limb(scene, f"{name}_antenna", "ink", (-0.23, 1.48, -0.25), (-0.28, 1.82, -0.26), 0.014, 0.009, position, yaw, scale)
        tip = CHAR.ellipsoid(f"{name}_antenna_tip", "orange", "root", (-0.28, 1.85, -0.26), (0.04, 0.04, 0.04), 6, 3)
        scene.add_part(tip, "orange", position, yaw, scale)

    if carrying:
        crate_center = local_point((0.0, 1.00, 0.36), position, yaw, scale)
        scene.box(f"{name}_crate", "paper", crate_center, (0.46 * scale, 0.34 * scale, 0.36 * scale), yaw, outline=True)
        scene.box(f"{name}_crate_mark", "orange", local_point((0.0, 1.01, 0.555), position, yaw, scale), (0.16 * scale, 0.12 * scale, 0.025 * scale), yaw)


def add_tree(scene: Scene, x: float, z: float, scale: float = 1.0) -> None:
    scene.cylinder("tree_trunk", "leather", (x, 0.0, z), (x, 1.45 * scale, z), 0.16 * scale, 0.12 * scale, 7)
    scene.ellipsoid("tree_crown", "plant", (x, 2.00 * scale, z), (0.72 * scale, 0.68 * scale, 0.66 * scale), 10, 5)
    scene.ellipsoid("tree_crown_high", "seafoam", (x - 0.28 * scale, 2.34 * scale, z + 0.08 * scale), (0.43 * scale, 0.42 * scale, 0.40 * scale), 9, 5)
    scene.ellipsoid("tree_crown_side", "plant", (x + 0.38 * scale, 2.18 * scale, z - 0.10 * scale), (0.40 * scale, 0.38 * scale, 0.38 * scale), 9, 5)


def add_gabled_roof(scene: Scene, name: str, colour: str, center: Vec3, size: Vec3, yaw: float = 0.0) -> None:
    hx, hy, hz = size[0] / 2, size[1] / 2, size[2] / 2
    vertices = [
        (-hx, -hy, -hz), (hx, -hy, -hz), (hx, -hy, hz), (-hx, -hy, hz),
        (0.0, hy, -hz), (0.0, hy, hz),
    ]
    faces = [(0, 1, 2, 3), (0, 4, 5, 3), (1, 2, 5, 4), (0, 1, 4), (3, 5, 2)]
    scene.add_part(CHAR.wedge(name, colour, "root", vertices, faces), colour, center, yaw, 1.0, outline=True)


def add_townhouse(scene: Scene, name: str, x: float, z: float, width: float, depth: float, yaw: float, accent: str) -> None:
    scene.box(f"{name}_plinth", "leather", (x, 0.16, z), (width + 0.22, 0.32, depth + 0.18), yaw, taper=0.03, outline=True)
    scene.box(f"{name}_base", "paper", (x, 1.28, z), (width, 2.56, depth), yaw, taper=0.04, outline=True)
    scene.box(f"{name}_upper", "cream", (x, 2.08, z + 0.03), (width * 0.90, 0.82, depth * 1.02), yaw, taper=0.03)
    add_gabled_roof(scene, f"{name}_roof", accent, (x, 3.03, z), (width + 0.56, 0.86, depth + 0.68), yaw)
    scene.box(f"{name}_eave", "ink", (x, 2.63, z + depth * 0.53), (width + 0.38, 0.11, 0.16), yaw, taper=0.04)
    scene.box(f"{name}_door", "ink", (x, 0.92, z + depth * 0.505), (0.66, 1.62, 0.08), yaw)
    for dx in (-width * 0.27, width * 0.27):
        scene.box(f"{name}_window", "seafoam", (x + dx, 1.86, z + depth * 0.51), (0.54, 0.62, 0.07), yaw, taper=0.10, outline=True)
        scene.box(f"{name}_window_bar", "ink", (x + dx, 1.86, z + depth * 0.555), (0.045, 0.62, 0.025), yaw)
        scene.box(f"{name}_window_sill", "leather", (x + dx, 1.51, z + depth * 0.56), (0.68, 0.08, 0.10), yaw)
    scene.box(f"{name}_beam_top", "leather", (x, 2.48, z + depth * 0.545), (width * 0.92, 0.10, 0.07), yaw)
    scene.box(f"{name}_beam_mid", "leather", (x, 1.36, z + depth * 0.545), (width * 0.92, 0.09, 0.07), yaw)
    scene.box(f"{name}_sign", accent, (x + width * 0.34, 1.18, z + depth * 0.58), (0.42, 0.62, 0.09), yaw, taper=0.12, outline=True)


def add_street_block(scene: Scene, name: str, x: float, z: float, height: float, side: int, accent: str) -> None:
    """Add one cheap street-canyon block with detail only on the visible face."""
    width, depth = 3.2, 4.6
    scene.box(f"{name}_base", "paper", (x, height * 0.48, z), (width, height * 0.96, depth), 0, taper=0.025, outline=True)
    scene.box(f"{name}_upper", "cream", (x, height * 0.77, z), (width * 1.05, height * 0.38, depth * 1.02), 0, taper=0.018)
    scene.box(f"{name}_roofline", accent, (x, height + 0.10, z), (width + 0.42, 0.24, depth + 0.40), 0, taper=0.04, outline=True)
    facade_x = x - side * (width / 2 + 0.025)
    normal = -side
    for floor_y in (2.15,):
        for offset_z in (-1.05, 0.45):
            half_y, half_z = 0.34, 0.34
            scene.polygon(
                f"{name}_window",
                "seafoam",
                [
                    (facade_x, floor_y - half_y, z + offset_z - half_z),
                    (facade_x, floor_y + half_y, z + offset_z - half_z),
                    (facade_x, floor_y + half_y, z + offset_z + half_z),
                    (facade_x, floor_y - half_y, z + offset_z + half_z),
                ][::normal],
                outline=True,
            )
    door_y, door_z = 0.92, z + 1.25
    scene.polygon(
        f"{name}_door",
        "ink",
        [
            (facade_x, 0.08, door_z - 0.36),
            (facade_x, door_y * 2, door_z - 0.36),
            (facade_x, door_y * 2, door_z + 0.36),
            (facade_x, 0.08, door_z + 0.36),
        ][::normal],
        outline=True,
    )


def add_planter(scene: Scene, x: float, z: float, scale: float = 1.0) -> None:
    scene.cylinder("planter", "leather", (x, 0.02, z), (x, 0.40 * scale, z), 0.38 * scale, 0.32 * scale, 9, outline=True)
    for dx, dz, height in ((-0.18, 0.0, 0.85), (0.16, 0.08, 0.72), (0.03, -0.16, 0.92)):
        scene.cylinder("planter_stem", "plant", (x + dx * scale, 0.36 * scale, z + dz * scale), (x + dx * scale, height * scale, z + dz * scale), 0.035 * scale, 0.020 * scale, 6)
        scene.ellipsoid("planter_leaf", "seafoam", (x + dx * scale, height * scale, z + dz * scale), (0.18 * scale, 0.13 * scale, 0.12 * scale), 8, 4)


def add_market(scene: Scene) -> None:
    for index, z in enumerate((-1.5, -4.2, -6.9)):
        x = -5.6
        scene.box(f"stall_{index}_counter", "leather", (x, 0.72, z), (3.1, 0.24, 1.4), -7, outline=True)
        scene.box(f"stall_{index}_back", "paper", (x, 1.65, z - 0.60), (3.2, 1.9, 0.18), -7, outline=True)
        add_gabled_roof(scene, f"stall_{index}_awning", "orange" if index == 0 else "seafoam", (x, 2.72, z), (3.6, 0.52, 1.95), -7)
        for offset in (-1.15, 1.15):
            scene.cylinder("stall_post", "ink", (x + offset, 0.0, z - 0.55), (x + offset, 2.7, z - 0.55), 0.055, 0.045, 6)
    scene.box("market_sign", "ink", (-5.6, 3.45, -4.2), (3.6, 0.55, 0.14), -7, outline=True)
    scene.box("market_signal", "orange", (-5.6, 3.45, -4.11), (0.48, 0.29, 0.035), -7)


def add_workshop(scene: Scene) -> None:
    scene.box("workshop_base", "charcoal", (5.9, 1.45, -5.7), (4.8, 2.9, 4.2), 5, outline=True)
    scene.box("workshop_face", "paper", (5.9, 1.52, -3.55), (4.3, 2.55, 0.20), 5, outline=True)
    scene.box("workshop_door", "ink", (6.15, 1.25, -3.36), (1.35, 2.25, 0.18), 5)
    scene.box("workshop_window", "seafoam", (4.65, 1.65, -3.34), (0.92, 0.72, 0.12), 5, taper=0.10, outline=True)
    scene.box("workshop_eave", "ink", (5.9, 2.88, -3.40), (5.25, 0.12, 0.28), 5)
    add_gabled_roof(scene, "workshop_roof", "orange", (5.9, 3.36, -5.65), (5.5, 0.92, 4.85), 5)
    scene.cylinder("repair_core", "seafoam", (3.95, 0.25, -1.35), (3.95, 1.65, -1.35), 0.42, 0.34, 10, outline=True)
    scene.cylinder("repair_ring", "orange", (3.95, 0.75, -1.35), (3.95, 0.95, -1.35), 0.55, 0.55, 10)
    scene.cylinder("repair_arm", "ink", (3.95, 1.35, -1.35), (4.65, 1.8, -1.35), 0.08, 0.05, 7)
    scene.ellipsoid("repair_signal", "orange", (4.72, 1.84, -1.35), (0.14, 0.14, 0.14), 8, 4)
    for x, z in ((6.9, -3.0), (7.5, -3.9), (6.8, -4.7)):
        scene.box("work_crate", "leather", (x, 0.38, z), (0.85, 0.75, 0.85), 8, outline=True)


def add_city_details(scene: Scene) -> None:
    # Orange route inlays teach the player where the social street continues.
    scene.polygon("route_left", "orange", [(-2.75, 0.034, 14.0), (-2.55, 0.034, 14.0), (-3.85, 0.034, -70.0), (-4.1, 0.034, -70.0)])
    scene.polygon("route_right", "orange", [(2.85, 0.034, 14.0), (3.05, 0.034, 14.0), (4.15, 0.034, -70.0), (3.88, 0.034, -70.0)])
    for x in (-2.2, 2.4):
        for z in (1.6, -3.2, -7.7, -14.8, -21.8, -28.8, -38.8, -48.8, -58.8, -67.0):
            scene.cylinder("signal_lamp_post", "ink", (x, 0.0, z), (x, 2.15, z), 0.055, 0.04, 6)
            scene.ellipsoid("signal_lamp", "orange" if z > -4 else "seafoam", (x, 2.25, z), (0.17, 0.17, 0.17), 8, 4, outline=True)
    for x, z, yaw in ((-2.7, -2.0, -8), (2.9, -5.7, 8)):
        scene.box("street_bench", "leather", (x, 0.55, z), (1.8, 0.18, 0.55), yaw, outline=True)
        scene.box("street_bench_back", "leather", (x, 0.95, z - 0.23), (1.8, 0.75, 0.14), yaw, outline=True)
    for x, z, colour in ((-5.7, -0.9, "orange"), (-6.4, -0.7, "seafoam"), (-6.9, -1.0, "cream"), (-5.9, -3.7, "seafoam")):
        scene.ellipsoid("market_goods", colour, (x, 1.03, z), (0.22, 0.22, 0.22), 7, 4)
    scene.box("community_board", "ink", (-2.9, 1.45, -5.6), (2.3, 1.65, 0.18), -5, outline=True)
    scene.box("community_board_face", "paper", (-2.9, 1.48, -5.49), (1.95, 1.30, 0.035), -5)
    scene.box("community_board_signal", "orange", (-2.9, 1.72, -5.45), (0.62, 0.18, 0.025), -5)
    # Human-scale paving and planted edges keep the mobile view visually dense without textures.
    for row, z in enumerate((10.8, 9.8, 8.8, 7.8, 5.7, 4.7, 3.7, 2.7, -0.8, -1.8, -4.8, -5.8, -13.8, -14.8, -20.8, -21.8, -27.8, -28.8, -37.8, -38.8, -47.8, -48.8, -57.8, -58.8, -66.8)):
        offset = 0.42 if row % 2 else 0.0
        for x in (-1.65 + offset, -0.55 + offset, 0.55 + offset, 1.65 + offset):
            scene.polygon("street_paver", "paper" if row % 2 else "cream", [
                (x - 0.44, 0.055, z - 0.31),
                (x + 0.44, 0.055, z - 0.31),
                (x + 0.44, 0.055, z + 0.31),
                (x - 0.44, 0.055, z + 0.31),
            ])
    for x, z in ((-3.75, 4.8), (3.85, 4.55), (-3.7, 0.1), (3.75, -0.2)):
        add_planter(scene, x, z, 0.72)


def add_entry_gate(scene: Scene) -> None:
    z = 6.35
    for x in (-3.7, 3.7):
        scene.box("entry_gate_plinth", "paper", (x, 0.24, z), (0.95, 0.48, 0.95), 0, taper=0.10, outline=True)
        scene.cylinder("entry_gate_post", "ink", (x, 0.42, z), (x, 3.35, z), 0.15, 0.11, 8, outline=True)
        scene.ellipsoid("entry_gate_lamp", "orange", (x, 3.50, z), (0.24, 0.24, 0.24), 8, 5, outline=True)
    scene.box("entry_gate_header", "ink", (0.0, 3.15, z), (8.2, 0.34, 0.42), 0, taper=0.04, outline=True)
    scene.box("entry_gate_signal", "orange", (0.0, 3.13, z + 0.25), (1.35, 0.42, 0.10), 0, taper=0.18, outline=True)


def add_pavilion(scene: Scene) -> None:
    x, z = -3.7, -11.4
    scene.box("pavilion_floor", "paper", (x, 0.25, z), (6.0, 0.5, 4.8), -4, outline=True)
    for dx, dz in ((-2.4, -1.7), (2.4, -1.7), (-2.4, 1.7), (2.4, 1.7)):
        scene.cylinder("pavilion_post", "ink", (x + dx, 0.45, z + dz), (x + dx, 3.35, z + dz), 0.10, 0.075, 7)
    add_gabled_roof(scene, "pavilion_roof", "seafoam", (x, 3.70, z), (6.8, 0.82, 5.5), -4)
    add_gabled_roof(scene, "pavilion_roof_cap", "orange", (x, 4.25, z), (3.9, 0.62, 3.1), -4)
    scene.cylinder("team_table", "leather", (x, 0.55, z), (x, 1.05, z), 0.95, 0.95, 12, outline=True)
    scene.cylinder("table_signal", "orange", (x, 1.08, z), (x, 1.30, z), 0.16, 0.08, 8)


def add_signal_tower(scene: Scene) -> None:
    x, z = 0.0, -16.2
    scene.cylinder("tower_plinth", "paper", (x, 0.0, z), (x, 0.75, z), 2.4, 2.1, 12, outline=True)
    scene.cylinder("tower_body", "ink", (x, 0.72, z), (x, 6.8, z), 0.72, 0.34, 10, outline=True)
    scene.cylinder("tower_light", "orange", (x, 5.4, z), (x, 6.25, z), 0.56, 0.42, 10)
    scene.ellipsoid("tower_orb", "cream", (x, 7.35, z), (0.85, 0.85, 0.85), 12, 7, outline=True)
    scene.ellipsoid("tower_core", "orange", (x, 7.35, z + 0.06), (0.42, 0.42, 0.42), 10, 6)
    for yaw in (0, 60, 120):
        angle = math.radians(yaw)
        scene.cylinder("tower_arc", "seafoam", (x, 6.95, z), (x + math.cos(angle) * 1.35, 7.72, z + math.sin(angle) * 1.35), 0.07, 0.04, 6)


def add_transit(scene: Scene) -> None:
    x, z = 5.7, -12.6
    scene.box("transit_platform", "paper", (x, 0.35, z), (6.2, 0.7, 4.0), 4, outline=True)
    for dx in (-2.3, 2.3):
        scene.cylinder("transit_pillar", "ink", (x + dx, 0.6, z), (x + dx, 3.8, z), 0.16, 0.12, 8)
    scene.box("transit_header", "orange", (x, 3.78, z), (5.0, 0.45, 0.42), 4, outline=True)
    scene.box("transit_car", "seafoam", (x, 1.15, z - 2.0), (4.5, 1.55, 2.1), 4, taper=0.32, outline=True)
    scene.box("transit_window", "ink", (x, 1.45, z - 0.91), (2.65, 0.55, 0.08), 4)


def add_residential_edge(scene: Scene) -> None:
    add_townhouse(scene, "tea_house", -7.8, 3.9, 3.4, 3.0, -7, "orange")
    add_townhouse(scene, "map_house", -8.0, -10.7, 3.8, 3.4, -5, "leather")
    add_townhouse(scene, "relay_house", 7.9, 2.2, 3.6, 3.2, 6, "seafoam")
    add_townhouse(scene, "ferry_house", 8.1, -10.0, 3.5, 3.0, 5, "orange")
    for x, z, scale in ((-6.1, 2.4, 0.72), (-6.4, -8.4, 0.66), (6.1, 1.0, 0.70), (6.4, -8.3, 0.68)):
        add_planter(scene, x, z, scale)


def add_distant_city(scene: Scene) -> None:
    """Extend the playable street into a readable district, not a boxed diorama."""
    scene.polygon("north_cross_street", "cream", [(-15.5, 0.028, -18.2), (15.5, 0.028, -18.2), (15.5, 0.028, -21.0), (-15.5, 0.028, -21.0)])
    scene.polygon("west_lane", "cream", [(-15.5, 0.029, -21.0), (-12.8, 0.029, -21.0), (-12.8, 0.029, -70.0), (-15.5, 0.029, -70.0)])
    scene.polygon("south_street", "cream", [(-12.8, 0.030, -31.0), (13.8, 0.030, -31.0), (13.8, 0.030, -34.0), (-12.8, 0.030, -34.0)])
    scene.polygon("far_cross_street", "cream", [(-15.5, 0.030, -49.0), (15.5, 0.030, -49.0), (15.5, 0.030, -52.0), (-15.5, 0.030, -52.0)])
    scene.polygon("horizon_cross_street", "cream", [(-15.5, 0.030, -65.0), (15.5, 0.030, -65.0), (15.5, 0.030, -68.0), (-15.5, 0.030, -68.0)])
    for name, x, z, width, depth, yaw, accent in (
        ("north_block_west", -10.5, -19.6, 3.8, 3.2, -8, "leather"),
        ("north_block_east", 9.2, -19.8, 4.2, 3.4, 6, "orange"),
        ("south_block_west", -8.8, -27.0, 4.0, 3.6, -4, "seafoam"),
        ("south_block_east", 8.4, -27.2, 4.4, 3.8, 5, "leather"),
    ):
        scene.box(f"{name}_base", "paper", (x, 1.05, z), (width, 2.1, depth), yaw, taper=0.04, outline=True)
        scene.box(f"{name}_roofline", accent, (x, 2.15, z), (width + 0.24, 0.18, depth + 0.20), yaw, taper=0.06)
    scene.box("far_commons_sign", "ink", (0.0, 2.15, -20.0), (4.8, 1.2, 0.18), 0, outline=True)
    scene.box("far_commons_signal", "orange", (0.0, 2.18, -19.88), (1.15, 0.20, 0.035), 0, outline=True)
    for index, (x, z, height, side, accent) in enumerate((
        (-5.4, 4.8, 5.8, -1, "orange"),
        (5.4, 4.0, 6.4, 1, "seafoam"),
        (-5.5, -17.6, 6.2, -1, "leather"),
        (5.5, -20.8, 5.7, 1, "orange"),
        (-5.4, -29.2, 6.8, -1, "seafoam"),
        (5.5, -32.0, 6.1, 1, "leather"),
        (-5.4, -41.8, 6.5, -1, "orange"),
        (5.4, -44.2, 5.9, 1, "seafoam"),
        (-5.5, -54.5, 6.9, -1, "leather"),
        (5.5, -57.0, 6.3, 1, "orange"),
        (-5.4, -66.0, 6.2, -1, "seafoam"),
        (5.4, -64.0, 6.7, 1, "leather"),
    )):
        add_street_block(scene, f"street_block_{index}", x, z, height, side, accent)


def build_scene(spec: dict, include_characters: bool = True) -> Scene:
    scene = Scene(spec["palette"])
    scene.polygon("ground", "paper", [(-16.5, 0.0, 14.0), (16.5, 0.0, 14.0), (16.5, 0.0, -72.5), (-16.5, 0.0, -72.5)])
    scene.polygon("water", "water", [(-20.0, -0.05, -69.0), (20.0, -0.05, -69.0), (20.0, -0.05, -80.0), (-20.0, -0.05, -80.0)])
    scene.polygon("main_path", "cream", [(-2.9, 0.025, 14.0), (3.2, 0.025, 14.0), (4.5, 0.025, -70.0), (-4.4, 0.025, -70.0)])
    scene.polygon("market_path", "cream", [(-10.2, 0.026, 2.2), (1.0, 0.026, 1.7), (1.0, 0.026, -0.6), (-10.2, 0.026, -0.2)])
    scene.polygon("yard_path", "cream", [(-0.2, 0.027, -1.8), (10.2, 0.027, -2.6), (10.2, 0.027, -5.0), (-0.2, 0.027, -4.1)])
    for x, z, size in ((-9.4, -7.2, 0.82), (-7.7, -14.4, 0.76), (8.6, -7.7, 0.82), (9.2, -14.4, 0.75), (-8.7, 6.0, 0.66), (8.6, 5.7, 0.68)):
        add_tree(scene, x, z, size)
    add_residential_edge(scene)
    add_market(scene)
    add_workshop(scene)
    add_pavilion(scene)
    add_signal_tower(scene)
    add_transit(scene)
    add_distant_city(scene)
    add_city_details(scene)

    if include_characters:
        characters = [
            ("player", (0.0, 0.0, 4.2), 180, "orange", "walk-a", 1.06, True, False),
            ("guide", (0.7, 0.0, 0.5), 5, "seafoam", "gesture", 1.02, False, False),
            ("merchant1", (-5.25, 0.0, -0.5), 250, "orange", "gesture", 0.95, False, False),
            ("customer2", (-4.0, 0.0, -0.1), 70, "cream", "idle", 0.94, False, False),
            ("customer3", (-3.45, 0.0, -1.15), 90, "seafoam", "idle", 0.91, False, False),
            ("customer4", (-4.15, 0.0, -2.0), 40, "paper", "walk-b", 0.90, False, False),
            ("builder5", (3.25, 0.0, -0.45), 200, "orange", "repair", 0.96, False, False),
            ("builder6", (4.6, 0.0, -0.55), 155, "seafoam", "repair", 0.92, False, False),
            ("carrier7", (2.0, 0.0, -3.7), 165, "cream", "carry", 0.91, False, True),
            ("carrier8", (-1.2, 0.0, -4.6), 190, "orange", "carry", 0.88, False, True),
            ("team9", (-3.6, 0.5, -9.8), 215, "seafoam", "gesture", 0.88, False, False),
            ("team10", (-4.7, 0.5, -10.6), 35, "cream", "idle", 0.88, False, False),
            ("team11", (-3.6, 0.5, -11.5), 145, "orange", "gesture", 0.86, False, False),
            ("traveller12", (4.55, 0.0, -7.4), 172, "paper", "walk-a", 0.86, False, False),
            ("traveller13", (5.6, 0.0, -8.4), 178, "seafoam", "walk-b", 0.84, False, False),
            ("walker14", (-0.4, 0.0, -7.0), 190, "cream", "walk-a", 0.86, False, False),
            ("walker15", (1.6, 0.0, -8.5), 20, "orange", "walk-b", 0.82, False, False),
        ]
        for args in characters:
            add_character(scene, *args)
    return scene


class Camera:
    def __init__(self, position: Vec3, target: Vec3, fov: float, width: int, height: int) -> None:
        self.position = position
        self.forward = unit(sub(target, position))
        self.right = unit(cross(self.forward, (0.0, 1.0, 0.0)))
        self.up = unit(cross(self.right, self.forward))
        self.focal = height / (2.0 * math.tan(math.radians(fov) / 2.0))
        self.width = width
        self.height = height

    def camera_point(self, point: Vec3) -> Vec3:
        relative = sub(point, self.position)
        return (dot(relative, self.right), dot(relative, self.up), dot(relative, self.forward))

    def project(self, point: Vec3) -> tuple[float, float] | None:
        x, y, depth = self.camera_point(point)
        if depth <= 0.1:
            return None
        return (self.width / 2 + self.focal * x / depth, self.height / 2 - self.focal * y / depth)


def blend(a: tuple[int, int, int], b: tuple[int, int, int], amount: float) -> tuple[int, int, int]:
    return tuple(round(a[index] * (1.0 - amount) + b[index] * amount) for index in range(3))


def render(
    scene: Scene,
    spec: dict,
    output_size: tuple[int, int] = (720, 1280),
    camera_override: dict | None = None,
    hud: bool = True,
) -> tuple[Image.Image, dict]:
    scale = 2
    width, height = output_size[0] * scale, output_size[1] * scale
    sky_top, sky_bottom = rgb("#BFD9D2"), rgb("#F4EDE0")
    image = Image.new("RGB", (width, height), sky_bottom)
    draw = ImageDraw.Draw(image)
    for y in range(height):
        amount = min(1.0, y / (height * 0.72))
        draw.line((0, y, width, y), fill=blend(sky_top, sky_bottom, amount))

    camera_data = camera_override or spec["camera"]
    camera = Camera(tuple(camera_data["positionMeters"]), tuple(camera_data["targetMeters"]), camera_data["fieldOfViewDegrees"], width, height)
    light = unit((-0.45, 0.86, 0.32))
    fog = rgb("#E7E4DA")
    triangles = []
    triangle_count = 0
    for mesh in scene.meshes:
        for index in range(0, len(mesh.indices), 3):
            points = [mesh.positions[mesh.indices[index + offset]] for offset in range(3)]
            camera_points = [camera.camera_point(point) for point in points]
            if min(point[2] for point in camera_points) <= 0.1:
                continue
            projected = [camera.project(point) for point in points]
            if any(point is None for point in projected):
                continue
            normal = unit(cross(sub(points[1], points[0]), sub(points[2], points[0])))
            shade = 0.66 + 0.34 * max(0.0, dot(normal, light))
            shaded = tuple(max(0, min(255, round(channel * shade))) for channel in mesh.colour)
            depth = sum(point[2] for point in camera_points) / 3.0
            fog_amount = max(0.0, min(0.46, (depth - 15.0) / 38.0))
            colour = blend(shaded, fog, fog_amount)
            triangles.append((depth, projected, colour, mesh.outline))
            triangle_count += 1
    triangles.sort(key=lambda item: item[0], reverse=True)
    for _, projected, colour, outline in triangles:
        points = [(round(point[0]), round(point[1])) for point in projected if point is not None]
        draw.polygon(points, fill=colour)
        if outline:
            draw.line(points + [points[0]], fill=blend(colour, rgb("#14110E"), 0.55), width=2)

    if hud:
        add_hud(draw, camera, spec, width, height)
    return image.resize(output_size, Image.Resampling.LANCZOS), {"trianglesRendered": triangle_count, "meshParts": len(scene.meshes)}


def font(size: int, bold: bool = False):
    name = "arialbd.ttf" if bold else "arial.ttf"
    path = Path("C:/Windows/Fonts") / name
    if path.exists():
        return ImageFont.truetype(str(path), size)
    return ImageFont.load_default()


def rounded_label(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], fill: tuple[int, int, int], text: str, text_colour: tuple[int, int, int], text_font, radius: int = 18) -> None:
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=blend(fill, text_colour, 0.40), width=2)
    bounds = draw.textbbox((0, 0), text, font=text_font)
    x = (box[0] + box[2] - (bounds[2] - bounds[0])) / 2
    y = (box[1] + box[3] - (bounds[3] - bounds[1])) / 2 - bounds[1]
    draw.text((x, y), text, fill=text_colour, font=text_font)


def add_hud(draw: ImageDraw.ImageDraw, camera: Camera, spec: dict, width: int, height: int) -> None:
    ink, cream, orange, seafoam = rgb("#14110E"), rgb("#F4EDE0"), rgb("#FF5A1F"), rgb("#8FB3A8")
    draw.rounded_rectangle((36, 34, width - 36, 190), radius=28, fill=(20, 17, 14), outline=(244, 237, 224), width=2)
    draw.text((72, 62), "BEACON COMMONS", fill=seafoam, font=font(27, True))
    draw.text((72, 101), "Meet the community guide", fill=cream, font=font(44, True))
    draw.text((72, 154), "Walk through the city. Learn by helping people.", fill=(205, 197, 183), font=font(24))
    rounded_label(draw, (width - 292, 60, width - 72, 128), orange, "EXPLORER", ink, font(27, True), 24)

    guide = camera.project((0.7, 2.28, 0.5))
    if guide is not None:
        gx, gy = guide
        rounded_label(draw, (round(gx - 92), round(gy - 42), round(gx + 92), round(gy + 18)), cream, "TALK", ink, font(25, True), 20)
        draw.line((gx, gy + 18, gx, gy + 55), fill=cream, width=5)

    rounded_label(draw, (width - 242, height - 242, width - 74, height - 74), orange, "TALK", ink, font(31, True), 52)
    draw.ellipse((74, height - 264, 282, height - 56), fill=(20, 17, 14), outline=(244, 237, 224), width=3)
    draw.ellipse((137, height - 201, 219, height - 119), outline=cream, width=5)
    draw.text((45, height - 42), "NATIVE PROCEDURAL 3D BLOCKOUT  |  OWNER REVIEW", fill=(62, 57, 50), font=font(21, True))


def validate(spec: dict, scene: Scene, render_metrics: dict) -> dict:
    digest = hashlib.sha256(OUTPUT_PATH.read_bytes()).hexdigest()
    profiles = spec["mobilePerformance"]["qualityProfiles"]
    checks = {
        "portraitResolution": Image.open(OUTPUT_PATH).size == (720, 1280),
        "overviewResolution": Image.open(OVERVIEW_PATH).size == (1280, 720),
        "populationTarget": spec["population"]["visibleCharacters"] == 17,
        "activityTarget": len(spec["population"]["activities"]) >= 6,
        "landmarkTarget": len(spec["landmarks"]) >= 5,
        "proceduralSourcePresent": CHARACTER_SOURCE.exists(),
        "renderHasGeometry": render_metrics["trianglesRendered"] > 1000,
        "mobileBlockoutBudget": render_metrics["trianglesRendered"] < 120000,
        "outputPresent": OUTPUT_PATH.exists() and OUTPUT_PATH.stat().st_size > 10000,
        "overviewPresent": OVERVIEW_PATH.exists() and OVERVIEW_PATH.stat().st_size > 10000,
        "glbPresent": GLB_PATH.exists() and GLB_PATH.stat().st_size > 10000,
        "glbBudget": GLB_PATH.exists() and GLB_PATH.stat().st_size <= 524288,
        "qualityTierPopulationOrder": profiles["low"]["visibleNpcs"] < profiles["balanced"]["visibleNpcs"] < profiles["high"]["visibleNpcs"],
        "qualityTierSimulationOrder": profiles["low"]["activeNpcs"] < profiles["balanced"]["activeNpcs"] < profiles["high"]["activeNpcs"],
        "qualityTierRenderScaleOrder": profiles["low"]["renderScale"] < profiles["balanced"]["renderScale"] < profiles["high"]["renderScale"],
        "interactionNeverDegrades": "touch-target-size" in spec["mobilePerformance"]["neverReduced"] and "mission-npc-visibility" in spec["mobilePerformance"]["neverReduced"],
    }
    report = {
        "asset": spec["asset"],
        "version": spec["version"],
        "status": "pass" if all(checks.values()) else "fail",
        "output": OUTPUT_PATH.name,
        "sha256": digest,
        "metrics": {**render_metrics, "visibleCharacters": 17, "activities": len(spec["population"]["activities"]), "landmarks": len(spec["landmarks"]), "imageBytes": OUTPUT_PATH.stat().st_size, "overviewBytes": OVERVIEW_PATH.stat().st_size},
        "checks": checks,
        "provenance": spec["authorship"],
    }
    VALIDATION_PATH.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    if report["status"] != "pass":
        raise SystemExit("Scene validation failed. Read validation.json.")
    return report


def main() -> None:
    spec = json.loads(SPEC_PATH.read_text(encoding="utf-8"))
    scene = build_scene(spec, include_characters=True)
    runtime_scene = build_scene(spec, include_characters=False)
    glb_metrics = export_city_glb(runtime_scene, GLB_PATH)
    review_glb_metrics = export_city_glb(scene, REVIEW_GLB_PATH)
    image, metrics = render(scene, spec)
    image.save(OUTPUT_PATH, optimize=True)
    overview_camera = {
        "positionMeters": [10.5, 6.2, 10.5],
        "targetMeters": [0.0, 1.7, -5.0],
        "fieldOfViewDegrees": 46
    }
    overview, overview_metrics = render(scene, spec, (1280, 720), overview_camera, False)
    overview.save(OVERVIEW_PATH, optimize=True)
    metrics["overviewTrianglesRendered"] = overview_metrics["trianglesRendered"]
    metrics.update(glb_metrics)
    metrics["reviewGlbBytes"] = review_glb_metrics["glbBytes"]
    metrics["reviewGlbDrawCalls"] = review_glb_metrics["materials"]
    report = validate(spec, runtime_scene, metrics)
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
