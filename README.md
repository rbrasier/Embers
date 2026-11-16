# Embers

A solo dungeon crawler for the browser, built phone-first. You play one hero and call the shots for four AI companions. "Embers" is a working title.

This is the **milestone 4 grey-box** from the design document: one room, one trash pack, one boss with three mechanics that each need a call. It exists to answer one question before any content is built: is shot-calling fun?

## Play

```
npm install
npm run dev      # then open the printed Network URL on your phone (same Wi-Fi)
```

Pushing to `main` builds, tests and publishes to GitHub Pages. Enable it once under **Settings → Pages → Source: GitHub Actions**.

On a phone, hold it sideways. "Add to Home Screen" gives a full-screen game without the browser bars.

| Input | Phone | Keyboard |
| --- | --- | --- |
| Move | Left thumb stick | WASD |
| Slash, Rend, Lunge, Flurry | Right thumb buttons (hold Slash to repeat) | 1 2 3 4 |
| Evade | Small button by the abilities | Space |
| Calls | Hold 📣 CALL, slide to a call, release | Q interrupt, E stack, R spread, F burst, C focus |
| Contextual call | Tap the big pulsing button | G |
| Markers | Tap an enemy portrait, then Kill or Control | Click |

Add `?seed=7` to the URL to replay the same run.

## The fight

Companions hold threat, heal and attack on their own. They do not interrupt, stack, spread or use cooldowns until you call it.

- **Searing Chant** needs an interrupt. It recasts faster than any single interrupt recharges, so you alternate your own Lunge with the Interrupt call.
- **Meteor** needs Stack, so the damage is shared.
- **Cinder Brand** needs Spread, and you have to move yourself clear as well.

The wipe screen lists what went wrong. Boss notes in the ☰ menu fill in as you see each mechanic.

## Code

```
src/sim/      Headless combat simulation. Fixed 30 Hz tick, seeded, no DOM.
  data.ts     Abilities, companions, enemies, boss mechanics, calls and barks, all as data.
  sim.ts      Rules, companion and enemy AI, calls, markers, checkpoints.
  autopilot.ts  A scripted player for tests and balance checks.
src/render/   three.js view. Reads sim state, never changes it.
src/ui/       Touch HUD, input and sound.
tests/        Headless fights: correct calls win, no calls wipe, same seed gives the same run.
```

`npm test` runs whole dungeon clears in under a second, so tuning numbers in `data.ts` can be checked without opening a browser.

## Not built yet

Milestones 5 to 10 in the design document: the pre-boss plan screen, learned mechanics, the other three classes, loot, the key ladder and the campaign.
