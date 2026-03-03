#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

function sqName(file, rank) {
  return FILES[file] + (rank + 1);
}

function isValid(file, rank) {
  return file >= 0 && file < 8 && rank >= 0 && rank < 8;
}

// Knight offsets
const KNIGHT_OFFSETS = [
  [-2, -1], [-2, 1], [-1, -2], [-1, 2],
  [1, -2], [1, 2], [2, -1], [2, 1],
];

// King offsets
const KING_OFFSETS = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1],           [0, 1],
  [1, -1],  [1, 0],  [1, 1],
];

// Sliding directions
const ROOK_DIRS = [[0, 1], [0, -1], [1, 0], [-1, 0]];
const BISHOP_DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const QUEEN_DIRS = [...ROOK_DIRS, ...BISHOP_DIRS];

/**
 * Get all squares along a ray from (file, rank) in direction (df, dr).
 * Returns array of { to: [f, r], between: [[f, r], ...] }
 * Each entry represents reaching that square, with all squares that must be empty in between.
 */
function getSlidingRay(file, rank, df, dr) {
  const results = [];
  const between = [];
  let f = file + df;
  let r = rank + dr;
  while (isValid(f, r)) {
    results.push({ to: [f, r], between: [...between] });
    between.push([f, r]);
    f += df;
    r += dr;
  }
  return results;
}

/**
 * Generate a CSS rule for a pseudo-legal move.
 * @param {string} color - 'w' or 'b'
 * @param {string} piece - 'wN', 'bR', etc.
 * @param {string} from - 'e4'
 * @param {string} to - 'd6'
 * @param {Array} between - array of square names that must be empty
 * @param {object} extras - { capture, nonCapture, promotion, ep, castle, epAttr }
 */
function generateRule(color, piece, from, to, between, extras = {}) {
  const opponent = color === 'w' ? 'b' : 'w';
  const parts = [`#game[data-t="${color}"]`];

  // Source square has the piece
  parts.push(`:has(.sq[data-s="${from}"][data-p="${piece}"])`);

  // All between squares must be empty
  for (const sq of between) {
    parts.push(`:has(.sq[data-s="${sq}"][data-p="empty"])`);
  }

  // Destination square conditions
  if (extras.capture === 'only') {
    // Must capture opponent piece
    parts.push(`:has(.sq[data-s="${to}"][data-p^="${opponent}"])`);
  } else if (extras.nonCapture) {
    // Must be empty
    parts.push(`:has(.sq[data-s="${to}"][data-p="empty"])`);
  } else if (!extras.ep && !extras.castle) {
    // Not friendly piece (can be empty or opponent)
    parts.push(`:has(.sq[data-s="${to}"]:not([data-p^="${color}"]):not([data-p="empty"]))`);
    // Actually for standard moves: not own piece (capture or move to empty)
  }

  // Build the move selector
  let moveSel = `.move[data-f="${from}"][data-d="${to}"]`;

  if (extras.promotion) {
    moveSel += `[data-pr]`;
  } else if (!extras.ep && !extras.castle) {
    moveSel += `:not([data-pr]):not([data-e]):not([data-c])`;
  }

  if (extras.ep) {
    moveSel += `[data-e="true"]`;
  }

  if (extras.castle) {
    moveSel += `[data-c="${extras.castle}"]`;
  }

  // Combine selector with newlines for readability
  const selector = parts.join('\n  ') + '\n  ' + moveSel;

  return `${selector} { --pseudo-legal: 1; }`;
}

function generateKnightRules(color) {
  const rules = [];
  const piece = color + 'N';

  for (let f = 0; f < 8; f++) {
    for (let r = 0; r < 8; r++) {
      const from = sqName(f, r);
      for (const [df, dr] of KNIGHT_OFFSETS) {
        const tf = f + df;
        const tr = r + dr;
        if (!isValid(tf, tr)) continue;
        const to = sqName(tf, tr);

        // Knight can move to any square not occupied by own piece
        const sel = `#game[data-t="${color}"]:has(.sq[data-s="${from}"][data-p="${piece}"]):has(.sq[data-s="${to}"]:not([data-p^="${color}"])) .move[data-f="${from}"][data-d="${to}"]:not([data-pr]):not([data-e]):not([data-c]) { --pseudo-legal: 1; }`;
        rules.push(sel);
      }
    }
  }
  return rules;
}

function generateKingRules(color) {
  const rules = [];
  const piece = color + 'K';

  for (let f = 0; f < 8; f++) {
    for (let r = 0; r < 8; r++) {
      const from = sqName(f, r);
      for (const [df, dr] of KING_OFFSETS) {
        const tf = f + df;
        const tr = r + dr;
        if (!isValid(tf, tr)) continue;
        const to = sqName(tf, tr);

        const sel = `#game[data-t="${color}"]:has(.sq[data-s="${from}"][data-p="${piece}"]):has(.sq[data-s="${to}"]:not([data-p^="${color}"])) .move[data-f="${from}"][data-d="${to}"]:not([data-pr]):not([data-e]):not([data-c]) { --pseudo-legal: 1; }`;
        rules.push(sel);
      }
    }
  }
  return rules;
}

