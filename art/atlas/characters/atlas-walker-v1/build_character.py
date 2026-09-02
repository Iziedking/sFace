"""Build the original SFACE Atlas Walker character from procedural primitives.

No image, scan, stock mesh, external model, or image-to-3D input is read. The
same geometry is exported to GLB and rendered into deterministic review images.
"""

from __future__ import annotations

import json
import hashlib
import math
import struct
import copy
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, Sequence

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent
SPEC_PATH = ROOT / "character-spec.json"
GLB_PATH = ROOT / "atlas-walker-v1.glb"
NPC_LOD1_PATH = ROOT / "atlas-walker-npc-lod1.glb"
NPC_LOD2_PATH = ROOT / "atlas-walker-npc-lod2.glb"
FRONT_PATH = ROOT / "preview-front.png"
TURN_PATH = ROOT / "preview-turntable.png"
SILHOUETTE_PATH = ROOT / "silhouette-96.png"
VALIDATION_PATH = ROOT / "validation.json"


Vec3 = tuple[float, float, float]


@dataclass
class Part:
    name: str
    material: str
    joint: str
    positions: list[Vec3] = field(default_factory=list)
    normals: list[Vec3] = field(default_factory=list)
    indices: list[int] = field(default_factory=list)


def add(a: Vec3, b: Vec3) -> Vec3:
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def sub(a: Vec3, b: Vec3) -> Vec3:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def mul(a: Vec3, s: float) -> Vec3:
    return (a[0] * s, a[1] * s, a[2] * s)


def dot(a: Vec3, b: Vec3) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def cross(a: Vec3, b: Vec3) -> Vec3:
    return (
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    )


def unit(a: Vec3) -> Vec3:
    length = math.sqrt(max(dot(a, a), 1e-12))
    return (a[0] / length, a[1] / length, a[2] / length)


def hex_rgb(value: str) -> tuple[int, int, int]:
    value = value.lstrip("#")
    return tuple(int(value[i : i + 2], 16) for i in (0, 2, 4))


def rgba_factor(value: str) -> list[float]:
    rgb = hex_rgb(value)
    return [channel / 255.0 for channel in rgb] + [1.0]


def ellipsoid(
    name: str,
    material: str,
    joint: str,
    center: Vec3,
    radii: Vec3,
    segments: int = 10,
    rings: int = 6,
) -> Part:
    part = Part(name, material, joint)
    for ring in range(rings + 1):
        phi = -math.pi / 2 + math.pi * ring / rings
        cp, sp = math.cos(phi), math.sin(phi)
        for segment in range(segments):
            theta = 2 * math.pi * segment / segments
            ct, st = math.cos(theta), math.sin(theta)
            local = (radii[0] * cp * ct, radii[1] * sp, radii[2] * cp * st)
            part.positions.append(add(center, local))
            part.normals.append(unit((local[0] / radii[0] ** 2, local[1] / radii[1] ** 2, local[2] / radii[2] ** 2)))
    for ring in range(rings):
        for segment in range(segments):
            a = ring * segments + segment
            b = ring * segments + (segment + 1) % segments
            c = (ring + 1) * segments + segment
            d = (ring + 1) * segments + (segment + 1) % segments
            part.indices.extend((a, c, b, b, c, d))
    return part


def cylinder_between(
    name: str,
    material: str,
    joint: str,
    start: Vec3,
    end: Vec3,
    radius_start: float,
    radius_end: float | None = None,
    segments: int = 8,
) -> Part:
    radius_end = radius_start if radius_end is None else radius_end
    axis = unit(sub(end, start))
    helper = (0.0, 0.0, 1.0) if abs(axis[2]) < 0.86 else (1.0, 0.0, 0.0)
    side = unit(cross(axis, helper))
    forward = unit(cross(side, axis))
    part = Part(name, material, joint)
    for point, radius in ((start, radius_start), (end, radius_end)):
        for segment in range(segments):
            angle = 2 * math.pi * segment / segments
            radial = add(mul(side, math.cos(angle)), mul(forward, math.sin(angle)))
            part.positions.append(add(point, mul(radial, radius)))
            part.normals.append(radial)
    for segment in range(segments):
        nxt = (segment + 1) % segments
        a, b = segment, nxt
        c, d = segments + segment, segments + nxt
        part.indices.extend((a, c, b, b, c, d))
    for point_index, normal in ((0, mul(axis, -1.0)), (1, axis)):
        center_index = len(part.positions)
        part.positions.append(start if point_index == 0 else end)
        part.normals.append(normal)
        ring_offset = 0 if point_index == 0 else segments
        for segment in range(segments):
            nxt = (segment + 1) % segments
            if point_index == 0:
                part.indices.extend((center_index, ring_offset + nxt, ring_offset + segment))
            else:
                part.indices.extend((center_index, ring_offset + segment, ring_offset + nxt))
    return part


def faceted_box(
    name: str,
    material: str,
    joint: str,
    center: Vec3,
    size: Vec3,
    front_taper: float = 0.0,
) -> Part:
    hx, hy, hz = size[0] / 2, size[1] / 2, size[2] / 2
    back_x = hx
    front_x = hx * (1.0 - front_taper)
    corners = [
        (-back_x, -hy, -hz), (back_x, -hy, -hz), (back_x, hy, -hz), (-back_x, hy, -hz),
        (-front_x, -hy, hz), (front_x, -hy, hz), (front_x, hy, hz), (-front_x, hy, hz),
    ]
    faces = [
        (0, 1, 2, 3), (5, 4, 7, 6), (4, 0, 3, 7),
        (1, 5, 6, 2), (3, 2, 6, 7), (4, 5, 1, 0),
    ]
    part = Part(name, material, joint)
    for face in faces:
        p = [add(center, corners[i]) for i in face]
        normal = unit(cross(sub(p[1], p[0]), sub(p[2], p[0])))
        base = len(part.positions)
        part.positions.extend(p)
        part.normals.extend([normal] * 4)
        part.indices.extend((base, base + 1, base + 2, base, base + 2, base + 3))
    return part


