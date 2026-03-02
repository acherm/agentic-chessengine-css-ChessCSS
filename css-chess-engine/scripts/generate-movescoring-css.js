#!/usr/bin/env node
'use strict';

/**
 * Generates dynamic-move-scoring.css — CSS rules that read board state via :has()
 * to compute MVV-LVA capture scores, positional bonuses, and depth-2 tactical awareness.
 *
 * Uses CSS if() with nested style() queries for SEE-aware threat penalties:
 * finds the cheapest attacker (pawn → knight → bishop → rook), computes
 * max(moving_piece_value - min_attacker_value, 0), halved if any defense exists.
 * Requires Chromium 137+ (Puppeteer ships Chrome 145).
 *
 * Sections:
 *   - Base rule with defaults + order formula (uses CSS if())
 *   - Promotion bonuses (4 rules)
 *   - Castling bonus (1 rule)
 *   - Destination square bonuses (centrality, ~58 rules)
 *   - Development bonuses (~18 rules)
 *   - Capture value rules (64 sq × 6 types = 384 rules)
 *   - Attacker value rules (64 sq × 6 types = 384 rules)
 *   - Pawn threat rules (~196 rules)
 *   - Knight threat rules (~672 rules)
 *   - Bishop/queen diagonal threat rules (~1,120 rules)
 *   - Rook/queen line threat rules (~1,792 rules)
 *   - Pawn defense rules (~196 rules)
 *   - Knight defense rules (~672 rules)
 *   - Bishop/queen diagonal defense rules (~1,120 rules)
 *   - Rook/queen line defense rules (~1,792 rules)
 *   - Discovered attack rules (~5,000 rules)
 */

const fs = require('fs');
const path = require('path');

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

const PIECES = [
  { type: 'P', value: 100 },
  { type: 'N', value: 320 },
  { type: 'B', value: 330 },
  { type: 'R', value: 500 },
  { type: 'Q', value: 900 },
  { type: 'K', value: 20000 },
];

const ROOK_DIRS = [[0, 1], [0, -1], [1, 0], [-1, 0]];
const BISHOP_DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

// Centrality bonuses per square, indexed [rankIndex][fileIndex]
// rankIndex 0 = rank 1, rankIndex 7 = rank 8
// 180-degree rotationally symmetric
const DEST_BONUS = [
  /* rank 1 */ [0, 1, 2, 4, 3, 2, 1, 0],
  /* rank 2 */ [1, 3, 6, 9, 8, 5, 3, 1],
  /* rank 3 */ [2, 7, 16, 23, 22, 15, 6, 2],
  /* rank 4 */ [4, 9, 22, 31, 30, 21, 8, 3],
  /* rank 5 */ [3, 8, 21, 30, 31, 22, 9, 4],
  /* rank 6 */ [2, 6, 15, 22, 23, 16, 7, 2],
  /* rank 7 */ [1, 3, 5, 8, 9, 6, 3, 1],
  /* rank 8 */ [0, 1, 2, 3, 4, 2, 1, 0],
];

/**
 * Return array of square names along a ray from (fi, ri) in direction (dfi, dri),
 * NOT including the starting square.
 * fi: 0-7 (file index), ri: 1-8 (rank), dfi/dri: direction deltas
 */
function slidingRay(fi, ri, dfi, dri) {
  const squares = [];
  let f = fi + dfi;
  let r = ri + dri;
  while (f >= 0 && f < 8 && r >= 1 && r <= 8) {
    squares.push(FILES[f] + r);
    f += dfi;
    r += dri;
  }
  return squares;
}

/**
 * Build SEE penalty CSS if() expression.
 * Checks threats cheapest-first (pawn → knight → bishop → rook).
 * First matching threat wins (= cheapest attacker).
 * For each threat, computes max(moving_piece_value - threat_piece_value, 0).
 */
