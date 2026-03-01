#!/usr/bin/env node
'use strict';

/**
 * Generates dynamic-move-scoring.css — CSS rules that read board state via :has()
 * to compute MVV-LVA capture scores, positional bonuses, and threat/defense awareness.
 *
 * Sections:
 *   - Base rule with defaults + order formula
 *   - Promotion bonuses (4 rules)
 *   - Castling bonus (1 rule)
 *   - Destination square bonuses (centrality, ~58 rules)
 *   - Development bonuses (~18 rules)
 *   - Capture value rules (64 sq × 6 types = 384 rules)
 *   - Attacker value rules (64 sq × 6 types = 384 rules)
 *   - Pawn threat rules (~196 rules)
 *   - Knight threat rules (~672 rules)
 *   - Pawn defense rules (~196 rules)
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

function generate() {
  const lines = [];

  lines.push('/* Auto-generated dynamic move scoring CSS */');
  lines.push('/* Uses :has() to read board state for MVV-LVA + positional scoring */');
  lines.push('');

  // Base rule with defaults and combined order calc
  lines.push('.move {');
  lines.push('  --capture-value: 0;');
  lines.push('  --attacker-value: 0;');
  lines.push('  --promo-bonus: 0;');
  lines.push('  --dest-bonus: 0;');
  lines.push('  --develop-bonus: 0;');
  lines.push('  --castle-bonus: 0;');
  lines.push('  --pawn-threat: 0;');
  lines.push('  --knight-threat: 0;');
  lines.push('  --pawn-defense: 0;');
  lines.push('  order: calc(');
  lines.push('    max(var(--capture-value) * 2 - var(--attacker-value), 0)');
  lines.push('    + var(--promo-bonus)');
  lines.push('    + var(--dest-bonus)');
  lines.push('    + var(--develop-bonus)');
  lines.push('    + var(--castle-bonus)');
  lines.push('    - var(--pawn-threat) * 80');
  lines.push('    - var(--knight-threat) * 30');
  lines.push('    + var(--pawn-defense) * 15');
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

  // Pawn defense rules
  lines.push('/* ── Pawn defense: destination defended by friendly pawn ── */');
  generatePawnDefense(lines);

  return lines.join('\n') + '\n';
}

/**
 * Pawn threats: detect when a destination square is attacked by an enemy pawn.
 * - White's turn: black pawn at (file±1, rank+1) attacks (file, rank)
 * - Black's turn: white pawn at (file±1, rank-1) attacks (file, rank)
 */
function generatePawnThreats(lines) {
  for (let fi = 0; fi < 8; fi++) {
    for (let ri = 1; ri <= 8; ri++) {
      const destSq = FILES[fi] + ri;

      // White's turn: check for black pawns attacking this square
      // Black pawn captures downward: pawn at (fi±1, ri+1) attacks (fi, ri)
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
      // White pawn captures upward: pawn at (fi±1, ri-1) attacks (fi, ri)
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
 * Pawn defense: detect when a destination square is defended by a friendly pawn.
 * - White's turn: white pawn at (file±1, rank-1) defends (file, rank)
 * - Black's turn: black pawn at (file±1, rank+1) defends (file, rank)
 */
function generatePawnDefense(lines) {
  for (let fi = 0; fi < 8; fi++) {
    for (let ri = 1; ri <= 8; ri++) {
      const destSq = FILES[fi] + ri;

      // White's turn: friendly white pawn defends from below
      // White pawn at (fi±1, ri-1) defends (fi, ri)
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
      // Black pawn at (fi±1, ri+1) defends (fi, ri)
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

const css = generate();
const outPath = path.resolve(__dirname, '..', 'css', 'dynamic-move-scoring.css');
fs.writeFileSync(outPath, css, 'utf8');

const ruleCount = (css.match(/\{/g) || []).length;
console.log(`Generated ${outPath} (${ruleCount} rules, ${(css.length / 1024).toFixed(1)} KB)`);
