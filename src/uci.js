'use strict';

const readline = require('readline');

class UciProtocol {
  constructor() {
    this.handlers = {};
    this.rl = null;
    this._queue = [];
    this._processing = false;
  }

  on(event, handler) {
    this.handlers[event] = handler;
  }

  start() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });

    this.rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      this._queue.push(trimmed);
      this._processQueue();
    });

    this.rl.on('close', () => {
      // Don't quit immediately — let queued commands finish first.
      // The 'quit' command in the queue will trigger the actual exit.
      // If there's no 'quit' in the queue, exit after processing completes.
      this._queue.push('quit');
      this._processQueue();
    });
  }

  async _processQueue() {
    if (this._processing) return;
    this._processing = true;

    while (this._queue.length > 0) {
      const line = this._queue.shift();
      await this._handleCommand(line);
    }

    this._processing = false;
  }

  async _handleCommand(line) {
    const parts = line.split(/\s+/);
    const cmd = parts[0];

    switch (cmd) {
      case 'uci':
        this.send('id name CSSChessEngine');
        this.send('id author CSS');
        this.send('uciok');
        break;

      case 'isready':
        if (this.handlers.isready) {
          await new Promise(resolve => {
            this.handlers.isready(() => {
              this.send('readyok');
              resolve();
            });
          });
        } else {
          this.send('readyok');
        }
        break;

      case 'ucinewgame':
        if (this.handlers.ucinewgame) this.handlers.ucinewgame();
        break;

      case 'position':
        this._handlePosition(parts.slice(1));
        break;

      case 'go':
        await this._handleGo(parts.slice(1));
        break;

      case 'quit':
        if (this.handlers.quit) this.handlers.quit();
        break;

      case 'stop':
        if (this.handlers.stop) this.handlers.stop();
        break;

      default:
        break;
    }
  }

  _handlePosition(args) {
    if (!this.handlers.position) return;

    let fen;
    let movesStart = -1;

    if (args[0] === 'startpos') {
      fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
      movesStart = args.indexOf('moves');
    } else if (args[0] === 'fen') {
      const fenParts = [];
      let i = 1;
      while (i < args.length && args[i] !== 'moves') {
        fenParts.push(args[i]);
        i++;
      }
      fen = fenParts.join(' ');
      movesStart = args.indexOf('moves');
    }

    const moves = movesStart >= 0 ? args.slice(movesStart + 1) : [];

    this.handlers.position(fen, moves);
  }

  async _handleGo(args) {
    if (!this.handlers.go) return;

    const options = {};

    for (let i = 0; i < args.length; i++) {
      switch (args[i]) {
        case 'depth':
          options.depth = parseInt(args[++i], 10);
          break;
        case 'movetime':
          options.movetime = parseInt(args[++i], 10);
          break;
        case 'wtime':
          options.wtime = parseInt(args[++i], 10);
          break;
        case 'btime':
          options.btime = parseInt(args[++i], 10);
          break;
        case 'winc':
          options.winc = parseInt(args[++i], 10);
          break;
        case 'binc':
          options.binc = parseInt(args[++i], 10);
          break;
        case 'movestogo':
          options.movestogo = parseInt(args[++i], 10);
          break;
        case 'infinite':
          options.infinite = true;
          break;
      }
    }

    await this.handlers.go(options);
  }

  send(msg) {
    process.stdout.write(msg + '\n');
  }

  sendBestMove(move) {
    this.send(`bestmove ${move}`);
  }
}

module.exports = { UciProtocol };