function buildSEEPenalty() {
  const threats = [
    { varName: '--pawn-threat', pieceValue: 100 },
    { varName: '--knight-threat', pieceValue: 320 },
    { varName: '--bishop-threat', pieceValue: 330 },
    { varName: '--rook-threat', pieceValue: 500 },
  ];

  function innerBranches(minAttackerValue) {
    const branches = PIECES.map(p => {
      const penalty = Math.max(p.value - minAttackerValue, 0);
      return `style(--attacker-value: ${p.value}): ${penalty}`;
    });
    branches.push(`else: ${minAttackerValue}`);
    return 'if(' + branches.join('; ') + ')';
  }

  const outerBranches = threats.map(t =>
    `style(${t.varName}: 1): ${innerBranches(t.pieceValue)}`
  );
  outerBranches.push('else: 0');
  return 'if(' + outerBranches.join(';\n          ') + ')';
}

function generate() {
  const lines = [];

  lines.push('/* Auto-generated dynamic move scoring CSS */');
  lines.push('/* Uses :has() for MVV-LVA + positional scoring + depth-2 tactical awareness */');
  lines.push('/* z-index argmax: browser stacking order = implicit best-move selection */');
  lines.push('');

  // Register --move-score as typed integer property so calc() can reference it
  lines.push('@property --move-score {');
  lines.push('  syntax: \'<integer>\';');
  lines.push('  inherits: false;');
  lines.push('  initial-value: 0;');
  lines.push('}');
  lines.push('');

  // Position #candidates at viewport origin for elementFromPoint(0, 0)
  lines.push('#candidates {');
  lines.push('  position: fixed;');
  lines.push('  top: 0;');
  lines.push('  left: 0;');
  lines.push('  width: 1px;');
  lines.push('  height: 1px;');
  lines.push('  overflow: hidden;');
  lines.push('  z-index: 999999;');
  lines.push('}');
  lines.push('');

  // Base rule with defaults and SEE-aware score formula
  lines.push('.move {');
  lines.push('  --capture-value: 0;');
  lines.push('  --attacker-value: 0;');
  lines.push('  --promo-bonus: 0;');
  lines.push('  --dest-bonus: 0;');
  lines.push('  --develop-bonus: 0;');
  lines.push('  --castle-bonus: 0;');
  lines.push('  --pawn-threat: 0;');
  lines.push('  --knight-threat: 0;');
  lines.push('  --bishop-threat: 0;');
  lines.push('  --rook-threat: 0;');
  lines.push('  --pawn-defense: 0;');
  lines.push('  --knight-defense: 0;');
  lines.push('  --bishop-defense: 0;');
  lines.push('  --rook-defense: 0;');
  lines.push('  --disc-attack: 0;');
  lines.push('  --reversal-penalty: 0;');

  // SEE penalty: find cheapest attacker, compute material loss, halve if defended.
  // Defense factor: (2 - max(defenses)) / 2 = 1.0 if undefended, 0.5 if defended.
  const seePenalty = buildSEEPenalty();

  // Store computed score in --move-score for reuse by both order and z-index
  lines.push('  --move-score: calc(');
  lines.push('    max(var(--capture-value) * 2 - var(--attacker-value), 0)');
  lines.push('    + var(--promo-bonus)');
  lines.push('    + var(--dest-bonus)');
  lines.push('    + var(--develop-bonus)');
  lines.push('    + var(--castle-bonus)');
  lines.push('    - ' + seePenalty);
  lines.push('      * (2 - max(var(--pawn-defense), var(--knight-defense), var(--bishop-defense), var(--rook-defense))) / 2');
  lines.push('    - var(--disc-attack)');
  lines.push('    - var(--reversal-penalty)');
  lines.push('  );');

  // order: backward compat for getLegalMoves() which reads style.order
  lines.push('  order: var(--move-score);');

  // z-index argmax: highest score = topmost element for elementFromPoint
  // +100000 offset ensures all values are positive (min score ≈ -21000)
  lines.push('  position: absolute;');
  lines.push('  left: 0;');
  lines.push('  top: 0;');
  lines.push('  width: 1px;');
  lines.push('  height: 1px;');
  lines.push('  z-index: calc(var(--move-score) + 100000);');

  // visibility: only legal moves visible; elementFromPoint skips hidden elements
  lines.push('  visibility: if(');
  lines.push('    style(--pseudo-legal: 1): if(style(--illegal: 1): hidden; else: visible);');
  lines.push('    else: hidden');
  lines.push('  );');
  lines.push('}');
  lines.push('');

  // Promotion bonuses
  lines.push('/* ── Promotion bonuses ── */');
  lines.push('.move[data-promotion="q"] { --promo-bonus: 9000; }');
  lines.push('.move[data-promotion="r"] { --promo-bonus: 5000; }');
  lines.push('.move[data-promotion="b"] { --promo-bonus: 3300; }');
  lines.push('.move[data-promotion="n"] { --promo-bonus: 3200; }');
  lines.push('');

  // Castling bonus
  lines.push('/* ── Castling bonus ── */');
  lines.push('.move[data-castle] { --castle-bonus: 60; }');
  lines.push('');

  // Destination square bonuses
  lines.push('/* ── Destination square bonuses (centrality, unique per square) ── */');
  for (let fi = 0; fi < 8; fi++) {
    for (let ri = 0; ri < 8; ri++) {
      const bonus = DEST_BONUS[ri][fi];
      if (bonus > 0) {
        const sq = FILES[fi] + (ri + 1);
        lines.push(`.move[data-to="${sq}"] { --dest-bonus: ${bonus}; }`);
      }
    }
  }
  lines.push('');

  // Development bonuses
  lines.push('/* ── Development bonuses: encourage piece activity ── */');
  lines.push('');
  lines.push('/* Knights off starting squares */');
  lines.push('#game:has(.sq[data-sq="b1"][data-piece="wN"]) .move[data-from="b1"] { --develop-bonus: 35; }');
  lines.push('#game:has(.sq[data-sq="g1"][data-piece="wN"]) .move[data-from="g1"] { --develop-bonus: 35; }');
  lines.push('#game:has(.sq[data-sq="b8"][data-piece="bN"]) .move[data-from="b8"] { --develop-bonus: 35; }');
  lines.push('#game:has(.sq[data-sq="g8"][data-piece="bN"]) .move[data-from="g8"] { --develop-bonus: 35; }');
  lines.push('');
  lines.push('/* Bishops off starting squares */');
  lines.push('#game:has(.sq[data-sq="c1"][data-piece="wB"]) .move[data-from="c1"] { --develop-bonus: 35; }');
  lines.push('#game:has(.sq[data-sq="f1"][data-piece="wB"]) .move[data-from="f1"] { --develop-bonus: 35; }');
  lines.push('#game:has(.sq[data-sq="c8"][data-piece="bB"]) .move[data-from="c8"] { --develop-bonus: 35; }');
  lines.push('#game:has(.sq[data-sq="f8"][data-piece="bB"]) .move[data-from="f8"] { --develop-bonus: 35; }');
  lines.push('');
  lines.push('/* Central pawns: small bonus (pieces should develop first) */');
  lines.push('#game:has(.sq[data-sq="d2"][data-piece="wP"]) .move[data-from="d2"] { --develop-bonus: 10; }');
  lines.push('#game:has(.sq[data-sq="e2"][data-piece="wP"]) .move[data-from="e2"] { --develop-bonus: 10; }');
  lines.push('#game:has(.sq[data-sq="d7"][data-piece="bP"]) .move[data-from="d7"] { --develop-bonus: 10; }');
  lines.push('#game:has(.sq[data-sq="e7"][data-piece="bP"]) .move[data-from="e7"] { --develop-bonus: 10; }');
  lines.push('');
  lines.push('/* Discourage early king moves (except castling) */');
  lines.push('#game:has(.sq[data-sq="e1"][data-piece="wK"]) .move[data-from="e1"]:not([data-castle]) { --develop-bonus: -15; }');
  lines.push('#game:has(.sq[data-sq="e8"][data-piece="bK"]) .move[data-from="e8"]:not([data-castle]) { --develop-bonus: -15; }');
  lines.push('');
  lines.push('/* Discourage early queen moves from starting square */');
  lines.push('#game:has(.sq[data-sq="d1"][data-piece="wQ"]) .move[data-from="d1"] { --develop-bonus: -8; }');
  lines.push('#game:has(.sq[data-sq="d8"][data-piece="bQ"]) .move[data-from="d8"] { --develop-bonus: -8; }');
  lines.push('');

  // Capture value rules
  lines.push('/* ── Capture value: piece on target square (64 sq × 6 types = 384 rules) ── */');
  for (let f = 0; f < 8; f++) {
    for (let r = 1; r <= 8; r++) {
      const sq = FILES[f] + r;
      for (const piece of PIECES) {
        lines.push(
          `#game:has(.sq[data-sq="${sq}"]:is([data-piece="w${piece.type}"],[data-piece="b${piece.type}"])) .move[data-to="${sq}"] { --capture-value: ${piece.value}; }`
        );
      }
    }
  }
  lines.push('');

  // Attacker value rules
  lines.push('/* ── Attacker value: piece on source square (64 sq × 6 types = 384 rules) ── */');
  for (let f = 0; f < 8; f++) {
    for (let r = 1; r <= 8; r++) {
      const sq = FILES[f] + r;
      for (const piece of PIECES) {
        lines.push(
          `#game:has(.sq[data-sq="${sq}"]:is([data-piece="w${piece.type}"],[data-piece="b${piece.type}"])) .move[data-from="${sq}"] { --attacker-value: ${piece.value}; }`
        );
      }
    }
  }
  lines.push('');

  // Pawn threat rules
  lines.push('/* ── Pawn threat: destination attacked by enemy pawn ── */');
  generatePawnThreats(lines);
  lines.push('');

  // Knight threat rules
  lines.push('/* ── Knight threat: destination attacked by enemy knight ── */');
  generateKnightThreats(lines);
  lines.push('');

  // Bishop/queen diagonal threat rules
  lines.push('/* ── Bishop/queen threat: destination attacked on diagonal ── */');
  generateSlidingThreatOrDefense(lines, {
    directions: BISHOP_DIRS,
    varName: '--bishop-threat',
    pieceTypes: ['B', 'Q'],
    isThreat: true,
  });
  lines.push('');

  // Rook/queen line threat rules
  lines.push('/* ── Rook/queen threat: destination attacked on rank/file ── */');
  generateSlidingThreatOrDefense(lines, {
    directions: ROOK_DIRS,
    varName: '--rook-threat',
    pieceTypes: ['R', 'Q'],
    isThreat: true,
  });
  lines.push('');

  // Pawn defense rules
  lines.push('/* ── Pawn defense: destination defended by friendly pawn ── */');
  generatePawnDefense(lines);
  lines.push('');

  // Knight defense rules
  lines.push('/* ── Knight defense: destination defended by friendly knight ── */');
  generateKnightDefense(lines);
  lines.push('');

  // Bishop/queen diagonal defense rules
  lines.push('/* ── Bishop/queen defense: destination defended on diagonal ── */');
  generateSlidingThreatOrDefense(lines, {
    directions: BISHOP_DIRS,
    varName: '--bishop-defense',
    pieceTypes: ['B', 'Q'],
    isThreat: false,
  });
  lines.push('');

  // Rook/queen line defense rules
  lines.push('/* ── Rook/queen defense: destination defended on rank/file ── */');
  generateSlidingThreatOrDefense(lines, {
    directions: ROOK_DIRS,
    varName: '--rook-defense',
    pieceTypes: ['R', 'Q'],
    isThreat: false,
  });
  lines.push('');

  // Discovered attack rules
  lines.push('/* ── Discovered attacks: moving from-square reveals slider attack on friendly piece ── */');
  generateDiscoveredAttacks(lines);
  lines.push('');

  // Reversal penalty rules
  lines.push('/* ── Reversal penalty: penalize moving a piece back to where it just came from ── */');
  generateReversalPenalty(lines);

  return lines.join('\n') + '\n';
}

