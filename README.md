# DUX — Deus Ex Duckina

An AI-driven dungeon crawler where every dungeon is invented for you on the spot. There are no hand-authored levels behind the scenes — the rooms, the theme, the palette, the items, the puzzles, and the prose are all dreamt up by a Dungeon Master AI the moment you press **Enter the Dungeon**.

## Getting in

```
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

You'll be asked how many rooms you want for your first dungeon. Pick a number from 1 to 50 (5 is a good start) and step inside.

## What you'll see

A top-down tile map of the room you're standing in, and to the side, a narrative panel where the DM tells you what's happening. A "look bar" along the bottom describes whatever your eye is on. An inventory panel keeps track of what you're carrying.

Every dungeon has a **theme** and a **mood** that the AI picks for you — you might find yourself in a moss-choked crypt one run, a sunlit forest temple the next, a dripping cavern after that. The colors of the walls, the floors, the doors — all of it is generated to match.

## Controls

| Key | Action |
|---|---|
| **WASD / Arrow keys / Numpad** | Move (cardinal directions) |
| **7, 9, 1, 3** | Move diagonally (numpad layout) |
| **5** | Wait one turn |
| **E** | Interact — opens a radial menu of actions for whatever is in front of you |
| **ESC** | Cancel / dismiss the menu |
| **Enter** | Confirm a radial menu choice |

When the radial menu is open, **W/S** or **arrows** move the highlight, **Enter** confirms, **ESC** backs out.

## How to play

**Explore.** Walk through doorways and corridors into the next room. Each room has its own scene — entities, atmosphere, possibly something hidden.

**Interact.** Stand next to something interesting (a chest, a lever, a body, a strange rune) and press **E**. The DM offers you a few options: *look*, *take*, *use*, *open*, etc. Some will be greyed out if you're missing what you'd need.

**Solve the chain.** Most rooms have a small puzzle — a sequence of actions in a specific order. Take the key, use it on the door. Pull the lever, then push the brick. The DM will hint at it, and exits sometimes won't open until you've done the right thing.

**Pick things up.** Portable items go into your inventory and stay there across rooms and levels. They're often required to solve later puzzles.

**Quests.** Each dungeon comes with a main quest and a few side quests, woven across rooms by the AI. They're suggestions, not rails — you can ignore them, or chase them for the reward described in the narrative.

**Descend.** Find the stairs going down and the next dungeon will be larger (one more room than the last) and freshly imagined. Find the stairs going up and you return to the dungeon you just left, exactly as you remember it — that one's cached, no AI calls, no waiting.

## Things to know

- **The first room is instant; the rest stream in behind you.** The DM finishes the layout of your starting room before you take a step. The other rooms are designed in the background while you're playing — usually they're ready by the time you walk into them, but if you outpace the AI you'll see a brief "preparing the room…" pause.
- **Same action twice gets a different reaction.** Try the same thing in the same place again and the DM will gently point out you've been here before.
- **No two dungeons are the same.** Even with the same room count, you'll never get the same theme, palette, layout, items, or story twice.
- **State is in-memory only.** If you restart the server, your run is gone. There's no save file.

Have fun, adventurer.