def wedge(
    name: str,
    material: str,
    joint: str,
    vertices: Sequence[Vec3],
    faces: Sequence[Sequence[int]],
) -> Part:
    part = Part(name, material, joint)
    for face in faces:
        points = [vertices[index] for index in face]
        normal = unit(cross(sub(points[1], points[0]), sub(points[2], points[0])))
        base = len(part.positions)
        part.positions.extend(points)
        part.normals.extend([normal] * len(points))
        for index in range(1, len(points) - 1):
            part.indices.extend((base, base + index, base + index + 1))
    return part


def build_skeleton() -> tuple[list[dict], dict[str, int], dict[str, Vec3]]:
    bones = [
        ("root", None, (0.0, 0.0, 0.0)),
        ("hips", "root", (0.0, 0.91, 0.0)),
        ("spine", "hips", (0.0, 0.27, 0.0)),
        ("chest", "spine", (0.0, 0.29, 0.0)),
        ("neck", "chest", (0.0, 0.25, 0.0)),
        ("head", "neck", (0.0, 0.20, 0.0)),
        ("eye.L", "head", (0.061, 0.038, 0.174)),
        ("eye.R", "head", (-0.061, 0.038, 0.174)),
        ("eyelid.L", "head", (0.061, 0.057, 0.185)),
        ("eyelid.R", "head", (-0.061, 0.057, 0.185)),
        ("mouth", "head", (0.0, -0.087, 0.178)),
        ("upper_arm.L", "chest", (0.29, 0.12, 0.0)),
        ("lower_arm.L", "upper_arm.L", (0.07, -0.32, 0.0)),
        ("hand.L", "lower_arm.L", (0.04, -0.30, 0.01)),
        ("upper_arm.R", "chest", (-0.29, 0.12, 0.0)),
        ("lower_arm.R", "upper_arm.R", (-0.07, -0.32, 0.0)),
        ("hand.R", "lower_arm.R", (-0.04, -0.30, 0.01)),
        ("upper_leg.L", "hips", (0.16, -0.05, 0.0)),
        ("lower_leg.L", "upper_leg.L", (0.0, -0.48, 0.0)),
        ("foot.L", "lower_leg.L", (0.0, -0.45, 0.02)),
        ("upper_leg.R", "hips", (-0.16, -0.05, 0.0)),
        ("lower_leg.R", "upper_leg.R", (0.0, -0.48, 0.0)),
        ("foot.R", "lower_leg.R", (0.0, -0.45, 0.02)),
    ]
    index = {name: i for i, (name, _, _) in enumerate(bones)}
    world: dict[str, Vec3] = {}
    nodes: list[dict] = []
    for name, parent, translation in bones:
        world[name] = translation if parent is None else add(world[parent], translation)
        node = {"name": name, "translation": list(translation)}
        children = [index[n] for n, p, _ in bones if p == name]
        if children:
            node["children"] = children
        nodes.append(node)
    return nodes, index, world


