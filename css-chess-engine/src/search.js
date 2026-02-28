'use strict';

const { GameState } = require('./game-state');

const INF = 999999;

class Search {
  constructor(cssEvaluator) {
    this.evaluator = cssEvaluator;
    this.nodes = 0;
    this.startTime = 0;
    this.timeLimit = 0; // ms, 0 = no limit
    this.aborted = false;
  }

  /**
   * Find the best move for the current position.
   * Uses CSS for move generation, evaluation, and move ordering.
   * Uses GameState for make/unmake moves — no chess.js dependency.
   * @param {string} fen - FEN string of the current position
   * @param {object} options - { depth, movetime }
   * @returns {{ bestMove: string|null, score: number, nodes: number, depth: number }}
   */
  async findBestMove(fen, options = {}) {
    const depth = options.depth || 2;
    const movetime = options.movetime || 0;

    this.nodes = 0;
    this.startTime = Date.now();
    this.timeLimit = movetime;
    this.aborted = false;

    const gameState = GameState.fromFen(fen);
    const cssMoves = await this.evaluator.getLegalMoves(gameState);

    if (cssMoves.length === 0) return { bestMove: null, score: 0, nodes: 0, depth: 0 };
    if (cssMoves.length === 1) {
      const uci = cssMoves[0].from + cssMoves[0].to + (cssMoves[0].promotion || '');
      return { bestMove: uci, score: 0, nodes: 1, depth: 1 };
    }

    // Sort by CSS score (MVV-LVA + promotion bonuses)
    const orderedMoves = cssMoves.slice().sort((a, b) => b.score - a.score);

    let bestMove = orderedMoves[0];
    let bestScore = -INF;
    let completedDepth = 0;

    // Iterative deepening
    for (let d = 1; d <= depth; d++) {
      let currentBest = orderedMoves[0];
      let currentScore = -INF;

      for (const move of orderedMoves) {
        if (this.isTimeUp()) break;

        const undo = gameState.applyMove(move);
        this.nodes++;

        const score = -(await this.negamax(gameState, d - 1, -INF, -currentScore));

        gameState.undoMove(undo);

        if (score > currentScore) {
          currentScore = score;
          currentBest = move;
        }
      }

      if (!this.isTimeUp()) {
        bestMove = currentBest;
        bestScore = currentScore;
        completedDepth = d;

        this.sendInfo(d, bestScore, this.nodes);

        // Reorder: put best move first for next iteration (improves alpha-beta pruning)
        const bestIdx = orderedMoves.indexOf(currentBest);
        if (bestIdx > 0) {
          orderedMoves.splice(bestIdx, 1);
          orderedMoves.unshift(currentBest);
        }

        // Early termination if mate found
        if (bestScore >= INF - 100) break;
      }
    }

    const uciMove = bestMove.from + bestMove.to + (bestMove.promotion || '');

    return {
      bestMove: uciMove,
      score: bestScore,
      nodes: this.nodes,
      depth: completedDepth,
    };
  }

  /**
   * Negamax alpha-beta search.
   * Uses CSS for move generation and game-over detection.
   * At depth 0, skips expensive getLegalMoves and goes directly to quiescence.
   */
  async negamax(gameState, depth, alpha, beta) {
    if (this.isTimeUp()) return 0;

    if (gameState.halfmoveClock >= 100) return 0; // 50-move rule

    // At depth 0, go directly to quiescence (which handles checkmate detection)
    if (depth <= 0) {
      return await this.quiescence(gameState, alpha, beta);
    }

    // Get legal moves from CSS (only at depth > 0)
    const cssMoves = await this.evaluator.getLegalMoves(gameState);

    // Game-over detection via CSS
    if (cssMoves.length === 0) {
      const inCheck = await this.evaluator.isInCheck(gameState);
      return inCheck ? (-INF + 1) : 0; // checkmate vs stalemate
    }

    // Sort by CSS score
    const moves = cssMoves.slice().sort((a, b) => b.score - a.score);

    for (const move of moves) {
      const undo = gameState.applyMove(move);
      this.nodes++;

      const score = -(await this.negamax(gameState, depth - 1, -beta, -alpha));

      gameState.undoMove(undo);

      if (this.isTimeUp()) return 0;

      if (score >= beta) return beta;
      if (score > alpha) alpha = score;
    }

    return alpha;
  }

  /**
   * Quiescence search — only consider captures to avoid horizon effect.
   * Uses combined evaluateAndGetCaptures for efficiency (single Puppeteer call).
   */
  async quiescence(gameState, alpha, beta) {
    if (this.isTimeUp()) return 0;

    // Combined: check detection + eval + capture generation in one page.evaluate
    const { inCheck, eval: evalValue, captures } = await this.evaluator.evaluateAndGetCaptures(gameState);

    // If in check with no captures, might be checkmate — need full move list
    if (inCheck) {
      const allMoves = await this.evaluator.getLegalMoves(gameState);
      if (allMoves.length === 0) return -INF + 1; // checkmate

      // In check — search all evasions (check extension)
      for (const move of allMoves) {
        const undo = gameState.applyMove(move);
        this.nodes++;

        const score = -(await this.quiescence(gameState, -beta, -alpha));

        gameState.undoMove(undo);

        if (this.isTimeUp()) return 0;

        if (score >= beta) return beta;
        if (score > alpha) alpha = score;
      }
      return alpha;
    }

    // Stand-pat score (negate for black since CSS eval is from white's perspective)
    let standPat = evalValue;
    if (gameState.turn === 'b') standPat = -standPat;

    if (standPat >= beta) return beta;
    if (standPat > alpha) alpha = standPat;

    // Sort captures by score (MVV-LVA)
    const orderedCaptures = captures.slice().sort((a, b) => b.score - a.score);

    for (const move of orderedCaptures) {
      const undo = gameState.applyMove(move);
      this.nodes++;

      const score = -(await this.quiescence(gameState, -beta, -alpha));

      gameState.undoMove(undo);

      if (this.isTimeUp()) return 0;

      if (score >= beta) return beta;
      if (score > alpha) alpha = score;
    }

    return alpha;
  }

  isTimeUp() {
    if (this.aborted) return true;
    if (this.timeLimit <= 0) return false;
    if (Date.now() - this.startTime >= this.timeLimit) {
      this.aborted = true;
      return true;
    }
    return false;
  }

  sendInfo(depth, score, nodes) {
    const elapsed = Date.now() - this.startTime;
    const nps = elapsed > 0 ? Math.floor((nodes / elapsed) * 1000) : 0;
    process.stdout.write(`info depth ${depth} score cp ${score} nodes ${nodes} nps ${nps} time ${elapsed}\n`);
  }
}

module.exports = { Search };
