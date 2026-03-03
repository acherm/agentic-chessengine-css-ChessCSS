#!/bin/bash
# Elo testing script using cutechess-cli
# Runs CSS Chess Engine against a random mover and optionally against Stockfish at low skill

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENGINE_DIR="$(dirname "$SCRIPT_DIR")"
ENGINE_CMD="node $ENGINE_DIR/src/driver.js"

# Check for cutechess-cli
if ! command -v cutechess-cli &> /dev/null; then
    echo "cutechess-cli not found. Install it first:"
    echo "  brew install cutechess  (macOS)"
    echo "  apt install cutechess   (Linux)"
    exit 1
fi

echo "=== CSS Chess Engine Elo Testing ==="
echo ""

# Create a simple random mover engine script
RANDOM_ENGINE="$ENGINE_DIR/scripts/random-engine.js"
cat > "$RANDOM_ENGINE" << 'ENDSCRIPT'
#!/usr/bin/env node
'use strict';
const { Chess } = require('chess.js');
const readline = require('readline');

const rl = readline.createInterface({ input: process.stdin, terminal: false });
let chess = new Chess();

rl.on('line', (line) => {
  const parts = line.trim().split(/\s+/);
  const cmd = parts[0];

  switch (cmd) {
    case 'uci':
      process.stdout.write('id name RandomMover\nid author Random\nuciok\n');
      break;
    case 'isready':
      process.stdout.write('readyok\n');
      break;
    case 'ucinewgame':
      chess = new Chess();
      break;
    case 'position': {
      let fen;
      if (parts[1] === 'startpos') {
        fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
      } else if (parts[1] === 'fen') {
        const fenParts = [];
        let i = 2;
        while (i < parts.length && parts[i] !== 'moves') { fenParts.push(parts[i]); i++; }
        fen = fenParts.join(' ');
      }
      chess = new Chess(fen);
      const movesIdx = parts.indexOf('moves');
      if (movesIdx >= 0) {
        for (let i = movesIdx + 1; i < parts.length; i++) {
          chess.move(parts[i], { sloppy: true });
        }
      }
      break;
    }
    case 'go': {
      const moves = chess.moves({ verbose: true });
      if (moves.length > 0) {
        const m = moves[Math.floor(Math.random() * moves.length)];
        let uci = m.from + m.to;
        if (m.promotion) uci += m.promotion;
        process.stdout.write(`bestmove ${uci}\n`);
      } else {
        process.stdout.write('bestmove 0000\n');
      }
      break;
    }
    case 'quit':
      process.exit(0);
      break;
  }
});
ENDSCRIPT

echo "--- Test 1: CSS Engine vs Random Mover (50 games) ---"
cutechess-cli \
  -engine name="CSSEngine" cmd="node" arg="$ENGINE_DIR/src/driver.js" proto=uci \
  -engine name="Random" cmd="node" arg="$RANDOM_ENGINE" proto=uci \
  -each tc=60+1 \
  -rounds 50 \
  -pgnout "$ENGINE_DIR/results-vs-random.pgn" \
  -recover \
  -repeat \
  2>&1 | tee "$ENGINE_DIR/results-vs-random.txt"

echo ""
echo "Results saved to $ENGINE_DIR/results-vs-random.txt"
echo "PGN saved to $ENGINE_DIR/results-vs-random.pgn"

# Optional: test against fairy-stockfish if available
if command -v fairy-stockfish &> /dev/null; then
    echo ""
    echo "--- Test 2: CSS Engine vs Fairy-Stockfish Skill 0 (50 games) ---"
    cutechess-cli \
      -engine name="CSSEngine" cmd="node" arg="$ENGINE_DIR/src/driver.js" proto=uci \
      -engine name="FairyStockfish" cmd="fairy-stockfish" proto=uci option.Skill\ Level=0 \
      -each tc=60+1 \
      -rounds 50 \
      -pgnout "$ENGINE_DIR/results-vs-sf.pgn" \
      -recover \
      -repeat \
      2>&1 | tee "$ENGINE_DIR/results-vs-sf.txt"

    echo ""
    echo "Results saved to $ENGINE_DIR/results-vs-sf.txt"
fi

echo ""
echo "=== Testing complete ==="