def build_parts(world: dict[str, Vec3]) -> list[Part]:
    parts: list[Part] = []
    hips = world["hips"]

    # A narrow field jacket and tapered trousers replace the old barrel torso.
    # Rounded forms keep the silhouette clean without inflating mobile geometry.
    parts.append(ellipsoid("jacket", "orange", "chest", (0.0, 1.42, 0.0), (0.285, 0.315, 0.185), 14, 7))
    parts.append(ellipsoid("jacket_waist", "orange", "hips", (0.0, 1.18, 0.0), (0.235, 0.145, 0.158), 12, 6))
    parts.append(cylinder_between("utility_sash", "ink", "hips", (-0.245, 1.13, 0.0), (0.245, 1.13, 0.0), 0.045, 0.045, 8))
    parts.append(ellipsoid("hips", "workwear", "hips", hips, (0.215, 0.135, 0.150), 12, 6))
    parts.append(cylinder_between("neck", "skin", "neck", (0.0, 1.68, 0.0), (0.0, 1.78, 0.0), 0.075, 0.07, 10))

    # The face is a soft tapered oval with shallow cheeks and a smaller jaw.
    # Eyes and brows stay readable at 96 pixels without becoming caricature.
    parts.append(ellipsoid("head", "skin", "head", (0.0, 1.91, 0.018), (0.178, 0.225, 0.158), 18, 9))
    parts.append(ellipsoid("cheek_L", "skin", "head", (0.070, 1.885, 0.105), (0.092, 0.105, 0.067), 8, 4))
    parts.append(ellipsoid("cheek_R", "skin", "head", (-0.070, 1.885, 0.105), (0.092, 0.105, 0.067), 8, 4))
    parts.append(ellipsoid("chin", "skin", "head", (0.0, 1.755, 0.075), (0.092, 0.055, 0.085), 10, 5))
    parts.append(ellipsoid("hair_cap", "ink", "head", (-0.008, 2.055, -0.010), (0.186, 0.108, 0.165), 16, 7))
    parts.append(ellipsoid("hair_back", "ink", "head", (-0.005, 1.970, -0.138), (0.164, 0.145, 0.060), 12, 6))
    parts.append(ellipsoid("side_hair_L", "ink", "head", (0.160, 1.995, -0.015), (0.035, 0.095, 0.135), 8, 4))
    parts.append(ellipsoid("side_hair_R", "ink", "head", (-0.160, 1.995, -0.015), (0.035, 0.095, 0.135), 8, 4))
    parts.append(ellipsoid("fringe_left", "ink", "head", (-0.076, 2.020, 0.145), (0.095, 0.040, 0.026), 10, 4))
    parts.append(ellipsoid("fringe_right", "ink", "head", (0.073, 2.026, 0.145), (0.082, 0.034, 0.024), 10, 4))
    parts.append(ellipsoid("ear_L", "skinShadow", "head", (0.178, 1.915, 0.005), (0.022, 0.046, 0.021), 10, 5))
    parts.append(ellipsoid("ear_R", "skinShadow", "head", (-0.178, 1.915, 0.005), (0.022, 0.046, 0.021), 10, 5))
    parts.append(ellipsoid("nose", "skinShadow", "head", (0.0, 1.902, 0.178), (0.018, 0.030, 0.014), 10, 5))
    for side, x in (("L", 0.061), ("R", -0.061)):
        parts.append(ellipsoid(f"eye_white_{side}", "cream", f"eye.{side}", (x, 1.958, 0.174), (0.050, 0.018, 0.010), 8, 4))
        parts.append(ellipsoid(f"eye_iris_{side}", "ink", f"eye.{side}", (x, 1.958, 0.185), (0.018, 0.020, 0.008), 8, 4))
        lid_start = (x - 0.038, 1.975, 0.185)
        lid_end = (x + 0.038, 1.978, 0.185)
        parts.append(cylinder_between(f"eye_lid_{side}", "skinShadow", f"eyelid.{side}", lid_start, lid_end, 0.0045, 0.0035, 6))
    parts.append(cylinder_between("brow_L", "ink", "head", (0.022, 2.003, 0.172), (0.101, 2.009, 0.166), 0.006, 0.005, 8))
    parts.append(cylinder_between("brow_R", "ink", "head", (-0.101, 2.009, 0.166), (-0.022, 2.003, 0.172), 0.006, 0.005, 8))
    parts.append(ellipsoid("mouth_inner", "ink", "mouth", (0.0, 1.833, 0.178), (0.035, 0.014, 0.007), 8, 4))
    parts.append(cylinder_between("mouth_upper", "skinShadow", "mouth", (-0.034, 1.839, 0.184), (0.034, 1.839, 0.184), 0.0045, 0.0035, 8))
    parts.append(cylinder_between("mouth_lower", "skinShadow", "mouth", (-0.031, 1.827, 0.183), (0.031, 1.827, 0.183), 0.0035, 0.0035, 8))

    # Slim sleeves, articulated hands, and narrow boots read as a person rather
    # than a toy built from blocks.
    for side in ("L", "R"):
        upper = world[f"upper_arm.{side}"]
        lower = world[f"lower_arm.{side}"]
        hand = world[f"hand.{side}"]
        parts.append(ellipsoid(f"shoulder_blend_{side}", "orange", f"upper_arm.{side}", upper, (0.105, 0.112, 0.096), 6, 3))
        parts.append(cylinder_between(f"upper_arm_{side}", "orange", f"upper_arm.{side}", upper, lower, 0.088, 0.075, 10))
        parts.append(ellipsoid(f"elbow_blend_{side}", "workwear", f"lower_arm.{side}", lower, (0.082, 0.092, 0.080), 8, 4))
        parts.append(cylinder_between(f"lower_arm_{side}", "workwear", f"lower_arm.{side}", lower, hand, 0.070, 0.055, 10))
        cuff_center = add(hand, (0.0, 0.025, 0.0))
        parts.append(ellipsoid(f"wrist_cuff_{side}", "seafoam", f"lower_arm.{side}", cuff_center, (0.070, 0.050, 0.067), 8, 4))
        hand_end = add(hand, (0.0, -0.075, 0.015))
        parts.append(ellipsoid(f"hand_{side}", "skin", f"hand.{side}", hand_end, (0.061, 0.092, 0.052), 10, 5))
        thumb_x = 0.050 if side == "L" else -0.050
        parts.append(ellipsoid(f"thumb_{side}", "skinShadow", f"hand.{side}", add(hand_end, (thumb_x, 0.006, 0.027)), (0.026, 0.050, 0.026), 8, 4))

    for side, x in (("L", 0.16), ("R", -0.16)):
        upper = world[f"upper_leg.{side}"]
        lower = world[f"lower_leg.{side}"]
        foot = world[f"foot.{side}"]
        parts.append(ellipsoid(f"hip_blend_{side}", "workwear", f"upper_leg.{side}", upper, (0.118, 0.125, 0.112), 6, 3))
        parts.append(cylinder_between(f"upper_leg_{side}", "workwear", f"upper_leg.{side}", upper, lower, 0.112, 0.096, 10))
        parts.append(ellipsoid(f"knee_blend_{side}", "workwear", f"lower_leg.{side}", lower, (0.105, 0.108, 0.102), 8, 4))
        parts.append(cylinder_between(f"lower_leg_{side}", "workwear", f"lower_leg.{side}", lower, foot, 0.096, 0.080, 10))
        parts.append(ellipsoid(f"boot_cuff_{side}", "leather", f"foot.{side}", (x, 0.175, 0.025), (0.102, 0.095, 0.100), 8, 4))
        parts.append(ellipsoid(f"boot_{side}", "ink", f"foot.{side}", (x, 0.095, 0.090), (0.112, 0.098, 0.180), 12, 6))
        parts.append(faceted_box(f"sole_{side}", "leather", f"foot.{side}", (x, 0.023, 0.100), (0.220, 0.035, 0.330), 0.18))

    parts.append(wedge(
        "field_neckerchief", "seafoam", "chest",
        [(-0.10, 1.66, 0.17), (0.11, 1.66, 0.17), (0.045, 1.55, 0.205), (-0.022, 1.58, 0.212)],
        [(0, 1, 2, 3)],
    ))

    parts.append(wedge(
        "jacket_collar_L", "cream", "chest",
        [(0.0, 1.66, 0.174), (0.125, 1.635, 0.164), (0.070, 1.525, 0.198), (0.0, 1.585, 0.202)],
        [(0, 1, 2, 3)],
    ))
    parts.append(wedge(
        "jacket_collar_R", "cream", "chest",
        [(-0.125, 1.635, 0.164), (0.0, 1.66, 0.174), (0.0, 1.585, 0.202), (-0.070, 1.525, 0.198)],
        [(0, 1, 2, 3)],
    ))
    parts.append(cylinder_between("pack_strap_L", "leather", "chest", (0.170, 1.63, 0.145), (0.115, 1.19, 0.150), 0.018, 0.015, 6))
    parts.append(cylinder_between("pack_strap_R", "leather", "chest", (-0.170, 1.63, 0.145), (-0.115, 1.19, 0.150), 0.018, 0.015, 6))

    parts.append(ellipsoid("signal_pack", "seafoam", "chest", (-0.10, 1.40, -0.205), (0.215, 0.27, 0.095), 12, 6))
    parts.append(faceted_box("pack_latch", "cream", "chest", (-0.10, 1.43, -0.295), (0.13, 0.10, 0.025), 0.18))
    parts.append(cylinder_between("antenna", "ink", "chest", (-0.23, 1.58, -0.23), (-0.27, 1.87, -0.24), 0.012, 0.008, 8))
    parts.append(ellipsoid("antenna_tip", "orange", "chest", (-0.27, 1.90, -0.24), (0.035, 0.035, 0.035), 8, 4))

    left_hand = world["hand.L"]
    parts.append(ellipsoid("scanner_body", "ink", "hand.L", add(left_hand, (0.018, -0.025, 0.078)), (0.070, 0.095, 0.045), 10, 5))
    parts.append(faceted_box("scanner_screen", "seafoam", "hand.L", add(left_hand, (0.018, -0.012, 0.122)), (0.072, 0.082, 0.014), 0.10))
    parts.append(cylinder_between("jacket_tab", "cream", "chest", (0.16, 1.58, 0.19), (0.16, 1.48, 0.20), 0.018, 0.014, 8))
    return parts


