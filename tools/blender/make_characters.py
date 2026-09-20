"""
Placeholder character + item generator for the block game.

Builds blocky humanoid characters that follow docs/character-contract.md
(shared skeleton, named animation clips, one small pixel-art texture) and
exports them as GLB files. Reproducible: re-run to regenerate everything.

Usage (headless, never touches an open Blender session):

    blender -b --factory-startup -P tools/blender/make_characters.py -- public/models

Blender 5.x (uses keyframe_insert, which handles slotted actions).
"""

import bpy
import bmesh
import math
import os
import sys

FPS = 30
TEX = 64          # texture size (pixels)
CELL = 8          # cell size (pixels); texture is a CELL grid
GRID = TEX // CELL

ARG_OUT = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else os.path.join(os.path.dirname(__file__), "..", "..", "public", "models")
OUT_DIR = os.path.abspath(ARG_OUT)

ARM_BONES = ["upper_arm.L", "lower_arm.L", "hand.L", "upper_arm.R", "lower_arm.R", "hand.R"]
UPPER_BONES = ["spine", "chest", "neck", "head"] + ARM_BONES
ALL_BONES = ["root", "hips", "spine", "chest", "neck", "head",
             "upper_arm.L", "lower_arm.L", "hand.L", "upper_arm.R", "lower_arm.R", "hand.R",
             "upper_leg.L", "lower_leg.L", "foot.L", "upper_leg.R", "lower_leg.R", "foot.R"]


# ---------------------------------------------------------------------------
#  scene helpers
# ---------------------------------------------------------------------------

def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.fps = FPS
    scene.frame_start = 0
    scene.frame_end = 60
    # linear keys: exported as-is (no baking), so each clip only carries the
    # bones it actually animates, which is what makes layering work
    bpy.context.preferences.edit.keyframe_new_interpolation_type = "LINEAR"


def hexcol(h):
    h = h.lstrip("#")
    return [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]


def lcg(seed):
    state = [seed & 0x7FFFFFFF or 1]

    def rnd():
        state[0] = (state[0] * 1103515245 + 12345) & 0x7FFFFFFF
        return state[0] / 0x7FFFFFFF
    return rnd


# ---------------------------------------------------------------------------
#  texture painting (cell based pixel art)
# ---------------------------------------------------------------------------

class Painter:
    def __init__(self, seed):
        self.px = [0.0] * (TEX * TEX * 4)
        self.rnd = lcg(seed)
        self.cells = {}

    def put(self, x, y, rgb, a=1.0):
        # x, y in texture pixels, y=0 is the TOP row (converted to Blender's bottom-up)
        if not (0 <= x < TEX and 0 <= y < TEX):
            return
        by = TEX - 1 - y
        i = (by * TEX + x) * 4
        self.px[i:i + 4] = [min(1, max(0, rgb[0])), min(1, max(0, rgb[1])), min(1, max(0, rgb[2])), a]

    def jit(self, rgb, amt):
        d = (self.rnd() - 0.5) * 2 * amt
        return [rgb[0] + d, rgb[1] + d, rgb[2] + d]

    def cell(self, name, paint):
        """allocate the next free cell and paint it: paint(p, ox, oy)"""
        if name in self.cells:
            return self.cells[name]
        idx = len(self.cells)
        cx, cy = idx % GRID, idx // GRID
        self.cells[name] = idx
        paint(self, cx * CELL, cy * CELL)
        return idx

    def fill(self, ox, oy, col, amt=0.04):
        c = hexcol(col)
        for y in range(CELL):
            for x in range(CELL):
                self.put(ox + x, oy + y, self.jit(c, amt))

    def rect(self, ox, oy, x, y, w, h, col, amt=0.03):
        c = hexcol(col)
        for yy in range(y, y + h):
            for xx in range(x, x + w):
                if 0 <= xx < CELL and 0 <= yy < CELL:
                    self.put(ox + xx, oy + yy, self.jit(c, amt))


def uv_rect(cell_index):
    cx, cy = cell_index % GRID, cell_index // GRID
    inset = 0.3 / TEX
    u0 = cx / GRID + inset
    u1 = (cx + 1) / GRID - inset
    # painter y=0 is top row: cell row cy spans image rows from the top
    v1 = 1 - cy / GRID - inset
    v0 = 1 - (cy + 1) / GRID + inset
    return u0, v0, u1, v1


# ---------------------------------------------------------------------------
#  character specs
# ---------------------------------------------------------------------------

def base_dims(scale=1.0, wide=1.0):
    s, w = scale, wide
    return {
        "leg_len": 0.74 * s, "leg_w": 0.22 * s * w,
        "hip_h": 0.12 * s,
        "torso_len": 0.56 * s, "torso_w": 0.46 * s * w, "torso_d": 0.26 * s * w,
        "head": 0.38 * s,
        "arm_len": 0.64 * s, "arm_w": 0.19 * s * w,
    }


def face_painter(skin, eye="#1d2733", mouth="#6b3a2a", hair=None, eye_white="#f4f4f4", tusks=False, sockets=False):
    def paint(p, ox, oy):
        p.fill(ox, oy, skin)
        if hair:
            p.rect(ox, oy, 0, 0, CELL, 2, hair)
            p.rect(ox, oy, 0, 2, 1, 1, hair)
            p.rect(ox, oy, 7, 2, 1, 1, hair)
        if sockets:
            p.rect(ox, oy, 1, 3, 2, 2, "#1a1a1a")
            p.rect(ox, oy, 5, 3, 2, 2, "#1a1a1a")
            p.rect(ox, oy, 2, 6, 4, 1, "#3a3a3a")
            return
        p.rect(ox, oy, 1, 3, 2, 1, eye_white)
        p.rect(ox, oy, 5, 3, 2, 1, eye_white)
        p.rect(ox, oy, 2, 3, 1, 1, eye)
        p.rect(ox, oy, 5, 3, 1, 1, eye)
        p.rect(ox, oy, 3, 6, 2, 1, mouth)
        if tusks:
            p.rect(ox, oy, 2, 6, 1, 1, "#f0ead6")
            p.rect(ox, oy, 5, 6, 1, 1, "#f0ead6")
    return paint


def solid(col, amt=0.04):
    return lambda p, ox, oy: p.fill(ox, oy, col, amt)


def banded(top, rows, rest):
    def paint(p, ox, oy):
        p.fill(ox, oy, rest)
        p.rect(ox, oy, 0, 0, CELL, rows, top)
    return paint


def shirt_front(col, belt="#3a2a1a", buckle="#d8b440", collar=None, emblem=None):
    def paint(p, ox, oy):
        p.fill(ox, oy, col)
        if collar:
            p.rect(ox, oy, 3, 0, 2, 2, collar)
        if emblem:
            p.rect(ox, oy, 2, 2, 4, 3, emblem)
            p.rect(ox, oy, 3, 3, 2, 1, "#f2d23c")
        p.rect(ox, oy, 0, 7, CELL, 1, belt)
        p.rect(ox, oy, 3, 7, 2, 1, buckle)
    return paint


