#!/usr/bin/env node
'use strict';

const { Chess } = require('chess.js');
const { UciProtocol } = require('./uci');
const { CssEvaluator } = require('./css-evaluator');
const { Search } = require('./search');

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

    // Extract each side's last move for reversal penalty
    const history = chess.history({ verbose: true });
    let lastMoveW = null;
    let lastMoveB = null;
    for (let i = history.length - 1; i >= 0; i--) {
      const m = history[i];
      if (!lastMoveW && m.color === 'w') lastMoveW = { from: m.from, to: m.to };
      if (!lastMoveB && m.color === 'b') lastMoveB = { from: m.from, to: m.to };
      if (lastMoveW && lastMoveB) break;
    }
    evaluator.setLastMoves(lastMoveW, lastMoveB);
  });

  uci.on('go', async (options) => {
    if (!initialized) {
      await evaluator.init();
      search = new Search(evaluator);
      initialized = true;
    }

    // Greedy search: depth is always 1, no time management needed
    const result = await search.findBestMove(chess.fen(), { depth: 1 });

    if (result.bestMove) {
      uci.sendBestMove(result.bestMove);
    } else {
      uci.sendBestMove('0000');
    }
  });

  uci.on('stop', () => {
    // No-op: greedy search completes in one pass
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
