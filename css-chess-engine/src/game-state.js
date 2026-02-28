'use strict';

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

class GameState {
  constructor() {
    this.board = {};    // { a1: 'wR', a2: 'wP', ..., h8: 'bR' } or 'empty'
    this.turn = 'w';
    this.castleWK = true;
    this.castleWQ = true;
    this.castleBK = true;
    this.castleBQ = true;
    this.epSquare = null; // e.g. 'e3' or null
    this.halfmoveClock = 0;
    this.fullmoveNumber = 1;
  }

  static fromFen(fen) {
    const gs = new GameState();
    const parts = fen.split(' ');
    const rows = parts[0].split('/');

    // Parse board
    for (let rankIdx = 0; rankIdx < 8; rankIdx++) {
      const rank = 8 - rankIdx;
      let fileIdx = 0;
      for (const ch of rows[rankIdx]) {
        if (ch >= '1' && ch <= '8') {
          for (let i = 0; i < parseInt(ch); i++) {
            const sq = FILES[fileIdx] + rank;
            gs.board[sq] = 'empty';
            fileIdx++;
          }
        } else {
          const sq = FILES[fileIdx] + rank;
          const color = ch === ch.toUpperCase() ? 'w' : 'b';
          const piece = ch.toUpperCase();
          gs.board[sq] = color + piece;
          fileIdx++;
        }
      }
    }

    // Turn
    gs.turn = parts[1] || 'w';

    // Castling
    const castling = parts[2] || '-';
    gs.castleWK = castling.includes('K');
    gs.castleWQ = castling.includes('Q');
    gs.castleBK = castling.includes('k');
    gs.castleBQ = castling.includes('q');

    // En passant
    gs.epSquare = (parts[3] && parts[3] !== '-') ? parts[3] : null;

    // Clocks
    gs.halfmoveClock = parseInt(parts[4]) || 0;
    gs.fullmoveNumber = parseInt(parts[5]) || 1;

    return gs;
  }

  clone() {
    const gs = new GameState();
    gs.board = Object.assign({}, this.board);
    gs.turn = this.turn;
    gs.castleWK = this.castleWK;
    gs.castleWQ = this.castleWQ;
    gs.castleBK = this.castleBK;
    gs.castleBQ = this.castleBQ;
    gs.epSquare = this.epSquare;
    gs.halfmoveClock = this.halfmoveClock;
    gs.fullmoveNumber = this.fullmoveNumber;
    return gs;
  }