/**
 * Pawn threats: detect when a destination square is attacked by an enemy pawn.
 * - White's turn: black pawn at (file+-1, rank+1) attacks (file, rank)
 * - Black's turn: white pawn at (file+-1, rank-1) attacks (file, rank)
 */
function generatePawnThreats(lines) {
  for (let fi = 0; fi < 8; fi++) {
    for (let ri = 1; ri <= 8; ri++) {
      const destSq = FILES[fi] + ri;

      // White's turn: check for black pawns attacking this square
      // Black pawn captures downward: pawn at (fi+-1, ri+1) attacks (fi, ri)
      for (const dfi of [-1, 1]) {
        const pawnFi = fi + dfi;
        const pawnRi = ri + 1;
        if (pawnFi >= 0 && pawnFi < 8 && pawnRi >= 1 && pawnRi <= 8) {
          const pawnSq = FILES[pawnFi] + pawnRi;
          lines.push(
            `#game[data-turn="w"]:has(.sq[data-sq="${pawnSq}"][data-piece="bP"]) .move[data-to="${destSq}"] { --pawn-threat: 1; }`
          );
        }
      }

      // Black's turn: check for white pawns attacking this square
      // White pawn captures upward: pawn at (fi+-1, ri-1) attacks (fi, ri)
      for (const dfi of [-1, 1]) {
        const pawnFi = fi + dfi;
        const pawnRi = ri - 1;
        if (pawnFi >= 0 && pawnFi < 8 && pawnRi >= 1 && pawnRi <= 8) {
          const pawnSq = FILES[pawnFi] + pawnRi;
          lines.push(
            `#game[data-turn="b"]:has(.sq[data-sq="${pawnSq}"][data-piece="wP"]) .move[data-to="${destSq}"] { --pawn-threat: 1; }`
          );
        }
      }
    }
  }
}

