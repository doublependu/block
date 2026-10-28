# itr_11: iteration 11 in brief

A summary of iteration 11 (`prompt_11.md` → `plan_11.md`, option A). The details are in
`next_11.md`; the section numbers below point there.

The first-person sword now points ahead, toward the crosshair. `npm run check` passes (307 tests)
and every build budget passes. Nothing is committed.

## The sword (§2)

- At rest, every sword (all three tiers, and the troop's when you control one) points 41° from
  where you look, in toward the crosshair. Your screenshot's pose was at 84°, lying across the
  screen.
- The guard sits just over the fist, with the grip inside it. That's a small change from the
  plan's picture, where the pommel stuck out.
- Before and after, on desktop and phone: `recordings/showcase11/sword-before-after.jpg` and
  `sword-before-after-phone.jpg`.

## The slashes (§3)

- I fitted all three strokes again for the new pose.
  - wooden: from the upper right, through the crosshair, to the lower left
  - stone: a high chop straight down
  - iron: a wide sweep across the view, alternating with a backhand
- The edge leads within 0–7° in every stroke.
- The iron backhand now has its own keys instead of mirroring the forehand, so it sweeps the whole
  view.
- Every stroke: `recordings/showcase11/sheet-swords.jpg`.

## Fixed along the way (§4)

- Since iteration 8, the iron sword's combo never alternated. It played the backhand, and its
  second sound, every time.
- Now holding the button goes forehand, backhand, forehand. After a pause, it opens with the
  forehand again.

## So it can't come back (§5)

- New tests fail if a sword at rest points more than 55° from where you look, more than 30° off
  the line to the crosshair, or with its tip over the aim.
- They fail on the pose in your screenshot.

## For you (§7)

- Try it in the game. If the angle needs a nudge, it's `rot` in `ITEM_POSE`.
- The pickaxe still stands straight up out of the fist. Say if you want it to point ahead too.
- Iteration 10's open items are still open (`next_10.md` §8).
