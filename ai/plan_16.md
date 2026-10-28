# Plan 16: spikes seen from both sides, touch that doesn't attack, shirts and bigger name tags

Answers `ai/prompt_16.md`. Nothing below is implemented yet.

All three issues have one cause each, and I've reproduced all three. Two of them are bugs in the
vendored noa engine, not in the spikes. In brief:

| Prompt | What I found | What I'll do |
|---|---|---|
| Issue 1: ice spikes seen from one side only (and iron and steel) | It isn't the spikes. noa doesn't re-mesh the next chunk when a block that is neither solid nor opaque is placed on a chunk's last row. A spike there never gets its outer face. All four spikes and all three gates are hit (§0.1) | Re-mesh the next chunk on every edit on an edge row (§1) |
| Issue 2: spikes and gates hide each other | noa draws **no face at all** between two different see-through blocks: "for now we draw neither" (§0.2) | Draw both faces (§1) |
| Issue 3: on mobile, a touch anywhere attacks | Every finger is also a pointer, and noa's input library takes a pointer as the left mouse button, which is *fire*. A finger on the joystick attacks too. By day, a touch picks up the troop under the crosshair (§0.3) | Touches never press a key binding. The ⛏ button stays the way to attack (§2) |
| Feature 1: a shirt colour for each player | The shirt is painted into `player.glb`'s texture, and every body shares one material (§0.4) | A recoloured copy of the material for each colour. Each player wears a colour nobody else in the room is wearing, and keeps it (§3) |
| Feature 2: bigger, easier name tags | 12 px on a faint chip, and only within 40 m of the camera. The aerial camera sits 40 m back, so in the aerial view names almost never show (§0.5) | Bigger and bolder, ringed in the friend's shirt colour, and shown in the aerial view (§4) |

---

## 0. What I found before planning

I read the code, then looked in the browser with throwaway scripts in `.temp/p16/` (git ignores
it), on the build in `dist/` from iteration 15. No game code changed. HEAD is `1de00c8`.

### 0.1 Spikes seen from one side (issue 1)

- **A spike on its own shows on all four sides.** Every kind does, from every side
  (`.temp/p16/look/A-*.png`). So the textures, the face list in `blocks.js` (`SPIKE`) and noa's face
  order are all right.