def scale_to_target_height(
    parts: list[Part],
    skeleton_nodes: list[dict],
    world: dict[str, Vec3],
    target_height: float,
) -> None:
    """Convert design units to metres and put both soles exactly on y=0."""
    minimum_y = min(point[1] for part in parts for point in part.positions)
    maximum_y = max(point[1] for part in parts for point in part.positions)
    factor = target_height / (maximum_y - minimum_y)
    ground_offset = -minimum_y * factor
    for part in parts:
        part.positions = [
            (point[0] * factor, point[1] * factor + ground_offset, point[2] * factor)
            for point in part.positions
        ]
    for node_index, node in enumerate(skeleton_nodes):
        translation = node["translation"]
        translation = [value * factor for value in translation]
        if node_index == 0:
            translation[1] += ground_offset
        node["translation"] = translation
    for name, point in list(world.items()):
        world[name] = (point[0] * factor, point[1] * factor + ground_offset, point[2] * factor)


class GlbBuffer:
    def __init__(self) -> None:
        self.data = bytearray()
        self.views: list[dict] = []
        self.accessors: list[dict] = []

    def align(self, size: int = 4) -> None:
        while len(self.data) % size:
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
        target: int | None = None,
        minimum: Sequence[float] | None = None,
        maximum: Sequence[float] | None = None,
    ) -> int:
        view = self.add_view(payload, target)
        accessor: dict = {"bufferView": view, "componentType": component_type, "count": count, "type": accessor_type}
        if minimum is not None:
            accessor["min"] = list(minimum)
        if maximum is not None:
            accessor["max"] = list(maximum)
        self.accessors.append(accessor)
        return len(self.accessors) - 1


def pack_floats(values: Iterable[float]) -> bytes:
    values = list(values)
    return struct.pack("<" + "f" * len(values), *values)


def pack_ushorts(values: Iterable[int]) -> bytes:
    values = list(values)
    return struct.pack("<" + "H" * len(values), *values)


def quaternion(axis: Vec3, degrees: float) -> tuple[float, float, float, float]:
    half = math.radians(degrees) / 2
    sine = math.sin(half)
    axis = unit(axis)
    return (axis[0] * sine, axis[1] * sine, axis[2] * sine, math.cos(half))


def multiply_quaternions(
    a: tuple[float, float, float, float],
    b: tuple[float, float, float, float],
) -> tuple[float, float, float, float]:
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return (
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
        aw * bw - ax * bx - ay * by - az * bz,
    )


def quaternion_euler(rotation: Vec3) -> tuple[float, float, float, float]:
    x = quaternion((1, 0, 0), rotation[0])
    y = quaternion((0, 1, 0), rotation[1])
    z = quaternion((0, 0, 1), rotation[2])
    return multiply_quaternions(z, multiply_quaternions(y, x))


