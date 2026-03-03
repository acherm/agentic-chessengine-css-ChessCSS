'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { Chess } = require('chess.js');
const { CssEvaluator } = require('../src/css-evaluator');
const { Search } = require('../src/search');

describe('Integration — Tactical Tests', () => {
  let evaluator;
  let search;

  before(async () => {
    evaluator = new CssEvaluator();
    await evaluator.init();
    search = new Search(evaluator);
  });

  after(async () => {
    await evaluator.close();
  });

  it('captures a hanging queen (depth 1)', async () => {
    // White to move, black queen on d4 is hanging
    // White has a knight on f3 that can capture
    const fen = 'rnb1kbnr/pppppppp/8/8/3q4/5N2/PPPPPPPP/RNBQKB1R w KQkq - 0 1';
    const result = await search.findBestMove(fen, { depth: 1 });

    // Knight should capture queen on d4
    assert.ok(result.bestMove, 'Should find a move');
    // Verify the score is highly positive (capturing a queen is worth ~900)
    assert.ok(result.score > 500, `Should find queen capture, score: ${result.score}, move: ${result.bestMove}`);
  });

  it('captures a hanging rook (depth 1)', async () => {
    // White to move, black rook on e5 is hanging, white bishop on c3 can take
    const fen = 'rnbqkbn1/pppppppp/8/4r3/8/2B5/PPPPPPPP/RN1QKBNR w KQq - 0 1';
    const result = await search.findBestMove(fen, { depth: 1 });

    assert.ok(result.bestMove, 'Should find a move');
    assert.ok(result.score > 100, `Should prefer capturing rook, score: ${result.score}, move: ${result.bestMove}`);
  });

  it('finds a legal move in mate-in-1 position', async () => {
    // Scholar's mate position: White Qf3, Bc4 can mate with Qxf7#
    // Greedy search can't see checkmate (no lookahead), but should find a legal move
    const fen = 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 0 1';
    const result = await search.findBestMove(fen, { depth: 1 });

    assert.ok(result.bestMove, 'Should find a move');
    // Verify the move is legal
    const chess = new Chess(fen);
    const move = chess.move(result.bestMove, { sloppy: true });
    assert.ok(move, `Move ${result.bestMove} should be legal`);
  });

  it('finds a move from starting position', async () => {
    // Starting position — greedy should find a legal move
    const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const result = await search.findBestMove(fen, { depth: 1 });

    assert.ok(result.bestMove, 'Should find a move');
    assert.ok(result.nodes >= 1, 'Should evaluate at least one node');
  });

  it('handles position with no captures', async () => {
    // Closed position with no immediate captures
    const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const result = await search.findBestMove(fen, { depth: 1 });

    assert.ok(result.bestMove, 'Should find a move');
    assert.strictEqual(result.depth, 1, 'Should complete depth 1');
  });

  it('prefers promotion', async () => {
    // White pawn on a7, kings far apart so queen can't be captured
    const fen = '8/P7/8/8/8/8/8/K6k w - - 0 1';
    const result = await search.findBestMove(fen, { depth: 1 });

    assert.ok(result.bestMove, 'Should find a move');
    // bestMove is in UCI format (e.g. "a7a8q")
    const chess = new Chess(fen);
    const move = chess.moves({ verbose: true }).find(m => {
      let uci = m.from + m.to;
      if (m.promotion) uci += m.promotion;
      return uci === result.bestMove;
    });
    assert.ok(move, `Move ${result.bestMove} should be in legal moves`);
    assert.ok(
      move.flags.includes('p') || result.bestMove.length > 4,
      `Should promote pawn. Move: ${result.bestMove}`
    );
  });
});
