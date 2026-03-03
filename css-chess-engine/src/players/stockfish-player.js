'use strict';

const { spawn } = require('child_process');

class StockfishPlayer {
  constructor({ skill = 0, depth = 1, name } = {}) {
    this.skill = skill;
    this.depth = depth;
    this.name = name || `Stockfish-skill${skill}`;
    this.process = null;
  }

  async init() {
    this.process = spawn('stockfish', [], {
      stdio: ['pipe', 'pipe', 'ignore'],
    });

    this._buffer = '';
    this.process.stdout.setEncoding('utf8');

    await this._send('uci');
    await this._waitFor('uciok');

    await this._send(`setoption name Skill Level value ${this.skill}`);
    await this._send('isready');
    await this._waitFor('readyok');
  }

  async pickMove(chess) {
    await this._send('ucinewgame');
    await this._send(`position fen ${chess.fen()}`);
    await this._send(`go depth ${this.depth}`);

    const line = await this._waitFor('bestmove');
    const match = line.match(/^bestmove\s+(\S+)/);
    return match ? match[1] : null;
  }

  _send(cmd) {
    this.process.stdin.write(cmd + '\n');
  }

  _waitFor(prefix) {
    return new Promise((resolve) => {
      const check = () => {
        const lines = this._buffer.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].startsWith(prefix)) {
            this._buffer = lines.slice(i + 1).join('\n');
            resolve(lines[i]);
            return;
          }
        }
        this._buffer = lines.join('\n');
      };

      const onData = (data) => {
        this._buffer += data;
        const lines = this._buffer.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].startsWith(prefix)) {
            this.process.stdout.removeListener('data', onData);
            this._buffer = lines.slice(i + 1).join('\n');
            resolve(lines[i]);
            return;
          }
        }
      };

      // Check existing buffer first
      const lines = this._buffer.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith(prefix)) {
          this._buffer = lines.slice(i + 1).join('\n');
          resolve(lines[i]);
          return;
        }
      }

      this.process.stdout.on('data', onData);
    });
  }

  async close() {
    if (this.process) {
      this._send('quit');
      this.process.kill();
      this.process = null;
    }
  }
}

module.exports = { StockfishPlayer };
