'use strict';

class RandomPlayer {
  constructor({ name } = {}) {
    this.name = name || 'Random';
  }

  async init() {}

  async pickMove(chess) {
    const moves = chess.moves({ verbose: true });
    if (moves.length === 0) return null;

    const move = moves[Math.floor(Math.random() * moves.length)];
    let uci = move.from + move.to;
    if (move.promotion) uci += move.promotion;
    return uci;
  }

  async close() {}
}

module.exports = { RandomPlayer };
