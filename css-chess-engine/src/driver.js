#!/usr/bin/env node
'use strict';

const { Chess } = require('chess.js');
const { UciProtocol } = require('./uci');
const { CssEvaluator } = require('./css-evaluator');
const { Search } = require('./search');

const DEFAULT_DEPTH = 2;

async function main() {
  const uci = new UciProtocol();
  const evaluator = new CssEvaluator();
  let chess = new Chess();
  let search = null;
  let initialized = false;

  uci.on('isready', async (respond) => {
    if (!initialized) {
      await evaluator.init();
      search = new Search(evaluator);
      initialized = true;
    }
    respond();
  });

  uci.on('ucinewgame', () => {
    chess = new Chess();
  });

  uci.on('position', (fen, moves) => {
    chess = new Chess(fen);
    for (const moveStr of moves) {
      chess.move(moveStr, { sloppy: true });
    }
  });

  uci.on('go', async (options) => {
    if (!initialized) {
      await evaluator.init();
      search = new Search(evaluator);
      initialized = true;
    }

    // Calculate time management
    let depth = options.depth || DEFAULT_DEPTH;
    let movetime = options.movetime || 0;

    if (!options.depth && !options.movetime && !options.infinite) {
      const isWhite = chess.turn() === 'w';
      const timeLeft = isWhite ? (options.wtime || 60000) : (options.btime || 60000);
      const increment = isWhite ? (options.winc || 0) : (options.binc || 0);
      const movestogo = options.movestogo || 30;

      movetime = Math.min(
        Math.floor(timeLeft / movestogo + increment * 0.8),
        Math.floor(timeLeft * 0.5)
      );
      movetime = Math.max(movetime, 100);
      depth = 10;
    }

    if (options.infinite) {
      depth = options.depth || 4;
      movetime = 0;
    }

    const result = await search.findBestMove(chess.fen(), { depth, movetime });

    if (result.bestMove) {
      // bestMove is already in UCI format (from search.js)
      uci.sendBestMove(result.bestMove);
    } else {
      uci.sendBestMove('0000');
    }
  });

  uci.on('stop', () => {
    if (search) search.aborted = true;
  });

  uci.on('quit', async () => {
    await evaluator.close();
    process.exit(0);
  });

  uci.start();
}

main().catch(err => {
  process.stderr.write(`Fatal error: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