def build_animation(
    buffer: GlbBuffer,
    joint_index: dict[str, int],
    base_translations: dict[str, Vec3],
    name: str,
    times: list[float],
    rotation_tracks: dict[str, list[Vec3]],
    translation_tracks: dict[str, list[Vec3]] | None = None,
) -> dict:
    time_accessor = buffer.add_accessor(pack_floats(times), 5126, len(times), "SCALAR", minimum=[times[0]], maximum=[times[-1]])
    samplers = []
    channels = []
    for bone, rotations in rotation_tracks.items():
        quaternions = [quaternion_euler(rotation) for rotation in rotations]
        output = buffer.add_accessor(pack_floats(value for item in quaternions for value in item), 5126, len(quaternions), "VEC4")
        sampler_index = len(samplers)
        samplers.append({"input": time_accessor, "output": output, "interpolation": "LINEAR"})
        channels.append({"sampler": sampler_index, "target": {"node": joint_index[bone], "path": "rotation"}})
    for bone, offsets in (translation_tracks or {}).items():
        base = base_translations[bone]
        translations = [add(base, offset) for offset in offsets]
        output = buffer.add_accessor(pack_floats(value for item in translations for value in item), 5126, len(translations), "VEC3")
        sampler_index = len(samplers)
        samplers.append({"input": time_accessor, "output": output, "interpolation": "LINEAR"})
        channels.append({"sampler": sampler_index, "target": {"node": joint_index[bone], "path": "translation"}})
    return {"name": name, "samplers": samplers, "channels": channels}


def cycle_value(values: Sequence[float], phase: float) -> float:
    position = (phase % math.tau) / math.tau * (len(values) - 1)
    index = min(len(values) - 2, int(position))
    amount = position - index
    return values[index] + (values[index + 1] - values[index]) * amount


def build_animation_set(buffer: GlbBuffer, joint_index: dict[str, int], skeleton_nodes: list[dict]) -> list[dict]:
    base = {node["name"]: tuple(node["translation"]) for node in skeleton_nodes}

    idle_times = [index * 0.25 for index in range(17)]
    idle_phases = [math.tau * index / (len(idle_times) - 1) for index in range(len(idle_times))]
    idle = build_animation(
        buffer, joint_index, base, "Atlas_Idle", idle_times,
        {
            "hips": [(0, math.sin(phase) * 0.8, math.sin(phase) * 0.7) for phase in idle_phases],
            "chest": [(-1.0 + (1 - math.cos(phase)) * 0.9, math.sin(phase) * -0.6, math.sin(phase) * -0.5) for phase in idle_phases],
            "neck": [(math.sin(phase) * 0.35, math.sin(phase) * -0.7, 0) for phase in idle_phases],
            "head": [(-0.6 + math.sin(phase) * 0.45, math.sin(phase) * 1.2, math.sin(phase) * 0.25) for phase in idle_phases],
            "upper_arm.L": [(math.sin(phase) * -1.4, 0, 1.5 + math.sin(phase) * 0.5) for phase in idle_phases],
            "upper_arm.R": [(math.sin(phase) * 1.4, 0, -1.5 - math.sin(phase) * 0.5) for phase in idle_phases],
        },
        {"hips": [(math.sin(phase) * 0.004, (1 - math.cos(phase)) * 0.004, 0) for phase in idle_phases]},
    )

    # A 25-sample contact/down/passing/up cycle keeps the planted foot readable
    # after mobile frame pacing and avoids the pendulum gait of the earlier clip.
    walk_times = [index * 0.05 for index in range(25)]
    walk_phases = [math.tau * index / (len(walk_times) - 1) for index in range(len(walk_times))]
    walk_hip = (26, 20, 8, -8, -24, -18, -4, 14, 26)
    walk_knee = (4, 8, 18, 32, 14, 7, 16, 38, 4)
    walk_foot = (-8, -3, 4, 11, -14, -8, 3, 18, -8)
    walk_elbow = (12, 14, 18, 24, 29, 24, 18, 14, 12)
    walk = build_animation(
        buffer, joint_index, base, "Atlas_Walk", walk_times,
        {
            "hips": [(0, math.sin(phase) * 3.2, math.sin(phase) * 1.8) for phase in walk_phases],
            "chest": [(1.2, math.sin(phase) * -4.5, math.sin(phase) * -1.5) for phase in walk_phases],
            "neck": [(-0.4, math.sin(phase) * 0.8, math.sin(phase) * 0.2) for phase in walk_phases],
            "head": [(-0.8, math.sin(phase) * 1.0, math.sin(phase) * 0.3) for phase in walk_phases],
            "upper_arm.L": [(-math.cos(phase) * 24.0, 0, 3.0) for phase in walk_phases],
            "lower_arm.L": [(cycle_value(walk_elbow, phase), 0, 0) for phase in walk_phases],
            "upper_arm.R": [(-math.cos(phase + math.pi) * 24.0, 0, -3.0) for phase in walk_phases],
            "lower_arm.R": [(cycle_value(walk_elbow, phase + math.pi), 0, 0) for phase in walk_phases],
            "upper_leg.L": [(cycle_value(walk_hip, phase), 0, math.sin(phase) * -1.2) for phase in walk_phases],
            "lower_leg.L": [(cycle_value(walk_knee, phase), 0, 0) for phase in walk_phases],
            "foot.L": [(cycle_value(walk_foot, phase), 0, 0) for phase in walk_phases],
            "upper_leg.R": [(cycle_value(walk_hip, phase + math.pi), 0, math.sin(phase + math.pi) * 1.2) for phase in walk_phases],
            "lower_leg.R": [(cycle_value(walk_knee, phase + math.pi), 0, 0) for phase in walk_phases],
            "foot.R": [(cycle_value(walk_foot, phase + math.pi), 0, 0) for phase in walk_phases],
        },
        {
            "hips": [
                (
                    math.sin(phase) * 0.012,
                    (1 - math.cos(phase * 2)) * 0.012,
                    math.cos(phase * 2) * -0.004,
                )
                for phase in walk_phases
            ]
        },
    )

    run_times = [index * 0.06 for index in range(13)]
    run_phases = [math.tau * index / (len(run_times) - 1) for index in range(len(run_times))]
    run_knee = (14, 18, 34, 56, 68, 48, 27, 18, 14)
    run_foot = (-15, -7, 8, 21, 31, 13, -12, -24, -15)
    run_elbow = (52, 58, 64, 68, 64, 58, 52, 48, 52)
    run = build_animation(
        buffer, joint_index, base, "Atlas_Run", run_times,
        {
            "hips": [(-3.0, math.sin(phase) * 5.0, math.sin(phase) * 2.8) for phase in run_phases],
            "chest": [(-11.0, math.sin(phase) * -9.0, math.sin(phase) * -3.4) for phase in run_phases],
            "neck": [(4.0, math.sin(phase) * 2.0, math.sin(phase) * 0.35) for phase in run_phases],
            "head": [(2.5, math.sin(phase) * 2.5, math.sin(phase) * 0.7) for phase in run_phases],
            "upper_arm.L": [(-math.cos(phase) * 52.0, 0, 6.0) for phase in run_phases],
            "lower_arm.L": [(cycle_value(run_elbow, phase), 0, 0) for phase in run_phases],
            "upper_arm.R": [(-math.cos(phase + math.pi) * 52.0, 0, -6.0) for phase in run_phases],
            "lower_arm.R": [(cycle_value(run_elbow, phase + math.pi), 0, 0) for phase in run_phases],
            "upper_leg.L": [(math.cos(phase) * 48.0, 0, math.sin(phase) * -2.4) for phase in run_phases],
            "lower_leg.L": [(cycle_value(run_knee, phase), 0, 0) for phase in run_phases],
            "foot.L": [(cycle_value(run_foot, phase), 0, 0) for phase in run_phases],
            "upper_leg.R": [(math.cos(phase + math.pi) * 48.0, 0, math.sin(phase + math.pi) * 2.4) for phase in run_phases],
            "lower_leg.R": [(cycle_value(run_knee, phase + math.pi), 0, 0) for phase in run_phases],
            "foot.R": [(cycle_value(run_foot, phase + math.pi), 0, 0) for phase in run_phases],
        },
        {"hips": [(math.sin(phase) * 0.016, math.sin(phase) ** 2 * 0.058, 0) for phase in run_phases]},
    )
    return [idle, walk, run]