def ribs(bone, dark):
    def paint(p, ox, oy):
        p.fill(ox, oy, dark)
        p.rect(ox, oy, 3, 0, 2, CELL, bone)
        for y in (1, 3, 5):
            p.rect(ox, oy, 1, y, 6, 1, bone)
    return paint


def armor_front(steel, trim):
    def paint(p, ox, oy):
        p.fill(ox, oy, steel, 0.06)
        p.rect(ox, oy, 0, 0, CELL, 1, trim)
        p.rect(ox, oy, 2, 2, 4, 4, trim)
        p.rect(ox, oy, 3, 3, 2, 2, "#f2d23c")
        for x, y in ((0, 6), (7, 6), (0, 2), (7, 2)):
            p.rect(ox, oy, x, y, 1, 1, "#e6ebef")
    return paint


def helmet_face(skin, steel):
    def paint(p, ox, oy):
        p.fill(ox, oy, steel, 0.05)
        p.rect(ox, oy, 1, 3, 6, 4, skin)
        p.rect(ox, oy, 2, 4, 1, 1, "#1d2733")
        p.rect(ox, oy, 5, 4, 1, 1, "#1d2733")
        p.rect(ox, oy, 3, 3, 2, 3, steel)
    return paint


def hood_face(skin, hood):
    def paint(p, ox, oy):
        face_painter(skin)(p, ox, oy)
        p.rect(ox, oy, 0, 0, CELL, 2, hood)
        p.rect(ox, oy, 0, 0, 1, CELL, hood)
        p.rect(ox, oy, 7, 0, 1, CELL, hood)
    return paint


def miner_face(skin, helmet):
    def paint(p, ox, oy):
        face_painter(skin, eye="#aa2222")(p, ox, oy)
        p.rect(ox, oy, 0, 0, CELL, 2, helmet)
        p.rect(ox, oy, 3, 0, 2, 2, "#fff6b0")
    return paint


CHARACTERS = {
    "player": {
        # the only model that carries the per-tier swings and the full bow draw
        "extra_clips": True,
        "dims": base_dims(),
        "cells": {
            "face": face_painter("#e0ac7e", hair="#4a2f1b"),
            "head_side": banded("#4a2f1b", 3, "#e0ac7e"),
            "head_back": solid("#4a2f1b"),
            "head_top": solid("#4a2f1b"),
            "skin": solid("#e0ac7e"),
            "torso_front": shirt_front("#3d8fd6", collar="#e0ac7e"),
            "torso": banded("#3d8fd6", 7, "#3d8fd6"),
            "sleeve": solid("#3d8fd6"),
            "forearm": banded("#3d8fd6", 2, "#e0ac7e"),
            "pants": solid("#3b3b58"),
            "shin": banded("#3b3b58", 5, "#4a3222"),
            "boot": solid("#4a3222"),
        },
    },
    "defender_swordsman": {
        "dims": base_dims(1.02, 1.08),
        "cells": {
            "face": helmet_face("#d9a27a", "#9aa3ad"),
            "head_side": solid("#9aa3ad", 0.06),
            "head_back": solid("#8a939d", 0.06),
            "head_top": solid("#aab3bd", 0.06),
            "skin": solid("#d9a27a"),
            "torso_front": armor_front("#9aa3ad", "#2f5fa8"),
            "torso": solid("#8a939d", 0.06),
            "sleeve": solid("#9aa3ad", 0.06),
            "forearm": banded("#9aa3ad", 4, "#5a4a3a"),
            "pants": solid("#6f7780", 0.08),
            "shin": banded("#6f7780", 3, "#3a3a40"),
            "boot": solid("#3a3a40"),
        },
    },
    "defender_archer": {
        "dims": base_dims(0.98, 0.95),
        "cells": {
            "face": hood_face("#e3b48a", "#3f7a3a"),
            "head_side": solid("#3f7a3a"),
            "head_back": solid("#356a31"),
            "head_top": solid("#3f7a3a"),
            "skin": solid("#e3b48a"),
            "torso_front": shirt_front("#6b8e3a", belt="#5a3a1a", collar="#3f7a3a"),
            "torso": solid("#6b8e3a"),
            "sleeve": solid("#3f7a3a"),
            "forearm": banded("#3f7a3a", 3, "#7a5534"),
            "pants": solid("#7a5534"),
            "shin": banded("#7a5534", 2, "#5a3d22"),
            "boot": solid("#5a3d22"),
        },
    },
    "defender_gunner": {
        "dims": base_dims(1.0, 1.02),
        "cells": {
            "face": face_painter("#c98f68", hair="#1b1b1f", mouth="#4a2a1a"),
            "head_side": banded("#1b1b1f", 4, "#c98f68"),
            "head_back": solid("#1b1b1f"),
            "head_top": solid("#1b1b1f"),
            "skin": solid("#c98f68"),
            "torso_front": shirt_front("#7a2e2e", belt="#1b1b1f", buckle="#c0c0c0", collar="#e8e2d0"),
            "torso": solid("#7a2e2e"),
            "sleeve": solid("#7a2e2e"),
            "forearm": banded("#7a2e2e", 5, "#e8e2d0"),
            "pants": solid("#c2a878"),
            "shin": banded("#c2a878", 2, "#1b1b1f"),
            "boot": solid("#1b1b1f"),
        },
    },
    "attacker_grunt": {
        "dims": base_dims(1.0, 1.0),
        "cells": {
            "face": face_painter("#6fa35a", eye="#d03030", eye_white="#20301a", mouth="#2a3a1a", hair="#3a4a2a"),
            "head_side": banded("#3a4a2a", 2, "#6fa35a"),
            "head_back": solid("#5f934a"),
            "head_top": solid("#3a4a2a"),
            "skin": solid("#6fa35a"),
            "torso_front": shirt_front("#5b4a7a", belt="#2a2030", buckle="#6fa35a"),
            "torso": solid("#5b4a7a", 0.08),
            "sleeve": solid("#5b4a7a", 0.08),
            "forearm": solid("#6fa35a"),
            "pants": solid("#2d3a5a"),
            "shin": banded("#2d3a5a", 4, "#6fa35a"),
            "boot": solid("#4f7a3e"),
        },
    },
    "attacker_archer": {
        "dims": base_dims(1.0, 0.85),
        "cells": {
            "face": face_painter("#d9d4c5", sockets=True),
            "head_side": solid("#d9d4c5"),
            "head_back": solid("#cfc9b8"),
            "head_top": solid("#e2ddd0"),
            "skin": solid("#d9d4c5"),
            "torso_front": ribs("#d9d4c5", "#2a2a2e"),
            "torso": ribs("#cfc9b8", "#2a2a2e"),
            "sleeve": solid("#d9d4c5"),
            "forearm": solid("#d9d4c5"),
            "pants": solid("#3a2f2a"),
            "shin": banded("#3a2f2a", 2, "#d9d4c5"),
            "boot": solid("#cfc9b8"),
        },
    },
    "attacker_brute": {
        "dims": base_dims(1.24, 1.35),
        "cells": {
            "face": face_painter("#9c4a3a", eye="#f2d23c", eye_white="#3a1a14", mouth="#3a1a14", tusks=True),
            "head_side": solid("#9c4a3a"),
            "head_back": solid("#8c3f31"),
            "head_top": solid("#6b2e24"),
            "skin": solid("#9c4a3a"),
            "torso_front": shirt_front("#9c4a3a", belt="#4a3222", buckle="#8a8a8a"),
            "torso": solid("#8c3f31"),
            "sleeve": solid("#9c4a3a"),
            "forearm": banded("#9c4a3a", 5, "#4a3222"),
            "pants": solid("#5a3d22"),
            "shin": solid("#9c4a3a"),
            "boot": solid("#3a2616"),
        },
    },
    "attacker_sapper": {
        "dims": base_dims(0.96, 1.0),
        "cells": {
            "face": miner_face("#8aa07a", "#e0b030"),
            "head_side": banded("#e0b030", 3, "#8aa07a"),
            "head_back": banded("#e0b030", 3, "#7a906a"),
            "head_top": solid("#e0b030"),
            "skin": solid("#8aa07a"),
            "torso_front": shirt_front("#6e5028", belt="#3a2a1a", collar="#8aa07a"),
            "torso": solid("#6e5028"),
            "sleeve": solid("#6e5028"),
            "forearm": banded("#6e5028", 3, "#8aa07a"),
            "pants": solid("#5a4020"),
            "shin": banded("#5a4020", 3, "#3a2a1a"),
            "boot": solid("#3a2a1a"),
        },
    },
}


