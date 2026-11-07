# Front Path

WeChat mini-program **mini-game** (小游戏) — single-player path puzzle.

Slide arrows off the board. Each arrow only moves in the direction it faces. Tap an arrow to slide it; if another arrow blocks the path, it snaps back. Clear every arrow to finish the level.

Inspired by popular WeChat “pull the arrow / plan the order” puzzles.

## Repo

- Display name: **Front Path**
- Type: WeChat mini-game (`compileType: game`)
- English UI: Level, Retry, Next, Clear!, Blocked

## Open in WeChat DevTools

1. Install [WeChat DevTools](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html).
2. **Import project** → select this folder (`front-path`).
3. AppID: use a test/tourist AppID (`touristappid` is already set in `project.config.json`), or your own.
4. Ensure compile type is **游戏** / **mini-game** (see `project.config.json` → `"compileType": "game"`).
5. Compile & preview on simulator or phone.

Entry file: `game.js`.

## Browser preview (no DevTools)

Same puzzle logic runs in a browser for quick testing:

```bash
# from this folder — any static server
npx --yes serve -p 4173
# then open http://localhost:4173/
```

Or open `index.html` via any local static file server (ES modules not required; plain scripts).

Progress is stored in `localStorage` in the browser, and in `wx` storage inside WeChat.

## Controls

- **Tap arrow** — slide it forward in its facing direction until it leaves the board
- **Blocked** — path hits another arrow → snap back (shake)
- **Retry** — reset current level
- **Next** — after Clear!, go to the next level (or jump to an already unlocked level)
- **Prev** — previous level

## Levels

**34** stages in `js/levels.js` (all verified solvable). Difficulty ramps with board size: early ~6×6 with few arrows; mid crossed paths on ~8×8–11×11; late large grids up to **16×12 / 14×16** with denser interlocking. Clear a level to unlock the next; progress key: `front_path_max_unlocked`.

Play in the browser via GitHub Pages: https://ningyixi.github.io/front-path/

**Controls tip:** you can tap several arrows in a row — they slide off at the same time.

## Layout

```
front-path/
  game.js                 # WeChat entry
  game.json
  project.config.json
  index.html              # browser preview
  js/
    levels.js             # level data
    game-core.js          # canvas loop + rules
  README.md
```

## License

MIT — do what you want.