def export_glb(
    spec: dict,
    parts: list[Part],
    skeleton_nodes: list[dict],
    joint_index: dict[str, int],
    world: dict[str, Vec3],
    output_path: Path = GLB_PATH,
) -> dict:
    material_names = list(spec["palette"].keys())
    roughness = {"skin": 0.72, "skinShadow": 0.76, "ink": 0.84, "workwear": 0.82, "cream": 0.74, "orange": 0.72, "seafoam": 0.70, "leather": 0.80}
    materials = [
        {
            "name": name,
            "pbrMetallicRoughness": {
                "baseColorFactor": rgba_factor(spec["palette"][name]),
                "metallicFactor": 0.0,
                "roughnessFactor": roughness[name],
            },
        }
        for name in material_names
    ]
    buffer = GlbBuffer()
    primitives = []
    total_vertices = 0
    total_triangles = 0

    for material_index, material in enumerate(material_names):
        selected = [part for part in parts if part.material == material]
        positions: list[Vec3] = []
        normals: list[Vec3] = []
        indices: list[int] = []
        joints: list[int] = []
        for part in selected:
            base = len(positions)
            positions.extend(part.positions)
            normals.extend(part.normals)
            indices.extend(base + index for index in part.indices)
            joints.extend([joint_index[part.joint]] * len(part.positions))
        if not positions:
            continue
        position_values = [value for point in positions for value in point]
        normal_values = [value for point in normals for value in point]
        joint_values = [value for joint in joints for value in (joint, 0, 0, 0)]
        weight_values = [value for _ in joints for value in (1.0, 0.0, 0.0, 0.0)]
        mins = [min(point[i] for point in positions) for i in range(3)]
        maxs = [max(point[i] for point in positions) for i in range(3)]
        attributes = {
            "POSITION": buffer.add_accessor(pack_floats(position_values), 5126, len(positions), "VEC3", 34962, mins, maxs),
            "NORMAL": buffer.add_accessor(pack_floats(normal_values), 5126, len(normals), "VEC3", 34962),
            "JOINTS_0": buffer.add_accessor(pack_ushorts(joint_values), 5123, len(joints), "VEC4", 34962),
            "WEIGHTS_0": buffer.add_accessor(pack_floats(weight_values), 5126, len(joints), "VEC4", 34962),
        }
        index_accessor = buffer.add_accessor(pack_ushorts(indices), 5123, len(indices), "SCALAR", 34963, [min(indices)], [max(indices)])
        primitives.append({"attributes": attributes, "indices": index_accessor, "material": material_index, "mode": 4})
        total_vertices += len(positions)
        total_triangles += len(indices) // 3

    inverse_bind = []
    joint_names = [node["name"] for node in skeleton_nodes]
    for name in joint_names:
        x, y, z = world[name]
        inverse_bind.extend((1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -x, -y, -z, 1))
    ibm_accessor = buffer.add_accessor(pack_floats(inverse_bind), 5126, len(joint_names), "MAT4")
    animations = build_animation_set(buffer, joint_index, skeleton_nodes)

    mesh_node_index = len(skeleton_nodes)
    document = {
        "asset": {"version": "2.0", "generator": "SFACE native procedural character builder 1.0"},
        "scene": 0,
        "scenes": [{"name": "Atlas Walker", "nodes": [0, mesh_node_index]}],
        "nodes": skeleton_nodes + [{"name": "AtlasWalker_Mesh", "mesh": 0, "skin": 0}],
        "meshes": [{"name": "AtlasWalker_Low", "primitives": primitives}],
        "skins": [{"name": "AtlasWalker_Rig", "inverseBindMatrices": ibm_accessor, "skeleton": 0, "joints": list(range(len(skeleton_nodes)))}],
        "animations": animations,
        "materials": materials,
        "buffers": [{"byteLength": len(buffer.data)}],
        "bufferViews": buffer.views,
        "accessors": buffer.accessors,
        "extras": {
            "source": "art/atlas/characters/atlas-walker-v1/build_character.py",
            "provenance": "Original procedural geometry; no generated image, image-to-3D input, stock model, or external mesh.",
            "frontDirection": "+Z",
            "animationSet": ["Atlas_Idle", "Atlas_Walk", "Atlas_Run"],
        },
    }

    json_bytes = json.dumps(document, separators=(",", ":")).encode("utf-8")
    json_bytes += b" " * ((4 - len(json_bytes) % 4) % 4)
    buffer.align()
    bin_bytes = bytes(buffer.data)
    total_length = 12 + 8 + len(json_bytes) + 8 + len(bin_bytes)
    payload = bytearray(struct.pack("<4sII", b"glTF", 2, total_length))
    payload.extend(struct.pack("<I4s", len(json_bytes), b"JSON"))
    payload.extend(json_bytes)
    payload.extend(struct.pack("<I4s", len(bin_bytes), b"BIN\x00"))
    payload.extend(bin_bytes)
    output_path.write_bytes(payload)
    return {
        "vertices": total_vertices,
        "triangles": total_triangles,
        "materials": len(primitives),
        "bones": len(skeleton_nodes),
        "animations": len(animations),
        "textureMaps": 0,
        "glbBytes": len(payload),
        "drawCalls": len(primitives),
    }