# ---------------------------------------------------------------------------
#  geometry
# ---------------------------------------------------------------------------

def add_box(bm, uv_layer, deform_layer, group_index, center, size, cells):
    """cells: dict face -> cell index for front/back/right/left/top/bottom"""
    cx, cy, cz = center
    hx, hy, hz = size[0] / 2, size[1] / 2, size[2] / 2

    def v(sx, sy, sz):
        return (cx + sx * hx, cy + sy * hy, cz + sz * hz)

    # corners per face in (bottom-left, bottom-right, top-right, top-left) seen from outside
    faces = {
        "front": [v(-1, -1, -1), v(1, -1, -1), v(1, -1, 1), v(-1, -1, 1)],
        "back": [v(1, 1, -1), v(-1, 1, -1), v(-1, 1, 1), v(1, 1, 1)],
        "right": [v(-1, 1, -1), v(-1, -1, -1), v(-1, -1, 1), v(-1, 1, 1)],
        "left": [v(1, -1, -1), v(1, 1, -1), v(1, 1, 1), v(1, -1, 1)],
        "top": [v(-1, -1, 1), v(1, -1, 1), v(1, 1, 1), v(-1, 1, 1)],
        "bottom": [v(-1, 1, -1), v(1, 1, -1), v(1, -1, -1), v(-1, -1, -1)],
    }
    for name, corners in faces.items():
        verts = []
        for co in corners:
            vert = bm.verts.new(co)
            if deform_layer is not None:
                vert[deform_layer][group_index] = 1.0
            verts.append(vert)
        face = bm.faces.new(verts)
        face.smooth = False
        u0, v0, u1, v1 = uv_rect(cells[name])
        uvs = [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]
        for loop, uv in zip(face.loops, uvs):
            loop[uv_layer].uv = uv


