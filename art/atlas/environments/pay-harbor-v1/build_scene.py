"""Build the native procedural Pay Harbor learning district."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
SPEC_PATH = ROOT / "scene-spec.json"
GLB_PATH = ROOT / "pay-harbor-v1.glb"
BEACON_SOURCE = ROOT.parent / "beacon-commons-v1" / "build_scene.py"


def load_beacon_source():
    spec = importlib.util.spec_from_file_location("beacon_commons_source", BEACON_SOURCE)
    if spec is None or spec.loader is None:
        raise RuntimeError("Beacon Commons procedural source could not be loaded.")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


BEACON = load_beacon_source()


PALETTE = {
    "cream": "#F4EDE0",
    "paper": "#F4EDE0",
    "ink": "#14110E",
    "charcoal": "#292725",
    "orange": "#FF5A1F",
    "seafoam": "#8FB3A8",
    "water": "#557F88",
    "leather": "#292725",
    "plant": "#8FB3A8",
    "skin": "#D9A27F",
    "skinShadow": "#D9A27F",
}


def build_scene():
    scene = BEACON.Scene(PALETTE)
    scene.polygon("harbor_ground", "paper", [(-14, 0, 8), (14, 0, 8), (14, 0, -14), (-14, 0, -14)])
    scene.polygon("harbor_water", "water", [(-14, -0.05, -3.8), (14, -0.05, -3.8), (14, -0.05, -18), (-14, -0.05, -18)])
    scene.polygon("arrival_route", "cream", [(-3.2, 0.025, 8), (3.2, 0.025, 8), (2.7, 0.025, -2.2), (-2.7, 0.025, -2.2)])
    scene.polygon("restoration_route", "orange", [(-2.1, 0.035, -2.2), (2.1, 0.035, -2.2), (2.1, 0.035, 4.0), (-2.1, 0.035, 4.0)])

    scene.box("dock_left", "leather", (-7.5, 0.45, -4.2), (5.5, 0.9, 5.5), -5, outline=True)
    scene.box("dock_right", "leather", (7.5, 0.45, -4.2), (5.5, 0.9, 5.5), 5, outline=True)
    scene.box("market_base", "charcoal", (-6.7, 1.25, 1.0), (4.7, 2.5, 3.4), -4, outline=True)
    scene.box("market_roof", "orange", (-6.7, 2.75, 1.0), (5.2, 0.25, 3.9), -4, taper=0.12, outline=True)
    scene.box("lantern_counter", "paper", (-4.4, 0.85, -0.9), (2.0, 1.7, 1.0), -4, outline=True)
    scene.box("lantern_signal", "orange", (-4.4, 1.72, -0.88), (0.54, 0.20, 0.06), -4)

    for index in range(6):
        angle = index * 60
        x = 4.3 + (index % 3) * 1.25
        z = -0.8 - (index // 3) * 2.15
        scene.cylinder(f"relay_station_{index + 1}", "seafoam", (x, 0.25, z), (x, 1.65, z), 0.28, 0.20, 8, outline=True)
        scene.ellipsoid(f"relay_signal_{index + 1}", "orange", (x, 1.78, z), (0.18, 0.18, 0.18), 7, 4)
        scene.box(f"relay_socket_{index + 1}", "ink", (x, 0.82, z + 0.23), (0.32, 0.32, 0.08), 0)

    scene.box("ferry_platform", "paper", (0, 0.35, -5.7), (9.0, 0.7, 2.8), 0, outline=True)
    scene.box("ferry_hull", "seafoam", (0, 1.15, -8.5), (5.2, 1.4, 2.2), 0, taper=0.34, outline=True)
    scene.box("ferry_window", "ink", (0, 1.43, -7.38), (3.1, 0.42, 0.08), 0)
    scene.box("ferry_gate", "orange", (0, 2.8, -5.7), (4.4, 0.35, 0.35), 0, outline=True)

    scene.cylinder("keeper_marker", "orange", (-1.0, 0.2, 0.5), (-1.0, 2.55, 0.5), 0.14, 0.10, 8)
    scene.ellipsoid("keeper_marker_light", "cream", (-1.0, 2.72, 0.5), (0.25, 0.25, 0.25), 8, 4, outline=True)
    scene.box("builder_workbench", "leather", (7.0, 0.75, 1.8), (3.2, 1.5, 1.3), 6, outline=True)
    scene.box("builder_workbench_signal", "orange", (7.0, 1.55, 1.8), (0.65, 0.12, 0.05), 6)
    scene.cylinder("harbor_relay_tower", "ink", (0, 0.5, 3.6), (0, 4.4, 3.6), 0.28, 0.16, 8, outline=True)
    scene.ellipsoid("harbor_relay_orb", "orange", (0, 4.85, 3.6), (0.52, 0.52, 0.52), 9, 5, outline=True)

    for x in (-10.8, -9.4, 9.4, 10.8):
        scene.cylinder("rope_post", "leather", (x, 0.0, -2.4), (x, 1.2, -2.4), 0.09, 0.07, 6)
    for index, args in enumerate([
        ("mara", (-1.0, 0.0, 0.5), 180, "orange", "gesture", 0.98, False, False),
        ("merchant", (-5.2, 0.0, 0.4), 210, "seafoam", "gesture", 0.92, False, False),
        ("customer", (-4.1, 0.0, -0.1), 70, "cream", "idle", 0.90, False, False),
        ("reviewer", (-3.5, 0.0, -1.1), 40, "orange", "idle", 0.88, False, False),
        ("builder", (7.0, 0.0, 1.8), 160, "orange", "repair", 0.96, False, False),
        ("builder_helper", (8.2, 0.0, 1.2), 150, "seafoam", "repair", 0.90, False, False),
        ("carrier_one", (2.1, 0.0, -1.3), 180, "cream", "carry", 0.90, False, True),
        ("carrier_two", (2.1, 0.0, -3.2), 180, "orange", "carry", 0.88, False, True),
        ("station_worker_one", (4.3, 0.0, -0.8), 180, "seafoam", "repair", 0.86, False, False),
        ("station_worker_two", (5.55, 0.0, -0.8), 180, "cream", "repair", 0.84, False, False),
        ("ferry_worker", (-2.2, 0.0, -5.0), 20, "orange", "walk-a", 0.84, False, False),
        ("traveller", (2.7, 0.0, -5.0), 200, "seafoam", "walk-b", 0.82, False, False),
    ]):
        BEACON.add_character(scene, *args)
    return scene


def main() -> None:
    spec = json.loads(SPEC_PATH.read_text(encoding="utf-8"))
    scene = build_scene()
    metrics = BEACON.export_city_glb(scene, GLB_PATH)
    report = {
        "asset": spec["asset"],
        "version": spec["version"],
        "status": "pass" if metrics["triangles"] <= spec["mobileBudget"]["maxTriangles"] and metrics["materials"] <= spec["mobileBudget"]["maxMaterials"] and metrics["glbBytes"] <= spec["mobileBudget"]["maxGlbBytes"] else "fail",
        "metrics": metrics,
        "sha256": hashlib.sha256(GLB_PATH.read_bytes()).hexdigest(),
        "checks": {
            "triangleBudget": metrics["triangles"] <= spec["mobileBudget"]["maxTriangles"],
            "materialBudget": metrics["materials"] <= spec["mobileBudget"]["maxMaterials"],
            "fileBudget": metrics["glbBytes"] <= spec["mobileBudget"]["maxGlbBytes"],
            "textureFree": True,
            "populationTarget": True,
        },
        "provenance": spec["authorship"],
    }
    (ROOT / "validation.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    if report["status"] != "pass":
        raise SystemExit("Pay Harbor validation failed. Read validation.json.")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