/**
 * Knight threats: detect when a destination square is attacked by an enemy knight.
 * Checks all 8 possible knight-jump squares for each destination.
 */
function generateKnightThreats(lines) {
  const knightOffsets = [
    [-2, -1], [-2, 1], [-1, -2], [-1, 2],
    [1, -2], [1, 2], [2, -1], [2, 1],
  ];

  for (let fi = 0; fi < 8; fi++) {
    for (let ri = 1; ri <= 8; ri++) {
      const destSq = FILES[fi] + ri;

      for (const [dfi, dri] of knightOffsets) {
        const kfi = fi + dfi;
        const kri = ri + dri;
        if (kfi >= 0 && kfi < 8 && kri >= 1 && kri <= 8) {
          const knightSq = FILES[kfi] + kri;
          // White's turn: enemy knights are black
          lines.push(
            `#game[data-turn="w"]:has(.sq[data-sq="${knightSq}"][data-piece="bN"]) .move[data-to="${destSq}"] { --knight-threat: 1; }`
          );
          // Black's turn: enemy knights are white
          lines.push(
            `#game[data-turn="b"]:has(.sq[data-sq="${knightSq}"][data-piece="wN"]) .move[data-to="${destSq}"] { --knight-threat: 1; }`
          );
        }
      }
    }
  }
}