def build_character(name, spec):
    reset_scene()
    d = spec["dims"]
    painter = Painter(sum(ord(c) for c in name))
    cell = {k: painter.cell(k, fn) for k, fn in spec["cells"].items()}

    leg, hip_h, torso, head = d["leg_len"], d["hip_h"], d["torso_len"], d["head"]
    hip_z = leg
    spine_z = hip_z + hip_h
    chest_z = spine_z + torso * 0.45
    neck_z = spine_z + torso
    head_z = neck_z + 0.04
    top_z = head_z + head
    shoulder_x = d["torso_w"] / 2 + d["arm_w"] / 2
    shoulder_z = neck_z - 0.04
    leg_x = d["torso_w"] / 4 + 0.005
    arm_len = d["arm_len"]

    # --- armature -------------------------------------------------------
    arm_data = bpy.data.armatures.new(name + "_rig")
    rig = bpy.data.objects.new("rig", arm_data)
    bpy.context.scene.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm_data.edit_bones

    def bone(bname, head_co, tail_co, parent=None, deform=True):
        b = eb.new(bname)
        b.head = head_co
        b.tail = tail_co
        b.roll = 0
        b.use_deform = deform
        if parent:
            b.parent = eb[parent]
            b.use_connect = False
        return b

    bone("root", (0, 0, 0), (0, 0, 0.15))
    bone("hips", (0, 0, hip_z), (0, 0, spine_z), "root")
    bone("spine", (0, 0, spine_z), (0, 0, chest_z), "hips")
    bone("chest", (0, 0, chest_z), (0, 0, neck_z), "spine")
    bone("neck", (0, 0, neck_z), (0, 0, head_z), "chest")
    bone("head", (0, 0, head_z), (0, 0, top_z), "neck")
    for side, sx in (("L", 1), ("R", -1)):
        x = sx * shoulder_x
        bone(f"upper_arm.{side}", (x, 0, shoulder_z), (x, 0, shoulder_z - arm_len * 0.5), "chest")
        bone(f"lower_arm.{side}", (x, 0, shoulder_z - arm_len * 0.5), (x, 0, shoulder_z - arm_len * 0.9), f"upper_arm.{side}")
        bone(f"hand.{side}", (x, 0, shoulder_z - arm_len * 0.9), (x, 0, shoulder_z - arm_len), f"lower_arm.{side}")
        lx = sx * leg_x
        bone(f"upper_leg.{side}", (lx, 0, hip_z), (lx, 0, leg * 0.5), "hips")
        bone(f"lower_leg.{side}", (lx, 0, leg * 0.5), (lx, 0, 0.1), f"upper_leg.{side}")
        bone(f"foot.{side}", (lx, 0, 0.1), (lx, -0.14, 0.0), f"lower_leg.{side}")
    bone("hand.R_socket", (-shoulder_x, 0, shoulder_z - arm_len * 0.95), (-shoulder_x, 0, shoulder_z - arm_len * 1.1), "hand.R", deform=False)
    bpy.ops.object.mode_set(mode="OBJECT")

    # --- mesh -----------------------------------------------------------
    mesh = bpy.data.meshes.new(name + "_mesh")
    body = bpy.data.objects.new("body", mesh)
    bpy.context.scene.collection.objects.link(body)
    groups = {b: body.vertex_groups.new(name=b).index for b in ALL_BONES}

    bm = bmesh.new()
    uv_layer = bm.loops.layers.uv.new("UVMap")
    deform = bm.verts.layers.deform.verify()

    def box(bname, center, size, faces):
        add_box(bm, uv_layer, deform, groups[bname], center, size, faces)

    def all6(c):
        return {k: c for k in ("front", "back", "right", "left", "top", "bottom")}

    # head
    hc = (0, 0, head_z + head / 2)
    box("head", hc, (head, head, head), {
        "front": cell["face"], "back": cell["head_back"], "right": cell["head_side"],
        "left": cell["head_side"], "top": cell["head_top"], "bottom": cell["skin"]})
    # torso (chest + belly as one box on chest bone, hips box on hips)
    tw, td = d["torso_w"], d["torso_d"]
    box("chest", (0, 0, (spine_z + neck_z) / 2), (tw, td, neck_z - spine_z), {
        "front": cell["torso_front"], "back": cell["torso"], "right": cell["torso"],
        "left": cell["torso"], "top": cell["sleeve"], "bottom": cell["torso"]})
    box("hips", (0, 0, (hip_z + spine_z) / 2), (tw * 0.98, td * 0.98, hip_h), all6(cell["pants"]))
    # arms
    aw = d["arm_w"]
    for side, sx in (("L", 1), ("R", -1)):
        x = sx * shoulder_x
        box(f"upper_arm.{side}", (x, 0, shoulder_z + 0.05 - arm_len * 0.25 - 0.025), (aw, aw, arm_len * 0.5 + 0.05),
            {**all6(cell["sleeve"]), "bottom": cell["skin"]})
        box(f"lower_arm.{side}", (x, 0, shoulder_z - arm_len * 0.7), (aw * 0.96, aw * 0.96, arm_len * 0.4),
            {**all6(cell["forearm"]), "top": cell["sleeve"]})
        box(f"hand.{side}", (x, 0, shoulder_z - arm_len * 0.95), (aw * 0.9, aw * 0.9, arm_len * 0.1), all6(cell["skin"]))
        lx = sx * leg_x
        lw = d["leg_w"]
        box(f"upper_leg.{side}", (lx, 0, leg * 0.75), (lw, lw, leg * 0.5), all6(cell["pants"]))
        box(f"lower_leg.{side}", (lx, 0, leg * 0.25 + 0.05), (lw * 0.96, lw * 0.96, leg * 0.5 - 0.1), all6(cell["shin"]))
        box(f"foot.{side}", (lx, -0.03, 0.05), (lw * 1.02, lw * 1.3, 0.1), all6(cell["boot"]))

    bm.to_mesh(mesh)
    bm.free()

    body.parent = rig
    mod = body.modifiers.new("Armature", "ARMATURE")
    mod.object = rig

    # --- material + texture -------------------------------------------------
    img = bpy.data.images.new(name + "_tex", TEX, TEX, alpha=True)
    img.pixels[:] = painter.px
    img.file_format = "PNG"
    img.pack()
    mat = bpy.data.materials.new(name + "_mat")
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    bsdf = next(n for n in nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Roughness"].default_value = 1.0
    bsdf.inputs["Metallic"].default_value = 0.0
    tex = nodes.new("ShaderNodeTexImage")
    tex.image = img
    tex.interpolation = "Closest"
    mat.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    mesh.materials.append(mat)

    # --- animations -----------------------------------------------------------
    check_axes(rig)
    make_animations(rig, d, extra=spec.get("extra_clips", False))
    return rig


# ---------------------------------------------------------------------------
#  animation
# ---------------------------------------------------------------------------

def deg(v):
    return math.radians(v)


class Clip:
    """Helper to key a named action on the rig."""

    def __init__(self, rig, name, frames, bones):
        self.rig = rig
        self.name = name
        self.frames = frames
        self.bones = bones
        rig.animation_data_create()
        self.action = bpy.data.actions.new(name)
        rig.animation_data.action = self.action
        for pb in rig.pose.bones:
            pb.rotation_mode = "XYZ"
            pb.rotation_euler = (0, 0, 0)
            pb.location = (0, 0, 0)

    def key(self, frame, pose, loc=None):
        """pose: bone -> (x, y, z) degrees; bones in self.bones not in pose get zero"""
        pbs = self.rig.pose.bones
        for b in self.bones:
            r = pose.get(b, (0, 0, 0))
            pbs[b].rotation_euler = (deg(r[0]), deg(r[1]), deg(r[2]))
            pbs[b].keyframe_insert("rotation_euler", frame=frame, group=b)
        if loc is None and "hips" in self.bones:
            loc = {"hips": (0, 0, 0)}
        if loc is not None:
            for b, l in loc.items():
                pbs[b].location = l
                pbs[b].keyframe_insert("location", frame=frame, group=b)

    def done(self):
        self.action.use_fake_user = True
        # stash so the exporter sees every action
        track = self.rig.animation_data.nla_tracks.new()
        track.name = self.name
        strip = track.strips.new(self.name, 0, self.action)
        strip.name = self.name
        self.rig.animation_data.action = None


# Axis conventions for this rig (bones along +/-Z, roll 0), verified by
# check_axes() on every build:
#   limbs (pointing down): FWD * X rotation swings the limb forward (-Y)
#   left limbs: SIDE * Z rotation raises the limb outward (+X)
#   spine bones (pointing up): +X leans forward
FWD = -1
SIDE = -1


def limb(fwd=0.0, side=0.0):
    """fwd: degrees forward swing; side: degrees outward for .L (pass negative for .R)"""
    return (FWD * fwd, 0, SIDE * side)


# Gaits. Each leg: stance (foot planted, sliding back at constant speed under
# the body) for `stance` of the cycle, then swing (lifted arc forward). Angles
# come from 2-bone IK, so the stance foot stays on the ground; the hips drop
# just enough to reach. Phase 0 = left heel strike; the right leg is half a
# cycle behind. Ground speed at speed ratio 1 = stride / (stance * cycle time),
# measured on the exported GLBs by tools/anim-check.mjs.
GAITS = {
    "walk": {
        "frames": 18, "key_every": 1, "stance": 0.58,
        "front": 0.30, "back": 0.30,          # ankle travel under the hip while planted (m, before scale)
        "lift": 0.085,                        # swing ankle lift
        "hip_drop": (0.04, 0.018),            # mean hip drop, bob amplitude (lowest at heel strike)
        # foot pitch (deg, + = toe up): heel strike, flat, heel off at toe-off, swing.
        # The rolls span at least two keys, or the sole cuts the ground between them.
        "pitch": [(0.0, 8), (0.12, 0), (0.40, 0), (0.58, -26), (0.74, -6), (0.9, 6), (1.0, 8)],
        "lean": 3, "twist": 5, "arm": 20, "arm_side": 5, "elbow": (12, 10), "head": -2,
    },
    "run": {
        "frames": 16, "key_every": 0.5, "stance": 0.35,
        "front": 0.26, "back": 0.54,
        "lift": 0.28,
        "hip_drop": (0.115, 0.03),            # lowest at mid-stance, highest in flight
        "pitch": [(0.0, 5), (0.13, 0), (0.17, 0), (0.35, -24), (0.54, -16), (0.8, 8), (1.0, 5)],
        "lean": 12, "twist": 8, "arm": 42, "arm_side": 10, "elbow": (80, 12), "head": -9,
    },
}


def frange(frames, step):
    """Key frames 0..frames every `step` frames; `step` may be fractional.

    The legs are solved with IK and exported as plain bone rotations, so between
    two keys the ankle cuts the chord instead of following the arc: the longer
    the stride, the further the planted foot sinks mid-key. Sub-frame keys on
    the fast part of the cycle are what keep the sole on the ground (they cost
    ~0.1 KB gzipped each, against a 150 KB model budget).
    """
    n = int(round(frames / step))
    return [min(frames, i * step) for i in range(n + 1)]


def smoothstep(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


def table_at(table, p):
    """piecewise smooth interpolation through (phase, value) points covering 0..1"""
    p = p % 1.0
    for (p0, v0), (p1, v1) in zip(table, table[1:]):
        if p0 <= p <= p1:
            return v0 + (v1 - v0) * smoothstep((p - p0) / (p1 - p0) if p1 > p0 else 0)
    return table[-1][1]


def leg_ik(ax, ay, hip_y, l1, l2):
    """Sagittal 2-bone IK (x forward, y up), hip at (0, hip_y), knee bending
    backward. Returns (thigh, knee) in limb() degrees."""
    dx, dy = ax, hip_y - ay
    dist = max(abs(l1 - l2) + 1e-4, min(math.hypot(dx, dy), (l1 + l2) * 0.9995))
    to_target = math.atan2(dx, dy)
    alpha = math.acos(max(-1.0, min(1.0, (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist))))
    flex = math.pi - math.acos(max(-1.0, min(1.0, (l1 * l1 + l2 * l2 - dist * dist) / (2 * l1 * l2))))
    return math.degrees(to_target + alpha), -math.degrees(flex)


def gait_pose(g, d, p):
    """pose dict + hips vertical offset at cycle phase p (0..1)"""
    s = d["leg_len"] / 0.74
    leg = d["leg_len"]
    l1, l2 = leg * 0.5, leg * 0.5 - 0.1
    ankle_h = 0.1
    toe = 0.03 + d["leg_w"] * 0.65          # sole extents from the ankle (see the foot box)
    heel = d["leg_w"] * 0.65 - 0.03
    stance = g["stance"]
    front, back = g["front"] * s, g["back"] * s
    mean_drop, bob = g["hip_drop"]
    if g["stance"] >= 0.5:
        # walk: hips lowest at heel strike, highest in single support
        drop = mean_drop + bob * math.cos(4 * math.pi * (p - 0.03))
    else:
        # run: lowest at mid-stance, highest in the air
        drop = mean_drop + bob * math.cos(4 * math.pi * (p - stance / 2))
    hip_y = leg - drop * s

    def ankle_on_ground(q):
        """ankle (x, y) while planted at stance fraction q, rolling over heel or toe"""
        th = math.radians(table_at(g["pitch"], q * stance))
        xf = front - (front + back) * q          # ankle x when the foot is flat
        if th >= 0:
            pivot = xf - heel
            hx, hy = -heel * math.cos(th) + ankle_h * math.sin(th), -heel * math.sin(th) - ankle_h * math.cos(th)
        else:
            pivot = xf + toe
            hx, hy = toe * math.cos(th) + ankle_h * math.sin(th), toe * math.sin(th) - ankle_h * math.cos(th)
        return pivot - hx, -hy

    def leg_pose(phase):
        phase %= 1.0
        if phase < stance:
            ax, ay = ankle_on_ground(phase / stance)
        else:
            q = (phase - stance) / (1 - stance)
            x0, y0 = ankle_on_ground(1.0)
            x1, y1 = ankle_on_ground(0.0)
            # leave and land moving back at ground speed (no slap at touch-down)
            m = -(front + back) / stance * (1 - stance)
            q2, q3 = q * q, q * q * q
            ax = (2 * q3 - 3 * q2 + 1) * x0 + (q3 - 2 * q2 + q) * m + (-2 * q3 + 3 * q2) * x1 + (q3 - q2) * m
            k = smoothstep(q)
            ay = y0 + (y1 - y0) * k + g["lift"] * s * math.sin(math.pi * q)
        thigh, knee = leg_ik(ax, ay, hip_y, l1, l2)
        foot = table_at(g["pitch"], phase) - thigh - knee
        return thigh, knee, foot

    pose = {}
    swing = {}
    for side, offset in (("L", 0.0), ("R", 0.5)):
        thigh, knee, foot = leg_pose(p + offset)
        pose[f"upper_leg.{side}"] = limb(thigh)
        pose[f"lower_leg.{side}"] = limb(knee)
        pose[f"foot.{side}"] = limb(foot)
        swing[side] = math.cos(2 * math.pi * (p + offset))   # +1 when that leg is forward
    # arms swing against the leg on their own side
    ef, ea = g["elbow"]
    for side, sgn in (("L", 1), ("R", -1)):
        a = -g["arm"] * swing[side]
        pose[f"upper_arm.{side}"] = limb(a, sgn * g["arm_side"])
        pose[f"lower_arm.{side}"] = limb(ef + ea * max(0.0, a / g["arm"]))
    # shoulders turn against the hips (twist about the spine), slight lean
    pose["spine"] = (g["lean"], g["twist"] * swing["L"], 0)
    pose["head"] = (g["head"], -g["twist"] * 0.6 * swing["L"], 0)
    return pose, -drop * s


def make_animations(rig, d, extra=False):
    B = ALL_BONES
    # ---- idle (loop) ----
    c = Clip(rig, "idle", 60, B)
    for f, s in ((0, 0), (30, 1), (60, 0)):
        c.key(f, {"chest": (FWD * -2 * s, 0, 0), "head": (2 * s, 0, 0),
                  "upper_arm.L": limb(-2, 4 + 2 * s), "upper_arm.R": limb(-2, -4 - 2 * s),
                  "lower_arm.L": limb(4), "lower_arm.R": limb(4)})
    c.done()

    # ---- walk / run (loops): leg IK over a planted-foot gait, see gait_keys() ----
    for name, g in GAITS.items():
        c = Clip(rig, name, g["frames"], B)
        for f in frange(g["frames"], g["key_every"]):
            pose, hips_y = gait_pose(g, d, f / g["frames"])
            c.key(f, pose, loc={"hips": (0, hips_y, 0)})
        c.done()

    # ---- jump (once) ----
    c = Clip(rig, "jump", 12, B)
    c.key(0, {"upper_leg.L": limb(30), "upper_leg.R": limb(30), "lower_leg.L": limb(-55), "lower_leg.R": limb(-55),
              "spine": (15, 0, 0), "upper_arm.L": limb(-20, 10), "upper_arm.R": limb(-20, -10)}, loc={"hips": (0, 0, -0.12)})
    c.key(5, {"upper_leg.L": limb(-5), "upper_leg.R": limb(10), "lower_leg.L": limb(-10), "lower_leg.R": limb(-20),
              "upper_arm.L": limb(150, 20), "upper_arm.R": limb(150, -20)}, loc={"hips": (0, 0, 0)})
    c.key(12, {"upper_leg.L": limb(20), "upper_leg.R": limb(5), "lower_leg.L": limb(-30), "lower_leg.R": limb(-15),
               "upper_arm.L": limb(100, 30), "upper_arm.R": limb(100, -30)}, loc={"hips": (0, 0, 0)})
    c.done()

    # ---- fall (loop) ----
    c = Clip(rig, "fall", 20, B)
    for f, s in ((0, 0), (10, 1), (20, 0)):
        c.key(f, {"upper_leg.L": limb(15 + 10 * s), "upper_leg.R": limb(-5 - 10 * s),
                  "lower_leg.L": limb(-30), "lower_leg.R": limb(-20),
                  "upper_arm.L": limb(90 + 20 * s, 45), "upper_arm.R": limb(110 - 20 * s, -45),
                  "lower_arm.L": limb(20), "lower_arm.R": limb(20)})
    c.done()

    # ---- cheer (loop) ----
    c = Clip(rig, "cheer", 30, B)
    for f, s in ((0, 0), (8, 1), (15, 0), (23, 1), (30, 0)):
        c.key(f, {"upper_arm.L": limb(160, 20 + 15 * s), "upper_arm.R": limb(160, -20 - 15 * s),
                  "lower_arm.L": limb(20 * s), "lower_arm.R": limb(20 * s), "head": (-15, 0, 0)},
              loc={"hips": (0, 0, 0.08 * s)})
    c.done()

    # ---- hit (once) ----
    # upper body only: a unit that gets hit keeps walking
    c = Clip(rig, "hit", 10, UPPER_BONES)
    c.key(0, {})
    c.key(3, {"spine": (-18, 0, 6), "head": (-20, 0, 0), "upper_arm.L": limb(-25, 20), "upper_arm.R": limb(-25, -20)})
    c.key(10, {})
    c.done()

    # ---- die (once, holds last frame) ----
    c = Clip(rig, "die", 30, B)
    c.key(0, {})
    c.key(8, {"root": (-10, 0, 0), "spine": (-15, 0, 0), "head": (-20, 0, 0),
              "upper_arm.L": limb(40, 30), "upper_arm.R": limb(40, -30), "upper_leg.L": limb(10), "lower_leg.L": limb(-30)})
    c.key(22, {"root": (-88, 0, 0), "spine": (-5, 0, 0), "head": (-10, 0, 0),
               "upper_arm.L": limb(150, 40), "upper_arm.R": limb(150, -40), "upper_leg.L": limb(20), "lower_leg.L": limb(-20)})
    c.key(30, {"root": (-90, 0, 0), "head": (-10, 0, 0),
               "upper_arm.L": limb(160, 45), "upper_arm.R": limb(160, -45), "upper_leg.L": limb(15), "lower_leg.L": limb(-10)})
    c.done()

    # ---- upper-body actions: chest, head and arms only ----
    U = UPPER_BONES
    c = Clip(rig, "mine", 18, U)
    c.key(0, {"upper_arm.R": limb(150, -10), "lower_arm.R": limb(30), "chest": (-6, 0, -10), "upper_arm.L": limb(20, 10), "lower_arm.L": limb(40)})
    c.key(8, {"upper_arm.R": limb(35, -8), "lower_arm.R": limb(10), "chest": (14, 0, 8), "upper_arm.L": limb(30, 8), "lower_arm.L": limb(50)})
    c.key(18, {"upper_arm.R": limb(150, -10), "lower_arm.R": limb(30), "chest": (-6, 0, -10), "upper_arm.L": limb(20, 10), "lower_arm.L": limb(40)})
    c.done()

    c = Clip(rig, "place", 10, U)
    c.key(0, {"upper_arm.R": limb(20, -5), "lower_arm.R": limb(20)})
    c.key(4, {"upper_arm.R": limb(80, -5), "lower_arm.R": limb(5), "chest": (8, 0, 6)})
    c.key(10, {"upper_arm.R": limb(20, -5), "lower_arm.R": limb(20)})
    c.done()

    c = Clip(rig, "attack", 14, U)
    c.key(0, {"upper_arm.R": limb(60, -10), "lower_arm.R": limb(60)})
    c.key(4, {"upper_arm.R": limb(165, -25), "lower_arm.R": limb(40), "chest": (-8, 0, -20)})
    c.key(8, {"upper_arm.R": limb(40, 10), "lower_arm.R": limb(5), "chest": (15, 0, 25)})
    c.key(14, {"upper_arm.R": limb(60, -10), "lower_arm.R": limb(60)})
    c.done()

    c = Clip(rig, "shoot", 12, U)
    aim = {"upper_arm.R": limb(85, 5), "lower_arm.R": limb(10), "upper_arm.L": limb(88, -15), "lower_arm.L": limb(5), "chest": (0, 0, -8)}
    kick = {"upper_arm.R": limb(100, 5), "lower_arm.R": limb(25), "upper_arm.L": limb(100, -15), "lower_arm.L": limb(15), "chest": (-6, 0, -8), "head": (-6, 0, 0)}
    c.key(0, aim)
    c.key(2, kick)
    c.key(12, aim)
    c.done()

    # ---- the builder's extra clips: one swing per sword tier, one full bow draw ----
    # Only the models that carry them get them (they fall back to attack / shoot
    # elsewhere, see FALLBACKS), so the other seven files don't grow.
    if extra:
        # stone: high wind-up, the whole body drops through it, a beat at the bottom
        c = Clip(rig, "attack_heavy", 16, U)
        c.key(0, {"upper_arm.R": limb(55, -12), "lower_arm.R": limb(65), "upper_arm.L": limb(25, 15), "lower_arm.L": limb(45)})
        c.key(5, {"upper_arm.R": limb(185, -30), "lower_arm.R": limb(55), "upper_arm.L": limb(120, 30), "lower_arm.L": limb(70),
                  "chest": (-16, 0, -26), "head": (-10, 0, -8)})
        c.key(9, {"upper_arm.R": limb(25, 6), "lower_arm.R": limb(0), "upper_arm.L": limb(30, 18), "lower_arm.L": limb(30),
                  "chest": (26, 0, 18), "head": (14, 0, 6)})
        c.key(11, {"upper_arm.R": limb(22, 6), "lower_arm.R": limb(0), "upper_arm.L": limb(28, 18), "lower_arm.L": limb(28),
                   "chest": (27, 0, 17), "head": (15, 0, 6)})          # the beat: it lands and stays
        c.key(16, {"upper_arm.R": limb(55, -12), "lower_arm.R": limb(65), "upper_arm.L": limb(25, 15), "lower_arm.L": limb(45)})
        c.done()

        # iron: a wide flourish that sweeps right across the body and back
        c = Clip(rig, "attack_flourish", 13, U)
        c.key(0, {"upper_arm.R": limb(50, -14), "lower_arm.R": limb(60), "upper_arm.L": limb(20, 12), "lower_arm.L": limb(40)})
        c.key(3, {"upper_arm.R": limb(120, -55), "lower_arm.R": limb(25), "chest": (-6, 0, -34), "head": (-4, 0, -14)})
        c.key(7, {"upper_arm.R": limb(95, 60), "lower_arm.R": limb(10), "upper_arm.L": limb(40, 25), "lower_arm.L": limb(20),
                  "chest": (6, 0, 38), "head": (2, 0, 16)})
        c.key(13, {"upper_arm.R": limb(50, -14), "lower_arm.R": limb(60), "upper_arm.L": limb(20, 12), "lower_arm.L": limb(40)})
        c.done()

        # a full pull to the ear and a release, longer than the archers' `shoot`
        c = Clip(rig, "shoot_draw", 20, U)
        nock = {"upper_arm.R": limb(80, 0), "lower_arm.R": limb(35), "upper_arm.L": limb(86, -16), "lower_arm.L": limb(8), "chest": (0, 0, -6)}
        full = {"upper_arm.R": limb(70, -22), "lower_arm.R": limb(120), "upper_arm.L": limb(90, -14), "lower_arm.L": limb(0),
                "chest": (0, 0, -18), "head": (0, 0, -6)}
        loose = {"upper_arm.R": limb(78, -14), "lower_arm.R": limb(70), "upper_arm.L": limb(96, -14), "lower_arm.L": limb(4),
                 "chest": (-4, 0, -12), "head": (-4, 0, -2)}
        c.key(0, nock)
        c.key(9, full)
        c.key(12, full)                                                # held at full draw
        c.key(14, loose)
        c.key(20, nock)
        c.done()

    # ---- arm poses: arms only, looped, layered over locomotion ----
    A = ARM_BONES
    poses = {
        "hold_item": {"upper_arm.R": limb(25, -5), "lower_arm.R": limb(55)},
        "hold_sword": {"upper_arm.R": limb(30, -10), "lower_arm.R": limb(65), "hand.R": limb(10)},
        "hold_bow": {"upper_arm.R": limb(75, 10), "lower_arm.R": limb(10), "upper_arm.L": limb(70, -35), "lower_arm.L": limb(90)},
        "hold_gun": {"upper_arm.R": limb(70, 5), "lower_arm.R": limb(25), "upper_arm.L": limb(78, -30), "lower_arm.L": limb(45)},
    }
    for pname, pose in poses.items():
        c = Clip(rig, pname, 2, A)
        c.key(0, pose)
        c.key(2, pose)
        c.done()


def check_axes(rig):
    """Fail loudly if the FWD / SIDE / spine conventions don't hold for this rig."""
    pbs = rig.pose.bones

    def tail_after(bname, rot):
        pb = pbs[bname]
        pb.rotation_mode = "XYZ"
        pb.rotation_euler = rot
        bpy.context.view_layer.update()
        t = rig.matrix_world @ pb.tail
        pb.rotation_euler = (0, 0, 0)
        bpy.context.view_layer.update()
        return t

    rest_l = rig.matrix_world @ pbs["upper_arm.L"].tail
    rest_r = rig.matrix_world @ pbs["upper_arm.R"].tail
    fwd = tail_after("upper_arm.R", (deg(FWD * 60), 0, 0))
    side_l = tail_after("upper_arm.L", (0, 0, deg(SIDE * 60)))
    side_r = tail_after("upper_arm.R", (0, 0, deg(SIDE * -60)))
    spine = tail_after("spine", (deg(30), 0, 0))
    problems = []
    if not fwd.y < -0.05:
        problems.append("FWD")
    if not side_l.x > rest_l.x + 0.05:
        problems.append("SIDE (left)")
    if not side_r.x < rest_r.x - 0.05:
        problems.append("SIDE (right)")
    if not spine.y < -0.02:
        problems.append("spine forward")
    if problems:
        raise RuntimeError("Axis convention check failed: " + ", ".join(problems))


def export(name, rig):
    path = os.path.join(OUT_DIR, name + ".glb")
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        export_yup=True,
        export_apply=False,
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_anim_single_armature=True,
        export_reset_pose_bones=False,
        export_force_sampling=False,
        export_optimize_animation_size=True,
        export_optimize_animation_keep_anim_armature=False,
        export_def_bones=False,
        export_leaf_bone=False,
        export_skins=True,
        export_influence_nb=1,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_cameras=False,
        export_lights=False,
    )
    return path


# ---------------------------------------------------------------------------
#  items (no rig): grip at origin, long axis along +Z (Blender) = +Y (glTF)
# ---------------------------------------------------------------------------

ITEM_COLORS = {
    "wood": "#8a6236", "wood_dark": "#5a3d22", "steel": "#c3c9cf", "steel_dark": "#6f7780",
    "string": "#e8e2d0", "gold": "#e0b030", "black": "#222226", "stone": "#8a8a8f", "grass": "#5fa83a", "dirt": "#7a5534",
    # weapon tiers (appended: cells are allocated in this order, so the ones above keep their UVs)
    "leather": "#6b4a2a", "stone_dark": "#66666c", "gem": "#3fb6dd", "horn": "#cfc3a8", "wood_light": "#bd9354",
}


def build_items():
    reset_scene()
    painter = Painter(99)
    cell = {k: painter.cell(k, solid(v, 0.05)) for k, v in ITEM_COLORS.items()}
    img = bpy.data.images.new("items_tex", TEX, TEX, alpha=True)
    img.pixels[:] = painter.px
    img.file_format = "PNG"
    img.pack()
    mat = bpy.data.materials.new("items_mat")
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    bsdf = next(n for n in nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Roughness"].default_value = 1.0
    tex = nodes.new("ShaderNodeTexImage")
    tex.image = img
    tex.interpolation = "Closest"
    mat.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])

    def item(name, boxes):
        mesh = bpy.data.meshes.new(name)
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        bm = bmesh.new()
        uv = bm.loops.layers.uv.new("UVMap")
        for center, size, col in boxes:
            add_box(bm, uv, None, 0, center, size, {k: cell[col] for k in ("front", "back", "right", "left", "top", "bottom")})
        bm.to_mesh(mesh)
        bm.free()
        mesh.materials.append(mat)
        return obj

    # the troops' plain sword (the builder carries the tiers below)
    item("sword", [((0, 0, 0), (0.06, 0.06, 0.2), "wood_dark"), ((0, 0, 0.12), (0.22, 0.06, 0.04), "gold"),
                   ((0, 0, 0.45), (0.08, 0.03, 0.62), "steel")])
    # --- the builder's three swords: each one longer, heavier and brighter ----
    item("wood_sword", [((0, 0, 0), (0.06, 0.06, 0.20), "leather"),            # bound grip
                        ((0, 0, -0.11), (0.08, 0.08, 0.03), "wood_dark"),      # pommel
                        ((0, 0, 0.12), (0.20, 0.055, 0.04), "wood_dark"),      # plain crossguard
                        ((0, 0, 0.38), (0.085, 0.028, 0.48), "wood_light"),    # short blade
                        ((0, 0, 0.66), (0.045, 0.022, 0.09), "wood_light")])   # point
    item("stone_sword", [((0, 0, 0), (0.065, 0.065, 0.20), "wood_dark"),
                         ((0, 0, -0.115), (0.09, 0.09, 0.04), "stone"),
                         ((0, 0, 0.125), (0.26, 0.07, 0.05), "stone"),         # notched guard
                         ((0.145, 0, 0.125), (0.05, 0.055, 0.035), "stone_dark"),
                         ((-0.145, 0, 0.125), (0.05, 0.055, 0.035), "stone_dark"),
                         ((0, 0, 0.46), (0.12, 0.045, 0.62), "stone"),         # thick blade
                         ((0.055, 0, 0.60), (0.03, 0.048, 0.10), "stone_dark"),  # chips out of the edge
                         ((-0.055, 0, 0.40), (0.03, 0.048, 0.08), "stone_dark"),
                         ((0, 0, 0.82), (0.06, 0.04, 0.10), "stone")])
    item("iron_sword", [((0, 0, 0), (0.055, 0.055, 0.22), "leather"),
                        ((0, 0, -0.125), (0.075, 0.075, 0.05), "steel_dark"),
                        ((0, 0, -0.155), (0.05, 0.05, 0.04), "gem"),           # pommel stone
                        ((0, 0, 0.135), (0.30, 0.06, 0.045), "steel"),         # steel crossguard
                        ((0.16, 0, 0.135), (0.04, 0.05, 0.065), "steel_dark"),
                        ((-0.16, 0, 0.135), (0.04, 0.05, 0.065), "steel_dark"),
                        ((0, 0, 0.58), (0.09, 0.032, 0.86), "steel"),          # long blade
                        ((0, 0, 0.58), (0.028, 0.038, 0.80), "steel_dark"),    # fuller down the middle
                        ((0, 0, 1.06), (0.045, 0.026, 0.10), "steel")])
    item("pickaxe", [((0, 0, 0.2), (0.05, 0.05, 0.6), "wood"), ((0, 0, 0.5), (0.5, 0.06, 0.07), "steel_dark"),
                     ((0.26, 0, 0.47), (0.06, 0.06, 0.08), "steel"), ((-0.26, 0, 0.47), (0.06, 0.06, 0.08), "steel")])
    # --- three bows. The string is its own node so a draw can pull it back;
    #     `<bow>_string` is attached beside the bow wherever one is held.
    item("bow", [((0, 0, 0), (0.05, 0.05, 0.16), "wood_dark"), ((0, 0.05, 0.28), (0.04, 0.04, 0.42), "wood"),
                 ((0, 0.05, -0.28), (0.04, 0.04, 0.42), "wood")])
    item("bow_string", [((0, -0.06, 0), (0.01, 0.01, 0.95), "string")])
    item("recurve_bow", [((0, 0, 0), (0.055, 0.06, 0.18), "leather"),
                         ((0, 0.05, 0.30), (0.045, 0.045, 0.40), "wood"),
                         ((0, 0.05, -0.30), (0.045, 0.045, 0.40), "wood"),
                         ((0, 0.01, 0.55), (0.04, 0.05, 0.16), "horn"),        # recurved tips, bent back
                         ((0, 0.01, -0.55), (0.04, 0.05, 0.16), "horn"),
                         ((0, 0.055, 0.12), (0.06, 0.03, 0.05), "steel_dark"),  # riser bands
                         ((0, 0.055, -0.12), (0.06, 0.03, 0.05), "steel_dark")])
    item("recurve_bow_string", [((0, -0.055, 0), (0.012, 0.012, 1.06), "string")])
    item("war_bow", [((0, 0, 0), (0.06, 0.065, 0.20), "leather"),
                     ((0, 0.06, 0.34), (0.05, 0.05, 0.46), "wood_dark"),
                     ((0, 0.06, -0.34), (0.05, 0.05, 0.46), "wood_dark"),
                     ((0, 0.02, 0.62), (0.045, 0.06, 0.18), "gold"),           # gilded recurved tips
                     ((0, 0.02, -0.62), (0.045, 0.06, 0.18), "gold"),
                     ((0, 0.065, 0.14), (0.07, 0.035, 0.06), "gold"),
                     ((0, 0.065, -0.14), (0.07, 0.035, 0.06), "gold"),
                     ((0, 0.065, 0), (0.075, 0.035, 0.09), "gem")])            # a stone in the riser
    item("war_bow_string", [((0, -0.06, 0), (0.014, 0.014, 1.22), "string")])
    item("gun", [((0, 0, 0), (0.06, 0.08, 0.16), "wood_dark"), ((0, -0.2, 0.1), (0.07, 0.5, 0.08), "black"),
                 ((0, 0.12, 0.08), (0.07, 0.22, 0.12), "wood")])
    item("block", [((0, 0, 0.12), (0.22, 0.22, 0.22), "dirt"), ((0, 0, 0.225), (0.222, 0.222, 0.012), "grass")])
    item("arrow", [((0, 0, 0), (0.025, 0.025, 0.7), "wood"), ((0, 0, 0.37), (0.06, 0.02, 0.08), "steel"),
                   ((0, 0, -0.32), (0.08, 0.01, 0.1), "string")])
    item("cannonball", [((0, 0, 0), (0.22, 0.22, 0.22), "black")])
    item("bullet", [((0, 0, 0), (0.05, 0.05, 0.12), "gold")])

    path = os.path.join(OUT_DIR, "items.glb")
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", export_yup=True, export_animations=False,
                              export_materials="EXPORT", export_cameras=False, export_lights=False)
    return path


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    only = os.environ.get("ONLY")
    for name, spec in CHARACTERS.items():
        if only and name != only:
            continue
        rig = build_character(name, spec)
        print("exported", export(name, rig))
    if not only or only == "items":
        print("exported", build_items())


main()
