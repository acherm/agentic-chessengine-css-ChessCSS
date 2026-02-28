'use strict';

const { Chess } = require('chess.js');
const { GameState } = require('./game-state');
const { orderMovesSimple } = require('./move-orderer');

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
   * Uses CSS for move generation at root and interior nodes.
   * Uses chess.js for make/unmake moves (Phase A hybrid).
   * @param {Chess} chess - chess.js instance with current position
   * @param {object} options - { depth, movetime }
   * @returns {{ bestMove: string|null, score: number, nodes: number, depth: number }}
   */
  async findBestMove(chess, options = {}) {
    const depth = options.depth || 2;
    const movetime = options.movetime || 0;

    this.nodes = 0;
    this.startTime = Date.now();
    this.timeLimit = movetime;
    this.aborted = false;

    // Get legal moves from CSS
    const gameState = GameState.fromFen(chess.fen());
    const cssMoves = await this.evaluator.getLegalMoves(gameState);

    if (cssMoves.length === 0) return { bestMove: null, score: 0, nodes: 0, depth: 0 };
    if (cssMoves.length === 1) {
      const uci = cssMoves[0].from + cssMoves[0].to + (cssMoves[0].promotion || '');
      return { bestMove: uci, score: 0, nodes: 1, depth: 1 };
    }

    // Convert CSS moves to chess.js verbose moves for move ordering
    const chessJsMoves = chess.moves({ verbose: true });
    const cssMoveKeys = new Set(cssMoves.map(m =>
      m.from + m.to + (m.promotion || '') + (m.castle || '') + (m.ep ? 'ep' : '')
    ));

    // Map CSS moves to chess.js move objects for scoring and make/unmake
    const matchedMoves = [];
    for (const cssMove of cssMoves) {
      const match = chessJsMoves.find(m => {
        if (m.from !== cssMove.from || m.to !== cssMove.to) return false;
        if (cssMove.promotion && m.promotion !== cssMove.promotion) return false;
        if (!cssMove.promotion && m.promotion) return false;
        return true;
      });
      if (match) {
        matchedMoves.push({ css: cssMove, chessJs: match });
      }
    }

    if (matchedMoves.length === 0) {
      // Fallback to chess.js moves if CSS matching fails
      const moves = chess.moves({ verbose: true });
      if (moves.length === 0) return { bestMove: null, score: 0, nodes: 0, depth: 0 };
      return { bestMove: moves[0].san, score: 0, nodes: 1, depth: 1 };
    }

    // Use CSS move scoring for root move ordering
    let orderedMoves;
    try {
      const scored = await this.evaluator.scoreMoves(matchedMoves.map(m => m.chessJs));
      orderedMoves = scored.map(s => s.move);
    } catch {
      orderedMoves = orderMovesSimple(matchedMoves.map(m => m.chessJs));
    }

    let bestMove = orderedMoves[0];
    let bestScore = -INF;
    let completedDepth = 0;

    // Iterative deepening
    for (let d = 1; d <= depth; d++) {
      let currentBest = orderedMoves[0];
      let currentScore = -INF;

      for (const move of orderedMoves) {
        if (this.isTimeUp()) break;

        chess.move(move.san);
        this.nodes++;

        const score = -(await this.negamax(chess, d - 1, -INF, -currentScore));

        chess.undo();

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
      }
    }

    // Convert SAN to UCI
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
   * Uses CSS for move generation at interior nodes.
   * Returns score from the perspective of the side to move.
   */
  async negamax(chess, depth, alpha, beta) {
    if (this.isTimeUp()) return 0;

    // Terminal node checks
    if (chess.isCheckmate()) return -INF + 1;
    if (chess.isDraw() || chess.isStalemate() || chess.isThreefoldRepetition() || chess.isInsufficientMaterial()) return 0;

    if (depth <= 0) {
      return await this.quiescence(chess, alpha, beta);
    }

    // Get legal moves from CSS
    const gameState = GameState.fromFen(chess.fen());
    const cssMoves = await this.evaluator.getLegalMoves(gameState);

    // Map CSS moves to chess.js moves for make/unmake
    const chessJsMoves = chess.moves({ verbose: true });
    const mappedMoves = [];
    for (const cssMove of cssMoves) {
      const match = chessJsMoves.find(m => {
        if (m.from !== cssMove.from || m.to !== cssMove.to) return false;
        if (cssMove.promotion && m.promotion !== cssMove.promotion) return false;
        if (!cssMove.promotion && m.promotion) return false;
        return true;
      });
      if (match) mappedMoves.push(match);
    }

    const moves = orderMovesSimple(mappedMoves);

    for (const move of moves) {
      chess.move(move.san);
      this.nodes++;

      const score = -(await this.negamax(chess, depth - 1, -beta, -alpha));

      chess.undo();

      if (this.isTimeUp()) return 0;

      if (score >= beta) return beta;
      if (score > alpha) alpha = score;
    }

    return alpha;
  }

  /**
   * Quiescence search — only consider captures to avoid horizon effect.
   */
  async quiescence(chess, alpha, beta) {
    if (this.isTimeUp()) return 0;

    // Stand-pat score from CSS evaluation
    const fen = chess.fen();
    let standPat = await this.evaluator.evaluate(fen);

    // Negate if black to move (CSS eval is from white's perspective)
    if (chess.turn() === 'b') standPat = -standPat;

    if (standPat >= beta) return beta;
    if (standPat > alpha) alpha = standPat;

    // Only consider captures — use chess.js here for speed in quiescence
    const captures = chess.moves({ verbose: true }).filter(m => m.captured);
    const orderedCaptures = orderMovesSimple(captures);

    for (const move of orderedCaptures) {
      chess.move(move.san);
      this.nodes++;

      const score = -(await this.quiescence(chess, -beta, -alpha));

      chess.undo();

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
