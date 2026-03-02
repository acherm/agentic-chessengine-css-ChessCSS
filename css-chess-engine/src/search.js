'use strict';

const { GameState } = require('./game-state');

class Search {
  constructor(cssEvaluator) {
    this.evaluator = cssEvaluator;
  }

  /**
   * Find the best move for the current position.
   * Greedy search: pick the move with the highest CSS-assigned score (MVV-LVA).
   * No lookahead — JS is just argmax over CSS-scored legal moves.
   * @param {string} fen - FEN string of the current position
   * @param {object} options - { depth, movetime } (informational only)
   * @returns {{ bestMove: string|null, score: number, nodes: number, depth: number }}
   */
  async findBestMove(fen, options = {}) {
    const gameState = GameState.fromFen(fen);
    const result = await this.evaluator.getBestMove(gameState);

    if (!result) {
      // No legal moves → checkmate or stalemate
      const inCheck = await this.evaluator.isInCheck(gameState);
      return {
        bestMove: null,
        score: inCheck ? -999999 : 0,
        nodes: 1,
        depth: 1,
      };
    }

    const uci = result.from + result.to + result.promotion;
    this.sendInfo(1, result.score, 1);

    return {
      bestMove: uci,
      score: result.score,
      nodes: 1,
      depth: 1,
    };
  }

  sendInfo(depth, score, nodes) {
    process.stdout.write(`info depth ${depth} score cp ${score} nodes ${nodes}\n`);
  }
}

module.exports = { Search };
