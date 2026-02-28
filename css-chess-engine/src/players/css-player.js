'use strict';

const { CssEvaluator } = require('../css-evaluator');
const { Search } = require('../search');

class CssPlayer {
  constructor({ depth = 2, name } = {}) {
    this.depth = depth;
    this.name = name || `CSSEngine-d${depth}`;
    this.evaluator = null;
    this.search = null;
  }

  async init() {
    this.evaluator = new CssEvaluator();
    await this.evaluator.init();
    this.search = new Search(this.evaluator);
    // Suppress UCI info output during tournament play
    this.search.sendInfo = () => {};
  }

  async pickMove(chess) {
    const result = await this.search.findBestMove(chess.fen(), { depth: this.depth });
    if (!result.bestMove) return null;
    // bestMove is already in UCI format (from search.js)
    return result.bestMove;
  }

  async close() {
    if (this.evaluator) {
      await this.evaluator.close();
    }
  }
}

module.exports = { CssPlayer };