- **The cause is chunk edges** (chunks are 24 blocks a side):
  - noa meshes the face between two chunks in the chunk on the + side (`terrainMesher.js`: "mesh
    plane between this chunk and previous neighbor").
  - `Chunk.set` re-meshes neighbouring chunks only when solidity or opacity changes
    (`vendor/noa/src/lib/chunk.js:182`).
  - Air to spikes changes neither: both aren't solid and aren't opaque. So a spike placed on a
    chunk's last row (x, y or z = 23 mod 24) never gets the face on that side. The face stays
    missing until the next chunk is re-meshed for some other reason, or the world is reloaded.
- **Reproduced:** each spike kind and a gate in a row on z = -1, a chunk's last row
  (`.temp/p16/edge/`). From -z, all of them show. From +z you see only their edges: the face toward
  you is missing.
- **Which blocks:** every block that's neither solid nor opaque. That's all four spikes and the three
  gates. One row in every 24 in each direction is an edge, so a long wall of spikes or gates
  almost always crosses one.
- **The same cause, two more ways it shows** (I found these by reading the code, and the check in
  §5.2 will confirm them):
  - mining a spike or gate on an edge row leaves its outer face behind, floating in the air
  - an upgrade in place on an edge row (spikes to iron spikes, an arrow tower to a crossbow tower)
    keeps the old picture on its outer face, because opacity doesn't change there either
- **Loading a world is fine:** a chunk that arrives re-meshes its neighbours (`world.js:921`). So it
  hits blocks placed during play: yours, a friend's, the dawn's rebuild.

### 0.2 Spikes and gates hide each other (issue 2)

- **`terrainMesher.js:442`:** when two different see-through blocks meet, the mesher draws neither
  face between them: "Someday we could try to draw both, but for now we draw neither."
- **Reproduced** (`.temp/p16/look/B-*.png`), with each spike kind in front of a two-high gate:
  - through the spikes, the gate's lower block is gone and its upper one floats
  - through the gate, the spikes behind it are gone; only their side faces show
- **It hits any pair of different see-through blocks:** a spike beside a gate, two kinds of spikes,
  a gate beside an iron gate, water against a gate, leaves against a gate.
- **Two of the same kind side by side** have no face between them, as with every block. A bed of ice
  spikes two deep shows one layer of spikes from each side. That stays as it is (choice 5).

### 0.3 A touch anywhere attacks (issue 3)

- **noa's input library** (`game-inputs`) listens for `pointerdown` on the game. A finger is a pointer
  too, with button 0, so it reads as Mouse1, which is bound to *fire*.
- `touch.js` calls `preventDefault` on its touch events. That stops the browser's fake mouse events,
  but not pointer events, which come first.
- **Measured on the phone profile** (`.temp/p16/touch-fire.mjs`):
  - a finger held on the look area: `fire` is down
  - a finger on the joystick: `fire` is down too, so walking also swings and mines
- **What that does** (`_firePressed`, `control.js:590`):
  - by day, with the crosshair on one of your own troops, a touch to look around picks the troop up
  - while you play a unit, every touch is an attack
- **Nothing on touch needs it.** The ⛏ button has its own path (`touchButton`), and so does a tap
  in the aerial view (`touchTap`).

### 0.4 Shirts (feature 1)

- **The builder's shirt is painted into `player.glb`'s texture:** `#3d8fd6` on the torso, the
  sleeves and the top of the forearms (`tools/blender/make_characters.py`). The texture is 64×64.
- **One material for the whole body, shared by every body:** the library instantiates the model
  without cloning its materials.
- **A separate shirt material is the wrong way:**
  - it means re-making the models in Blender
  - it adds a draw call for every body
  - it breaks the first-person arms: `armsLast` leaves alone any mesh with more than one material
- **A recoloured copy of the body's material, one per colour, swapped onto that body,** costs no
  draws and no asset change.
- **Troop colours to stay clear of,** so a friend never reads as a troop or an attacker:
  - defenders: steel grey, olive green `#6b8e3a`, dark red `#7a2e2e`
  - attackers: muted purple `#5b4a7a`, bone `#d9d4c5`, brown-red `#9c4a3a`, orange `#b8461e`,
    brown `#6e5028`
- **Where a colour can ride:**
  - a builder's presence, which is 12 fields today (`readHero`)
  - each player's own value in the room (`me`, `ownThings`), which already keeps where they stood,
    what they carried and their hotbar
- **The room has a join order:** `Member.order` is the same on every page.

### 0.5 Name tags (feature 2)

- **Today's tag** is 12 px text on a 55%-dark chip (`.name-tag` in `hud.css`).
- **It's shown only within 40 m of the camera** (`NAME_RANGE`, `replica.js`). The aerial camera
  starts 40 m from the point it looks at, and goes from 12 to 70 m. So from above, names almost
  never show. There are none in iteration 15's `recordings/room15/night-side-by-side.jpg`.

---

## 1. Spikes and gates (issues 1 and 2)

Both fixes are in `vendor/noa`, each marked `[block patch]` and added to the table in
`vendor/noa/UPSTREAM.md`.

1. **`chunk.js`, `Chunk.set`: an edit on a chunk's last row also re-meshes the next chunk** along that
   axis, whatever the block was or now is. That chunk draws the face between the two.
   - Today's rule stays as well: neighbours all round are re-meshed when solidity or opacity
     changes, for the shading.
2. **`terrainMesher.js`, `constructMeshMask`: two different see-through blocks face to face get both
   faces.**
   - The first pass draws the first block's face, as today's code does when one side is empty, and
     counts the pairs.
   - Only when there are any, a second pass over the same plane draws the other block's face.
     Planes without such a pair cost nothing extra.
   - The two faces lie in one plane and face opposite ways. Terrain materials cull back faces, and
     see-through blocks are cut out (alpha test), not blended. So from either side you see just the
     face toward you, with nothing to flicker or sort.

**What you'll see:**

- spikes and gates have all their faces wherever they're placed, and nothing is left behind when
  they're mined
- an upgrade shows its new picture on every side
- through spikes you see the gate behind them, and through a gate the spikes behind it
- the same goes for two kinds of spikes side by side, and for gates of two kinds

---

## 2. Touch (issue 3)

- **`control.js`:** `inputs.filterEvents = (ev) => !(ev && ev.pointerType === 'touch')`. A touch never
  presses a binding. A mouse and a pen click as they do today, and keys aren't touched.
  - `filterEvents` is `game-inputs`' own hook for this, so nothing in `node_modules` changes.
- **What you'll see on a phone:**
  - look around and walk without swinging, mining or picking up troops
  - ⛏ mines and attacks, and ▣ places, as before
  - taps in the aerial view work as before

---

## 3. Shirts (feature 1)

**The colours** (choice 2): eight, the first being today's blue.

| # | Colour | | # | Colour |
|---|---|---|---|---|
| 0 | blue `#3d8fd6` (today's) | | 4 | lime `#93d13d` |
| 1 | yellow `#e6c02a` | | 5 | violet `#8e63e6` |
| 2 | pink `#e35d9f` | | 6 | white `#eef1f4` |
| 3 | teal `#1aa89a` | | 7 | red `#d93a3a` |

The first four are the furthest from each other and from the troops. Lime is nearest the archers'
olive, violet the grunts' purple, and white the skeleton archers' bone. A ninth player shares a
colour.

**Who wears what** (choice 1):

- **Alone,** you're blue, as today, with no texture work at all.
- **In a room,** you wear the first colour nobody else present is wearing. The host, first in,
  stays blue.
- **You keep it.** It goes into your value in the room (`me.shirt`), so you're the same colour after
  a reload, and when you come back another day.
- **Two people in one colour** (two arrived together, or someone took yours while you were away):
  whoever joined first keeps it (`Member.order`), and the other takes the next free one. Every page
  works this out the same way, so nobody has to decide for anybody.
- **Your presence carries your colour** (a 13th field), so everybody draws you in it.
- **Your own arms** in first person are in your colour too, since they're your own body.

**How it's drawn:**

- **`src/characters/shirt.js` (new):**
  - `SHIRTS`, the palette
  - `recolorShirt(pixels, hex)`, pure: every pixel near the shirt's blue (within about 25 a channel)
    becomes the colour, keeping its own shade (pixel × colour ÷ blue). The eyes (`#1d2733`) and the
    trousers (`#3b3b58`) are far enough from it to stay as they are.
  - `pickShirt(kept, others)`, pure: the rules above
- **`CharacterLibrary.shirtMaterial(hex)`:**
  - reads the body texture's pixels once (`readPixels`), recolours them, and uploads them the way
    round they came
  - clones the body's material with that texture
  - one per colour, cached, so a room of three players makes two
- **`CharacterInstance.setShirt(hex)`,** like `setItem`:
  - it's put on when the model arrives
  - it's also what the hit flash goes back to (`_baseMat`)
  - until the texture is ready, a body wears blue
- **`units.js` / `replica.js`:** friends' builders take their colour from presence. Your own builder
  takes yours from `RoomSync` when the room's world loads.

---

## 4. Name tags (feature 2)

- **Bigger and bolder:**
  - text from 12 to 16 px bold (14 px on a phone)
  - more padding, a darker chip (about 75%) and a text shadow
  - a 2 px ring in the friend's shirt colour, so the name and the body match at a glance
- **Shown further** (choice 3):
  - on foot, within 80 m (it's 40 today)
  - in the aerial view, every friend on the screen. Rooms are small, so that's a few tags at most.
- **As today:** no tag over a friend who's down, and tags show through walls, so you can find a
  friend inside the town.

```
   ╭────────────╮
   │  Grace     │  ← 16 px bold, ringed in her teal
   ╰────────────╯
        ▇▇
       ▇██▇       her shirt: teal
        ▇▇
```

---

## 5. Testing

### 5.1 Unit tests (`npm run check`)

- `pickShirt`:
  - the host gets blue
  - newcomers get the free ones in order
  - a kept colour comes back
  - in a clash, the first to join keeps it
  - a ninth player shares
- `ownThings` keeps a valid `shirt` and drops a bad one. `readHero` reads field 13, and treats a
  missing one as blue.
- `recolorShirt` on a strip of pixels: the shirt's shades change, and skin, eyes, trousers and belt
  don't.

### 5.2 Spikes and gates in the game (`tools/autoplay/target-check.mjs`, plan 13's spikes check)

A new part, "seen from both sides". It reads the terrain meshes for a face at a given cell and
side, and the tile on it, and doesn't judge a picture. The cases:

- each spike kind and each gate, placed on a chunk's last row in x, in y and in z, and on a first
  row: all four faces
- the same, mined: no face left
- upgraded in place on an edge (spikes to iron spikes, an arrow tower to a crossbow tower): the new
  tile on the outer face
- each spike kind beside a gate, and two spike kinds side by side: both faces between them
- a lone spike in the middle of a chunk: four faces, as today

Then a sheet for you, of each case from both sides, in `recordings/faces16/`.

### 5.3 Touch (`tools/autoplay/touch-check.mjs`, new)

On the phone profiles, upright and sideways:

- a finger held on the look area, then on the joystick: `fire` never goes down, the builder doesn't
  swing, the block under the crosshair isn't mined, and the troop under it isn't picked up
- ⛏ still mines and swings; ▣ still places
- a tap in the aerial view still places and selects
- on the desktop profile, a mouse click still attacks

### 5.4 In a room (`tools/autoplay/room-check.mjs`)

- **Three players in three colours,** the same on every page. `replica.list()` gets each hero's
  `shirt`.
- **Colours kept** after a guest reloads, and after a guest leaves and comes back.
- **A clash settles:** a newcomer whose kept colour is taken gets the next free one.
- **Tags:**
  - on screen for every friend in the aerial view
  - within the screen on the phones
- **A sheet for you** in `recordings/room16/`: the three builders side by side with their tags, on
  foot and from above, on a desktop and a phone.

---

## 6. The spec

- **Load:**
  - nothing new on the first load beyond 1 to 2 KB of code. The menu is unchanged.
  - the shirts cost one 16 KB texture per colour in use, made on the device, in a room only
- **Frame rate:**
  - the mesher's second pass runs only on planes where two different see-through blocks meet
  - an edit on an edge row re-meshes one more chunk. That's about one edit in eight, mostly in the
    night as walls come down.
  - shirts add no draw calls
- **Measured as in iteration 15:**
  - `perf`, `perf:mobile` and the night benchmark, against the last commit's build, side by side
  - a night with three players in a room

---

## 7. Your choices

Each has a default. I'll go with the defaults for anything you don't answer.

1. **Picking a colour.** *Default: given automatically* (§3), the first one free, and kept. The other
   option is to also add a row of eight swatches to the pause panel's *Friends* row, in a room, so
   you can change yours. A taken colour would be greyed out.
2. **The palette.** *Default: the eight in §3,* with today's blue first. Swap any you don't like.
3. **Tags in the aerial view.** *Default: every friend on the screen.* The other option is a range,
   like on foot.
4. **Tag size.** *Default: 16 px* (14 on a phone). Say if you'd like them bigger still.
5. **Spikes behind spikes of the same kind.** *Default: leave as they are* (§0.2): one layer seen
   from each side, as with every block next to its own kind. The other option is to draw every layer
   in a deep bed of spikes. That's more faces, and it's not what the prompt asks.

---

## 8. Order of work

1. **Touch** (§2) and `touch-check`: it's the smallest change, and it gets in the way the most.
2. **The two noa patches** (§1), with the new part of `target-check` and the sheet.
3. **Shirts** (§3): `shirt.js` and its tests first, then the library, units, presence and the room's
   value.
4. **Name tags** (§4), checked on the phones with `hud-check`.
5. **The room check** (§5.4) and its sheet. Then `npm run check`, the build budgets, `perf`,
   `perf:mobile`, the night benchmark and a night with three players (§6).
6. **`vendor/noa/UPSTREAM.md`** and **`docs/protocol.md`** (presence field 13, `me.shirt`); write
   `next_16.md` and `itr_16.md`.