def build_npc_lod2_parts() -> list[Part]:
    """Build a tiny distant silhouette from the same native primitive source."""
    return [
        ellipsoid("npc_lod2_body", "orange", "chest", (0.0, 1.30, 0.0), (0.31, 0.36, 0.20), 6, 3),
        ellipsoid("npc_lod2_head", "skin", "head", (0.0, 1.82, 0.01), (0.18, 0.21, 0.16), 6, 3),
        faceted_box("npc_lod2_pack", "seafoam", "chest", (-0.10, 1.33, -0.22), (0.34, 0.38, 0.16), 0.10),
        cylinder_between("npc_lod2_arm_l", "orange", "upper_arm.L", (0.24, 1.47, 0.0), (0.30, 1.02, 0.02), 0.08, 0.055, 5),
        cylinder_between("npc_lod2_arm_r", "orange", "upper_arm.R", (-0.24, 1.47, 0.0), (-0.30, 1.02, 0.02), 0.08, 0.055, 5),
        cylinder_between("npc_lod2_leg_l", "workwear", "upper_leg.L", (0.14, 0.92, 0.0), (0.14, 0.12, 0.02), 0.10, 0.075, 5),
        cylinder_between("npc_lod2_leg_r", "workwear", "upper_leg.R", (-0.14, 0.92, 0.0), (-0.14, 0.12, 0.02), 0.10, 0.075, 5),
    ]


def select_npc_lod1_parts(parts: list[Part]) -> list[Part]:
    """Keep low-cost eyes and a mouth on nearby citizens while trimming tiny gear."""
    hidden_prefixes = (
        "ear_", "brow_", "nose", "fringe_", "scanner_", "antenna", "jacket_tab", "sole_",
        "thumb_", "eye_lid_", "pack_strap_", "jacket_collar_", "boot_cuff_", "wrist_cuff_", "chin",
    )
    return [part for part in parts if not part.name.startswith(hidden_prefixes)]


def rotate_y(point: Vec3, degrees: float) -> Vec3:
    angle = math.radians(degrees)
    cosine, sine = math.cos(angle), math.sin(angle)
    return (point[0] * cosine + point[2] * sine, point[1], -point[0] * sine + point[2] * cosine)


def render_view(parts: list[Part], palette: dict[str, str], yaw: float, size: int = 512, silhouette: bool = False) -> Image.Image:
    scale_factor = 2
    width = height = size * scale_factor
    background = hex_rgb("#F4EDE0")
    image = Image.new("RGB", (width, height), background)
    draw = ImageDraw.Draw(image)
    draw.ellipse((width * 0.27, height * 0.86, width * 0.73, height * 0.94), fill=(210, 195, 170))
    triangles = []
    light = unit((-0.4, 0.8, 0.6))
    for part in parts:
        points = [rotate_y(point, yaw) for point in part.positions]
        base_colour = (20, 17, 14) if silhouette else hex_rgb(palette[part.material])
        for index in range(0, len(part.indices), 3):
            tri = [points[part.indices[index + offset]] for offset in range(3)]
            normal = unit(cross(sub(tri[1], tri[0]), sub(tri[2], tri[0])))
            shade = 1.0 if silhouette else 0.70 + 0.30 * max(0.0, dot(normal, light))
            colour = tuple(max(0, min(255, round(channel * shade))) for channel in base_colour)
            depth = sum(point[2] for point in tri) / 3
            triangles.append((depth, tri, colour))
    triangles.sort(key=lambda item: item[0])
    minimum_y = min(point[1] for part in parts for point in part.positions)
    maximum_y = max(point[1] for part in parts for point in part.positions)
    model_height = maximum_y - minimum_y
    pixel_scale = height * 0.78 / model_height
    origin_x, ground_y = width / 2, height * 0.88
    for _, tri, colour in triangles:
        polygon = [(origin_x + p[0] * pixel_scale, ground_y - p[1] * pixel_scale + p[2] * pixel_scale * 0.07) for p in tri]
        draw.polygon(polygon, fill=colour)
    return image.resize((size, size), Image.Resampling.LANCZOS)


