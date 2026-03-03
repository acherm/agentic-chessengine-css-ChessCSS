# ChessCSS: A Chess Engine in CSS

**Authors:** Mathieu Acher and [Claude Code](https://claude.ai/claude-code) (Anthropic)

A chess engine that pushes as much logic as possible into pure CSS. Move generation, legality checking, check detection, position evaluation, and move scoring are all expressed as CSS rules using `:has()` selectors, custom properties, and the new `if()` function. JavaScript handles only what CSS structurally cannot: game loop control, I/O, and reading computed styles back from the browser.

**[Play it in your browser](http://blog.mathieuacher.com/agentic-chessengine-css-ChessCSS/play.html)** (requires Chromium 137+ for CSS `if()` support)

Current status/thoughts:
 * after a systematic review of all 15 JS functions, JavaScript is confirmed necessary: CSS cannot write DOM attributes, export computed values, or sequence operations. The remaining ~370 lines of JS are the minimum viable runtime. Last-move highlighting was successfully moved to pure CSS (128 attribute selectors + sibling combinator), proving the boundary can still be pushed.
 * would love to have the opinions of CSS nerds... 
 * I'm expecting we will see relatively strong CSS engines in near future, thanks to humans and coding agents
 * I had a working version without `if()` and it was not that bad... `if()` breaks a bit the purity of the solution (it's still CSS, and the future, but still, it's easier)
 * how far can we push the level of the CSS engine? There are two directions: (1) fight with the constraints and encode lots of tricks/heuristics; (2) change the computational model and have a way to ambition advanced features (search)
 * tradeoff between size of the bundle (though gzip can compress immensely), time needed to play moves, and Elo/rating/strength 
 * it is funny to notice some clear limitations (eg inability to checkmate with large advantage and tendency to repeat moves due to lack of memory, thus leading to very frustrating draws) and have plenty of ideas to still deal with them... back in the 70s?
 * I need to tell the story of this development... clearly, it is related to https://blog.mathieuacher.com/FromScratchChessEnginesPolyglot/ and https://blog.mathieuacher.com/TeXCCChessEngine/ but the main difference is that I really had to drive the agent with technical expertise (chess and programming), to be proactive, and even to encourage the agents to not giving up with CSS ;-) Hence, from an experimental perspective, this engine is out of the scope of previous experiments that were more "from scratch, no/little guidance".
 * I'm now operating/navigating at a very interesting abstraction level: I can truly realize chess engine specific ideas (eg heuristics), and I am never editing the generators or CSS directly... It was not the case at all at the beginning 
 * it's so fun and magik 

## How It Works

The core idea: a chess position is represented as HTML elements with `data-*` attributes, and CSS rules "compute" everything by matching patterns in the DOM.

**Board representation.** 64 `<div class="sq">` elements carry `data-sq="e4"` and `data-piece="wN"`. A root `#game` element carries `data-turn`, castling rights, en passant square, and last-move tracking. All ~4,000 candidate moves are pre-allocated as `<div class="move" data-from="..." data-to="...">` elements.

**Move generation (CSS).** Rules like this detect pseudo-legal moves:

```css
/* White knight on b1 can jump to c3 if c3 isn't occupied by white */
#game[data-turn="w"]:has(.sq[data-sq="b1"][data-piece="wN"])
  :has(.sq[data-sq="c3"]:not([data-piece^="w"]))
  .move[data-from="b1"][data-to="c3"] { --pseudo-legal: 1; }
```

**Check detection (CSS).** Sliding-piece attacks use chained `:has()` selectors requiring intermediate squares to be empty:

```css
/* Black rook on a8 checks white king on a1 if a2-a7 are empty */
#board:has(.sq[data-sq="a1"][data-piece="wK"])
  :has(.sq[data-sq="a8"]:is([data-piece="bR"],[data-piece="bQ"]))
  :has(.sq[data-sq="a7"][data-piece="empty"])
  :has(.sq[data-sq="a6"][data-piece="empty"])
  /* ...intermediate squares... */
  { --wk-in-check: 1; }
```

**Legality (CSS).** Pin detection constrains pieces to move along the pin line. Castling rules verify no check on intermediate squares. En passant validates the captured pawn position. All via `:has()`.

**Move scoring (CSS).** The `--move-score` custom property combines multiple signals using the CSS `if()` function (Chromium 137+):

- **MVV-LVA capture ordering** (capture victim value vs. attacker value)
- **SEE-like threat penalty** (cheapest attacker on destination: king > pawn > knight > bishop > rook, halved if defended)
- **Centrality bonus** (destination square value)
- **Development bonus** (encourage piece activity in the opening)
- **Check bonus** (+40 for moves that give check, verified by piece type)
- **Discovered attack penalty** (detects sliding piece exposure)
- **Reversal penalty** (discourages shuffling the same piece back and forth)

**Best move selection (CSS).** Each move's `z-index` equals `--move-score + 100000`. The highest-scored legal move is the topmost element at position (0,0). A single `elementFromPoint(0, 0)` call returns the best move, O(1).

## Architecture

```
play.html              Interactive UI (human vs engine in browser)

css/
  move-generation.css    7,649 rules  -  Pseudo-legal move detection
  legality.css          16,161 rules  -  Pin/check/castling legality filtering
  check-detection.css    3,781 rules  -  King-in-check detection
  eval.css                 769 rules  -  Material + piece-square tables
  dynamic-move-scoring.css 26,656 rules - SEE, threats, checks, scoring
  move-scoring.css          55 rules  -  Static capture/bonus scoring
                        -----------
                        55,071 rules total (~17 MB of CSS)

scss/legality/               Sass source for legality.css
  _constants.scss              Board geometry, directions, castling defs
  _functions.scss              Chess helpers (sq-name, has-piece, build-ray...)
  _mixins.scss                 Rule emission mixins
  _king-safety-sliding.scss    King vs sliding piece attacks
  _king-safety-non-sliding.scss King vs knight/pawn attacks
  _king-safety-vacancy.scss    King destination occupancy
  _check-evasion.scss          Must block/capture when in check

scripts/
  generate-movegen-css.js       Generate move-generation.css
  generate-check-css.js         Generate check-detection.css
  generate-movescoring-css.js   Generate dynamic-move-scoring.css
  generate-css.js               Generate eval.css
  tournament.js                 Run multi-game tournaments

src/
  css-evaluator.js       Puppeteer bridge: read CSS computed styles
  board-renderer.js      Render position as HTML for CSS evaluation
  game-state.js          Position state (FEN, apply/undo moves)
  search.js              Move selection (greedy depth-1)
  driver.js              UCI engine entry point
  uci.js                 UCI protocol parser
  players/               Tournament players (CSS, random, Stockfish)

test/                    51 tests (move generation, check, eval, UCI)
```

## Chess Features

| Feature | Implementation |
|---------|---------------|
| All piece moves (P, N, B, R, Q, K) | CSS `:has()` rules |
| Castling (O-O, O-O-O) | CSS (rights tracking in JS) |
| En passant | CSS (target square tracking in JS) |
| Pawn promotion (Q/R/B/N) | CSS + JS UI dialog |
| Check detection | CSS |
| Pin detection | CSS |
| Checkmate / stalemate | CSS (no legal moves) + JS (game end) |
| Threefold repetition | JS (chess.js) |
| 50-move rule | JS (halfmove clock) |
| Insufficient material draw | JS (chess.js) |

## Performance Assessment

The engine plays **greedy depth-1**: it picks the single highest-scored move with no lookahead. The "depth-2" refers to the CSS scoring layer, which looks one ply ahead to detect threats, defenses, and discovered attacks statically.

**vs Random player:** Wins convincingly (100% win rate in testing). The CSS scoring produces sensible moves: develops pieces, captures material, avoids hanging pieces, and finds checkmates.

**vs Stockfish skill 0:** Loses consistently. Even at its weakest setting, Stockfish searches several plies deep, giving it a decisive advantage over greedy evaluation.

**Speed:** ~17 seconds per move at depth 2 (Puppeteer + Chrome rendering 55K CSS rules). The bottleneck is browser style computation, not JavaScript.

**Strength estimate:** Roughly 500-800 Elo based on tournament results. Stronger than random, weaker than any real engine. The CSS evaluation is surprisingly good at tactical awareness (threats, pins, discovered attacks) but lacks the ability to plan ahead.

## CSS vs JavaScript: What Each Does and Why

### How the CSS is generated: Node.js scripts vs Sass

The 55,071 CSS rules are not hand-written -- they are generated by two different meta-programming approaches:

**Node.js scripts** generate five of the six CSS files (`move-generation.css`, `check-detection.css`, `eval.css`, `dynamic-move-scoring.css`, `move-scoring.css`). Each script uses JavaScript loops to enumerate squares, directions, and piece types, emitting CSS rules as strings. For example, `generate-movescoring-css.js` iterates all 64 squares, all 8 ray directions, and all piece combinations to emit ~26,000 threat/defense/scoring rules.

**Sass (SCSS)** generates `legality.css` -- the most complex file (16,161 rules, ~9 MB). Legality involves deeply nested logic: for each king position, for each attack direction, for each sliding piece along that ray, for each intermediate square that must be empty, for each possible pinned piece... the combinatorics are brutal. Sass's `@each`, `@for`, `@while` loops, `@function`, `@mixin`, and module system (`@use`) handle this nesting more naturally than string concatenation in JavaScript.

The Sass code is organized as a library of chess primitives:
- `_constants.scss` -- board geometry: files, directions, knight offsets, castling definitions
- `_functions.scss` -- helpers like `sq-name($f, $r)`, `has-piece($sq, $piece)`, `has-attacker($sq, $p1, $p2)`, `build-ray($sf, $sr, $df, $dr)`, `empty-chain($squares)` -- composing `:has()` selector chains from chess concepts
- `_mixins.scss` -- `emit-rule($selector)` and `emit-rule-list($selectors)` for output
- `_king-safety-sliding.scss` -- king can't move into sliding piece attack lines
- `_king-safety-non-sliding.scss` -- king can't move into knight/pawn attacks
- `_king-safety-vacancy.scss` -- king can't move to occupied squares
- `_check-evasion.scss` -- when in check, non-king moves must block or capture the checker

The choice between Node.js and Sass is pragmatic: simple enumeration (64 squares x 6 piece types = emit rule) works fine as JS string concatenation; complex nested chess logic with intermediate variables and helper functions is cleaner in Sass. Both approaches produce pure CSS as output -- the generation strategy is invisible at runtime.

### What CSS handles (the hard part)

CSS expresses the **chess rules** and **evaluation** -- the parts that are usually the core of any chess engine:

- **Move generation**: 7,649 rules enumerate every possible piece move on every square, handling pawn double-pushes, knight L-shapes, sliding piece rays, and special moves. Each rule sets `--pseudo-legal: 1` on matching move candidates.

- **Legality filtering**: 16,161 rules detect pins (pieces constrained to move along the pin line between their king and an attacking slider), castling legality (no check on king's path, rights not lost), and en passant edge cases.

- **Check detection**: 3,781 rules determine if a king is in check by testing all attack directions (knight hops, pawn diagonals, sliding rays) with `:has()` chains.

- **Position evaluation**: 769 rules assign material values and piece-square bonuses, read via `getComputedStyle()`.

- **Move scoring**: 26,656 rules compute a composite score for each move using CSS `if()` and `style()` queries. This is the most sophisticated CSS layer: it performs SEE-like threat analysis (cheapest attacker lookup, defense detection), discovers sliding piece attacks, identifies check opportunities, penalizes reversals, and rewards development. The `z-index` property encodes the final score, making the best move the topmost DOM element.

### What JavaScript handles (and why)

JavaScript is required for things CSS **structurally cannot do**:

| JS Module | Purpose | Why CSS can't do it |
|-----------|---------|-------------------|
| `css-evaluator.js` | Reads CSS computed styles via Puppeteer | CSS has no way to "output" values; JavaScript must call `getComputedStyle()` or `elementFromPoint()` to read what CSS computed |
| `board-renderer.js` | Updates DOM `data-*` attributes to reflect position changes | CSS can match patterns but cannot mutate the DOM; applying a move requires changing `data-piece` attributes |
| `game-state.js` | Tracks position state, castling rights, en passant, halfmove clock | CSS has no persistent memory across "turns"; each position must be set up in the DOM for CSS to evaluate |
| `search.js` | Selects which move to play | CSS scores all moves in parallel (the static evaluation), but deciding to actually play one and advance the game requires control flow |
| `driver.js` / `uci.js` | UCI protocol (stdin/stdout communication) | CSS has no I/O capabilities |
| `tournament.js` | Multi-game orchestration | Sequential game control, file writing, statistics |
| `play.html` JS (~400 lines) | Interactive UI: click handling, overlay highlights, promotion dialog, move list display | CSS cannot handle click events or maintain UI state across interactions |

### A closer look at each JS function

**`css-evaluator.js`** -- the critical bridge. Launches headless Chrome, loads all CSS into a single page, then mutates `data-*` attributes to set positions. Three key operations:
- `getLegalMoves()`: iterates all ~4,000 candidate move elements, reads `--pseudo-legal` and `--illegal` CSS properties to filter legal moves
- `getBestMove()`: calls `elementFromPoint(0, 0)` -- returns the element with the highest `z-index`, which is the highest-scored legal move. A single DOM call replaces the entire "search"
- `evaluate()`: sums `--piece-value` across all 64 squares

**`board-renderer.js`** -- generates the HTML that CSS needs. The `_updateMoveGenPosition()` method is optimized to only change `data-piece` attributes that differ from the current DOM state, avoiding full page rebuilds.

**`game-state.js`** -- a mutable position tracker. CSS evaluates a static snapshot; this module handles the state transitions between snapshots: applying moves (updating piece positions, castling rights, en passant targets, halfmove clock) and undoing them.

**`play.html` JavaScript** (~370 lines, 15 functions) -- handles user interaction and the game loop. The code splits into three categories:

*CSS engine bridges* (read-only, cannot be eliminated):
- `getLegalMoves()` -- reads `--pseudo-legal` and `--illegal` computed styles from all ~4,000 candidate elements via `getComputedStyle()`
- `isInCheck()` -- reads `--wk-in-check` / `--bk-in-check` CSS custom properties
- `engineMove()` -- calls `elementFromPoint(0, 0)` to extract the CSS z-index argmax (the best-scored legal move)

*DOM state mutations* (CSS cannot write attributes):
- `resetBoard(fen)` -- parses FEN and sets all `data-*` attributes on 64 square elements
- `applyMove(move)` -- updates DOM for a move (piece positions, castling rights, en passant, turn flip, last-move tracking via `data-lf`/`data-lt` which drives CSS overlay highlight)

*UI and game orchestration* (sequencing, I/O, visual feedback):
- `selectSquare(sq)` / `clearSelection()` -- highlight selected piece and legal move indicators (dots/rings) on the UI overlay
- `playMove(move)` / `checkGameEnd()` -- game loop sequencing
- `toSan(move, legalMoves)` -- Standard Algebraic Notation with disambiguation
- `showPromotionDialog()` / `updateMoveList()` / `setStatus()` -- UI rendering

Note: last-move highlighting was originally a JS function (`updateBoard()`) but has been replaced with pure CSS -- 128 attribute selectors match `data-lf`/`data-lt` on `#game` and apply a background to the corresponding overlay cells via the `~` sibling combinator. The browser handles "clearing" automatically: when the attribute value changes, the old selector stops matching.

### Could JavaScript be eliminated entirely?

**In the browser (`play.html`):** No, and the reasons are structural, not accidental. A systematic review of all 15 JS functions reveals three hard barriers:

1. **CSS cannot write to the DOM.** Moving a piece from e2 to e4 requires changing `data-p` attributes on two elements, updating castling rights, flipping the turn, and setting the en passant target. CSS can *match* attribute patterns but has no mechanism to *mutate* them. `applyMove()` and `resetBoard()` are irreplaceable.

2. **CSS cannot export computed values.** The CSS engine computes `--pseudo-legal`, `--illegal`, and `--wk-in-check` via `:has()` selectors, but there is no CSS-native way to read these results back. `getComputedStyle()` and `elementFromPoint()` are the only extraction mechanisms. `getLegalMoves()`, `isInCheck()`, and `engineMove()` exist solely for this bridge.

3. **CSS cannot sequence operations.** A chess turn requires: read legal moves → validate user click → apply move → check for game end → trigger engine response. CSS has no control flow, no conditional branching over computed values, and no way to schedule deferred actions.

A pure-CSS click interaction (radio buttons + `:has(:checked)`) was attempted for piece selection but caused Chrome to hang — any DOM mutation inside `#game` triggers re-evaluation of thousands of `:has()` selectors. This is a browser implementation reality: the `:has()` invalidation scope is the entire containing element. The decoupled overlay architecture (`#ui-overlay` as a sibling of `#game`) solves this by keeping all visual feedback mutations outside the engine's CSS recalc zone.

`updateBoard()` was the first function to cross over: last-move highlighting is now pure CSS, using 128 attribute selectors that match `data-lf`/`data-lt` on `#game` and style the corresponding overlay cells via the `~` sibling combinator. The browser automatically handles "clearing" old highlights when attribute values change -- no JS loop needed. The remaining candidate for CSS is `setStatus()` (turn indicator could use `content:` with attribute selectors), but endgame messages depend on computed state that CSS can't branch on.

**For the UCI engine:** No. The engine needs Puppeteer (a Node.js library) to run Chrome and read computed styles. CSS cannot communicate over stdin/stdout or manage a game loop. The JavaScript here is an irreducible I/O layer.

**The philosophical split:** CSS answers "what are the legal moves and which is best?" -- the intellectual core of a chess engine. JavaScript answers "make it happen" -- clicking, rendering, communicating, and looping. The chess knowledge lives in CSS; the plumbing lives in JavaScript. The `#game` div is a pure CSS computation zone (JS writes state in, reads results out); `#ui-overlay` is a hybrid -- last-move highlighting is pure CSS (attribute selectors + sibling combinator), while selection/legal-move indicators remain JS-driven (they depend on `getComputedStyle` results that CSS can't re-export to itself).

## Getting Started

**Requirements:** Node.js 18+, Chromium 137+ (bundled with Puppeteer)

```bash
npm install

# Generate all CSS (only needed if modifying generators)
npm run generate-movegen-css
npm run generate-check-css
npm run generate-movescoring-css
npm run generate-legality-css

# Run tests
npm test

# Play in browser
npm run play        # opens http://localhost:8080/play.html

# Run as UCI engine
npm start

# Run tournament
npm run tournament -- --rounds 10 --opponent stockfish-skill0
```

## Architecture: Decoupled UI Overlay

The `#game` element is a "hot zone" — any DOM mutation inside it triggers re-evaluation of thousands of CSS `:has()` selectors. A pure-CSS approach to move highlighting (radio buttons + `:has(:checked)`) was attempted but caused Chrome to hang due to cascading invalidation.

The solution: a **`#ui-overlay`** layer, a sibling `<div>` positioned on top of `#board` but outside `#game`. It handles all visual feedback (selected square highlight, legal move dots, capture rings, last-move highlight) on its own 64 overlay cells. Since it's outside `#game`, these mutations trigger zero engine CSS recalc — piece selection and move indicators appear instantly.

The overlay uses two complementary approaches:
- **JS-driven classes** (`.selected`, `.dot`, `.ring`) for interactive feedback that depends on computed legal moves
- **Pure CSS attribute selectors** for last-move highlighting: 128 rules match `data-lf`/`data-lt` on `#game` and style the corresponding `.ov` cell via the `~` sibling combinator — no JS needed

```
#board-wrap (position: relative)
├── #game              ← CSS engine zone (data-* attributes, :has() selectors)
│   ├── #board         ← 64 .sq elements with piece data
│   └── #candidates    ← ~4,000 .move elements scored by CSS
└── #ui-overlay        ← visual feedback layer (pointer-events: none, z-index: 10)
    └── 64 .ov cells   ← JS classes: .selected, .dot, .ring
                          CSS-driven: last-move highlight via #game[data-lf/lt] ~ selectors
```

## TODO / Future Explorations

## License

MIT
