'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { Chess } = require('chess.js');
const { CssEvaluator } = require('../src/css-evaluator');
const { GameState } = require('../src/game-state');

describe('CSS Check Detection', () => {
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
      name: 'Starting position — no check',
      fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      inCheck: false,
    },
    {
      name: 'White king in check by bishop',
      fen: 'rnbqk1nr/pppp1ppp/8/4p3/7b/5NP1/PPPPPP1P/RNBQKB1R w KQkq - 0 1',
      inCheck: false, // bishop on h4 doesn't check king on e1
    },
    {
      name: 'Scholar\'s mate threat — black in check from queen',
      fen: 'rnbqkbnr/ppppp1pp/8/5p1Q/4P3/8/PPPP1PPP/RNB1KBNR b KQkq - 1 2',
      inCheck: true,
    },
    {
      name: 'Knight check',
      fen: '4k3/8/5N2/8/8/8/8/4K3 b - - 0 1',
      inCheck: true, // Nf6 checks king on e8
    },
    {
      name: 'Rook check along file',
      fen: '4k3/8/8/8/8/8/8/4K2R b - - 0 1',
      inCheck: false, // Rh1 doesn't check e8 — white king blocks on e1
    },
    {
      name: 'Rook check — clear file',
      fen: '4k3/8/8/8/4R3/8/8/4K3 b - - 0 1',
      inCheck: true, // Re4 checks king on e8 along e-file
    },
    {
      name: 'Bishop check on diagonal',
      fen: '4k3/8/8/8/8/5B2/8/4K3 b - - 0 1',
      inCheck: false, // Bf3 doesn't check e8
    },
    {
      name: 'Bishop check — clear diagonal',
      fen: '4k3/8/8/7B/8/8/8/4K3 b - - 0 1',
      inCheck: true, // Bh5 checks e8 along the diagonal (h5-e8)
    },
    {
      name: 'Queen check along rank',
      fen: '4k3/8/8/8/8/8/8/Q3K3 b - - 0 1',
      inCheck: false, // Qa1 doesn't check e8
    },
    {
      name: 'Queen check along file',
      fen: '4k3/8/8/8/4Q3/8/8/4K3 b - - 0 1',
      inCheck: true, // Qe4 checks king on e8 along e-file
    },
    {
      name: 'Pawn check — white pawn checks black king',
      fen: '4k3/8/3P4/8/8/8/8/4K3 b - - 0 1',
      inCheck: false, // Pd6 doesn't check e8 — too far
    },
    {
      name: 'Pawn check — adjacent',
      fen: '4k3/3P4/8/8/8/8/8/4K3 b - - 0 1',
      inCheck: true, // Pd7 checks king on e8
    },
    {
      name: 'No check with blocked sliding piece',
      fen: '4k3/4p3/8/8/4R3/8/8/4K3 b - - 0 1',
      inCheck: false, // Re4 is blocked by pe7
    },
    {
      name: 'Double check',
      fen: '4k3/8/3N4/8/4R3/8/8/4K3 b - - 0 1',
      inCheck: true, // Re4 checks along file (Nd6 doesn't check e8 via knight)
    },
  ];

  for (const pos of testPositions) {
    it(`Check detection: ${pos.name}`, async () => {
      const gameState = GameState.fromFen(pos.fen);
      const inCheck = await evaluator.isInCheck(gameState);
      assert.strictEqual(
        inCheck, pos.inCheck,
        `Expected inCheck=${pos.inCheck}, got ${inCheck} for "${pos.name}"`
      );
    });
  }
});