def build_previews(parts: list[Part], palette: dict[str, str]) -> None:
    front = render_view(parts, palette, 0, 640)
    front.save(FRONT_PATH, optimize=True)
    views = [("FRONT", 0), ("THREE QUARTER", 38), ("SIDE", 90), ("BACK", 180)]
    panel = Image.new("RGB", (1280, 400), hex_rgb("#14110E"))
    draw = ImageDraw.Draw(panel)
    for index, (label, yaw) in enumerate(views):
        view = render_view(parts, palette, yaw, 360)
        x = index * 320 - 20
        panel.paste(view, (x, 20))
        draw.text((index * 320 + 16, 366), label, fill=hex_rgb("#F4EDE0"), stroke_width=0)
    panel.save(TURN_PATH, optimize=True)
    render_view(parts, palette, 0, 96, silhouette=True).save(SILHOUETTE_PATH, optimize=True)


def validate(spec: dict, metrics: dict, parts: list[Part]) -> dict:
    raw = GLB_PATH.read_bytes()
    magic, version, declared_length = struct.unpack_from("<4sII", raw, 0)
    json_length, json_kind = struct.unpack_from("<I4s", raw, 12)
    json_start = 20
    json_end = json_start + json_length
    document = json.loads(raw[json_start:json_end].decode("utf-8"))
    bin_length, bin_kind = struct.unpack_from("<I4s", raw, json_end)
    bin_start = json_end + 8
    component_bytes = {5121: 1, 5123: 2, 5125: 4, 5126: 4}
    type_width = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}
    buffer_ranges_valid = all(
        view.get("byteOffset", 0) >= 0
        and view.get("byteOffset", 0) + view["byteLength"] <= bin_length
        for view in document["bufferViews"]
    )
    accessor_ranges_valid = True
    for accessor in document["accessors"]:
        view = document["bufferViews"][accessor["bufferView"]]
        required = accessor.get("byteOffset", 0) + accessor["count"] * component_bytes[accessor["componentType"]] * type_width[accessor["type"]]
        accessor_ranges_valid = accessor_ranges_valid and required <= view["byteLength"]
    bounds = {
        axis: [min(point[i] for part in parts for point in part.positions), max(point[i] for part in parts for point in part.positions)]
        for i, axis in enumerate(("x", "y", "z"))
    }
    budget = spec["mobileBudget"]
    checks = {
        "glbHeader": magic == b"glTF" and version == 2 and declared_length == len(raw),
        "glbChunks": json_kind == b"JSON" and bin_kind == b"BIN\x00" and bin_start + bin_length == len(raw),
        "bufferRanges": buffer_ranges_valid and accessor_ranges_valid,
        "skinBinding": len(document["skins"][0]["joints"]) == metrics["bones"] and document["skins"][0]["skeleton"] == 0,
        "runtimeMesh": len(document["meshes"]) == 1 and len(document["meshes"][0]["primitives"]) == metrics["drawCalls"],
        "noEmbeddedImages": not document.get("images") and not document.get("textures"),
        "triangleBudget": metrics["triangles"] <= budget["maxTriangles"],
        "materialBudget": metrics["materials"] <= budget["maxMaterials"],
        "boneBudget": metrics["bones"] <= budget["maxBones"],
        "fileBudget": metrics["glbBytes"] <= budget["maxGlbBytes"],
        "textureFree": metrics["textureMaps"] == budget["textureMaps"],
        "animationPresent": metrics["animations"] == budget["animationClips"],
        "heightMatchesSpec": abs((bounds["y"][1] - bounds["y"][0]) - spec["scaleMeters"]["height"]) < 0.001,
        "silhouettePreview": SILHOUETTE_PATH.exists() and SILHOUETTE_PATH.stat().st_size > 0,
    }
    report = {
        "asset": spec["asset"],
        "version": spec["version"],
        "status": "pass" if all(checks.values()) else "fail",
        "metrics": metrics,
        "sha256": hashlib.sha256(raw).hexdigest(),
        "boundsMeters": bounds,
        "checks": checks,
        "provenance": spec["authorship"],
    }
    VALIDATION_PATH.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    if report["status"] != "pass":
        raise SystemExit("Character validation failed. Read validation.json.")
    return report


def main() -> None:
    spec = json.loads(SPEC_PATH.read_text(encoding="utf-8"))
    skeleton_nodes, joint_index, world = build_skeleton()
    parts = build_parts(world)
    scale_to_target_height(parts, skeleton_nodes, world, spec["scaleMeters"]["height"])
    metrics = export_glb(spec, parts, skeleton_nodes, joint_index, world)
    lod1_metrics = export_glb(spec, select_npc_lod1_parts(parts), skeleton_nodes, joint_index, world, NPC_LOD1_PATH)
    lod2_nodes = copy.deepcopy(skeleton_nodes)
    lod2_world = dict(world)
    lod2_parts = build_npc_lod2_parts()
    scale_to_target_height(lod2_parts, lod2_nodes, lod2_world, spec["scaleMeters"]["height"])
    lod2_metrics = export_glb(spec, lod2_parts, lod2_nodes, joint_index, lod2_world, NPC_LOD2_PATH)
    build_previews(parts, spec["palette"])
    metrics["npcLod1"] = lod1_metrics
    metrics["npcLod2"] = lod2_metrics
    report = validate(spec, metrics, parts)
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