function generateSlidingRules(color, pieceType, directions) {
  const rules = [];
  const piece = color + pieceType;

  for (let f = 0; f < 8; f++) {
    for (let r = 0; r < 8; r++) {
      const from = sqName(f, r);
      for (const [df, dr] of directions) {
        const ray = getSlidingRay(f, r, df, dr);
        for (const { to: [tf, tr], between } of ray) {
          const to = sqName(tf, tr);
          const betweenNames = between.map(([bf, br]) => sqName(bf, br));

          // Build has-conditions: all between squares must be empty, target not own piece
          let sel = `#game[data-t="${color}"]:has(.sq[data-s="${from}"][data-p="${piece}"])`;
          for (const bsq of betweenNames) {
            sel += `:has(.sq[data-s="${bsq}"][data-p="empty"])`;
          }
          sel += `:has(.sq[data-s="${to}"]:not([data-p^="${color}"]))`;
          sel += ` .move[data-f="${from}"][data-d="${to}"]:not([data-pr]):not([data-e]):not([data-c]) { --pseudo-legal: 1; }`;
          rules.push(sel);
        }
      }
    }
  }
  return rules;
}

function generatePawnRules(color) {
  const rules = [];
  const piece = color + 'P';
  const dir = color === 'w' ? 1 : -1;
  const startRank = color === 'w' ? 1 : 6; // 0-indexed: rank 2 for white, rank 7 for black
  const promoRank = color === 'w' ? 7 : 0;  // 0-indexed: rank 8 for white, rank 1 for black
  const prePromoRank = color === 'w' ? 6 : 1; // rank 7 for white, rank 2 for black
  const opponent = color === 'w' ? 'b' : 'w';

  for (let f = 0; f < 8; f++) {
    for (let r = 0; r < 8; r++) {
      // Pawns can't be on rank 1 or rank 8
      if (r === 0 || r === 7) continue;

      const from = sqName(f, r);

      // Single push
      const pushR = r + dir;
      if (isValid(f, pushR)) {
        const to = sqName(f, pushR);
        if (pushR === promoRank) {
          // Promotion push
          const sel = `#game[data-t="${color}"]:has(.sq[data-s="${from}"][data-p="${piece}"]):has(.sq[data-s="${to}"][data-p="empty"]) .move[data-f="${from}"][data-d="${to}"][data-pr] { --pseudo-legal: 1; }`;
          rules.push(sel);
        } else {
          // Normal push
          const sel = `#game[data-t="${color}"]:has(.sq[data-s="${from}"][data-p="${piece}"]):has(.sq[data-s="${to}"][data-p="empty"]) .move[data-f="${from}"][data-d="${to}"]:not([data-pr]):not([data-e]):not([data-c]) { --pseudo-legal: 1; }`;
          rules.push(sel);
        }
      }

      // Double push from starting rank
      if (r === startRank) {
        const midR = r + dir;
        const dblR = r + 2 * dir;
        if (isValid(f, dblR)) {
          const mid = sqName(f, midR);
          const to = sqName(f, dblR);
          const sel = `#game[data-t="${color}"]:has(.sq[data-s="${from}"][data-p="${piece}"]):has(.sq[data-s="${mid}"][data-p="empty"]):has(.sq[data-s="${to}"][data-p="empty"]) .move[data-f="${from}"][data-d="${to}"]:not([data-pr]):not([data-e]):not([data-c]) { --pseudo-legal: 1; }`;
          rules.push(sel);
        }
      }

      // Captures (diagonal)
      for (const df of [-1, 1]) {
        const cf = f + df;
        const cr = r + dir;
        if (!isValid(cf, cr)) continue;
        const to = sqName(cf, cr);

        if (cr === promoRank) {
          // Promotion capture
          const sel = `#game[data-t="${color}"]:has(.sq[data-s="${from}"][data-p="${piece}"]):has(.sq[data-s="${to}"][data-p^="${opponent}"]) .move[data-f="${from}"][data-d="${to}"][data-pr] { --pseudo-legal: 1; }`;
          rules.push(sel);
        } else {
          // Normal capture
          const sel = `#game[data-t="${color}"]:has(.sq[data-s="${from}"][data-p="${piece}"]):has(.sq[data-s="${to}"][data-p^="${opponent}"]) .move[data-f="${from}"][data-d="${to}"]:not([data-pr]):not([data-e]):not([data-c]) { --pseudo-legal: 1; }`;
          rules.push(sel);
        }
      }

      // En passant
      // Pawn must be on the 5th rank (4 for white 0-indexed, 3 for black 0-indexed)
      const epRank = color === 'w' ? 4 : 3;
      if (r === epRank) {
        for (const df of [-1, 1]) {
          const cf = f + df;
          const cr = r + dir;
          if (!isValid(cf, cr)) continue;
          const to = sqName(cf, cr);
          // EP: data-e on #game must match the target square
          const sel = `#game[data-t="${color}"][data-e="${to}"]:has(.sq[data-s="${from}"][data-p="${piece}"]) .move[data-f="${from}"][data-d="${to}"][data-e="true"] { --pseudo-legal: 1; }`;
          rules.push(sel);
        }
      }
    }
  }
  return rules;
}

