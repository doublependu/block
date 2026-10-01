# itr_10: iteration 10 in brief

A summary of iteration 10 (`prompt_10.md` → `plan_10.md`). The details are in `next_10.md`; the
section numbers below point there.

The castle video and the world export are both done. The video is one survival game stitched from
several recordings, and the castle isn't "very safe" late in the game. `npm run check` passes (294
tests) and every build budget passes. Nothing is committed.

## The sword and the other weapons (§2)

- The swords hit with the flat of the blade in every tier. Each sword is now rolled so the edge
  leads at the blow.
- The bows were turned the wrong way round, and the pickaxe's long point faced the player. Both
  are fixed.
- In third person, every held item now has its own pose.
- A pose test (32 tests) and `npm run check:poses` fail if a pose is turned wrong again.

## High ground (§3)

- Arrow towers, troops and raiders reach farther from high up, up to 1.5×, and hit up to 25%
  harder. Towers on the ground play as before.
- On the difficulty map, a town with raised towers holds about two more nights.

## A world export is a world (§4)

- Export world now writes only the world: name, description, seed, the blocks mined and placed,
  the troops, and your inventory as the starting kit.
- Survival or creative, and daytime attacks, are chosen when you start a world.
- The opening raid always plays. Only a town as weak as the starter town is scripted to lose it.

## The video: `recordings/castle10/castle.mp4` (§5)

- 29:47 at 1920×1080 with 55 chapters (5.5 GB). `castle-share.mp4` is a 2.1 GB copy for sharing.
- It covers 19 days: the opening raid, the quarry, every part of the castle going up, the
  finished castle from above, and night 17. Key moments play at 1×; building and nights run at
  9×, mining and walking at 35×.
- The castle has 23 archery towers, 7 of them on high places 11–16 blocks up.
- **Stitched from saves:** from night 15 on, nights are a coin flip for this castle, so the video
  is joined from five recordings. When a try lost its last life, I went back to the last good
  dawn save and replayed from there. Ten tries were thrown away.
- **Lives:** the kept game lost two lives, on nights 12 and 16. Both are shown and captioned in
  the video.
- **Smaller castle:** to finish, the tall tower was made slimmer and the square tower lower. The
  castle is 3,088 blocks, down from the plan's ~4,200.
- **Gaps:** 64 blocks of the design (2%) are gaps the bot couldn't reach from the aerial view.
  They're visible up close, but not from above.
- **Photo comparison:** `compare-final.jpg`. The castle reads as Neuschwanstein by its colours
  and parts, but only from above, and the tall tower doesn't stand out as it does in the photo.

## The export: `recordings/castle10/castle-on-the-rock.world.json` (§6)

- It holds name, description, seed, the blocks placed and dug out, the 2 troops, and your
  inventory as the starting kit. No game state: it loads as survival, day 1, 3 lives.
- The description was written in by hand, since the game has no field for it.
- The kit is generous: 6 ballista towers, 76 gold and 17 iron. It was left as you asked; edit
  `start.inventory` if you want a harder start.
- As the starting point, in a scratch copy of the game:
  - first playable frame in 0.77 s on desktop and 1.73 s on mobile; 60 fps in the raid and at
    night
  - 9.4 KB compressed, well under the 50 KB budget
  - the opening raid was held in 137 s without touching the Town Center (clip:
    `recordings/castle10/deploy-test/raid/game.mp4`)
  - in one of two tries a raider got stuck and the raid ran to the 5-minute night limit
- **Your branch needs:**
  1. Copy the file over `worlds/default.world.json`.
  2. In `tests/worldfile.test.js`, delete the two tests about the old default world.

## A decision for you: late nights (§5, §8)

- By night 15, extra defence doesn't help. Each night's wave grows with your defence, and the
  extra attackers come back as more HP and damage.
- In the lab, adding 12 archers or 8 ballistas made night 17 worse, and removing towers also lost.
- That works against "castle feels very safe" and against high-ground towers late in a game.
- The balance is unchanged. The options, and a quick way to measure each, are in §8.

## Also fixed along the way (§7)

- The castle bot now gives up on blocks it can't reach within minutes instead of about three game
  days.
- The video editor had bugs joining several recordings: parts introduced twice, a cut that ran
  long, and a final join that failed. All fixed.
- The load test ignored its port setting. Fixed.
- The default town's missing night-10 map runs were rerun: lost both, as in iteration 9.

## Not done (§3, §8)

- The plan's side-by-side clip of a high and a ground tower firing.

The source recordings take about 60 GB; their `game.webm` files can go once you're happy with the
cut.
