#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

// Material values (centipawns)
const MATERIAL = {
  P: 100, N: 320, B: 330, R: 500, Q: 900, K: 20000,
};

// Piece-square tables (from white's perspective, a1=index 0, h8=index 63)
// Values in centipawns, added to material value
// Indexed [rank 8..1][file a..h] — rank 8 is row 0 (top of board from white's view)
const PST = {
  P: [
    [  0,  0,  0,  0,  0,  0,  0,  0],
    [ 50, 50, 50, 50, 50, 50, 50, 50],
    [ 10, 10, 20, 30, 30, 20, 10, 10],
    [  5,  5, 10, 25, 25, 10,  5,  5],
    [  0,  0,  0, 20, 20,  0,  0,  0],
    [  5, -5,-10,  0,  0,-10, -5,  5],
    [  5, 10, 10,-20,-20, 10, 10,  5],
    [  0,  0,  0,  0,  0,  0,  0,  0],
  ],
  N: [
    [-50,-40,-30,-30,-30,-30,-40,-50],
    [-40,-20,  0,  0,  0,  0,-20,-40],
    [-30,  0, 10, 15, 15, 10,  0,-30],
    [-30,  5, 15, 20, 20, 15,  5,-30],
    [-30,  0, 15, 20, 20, 15,  0,-30],
    [-30,  5, 10, 15, 15, 10,  5,-30],
    [-40,-20,  0,  5,  5,  0,-20,-40],
    [-50,-40,-30,-30,-30,-30,-40,-50],
  ],
  B: [
    [-20,-10,-10,-10,-10,-10,-10,-20],
    [-10,  0,  0,  0,  0,  0,  0,-10],
    [-10,  0, 10, 10, 10, 10,  0,-10],
    [-10,  5,  5, 10, 10,  5,  5,-10],
    [-10,  0,  5, 10, 10,  5,  0,-10],
    [-10, 10, 10, 10, 10, 10, 10,-10],
    [-10,  5,  0,  0,  0,  0,  5,-10],
    [-20,-10,-10,-10,-10,-10,-10,-20],
  ],
  R: [
    [  0,  0,  0,  0,  0,  0,  0,  0],
    [  5, 10, 10, 10, 10, 10, 10,  5],
    [ -5,  0,  0,  0,  0,  0,  0, -5],
    [ -5,  0,  0,  0,  0,  0,  0, -5],
    [ -5,  0,  0,  0,  0,  0,  0, -5],
    [ -5,  0,  0,  0,  0,  0,  0, -5],
    [ -5,  0,  0,  0,  0,  0,  0, -5],
    [  0,  0,  0,  5,  5,  0,  0,  0],
  ],
  Q: [
    [-20,-10,-10, -5, -5,-10,-10,-20],
    [-10,  0,  0,  0,  0,  0,  0,-10],
    [-10,  0,  5,  5,  5,  5,  0,-10],
    [ -5,  0,  5,  5,  5,  5,  0, -5],
    [  0,  0,  5,  5,  5,  5,  0, -5],
    [-10,  5,  5,  5,  5,  5,  0,-10],
    [-10,  0,  5,  0,  0,  0,  0,-10],
    [-20,-10,-10, -5, -5,-10,-10,-20],
  ],
  K: [
    [-30,-40,-40,-50,-50,-40,-40,-30],
    [-30,-40,-40,-50,-50,-40,-40,-30],
    [-30,-40,-40,-50,-50,-40,-40,-30],
    [-30,-40,-40,-50,-50,-40,-40,-30],
    [-20,-30,-30,-40,-40,-30,-30,-20],
    [-10,-20,-20,-20,-20,-20,-20,-10],
    [ 20, 20,  0,  0,  0,  0, 20, 20],
    [ 20, 30, 10,  0,  0, 10, 30, 20],
  ],
};

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1'];

function generateEvalCss() {
  const rules = [];

  rules.push('/* CSS Chess Engine — Evaluation Rules');
  rules.push(' * 768 rules: material + piece-square table values via --piece-value custom property');
  rules.push(' * The driver sums --piece-value across all 64 squares to get the position eval.');
  rules.push(' */');
  rules.push('');

  // Default: empty squares contribute 0
  rules.push('.sq { --piece-value: 0; }');
  rules.push('');

  let ruleCount = 0;

  for (const piece of Object.keys(MATERIAL)) {
    rules.push(`/* ${piece} */`);
    for (let rankIdx = 0; rankIdx < 8; rankIdx++) {
      for (let fileIdx = 0; fileIdx < 8; fileIdx++) {
        const sq = FILES[fileIdx] + RANKS[rankIdx];
        const material = MATERIAL[piece];
        const pst = PST[piece][rankIdx][fileIdx];

        // White piece: positive contribution
        const whiteVal = material + pst;
        rules.push(`.sq[data-piece="w${piece}"][data-sq="${sq}"] { --piece-value: ${whiteVal}; }`);
        ruleCount++;

        // Black piece: negative contribution, PST mirrored vertically
        const mirroredRankIdx = 7 - rankIdx;
        const blackPst = PST[piece][mirroredRankIdx][fileIdx];
        const blackVal = -(material + blackPst);
        rules.push(`.sq[data-piece="b${piece}"][data-sq="${sq}"] { --piece-value: ${blackVal}; }`);
        ruleCount++;
      }
    }
    rules.push('');
  }

  const css = rules.join('\n');

  const outPath = path.join(__dirname, '..', 'css', 'eval.css');
  fs.writeFileSync(outPath, css, 'utf8');

  console.log(`Generated ${outPath}`);
  console.log(`Total piece-square rules: ${ruleCount}`);
  console.log(`Expected: 768 (6 pieces x 2 colors x 64 squares)`);
}

// Also export the tables for reference testing
function getReferenceEval(board) {
  // board: array of { piece, color, square } or null for empty
  let score = 0;
  for (const entry of board) {
    if (!entry) continue;
    const { type, color, square } = entry;
    const piece = type.toUpperCase();
    const file = square.charCodeAt(0) - 'a'.charCodeAt(0);
    const rank = parseInt(square[1]);

    // PST index: rank 8 = row 0, rank 1 = row 7
    const material = MATERIAL[piece];

    if (color === 'w') {
      const rankIdx = 8 - rank; // rank 8 → 0, rank 1 → 7
      const pst = PST[piece][rankIdx][file];
      score += material + pst;
    } else {
      // For black, mirror the PST vertically
      const rankIdx = rank - 1; // rank 1 → 0, rank 8 → 7 (mirrored)
      const pst = PST[piece][rankIdx][file];
      score -= (material + pst);
    }
  }
  return score;
}

if (require.main === module) {
  generateEvalCss();
}

module.exports = { generateEvalCss, getReferenceEval, MATERIAL, PST };