/**
 * Generic sliding piece threat or defense generator.
 * For threats: checks if enemy sliding piece (on given directions) attacks the destination.
 * For defense: checks if friendly sliding piece defends the destination.
 * All intermediate squares between piece and destination must be empty.
 *
 * @param {string[]} lines - output array
 * @param {Object} opts
 * @param {number[][]} opts.directions - direction vectors (BISHOP_DIRS or ROOK_DIRS)
 * @param {string} opts.varName - CSS variable to set (e.g. '--bishop-threat')
 * @param {string[]} opts.pieceTypes - piece type letters (e.g. ['B', 'Q'])
 * @param {boolean} opts.isThreat - true for threats (enemy pieces), false for defense (friendly)
 */
function generateSlidingThreatOrDefense(lines, { directions, varName, pieceTypes, isThreat }) {
  for (let fi = 0; fi < 8; fi++) {
    for (let ri = 1; ri <= 8; ri++) {
      const destSq = FILES[fi] + ri;

      for (const [dfi, dri] of directions) {
        const ray = slidingRay(fi, ri, dfi, dri);
        const between = [];

        for (const sq of ray) {
          for (const color of ['w', 'b']) {
            // For threats: piece belongs to enemy; for defense: piece belongs to friend
            const pieceColor = isThreat
              ? (color === 'w' ? 'b' : 'w')
              : color;

            const pieceSels = pieceTypes.map(t => `[data-piece="${pieceColor}${t}"]`).join(',');

            let sel = `#game[data-turn="${color}"]`;
            sel += `:has(.sq[data-sq="${sq}"]:is(${pieceSels}))`;
            for (const bsq of between) {
              sel += `:has(.sq[data-sq="${bsq}"][data-piece="empty"])`;
            }
            sel += ` .move[data-to="${destSq}"] { ${varName}: 1; }`;
            lines.push(sel);
          }

          between.push(sq);
        }
      }
    }
  }
}

