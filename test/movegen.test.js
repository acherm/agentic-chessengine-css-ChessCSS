'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { Chess } = require('chess.js');
const { CssEvaluator } = require('../src/css-evaluator');
const { GameState } = require('../src/game-state');

/**
 * Convert chess.js verbose moves to a comparable format.
 * Returns a sorted array of "from-to[-promo]" strings.
 */
function chessJsMovesToKeys(moves) {
  return moves.map(m => {
    let key = m.from + m.to;
    if (m.promotion) key += m.promotion;
    return key;
  }).sort();
}

/**
 * Convert CSS moves to a comparable format.
 */
function cssMovesToKeys(moves) {
  return moves.map(m => {
    let key = m.from + m.to;
    if (m.promotion) key += m.promotion;
    return key;
  }).sort();
}

describe('CSS Move Generation', () => {
  let evaluator;

  before(async () => {
    evaluator = new CssEvaluator();
    await evaluator.init();
  });

  after(async () => {
    await evaluator.close();
  });

  const testPositions = [
    {
      name: 'Starting position',
      fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      expectedCount: 20,
    },
    {
      name: 'Starting position — black to move',
      fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
      expectedCount: 20,
    },
    {
      name: 'Open position with many pieces',
      fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 2 3',
    },
    {
      name: 'Position with en passant',
      fen: 'rnbqkbnr/pppp1ppp/8/4pP2/8/8/PPPPP1PP/RNBQKBNR w KQkq e6 0 3',
    },
    {
      name: 'Position with castling available',
      fen: 'r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1',
    },
    {
      name: 'Position with pins',
      fen: 'rnb1kbnr/pppp1ppp/8/4p3/7q/5NP1/PPPPPP1P/RNBQKB1R w KQkq - 0 1',
    },
    {
      name: 'Pawn promotion position',
      fen: '8/P7/8/8/8/8/8/K6k w - - 0 1',
    },
    {
      name: 'King in check — must escape',
      fen: 'rnbqkbnr/ppppp1pp/8/5p1Q/4P3/8/PPPP1PPP/RNB1KBNR b KQkq - 1 2',
    },
    {
      name: 'Endgame with few pieces',
      fen: '4k3/8/8/8/8/8/8/R3K3 w Q - 0 1',
    },
    {
      name: 'Complex middlegame',
      fen: 'r1bq1rk1/ppp2ppp/2np1n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQ1RK1 w - - 4 7',
    },
    {
      name: 'Double check evasion',
      fen: '4k3/8/8/8/1b6/2N5/1K3r2/8 w - - 0 1',
    },
    {
      name: 'Position with multiple promotions',
      fen: '3k4/PPPPPPPP/8/8/8/8/8/4K3 w - - 0 1',
    },
  ];

  for (const pos of testPositions) {
    it(`CSS moves match chess.js: ${pos.name}`, async () => {
      const chess = new Chess(pos.fen);
      const gameState = GameState.fromFen(pos.fen);

      const chessJsMoves = chess.moves({ verbose: true });
      const cssMoves = await evaluator.getLegalMoves(gameState);

      const jsKeys = chessJsMovesToKeys(chessJsMoves);
      const cssKeys = cssMovesToKeys(cssMoves);

      if (pos.expectedCount !== undefined) {
        assert.strictEqual(
          cssMoves.length, pos.expectedCount,
          `Expected ${pos.expectedCount} moves, got ${cssMoves.length}`
        );
      }

      // Find missing and extra moves
      const jsSet = new Set(jsKeys);
      const cssSet = new Set(cssKeys);

      const missingFromCss = jsKeys.filter(k => !cssSet.has(k));
      const extraInCss = cssKeys.filter(k => !jsSet.has(k));

      assert.deepStrictEqual(
        missingFromCss, [],
        `CSS is missing moves: ${missingFromCss.join(', ')}`
      );
      assert.deepStrictEqual(
        extraInCss, [],
        `CSS has extra moves: ${extraInCss.join(', ')}`
      );

      assert.strictEqual(
        cssKeys.length, jsKeys.length,
        `Move count mismatch: CSS=${cssKeys.length}, JS=${jsKeys.length}`
      );
    });
  }
});
