'use strict';

/**
 * Move ordering using CSS-computed scores.
 * Falls back to simple heuristic ordering for interior search nodes
 * (to avoid the cost of a Puppeteer round-trip for every node).
 */

const PIECE_VALUES = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };

/**
 * Simple JS-based move ordering for interior search nodes.
 * Captures first (MVV-LVA), then non-captures.
 */
function orderMovesSimple(moves) {
  return moves.slice().sort((a, b) => {
    // Captures first
    const aCapture = a.captured ? PIECE_VALUES[a.captured] * 10 - PIECE_VALUES[a.piece] : 0;
    const bCapture = b.captured ? PIECE_VALUES[b.captured] * 10 - PIECE_VALUES[b.piece] : 0;

    // Promotions
    const aPromo = a.flags.includes('p') ? 9000 : 0;
    const bPromo = b.flags.includes('p') ? 9000 : 0;

    const aScore = aCapture + aPromo;
    const bScore = bCapture + bPromo;

    return bScore - aScore;
  });
}

module.exports = { orderMovesSimple, PIECE_VALUES };
