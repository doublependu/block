# Character GLB contract

Every character (player, defenders, attackers, and in future any avatar served by
the identity server) is one GLB file that follows these rules. Anything that
follows them can be played as, and animated by, the game.

Validate with:

```bash
npm run validate-glb                    # all of public/models
node tools/validate-glb.mjs my-hero.glb # a specific file
```

## Scale and orientation

- 1 unit = 1 block = 1 m. Height 1.6–2.4.
- Origin at the feet, centred.
- Facing **+Z in glTF** (in Blender: facing −Y, i.e. towards the viewer in front
  view; the Blender glTF exporter converts it).

## Skeleton

Bone (joint node) names, all required:

```
root
└─ hips
   ├─ spine ─ chest ─┬─ neck ─ head
   │                 ├─ upper_arm.L ─ lower_arm.L ─ hand.L
   │                 └─ upper_arm.R ─ lower_arm.R ─ hand.R ─ hand.R_socket
   ├─ upper_leg.L ─ lower_leg.L ─ foot.L
   └─ upper_leg.R ─ lower_leg.R ─ foot.R
```

- `hand.R_socket` (non-deforming) is where held items attach. Optional, but
  without it no item is shown.
- Proportions may differ (the brute is wider and taller) because clips only key
  **rotations**, except `hips` translation (bob) and `root` rotation (death fall).

## Animation clips

Clip (glTF animation) names, snake_case. Other spellings are accepted and
normalised: `Armature|Walk`, `mine block`, `Death`, `Hold Bow`… (see
`src/characters/contract.js`).

| Clip | Loop | Bones keyed | Used for |
|---|---|---|---|
| `idle` **(required)** | yes | all | standing |
| `walk`, `run` | yes | all | locomotion (speed-scaled) |
| `fall`, `cheer` | yes | all | airborne, victory |
| `jump`, `hit`, `die` | once | all | full-body one-shots (`die` holds its last frame) |
| `mine`, `place`, `attack`, `shoot` | once | spine, chest, neck, head, arms | upper-body actions over locomotion |
| `hold_item`, `hold_bow`, `hold_sword`, `hold_gun` | yes | arms only | arm pose while carrying an item |

**Layering:** the game plays one locomotion clip. While a hold pose is active the
locomotion clip is masked to exclude the arm bones; while an upper-body action
plays it is masked to exclude the upper body. So action and hold clips must only
key the bones listed above, or they will fight the locomotion clip.

**Fallbacks** when a clip is missing: `run → walk → idle`, `walk → idle`,
`fall → jump → idle`, `cheer → idle`, `mine → attack`, `place → attack → mine`,
`attack → mine`, `shoot → attack`, `die →` a procedural tip-over. Missing hold
poses just leave the arms to the locomotion clip.

Every character can be possessed by the player, so give every character at
least `idle`, `walk`, `run`, `attack`, `hit` and `die`.

## Budgets

- ≤ 150 KB per file, ≤ 3000 triangles, one texture ≤ 256×256.
- Materials: the game replaces them with a flat unlit-specular material using the
  base colour texture, sampled with nearest filtering (pixel-art look). PBR
  parameters are ignored.
- ≤ 4 bone influences per vertex (the placeholders use 1, rigid blocky parts).

## Held items

`public/models/items.glb` contains one mesh node per item (`sword`, `pickaxe`,
`bow`, `gun`, `block`, plus projectile meshes). Grip at the origin, long axis
along +Y (glTF). Per-item attach offsets are in `ITEM_POSE` in
`src/characters/library.js`.

## Regenerating the placeholders

All placeholder characters and items come from one reproducible Blender script:

```bash
~/Downloads/blender-5.2.1-linux-x64/blender -b --factory-startup \
    -P tools/blender/make_characters.py -- public/models
ONLY=attacker_brute blender -b --factory-startup -P tools/blender/make_characters.py -- public/models
```

It builds the shared rig, box body parts (each fully weighted to one bone), a
64×64 painted texture, all clips, and checks its own axis conventions before
exporting.