/**
 * Knight defense: detect when a destination square is defended by a friendly knight.
 * Mirrors generateKnightThreats but checks for friendly knights instead of enemy.
 */
function generateKnightDefense(lines) {
  const knightOffsets = [
    [-2, -1], [-2, 1], [-1, -2], [-1, 2],
    [1, -2], [1, 2], [2, -1], [2, 1],
  ];

  for (let fi = 0; fi < 8; fi++) {
    for (let ri = 1; ri <= 8; ri++) {
      const destSq = FILES[fi] + ri;

      for (const [dfi, dri] of knightOffsets) {
        const kfi = fi + dfi;
        const kri = ri + dri;
        if (kfi >= 0 && kfi < 8 && kri >= 1 && kri <= 8) {
          const knightSq = FILES[kfi] + kri;
          // White's turn: friendly knights are white
          lines.push(
            `#game[data-turn="w"]:has(.sq[data-sq="${knightSq}"][data-piece="wN"]) .move[data-to="${destSq}"] { --knight-defense: 1; }`
          );
          // Black's turn: friendly knights are black
          lines.push(
            `#game[data-turn="b"]:has(.sq[data-sq="${knightSq}"][data-piece="bN"]) .move[data-to="${destSq}"] { --knight-defense: 1; }`
          );
        }
      }
    }
  }
}

/**
 * Pawn defense: detect when a destination square is defended by a friendly pawn.
 * - White's turn: white pawn at (file+-1, rank-1) defends (file, rank)
 * - Black's turn: black pawn at (file+-1, rank+1) defends (file, rank)
 */
function generatePawnDefense(lines) {
  for (let fi = 0; fi < 8; fi++) {
    for (let ri = 1; ri <= 8; ri++) {
      const destSq = FILES[fi] + ri;

      // White's turn: friendly white pawn defends from below
      // White pawn at (fi+-1, ri-1) defends (fi, ri)
      for (const dfi of [-1, 1]) {
        const pawnFi = fi + dfi;
        const pawnRi = ri - 1;
        if (pawnFi >= 0 && pawnFi < 8 && pawnRi >= 1 && pawnRi <= 8) {
          const pawnSq = FILES[pawnFi] + pawnRi;
          lines.push(
            `#game[data-turn="w"]:has(.sq[data-sq="${pawnSq}"][data-piece="wP"]) .move[data-to="${destSq}"] { --pawn-defense: 1; }`
          );
        }
      }

      // Black's turn: friendly black pawn defends from above
      // Black pawn at (fi+-1, ri+1) defends (fi, ri)
      for (const dfi of [-1, 1]) {
        const pawnFi = fi + dfi;
        const pawnRi = ri + 1;
        if (pawnFi >= 0 && pawnFi < 8 && pawnRi >= 1 && pawnRi <= 8) {
          const pawnSq = FILES[pawnFi] + pawnRi;
          lines.push(
            `#game[data-turn="b"]:has(.sq[data-sq="${pawnSq}"][data-piece="bP"]) .move[data-to="${destSq}"] { --pawn-defense: 1; }`
          );
        }
      }
    }
  }
}

/**
 * Discovered attacks: detect when moving a piece from a square reveals
 * an enemy slider attack on a friendly valuable piece (queen or rook).
 *
 * For each from-square, check all 8 ray directions:
 *   - In one direction: look for enemy slider (B/Q on diagonal, R/Q on rank/file)
 *   - In the opposite direction: look for friendly target (Q or R)
 *   - All intermediate squares (between slider↔from and from↔target) must be empty
 *   - Set --disc-attack to target value (500 for rook, 900 for queen)
 *
 * Rook-target rules are emitted before queen-target rules so that CSS cascade
 * gives queen targets (higher value) precedence when both match.
 */
