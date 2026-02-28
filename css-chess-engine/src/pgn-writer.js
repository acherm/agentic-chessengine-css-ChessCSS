'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Format a single game as PGN string.
 * Sets headers on the chess instance, then returns chess.pgn().
 */
function formatGame(chess, headers) {
  const headerArgs = [];
  for (const [key, value] of Object.entries(headers)) {
    headerArgs.push(key, value);
  }
  chess.header(...headerArgs);
  return chess.pgn();
}

/**
 * Write multiple games to a PGN file.
 * Each game is separated by double blank lines (standard PGN format).
 */
function writeGames(games, outputPath) {
  // Ensure output directory exists
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const pgnStrings = games.map(g => formatGame(g.chess, g.headers));
  const content = pgnStrings.join('\n\n\n');
  fs.writeFileSync(outputPath, content + '\n', 'utf8');
}

module.exports = { formatGame, writeGames };
