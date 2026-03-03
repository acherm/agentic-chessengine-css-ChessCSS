'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { Chess } = require('chess.js');
const { CssEvaluator } = require('../src/css-evaluator');
const { GameState } = require('../src/game-state');
const { boardToEntries } = require('../src/board-renderer');
const { getReferenceEval } = require('../scripts/generate-css');

describe('CSS Evaluation', () => {
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
      description: 'Symmetric — should be 0',
    },
    {
      name: 'After 1.e4',
      fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
    },
    {
      name: 'After 1.e4 e5',
      fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2',
    },
    {
      name: 'White up a queen',
      fen: 'rnb1kbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      expectPositive: true,
    },
    {
      name: 'Black up a queen',
      fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNB1KBNR w Kkq - 0 1',
      expectNegative: true,
    },
    {
      name: 'White up a rook',
      fen: 'rnbqkbn1/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQq - 0 1',
      expectPositive: true,
    },
    {
      name: 'Empty board with kings only',
      fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1',
    },
    {
      name: 'Sicilian Defense',
      fen: 'rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq c6 0 2',
    },
    {
      name: 'Italian Game',
      fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3',
    },
    {
      name: 'Endgame: K+R vs K',
      fen: '4k3/8/8/8/8/8/8/R3K3 w Q - 0 1',
      expectPositive: true,
    },
  ];

  for (const pos of testPositions) {
    it(`CSS eval matches reference JS eval: ${pos.name}`, async () => {
      const gameState = GameState.fromFen(pos.fen);
      const cssEval = await evaluator.evaluate(gameState);
      const entries = boardToEntries(pos.fen);
      const jsEval = getReferenceEval(entries);

      assert.strictEqual(
        cssEval, jsEval,
        `CSS eval (${cssEval}) !== JS eval (${jsEval}) for ${pos.name}`
      );
    });
  }

  it('White up a queen should have positive eval', async () => {
    const fen = 'rnb1kbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const gameState = GameState.fromFen(fen);
    const cssEval = await evaluator.evaluate(gameState);
    assert.ok(cssEval > 800, `Expected eval > 800, got ${cssEval}`);
  });

  it('Black up a queen should have negative eval', async () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNB1KBNR w Kkq - 0 1';
    const gameState = GameState.fromFen(fen);
    const cssEval = await evaluator.evaluate(gameState);
    assert.ok(cssEval < -800, `Expected eval < -800, got ${cssEval}`);
  });

  it('Eval is consistent across multiple calls', async () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
    const gameState = GameState.fromFen(fen);
    const eval1 = await evaluator.evaluate(gameState);
    const eval2 = await evaluator.evaluate(gameState);
    assert.strictEqual(eval1, eval2, 'Eval should be deterministic');
  });
});