  /**
   * Apply a move and return undo info.
   * Move: { from, to, promotion?, castle?, ep? }
   */
  applyMove(move) {
    const undo = {
      from: move.from,
      to: move.to,
      fromPiece: this.board[move.from],
      toPiece: this.board[move.to],
      turn: this.turn,
      castleWK: this.castleWK,
      castleWQ: this.castleWQ,
      castleBK: this.castleBK,
      castleBQ: this.castleBQ,
      epSquare: this.epSquare,
      halfmoveClock: this.halfmoveClock,
      fullmoveNumber: this.fullmoveNumber,
      extraChanges: [], // for castling rook, ep capture
    };

    const movingPiece = this.board[move.from];
    const pieceType = movingPiece[1]; // 'P', 'N', 'B', 'R', 'Q', 'K'
    const color = movingPiece[0];     // 'w' or 'b'
    const captured = this.board[move.to] !== 'empty';

    // Handle en passant capture
    if (move.ep) {
      // The captured pawn is on the same file as 'to', but on the rank of 'from'
      const epCapturedSq = move.to[0] + move.from[1];
      undo.extraChanges.push({ sq: epCapturedSq, was: this.board[epCapturedSq] });
      this.board[epCapturedSq] = 'empty';
    }

    // Handle castling rook movement
    if (move.castle) {
      let rookFrom, rookTo;
      if (move.castle === 'wk') { rookFrom = 'h1'; rookTo = 'f1'; }
      else if (move.castle === 'wq') { rookFrom = 'a1'; rookTo = 'd1'; }
      else if (move.castle === 'bk') { rookFrom = 'h8'; rookTo = 'f8'; }
      else if (move.castle === 'bq') { rookFrom = 'a8'; rookTo = 'd8'; }
      undo.extraChanges.push(
        { sq: rookFrom, was: this.board[rookFrom] },
        { sq: rookTo, was: this.board[rookTo] }
      );
      this.board[rookTo] = this.board[rookFrom];
      this.board[rookFrom] = 'empty';
    }

    // Move the piece
    if (move.promotion) {
      this.board[move.to] = color + move.promotion.toUpperCase();
    } else {
      this.board[move.to] = movingPiece;
    }
    this.board[move.from] = 'empty';

    // Update castling rights
    if (pieceType === 'K') {
      if (color === 'w') { this.castleWK = false; this.castleWQ = false; }
      else { this.castleBK = false; this.castleBQ = false; }
    }
    if (pieceType === 'R') {
      if (move.from === 'a1') this.castleWQ = false;
      if (move.from === 'h1') this.castleWK = false;
      if (move.from === 'a8') this.castleBQ = false;
      if (move.from === 'h8') this.castleBK = false;
    }
    // If a rook is captured on its starting square
    if (move.to === 'a1') this.castleWQ = false;
    if (move.to === 'h1') this.castleWK = false;
    if (move.to === 'a8') this.castleBQ = false;
    if (move.to === 'h8') this.castleBK = false;

    // Update en passant square
    if (pieceType === 'P' && Math.abs(parseInt(move.to[1]) - parseInt(move.from[1])) === 2) {
      const epRank = color === 'w' ? '3' : '6';
      this.epSquare = move.from[0] + epRank;
    } else {
      this.epSquare = null;
    }

    // Update clocks
    if (pieceType === 'P' || captured || move.ep) {
      this.halfmoveClock = 0;
    } else {
      this.halfmoveClock++;
    }
    if (color === 'b') this.fullmoveNumber++;

    // Switch turn
    this.turn = color === 'w' ? 'b' : 'w';

    return undo;
  }

  undoMove(undo) {
    this.board[undo.from] = undo.fromPiece;
    this.board[undo.to] = undo.toPiece;
    this.turn = undo.turn;
    this.castleWK = undo.castleWK;
    this.castleWQ = undo.castleWQ;
    this.castleBK = undo.castleBK;
    this.castleBQ = undo.castleBQ;
    this.epSquare = undo.epSquare;
    this.halfmoveClock = undo.halfmoveClock;
    this.fullmoveNumber = undo.fullmoveNumber;

    // Undo extra changes (castling rook, ep capture) in reverse
    for (let i = undo.extraChanges.length - 1; i >= 0; i--) {
      const { sq, was } = undo.extraChanges[i];
      this.board[sq] = was;
    }
  }

  toFen() {
    let fen = '';
    for (let rank = 8; rank >= 1; rank--) {
      let empty = 0;
      for (let fileIdx = 0; fileIdx < 8; fileIdx++) {
        const sq = FILES[fileIdx] + rank;
        const piece = this.board[sq];
        if (piece === 'empty') {
          empty++;
        } else {
          if (empty > 0) { fen += empty; empty = 0; }
          const color = piece[0];
          const type = piece[1];
          fen += color === 'w' ? type : type.toLowerCase();
        }
      }
      if (empty > 0) fen += empty;
      if (rank > 1) fen += '/';
    }

    fen += ' ' + this.turn;

    let castling = '';
    if (this.castleWK) castling += 'K';
    if (this.castleWQ) castling += 'Q';
    if (this.castleBK) castling += 'k';
    if (this.castleBQ) castling += 'q';
    fen += ' ' + (castling || '-');

    fen += ' ' + (this.epSquare || '-');
    fen += ' ' + this.halfmoveClock;
    fen += ' ' + this.fullmoveNumber;

    return fen;
  }

  findKing(color) {
    const king = color + 'K';
    for (const sq of Object.keys(this.board)) {
      if (this.board[sq] === king) return sq;
    }
    return null;
  }
}

module.exports = { GameState };
