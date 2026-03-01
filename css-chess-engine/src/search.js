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
    const legalMoves = await this.evaluator.getLegalMoves(gameState);

    if (legalMoves.length === 0) {
      const inCheck = await this.evaluator.isInCheck(gameState);
      return {
        bestMove: null,
        score: inCheck ? -999999 : 0,
        nodes: 1,
        depth: 1,
      };
    }

    // Pick the move with the highest CSS-assigned score (MVV-LVA)
    legalMoves.sort((a, b) => b.score - a.score);
    const best = legalMoves[0];
    const uci = best.from + best.to + (best.promotion || '');

    this.sendInfo(1, best.score, legalMoves.length);

    return {
      bestMove: uci,
      score: best.score,
      nodes: legalMoves.length,
      depth: 1,
    };
  }

  sendInfo(depth, score, nodes) {
    process.stdout.write(`info depth ${depth} score cp ${score} nodes ${nodes}\n`);
  }
}

module.exports = { Search };