function generateDiscoveredAttacks(lines) {
  const allDirs = [...BISHOP_DIRS, ...ROOK_DIRS];

  // Emit lower-value target rules first (rook), then higher (queen).
  // CSS cascade: last matching rule wins, so queen (900) overrides rook (500).
  const targets = [
    { type: 'R', value: 500 },
    { type: 'Q', value: 900 },
  ];

  for (const target of targets) {
    for (const color of ['w', 'b']) {
      const enemy = color === 'w' ? 'b' : 'w';

      for (let fi = 0; fi < 8; fi++) {
        for (let ri = 1; ri <= 8; ri++) {
          const fromSq = FILES[fi] + ri;

          for (const [dfi, dri] of allDirs) {
            const isDiag = dfi !== 0 && dri !== 0;

            // In direction (dfi, dri): look for enemy slider
            const sliderRay = slidingRay(fi, ri, dfi, dri);
            // In opposite direction: look for friendly target
            const targetRay = slidingRay(fi, ri, -dfi, -dri);

            if (sliderRay.length === 0 || targetRay.length === 0) continue;

            for (let si = 0; si < sliderRay.length; si++) {
              const sliderSq = sliderRay[si];
              const sliderBetween = sliderRay.slice(0, si);

              for (let ti = 0; ti < targetRay.length; ti++) {
                const targetSq = targetRay[ti];
                const targetBetween = targetRay.slice(0, ti);

                let sel = `#game[data-turn="${color}"]`;

                // Enemy slider piece
                if (isDiag) {
                  sel += `:has(.sq[data-sq="${sliderSq}"]:is([data-piece="${enemy}B"],[data-piece="${enemy}Q"]))`;
                } else {
                  sel += `:has(.sq[data-sq="${sliderSq}"]:is([data-piece="${enemy}R"],[data-piece="${enemy}Q"]))`;
                }

                // Intermediates between from and slider must be empty
                for (const bsq of sliderBetween) {
                  sel += `:has(.sq[data-sq="${bsq}"][data-piece="empty"])`;
                }

                // Intermediates between from and target must be empty
                for (const bsq of targetBetween) {
                  sel += `:has(.sq[data-sq="${bsq}"][data-piece="empty"])`;
                }

                // Friendly target piece
                sel += `:has(.sq[data-sq="${targetSq}"][data-piece="${color}${target.type}"])`;

                sel += ` .move[data-from="${fromSq}"] { --disc-attack: ${target.value}; }`;
                lines.push(sel);
              }
            }
          }
        }
      }
    }
  }
}

/**
 * Reversal penalty: for each square pair (X, Y) where X ≠ Y, penalize
 * the move Y→X when the side to move just played X→Y.
 * Uses :is() to cover both colors in a single rule.
 * 64 × 63 = 4032 rules.
 */
function generateReversalPenalty(lines) {
  for (let fi1 = 0; fi1 < 8; fi1++) {
    for (let ri1 = 1; ri1 <= 8; ri1++) {
      const sqX = FILES[fi1] + ri1;
      for (let fi2 = 0; fi2 < 8; fi2++) {
        for (let ri2 = 1; ri2 <= 8; ri2++) {
          if (fi1 === fi2 && ri1 === ri2) continue;
          const sqY = FILES[fi2] + ri2;
          lines.push(
            `:is(#game[data-turn="w"][data-last-from-w="${sqX}"][data-last-to-w="${sqY}"],` +
            `#game[data-turn="b"][data-last-from-b="${sqX}"][data-last-to-b="${sqY}"])` +
            ` .move[data-from="${sqY}"][data-to="${sqX}"] { --reversal-penalty: 50; }`
          );
        }
      }
    }
  }
}

const css = generate();
const outPath = path.resolve(__dirname, '..', 'css', 'dynamic-move-scoring.css');
fs.writeFileSync(outPath, css, 'utf8');

const ruleCount = (css.match(/\{/g) || []).length;
console.log(`Generated ${outPath} (${ruleCount} rules, ${(css.length / 1024).toFixed(1)} KB)`);
