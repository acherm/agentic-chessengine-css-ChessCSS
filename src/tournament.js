'use strict';

const { Chess } = require('chess.js');

const MAX_MOVES = 200;

/**
 * Check if the game is over.
 */
function isGameOver(chess) {
  return chess.isCheckmate() || chess.isDraw() || chess.isStalemate() ||
    chess.isThreefoldRepetition() || chess.isInsufficientMaterial();
}

/**
 * Determine the result string for a finished game.
 */
function getResult(chess) {
  if (chess.isCheckmate()) {
    // The side whose turn it is now lost (they are in checkmate)
    return chess.turn() === 'w' ? '0-1' : '1-0';
  }
  return '1/2-1/2';
}

/**
 * Run a tournament between two players.
 *
 * @param {object} player1 - First player { name, init(), pickMove(chess), close() }
 * @param {object} player2 - Second player
 * @param {object} options - { rounds, timePerMove, onGameComplete }
 * @returns {{ games: Array, stats: { p1Wins, p2Wins, draws } }}
 */
async function runTournament(player1, player2, options = {}) {
  const { rounds = 20 } = options;

  const games = [];
  const stats = { p1Wins: 0, p2Wins: 0, draws: 0 };

  for (let round = 0; round < rounds; round++) {
    // Alternate colors for fairness
    const p1IsWhite = round % 2 === 0;
    const white = p1IsWhite ? player1 : player2;
    const black = p1IsWhite ? player2 : player1;

    const chess = new Chess();
    let moveCount = 0;
    let result = null;

    while (moveCount < MAX_MOVES) {
      const currentPlayer = chess.turn() === 'w' ? white : black;
      const moveStart = Date.now();
      const move = await currentPlayer.pickMove(chess);
      const moveTime = Date.now() - moveStart;

      if (!move) {
        // No move returned — game must be over or player failed
        break;
      }

      const applied = chess.move(move, { sloppy: true });
      if (!applied) {
        // Invalid move — treat as loss for the player that made it
        result = currentPlayer === white ? '0-1' : '1-0';
        break;
      }

      moveCount++;

      // Progress callback per move
      if (options.onMove) {
        options.onMove({
          round: round + 1,
          rounds,
          moveCount,
          san: applied.san,
          uci: move,
          player: currentPlayer.name,
          color: applied.color === 'w' ? 'White' : 'Black',
          moveTimeMs: moveTime,
          fen: chess.fen(),
        });
      }

      // Check if game is over after the move
      if (isGameOver(chess)) {
        result = getResult(chess);
        break;
      }
    }

    // Max moves reached without result — adjudicate as draw
    if (!result) {
      result = '1/2-1/2';
    }

    // Update stats relative to player1
    if (result === '1-0') {
      if (p1IsWhite) stats.p1Wins++;
      else stats.p2Wins++;
    } else if (result === '0-1') {
      if (p1IsWhite) stats.p2Wins++;
      else stats.p1Wins++;
    } else {
      stats.draws++;
    }

    // Build PGN headers
    const headers = {
      Event: 'CSS Chess Tournament',
      Site: 'Local',
      Date: new Date().toISOString().split('T')[0].replace(/-/g, '.'),
      Round: String(round + 1),
      White: white.name,
      Black: black.name,
      Result: result,
    };

    games.push({
      chess,
      headers,
      result,
      round: round + 1,
      moveCount,
      white: white.name,
      black: black.name,
    });

    // Progress callback
    if (options.onGameComplete) {
      options.onGameComplete({
        round: round + 1,
        rounds,
        white: white.name,
        black: black.name,
        result,
        moveCount,
      });
    }
  }

  return { games, stats };
}

module.exports = { runTournament };