function generateCastlingRules() {
  const rules = [];

  // White kingside: e1-g1, f1 and g1 empty, rook on h1
  rules.push(`#game[data-t="w"][data-cwk="1"]:has(.sq[data-s="e1"][data-p="wK"]):has(.sq[data-s="h1"][data-p="wR"]):has(.sq[data-s="f1"][data-p="empty"]):has(.sq[data-s="g1"][data-p="empty"]) .move[data-f="e1"][data-d="g1"][data-c="wk"] { --pseudo-legal: 1; }`);

  // White queenside: e1-c1, b1,c1,d1 empty, rook on a1
  rules.push(`#game[data-t="w"][data-cwq="1"]:has(.sq[data-s="e1"][data-p="wK"]):has(.sq[data-s="a1"][data-p="wR"]):has(.sq[data-s="b1"][data-p="empty"]):has(.sq[data-s="c1"][data-p="empty"]):has(.sq[data-s="d1"][data-p="empty"]) .move[data-f="e1"][data-d="c1"][data-c="wq"] { --pseudo-legal: 1; }`);

  // Black kingside: e8-g8, f8 and g8 empty, rook on h8
  rules.push(`#game[data-t="b"][data-cbk="1"]:has(.sq[data-s="e8"][data-p="bK"]):has(.sq[data-s="h8"][data-p="bR"]):has(.sq[data-s="f8"][data-p="empty"]):has(.sq[data-s="g8"][data-p="empty"]) .move[data-f="e8"][data-d="g8"][data-c="bk"] { --pseudo-legal: 1; }`);

  // Black queenside: e8-c8, b8,c8,d8 empty, rook on a8
  rules.push(`#game[data-t="b"][data-cbq="1"]:has(.sq[data-s="e8"][data-p="bK"]):has(.sq[data-s="a8"][data-p="bR"]):has(.sq[data-s="b8"][data-p="empty"]):has(.sq[data-s="c8"][data-p="empty"]):has(.sq[data-s="d8"][data-p="empty"]) .move[data-f="e8"][data-d="c8"][data-c="bq"] { --pseudo-legal: 1; }`);

  return rules;
}

function generateMoveGenCss() {
  const allRules = [];

  allRules.push('/* CSS Chess Engine — Move Generation Rules');
  allRules.push(' * Auto-generated by scripts/generate-movegen-css.js');
  allRules.push(' * Sets --pseudo-legal: 1 on .move elements that are pseudo-legal.');
  allRules.push(' * Legality (not moving into check) is verified by DOM mutation + check detection CSS.');
  allRules.push(' */');
  allRules.push('');
  allRules.push('/* Default: no move is pseudo-legal */');
  allRules.push('.move { --pseudo-legal: 0; }');
  allRules.push('');

  let totalRules = 0;

  for (const color of ['w', 'b']) {
    const colorName = color === 'w' ? 'White' : 'Black';

    // Knights
    allRules.push(`/* === ${colorName} Knight === */`);
    const knightRules = generateKnightRules(color);
    allRules.push(...knightRules);
    allRules.push('');
    totalRules += knightRules.length;

    // King
    allRules.push(`/* === ${colorName} King === */`);
    const kingRules = generateKingRules(color);
    allRules.push(...kingRules);
    allRules.push('');
    totalRules += kingRules.length;

    // Pawns
    allRules.push(`/* === ${colorName} Pawn === */`);
    const pawnRules = generatePawnRules(color);
    allRules.push(...pawnRules);
    allRules.push('');
    totalRules += pawnRules.length;

    // Rooks
    allRules.push(`/* === ${colorName} Rook === */`);
    const rookRules = generateSlidingRules(color, 'R', ROOK_DIRS);
    allRules.push(...rookRules);
    allRules.push('');
    totalRules += rookRules.length;

    // Bishops
    allRules.push(`/* === ${colorName} Bishop === */`);
    const bishopRules = generateSlidingRules(color, 'B', BISHOP_DIRS);
    allRules.push(...bishopRules);
    allRules.push('');
    totalRules += bishopRules.length;

    // Queens
    allRules.push(`/* === ${colorName} Queen === */`);
    const queenRules = generateSlidingRules(color, 'Q', QUEEN_DIRS);
    allRules.push(...queenRules);
    allRules.push('');
    totalRules += queenRules.length;
  }

  // Castling
  allRules.push('/* === Castling === */');
  const castlingRules = generateCastlingRules();
  allRules.push(...castlingRules);
  allRules.push('');
  totalRules += castlingRules.length;

  const css = allRules.join('\n');
  const outPath = path.join(__dirname, '..', 'css', 'move-generation.css');
  fs.writeFileSync(outPath, css, 'utf8');

  console.log(`Generated ${outPath}`);
  console.log(`Total move-generation rules: ${totalRules}`);
}

if (require.main === module) {
  generateMoveGenCss();
}

module.exports = { generateMoveGenCss };
