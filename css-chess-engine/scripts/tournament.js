#!/usr/bin/env node
'use strict';

const path = require('path');
const fs = require('fs');
const { runTournament } = require('../src/tournament');
const { CssPlayer } = require('../src/players/css-player');
const { RandomPlayer } = require('../src/players/random-player');
const { StockfishPlayer } = require('../src/players/stockfish-player');
const { writeGames } = require('../src/pgn-writer');
const { estimateElo } = require('../src/elo');

function parseArgs(args) {
  const opts = {
    rounds: 20,
    depth: 2,
    opponent: 'random',
    pgn: null,
    timePerMove: 5000,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--rounds':
        opts.rounds = parseInt(args[++i], 10);
        break;
      case '--depth':
        opts.depth = parseInt(args[++i], 10);
        break;
      case '--opponent':
        opts.opponent = args[++i];
        break;
      case '--pgn':
        opts.pgn = args[++i];
        break;
      case '--time-per-move':
        opts.timePerMove = parseInt(args[++i], 10);
        break;
      case '--help':
        console.log(`Usage: node scripts/tournament.js [options]

Options:
  --rounds N        Number of games (default: 20)
  --depth N         CSS engine search depth (default: 2)
  --opponent TYPE   "random", "css-depth-N", or "stockfish-skillN" (default: random)
  --pgn FILE        PGN output path (default: tournaments/<date>-tournament.pgn)
  --time-per-move M Max ms per move (default: 5000)`);
        process.exit(0);
    }
  }

  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  const date = new Date().toISOString().split('T')[0];
  const pgnPath = opts.pgn || path.join('tournaments', `${date}-tournament.pgn`);

  // Ensure output directory exists
  const pgnDir = path.dirname(pgnPath);
  if (!fs.existsSync(pgnDir)) {
    fs.mkdirSync(pgnDir, { recursive: true });
  }

  const allGames = [];
  const players = [];

  // Create main CSS engine
  const cssEngine = new CssPlayer({ depth: opts.depth, name: `CSSEngine-d${opts.depth}` });
  players.push(cssEngine);

  // Create opponent
  let opponent;
  if (opts.opponent === 'random') {
    opponent = new RandomPlayer();
  } else if (opts.opponent.startsWith('css-depth-')) {
    const oppDepth = parseInt(opts.opponent.replace('css-depth-', ''), 10);
    opponent = new CssPlayer({ depth: oppDepth, name: `CSSEngine-d${oppDepth}` });
  } else if (opts.opponent.startsWith('stockfish')) {
    const skillMatch = opts.opponent.match(/stockfish-skill(\d+)/);
    const skill = skillMatch ? parseInt(skillMatch[1], 10) : 0;
    opponent = new StockfishPlayer({ skill, depth: 1 });
  } else {
    console.error(`Unknown opponent type: ${opts.opponent}`);
    console.error('Valid options: "random", "css-depth-N", or "stockfish-skillN"');
    process.exit(1);
  }
  players.push(opponent);

  // Initialize all players
  console.log('Initializing players...');
  for (const p of players) {
    await p.init();
  }
  console.log('Players ready.\n');

  // Run tournament
  console.log(`=== ${cssEngine.name} vs ${opponent.name} (${opts.rounds} rounds) ===\n`);

  const gameStartTimes = {};

  const { games, stats } = await runTournament(cssEngine, opponent, {
    rounds: opts.rounds,
    timePerMove: opts.timePerMove,
    onMove: ({ round, rounds, moveCount, san, player, color, moveTimeMs }) => {
      if (moveCount === 1) {
        gameStartTimes[round] = Date.now();
        console.log(`\n--- Game ${round}/${rounds} ---`);
      }
      const elapsed = ((Date.now() - gameStartTimes[round]) / 1000).toFixed(1);
      const moveNum = Math.ceil(moveCount / 2);
      const side = color === 'White' ? `${moveNum}.` : `${moveNum}...`;
      const timeStr = moveTimeMs < 1000
        ? `${moveTimeMs}ms`
        : `${(moveTimeMs / 1000).toFixed(1)}s`;
      process.stdout.write(`  ${side} ${san} (${player}, ${timeStr}, game ${elapsed}s)\n`);
    },
    onGameComplete: ({ round, rounds, white, black, result, moveCount }) => {
      const elapsed = gameStartTimes[round]
        ? ((Date.now() - gameStartTimes[round]) / 1000).toFixed(1)
        : '?';
      console.log(`  => ${result} in ${moveCount} moves (${elapsed}s)\n`);
    },
  });

  allGames.push(...games);

  // Print results
  const total = stats.p1Wins + stats.p2Wins + stats.draws;
  const scorePercent = total > 0
    ? Math.round((stats.p1Wins + stats.draws * 0.5) / total * 100)
    : 0;
  const elo = estimateElo(stats.p1Wins, stats.p2Wins, stats.draws);

  console.log(`\n=== Results: ${cssEngine.name} vs ${opponent.name} ===`);
  console.log(`+${stats.p1Wins} =${stats.draws} -${stats.p2Wins}  (${scorePercent}%)  Elo: ${elo.display}`);

  // Write PGN
  writeGames(allGames, pgnPath);
  console.log(`\nPGN saved to ${pgnPath}`);

  // Cleanup
  for (const p of players) {
    await p.close();
  }
}

main().catch(err => {
  console.error(`Fatal error: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
