'use strict';

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { gameHtml } = require('./board-renderer');
const { GameState } = require('./game-state');

const EVAL_CSS_PATH = path.resolve(__dirname, '..', 'css', 'eval.css');
const MOVEGEN_CSS_PATH = path.resolve(__dirname, '..', 'css', 'move-generation.css');
const CHECK_CSS_PATH = path.resolve(__dirname, '..', 'css', 'check-detection.css');
const LEGALITY_CSS_PATH = path.resolve(__dirname, '..', 'css', 'legality.css');
const MOVESCORING_CSS_PATH = path.resolve(__dirname, '..', 'css', 'dynamic-move-scoring.css');

// Cache CSS content at load time
const evalCssContent = fs.readFileSync(EVAL_CSS_PATH, 'utf8');
const movegenCssContent = fs.readFileSync(MOVEGEN_CSS_PATH, 'utf8');
const checkCssContent = fs.readFileSync(CHECK_CSS_PATH, 'utf8');
const legalityCssContent = fs.readFileSync(LEGALITY_CSS_PATH, 'utf8');
const moveScoringCssContent = fs.readFileSync(MOVESCORING_CSS_PATH, 'utf8');

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

class CssEvaluator {
  constructor() {
    this.browser = null;
    this.moveGenPage = null;
    this.moveGenReady = false;
    this._lastFen = null; // Position cache to skip redundant DOM updates
    this._lastMoveW = null; // { from, to } for white's last move
    this._lastMoveB = null; // { from, to } for black's last move
  }

  /**
   * Set each side's last move for reversal penalty detection.
   * @param {{ from: string, to: string }|null} lastMoveW - white's last move
   * @param {{ from: string, to: string }|null} lastMoveB - black's last move
   */
  setLastMoves(lastMoveW, lastMoveB) {
    this._lastMoveW = lastMoveW;
    this._lastMoveB = lastMoveB;
    this._lastFen = null; // Force DOM update on next call
  }

  async init() {
    this.browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    await this.initMoveGenPage();
  }

  /**
   * Initialize the single page with all CSS loaded: move-generation,
   * check-detection, evaluation, legality, and move scoring.
   * All candidate move elements are pre-allocated. We mutate data-p
   * attributes to update the position instead of rebuilding HTML.
   */
  async initMoveGenPage() {
    this.moveGenPage = await this.browser.newPage();

    const initialState = GameState.fromFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    const combinedCss = movegenCssContent + '\n' + checkCssContent + '\n'
      + evalCssContent + '\n' + legalityCssContent + '\n' + moveScoringCssContent;
    const html = gameHtml(initialState, combinedCss);

    await this.moveGenPage.setContent(html, { waitUntil: 'domcontentloaded' });
    this.moveGenReady = true;
    this._lastFen = initialState.toFen();
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  /**
   * Evaluate a position using CSS.
   * Returns the evaluation in centipawns from white's perspective.
   * @param {GameState} gameState
   */
  async evaluate(gameState) {
    await this._updateMoveGenPosition(gameState);

    return await this.moveGenPage.evaluate(() => {
      let sum = 0;
      for (const sq of document.querySelectorAll('#board .sq')) {
        sum += parseInt(getComputedStyle(sq).getPropertyValue('--piece-value').trim(), 10) || 0;
      }
      return sum;
    });
  }

  /**
   * Update the move-generation page DOM to match the given game state.
   * Skips the update if the position hasn't changed (position caching).
   */
  async _updateMoveGenPosition(gameState) {
    const fen = gameState.toFen();
    if (this._lastFen === fen) return;
    this._lastFen = fen;

    await this.moveGenPage.evaluate((state) => {
      const game = document.getElementById('game');
      game.setAttribute('data-t', state.turn);
      game.setAttribute('data-cwk', state.castleWK ? '1' : '0');
      game.setAttribute('data-cwq', state.castleWQ ? '1' : '0');
      game.setAttribute('data-cbk', state.castleBK ? '1' : '0');
      game.setAttribute('data-cbq', state.castleBQ ? '1' : '0');
      game.setAttribute('data-e', state.epSquare || 'none');

      // Set last-move attributes for reversal penalty
      if (state.lastMoveW) {
        game.setAttribute('data-lfw', state.lastMoveW.from);
        game.setAttribute('data-ltw', state.lastMoveW.to);
      } else {
        game.removeAttribute('data-lfw');
        game.removeAttribute('data-ltw');
      }
      if (state.lastMoveB) {
        game.setAttribute('data-lfb', state.lastMoveB.from);
        game.setAttribute('data-ltb', state.lastMoveB.to);
      } else {
        game.removeAttribute('data-lfb');
        game.removeAttribute('data-ltb');
      }

      const squares = document.querySelectorAll('.sq');
      for (const sqEl of squares) {
        const sq = sqEl.getAttribute('data-s');
        sqEl.setAttribute('data-p', state.board[sq] || 'empty');
      }
    }, {
      turn: gameState.turn,
      castleWK: gameState.castleWK,
      castleWQ: gameState.castleWQ,
      castleBK: gameState.castleBK,
      castleBQ: gameState.castleBQ,
      epSquare: gameState.epSquare,
      board: gameState.board,
      lastMoveW: this._lastMoveW,
      lastMoveB: this._lastMoveB,
    });
  }

  /**
   * Get the best legal move using CSS z-index argmax.
   * All ~4000 candidate moves are positioned at (0,0) with z-index proportional
   * to score. Illegal moves have visibility:hidden. elementFromPoint(0,0) returns
   * the topmost visible element — the highest-scored legal move — in O(1).
   *
   * @param {GameState} gameState
   * @returns {{ from: string, to: string, promotion: string, score: number } | null}
   */
  async getBestMove(gameState) {
    await this._updateMoveGenPosition(gameState);

    return await this.moveGenPage.evaluate(() => {
      const el = document.elementFromPoint(0, 0);
      if (!el || !el.classList.contains('move')) return null;

      const from = el.getAttribute('data-f');
      const to = el.getAttribute('data-d');
      const promotion = el.getAttribute('data-pr') || '';
      const score = parseInt(getComputedStyle(el).order, 10) || 0;

      return { from, to, promotion, score };
    });
  }

  /**
   * Get all legal moves for the given game state.
   *
   * CSS generates pseudo-legal moves (--pseudo-legal: 1) and marks illegal
   * ones (--illegal: 1) via legality.css. CSS also scores moves via
   * dynamic-move-scoring.css (order property = MVV-LVA score).
   *
   * One page.evaluate call reads everything. No DOM mutations during selection.
   * No JS chess knowledge needed.
   *
   * @param {GameState} gameState
   * @returns {Array<{from, to, promotion?, castle?, ep?, captured?, capturedType?, piece?, pieceType?, score}>}
   */
  async getLegalMoves(gameState) {
    await this._updateMoveGenPosition(gameState);

    return await this.moveGenPage.evaluate(() => {
      const board = document.getElementById('board');
      const candidates = document.querySelectorAll('#candidates .move');
      const moves = [];

      for (const el of candidates) {
        const style = getComputedStyle(el);
        if (style.getPropertyValue('--pseudo-legal').trim() !== '1') continue;
        if (style.getPropertyValue('--illegal').trim() === '1') continue;

        const from = el.getAttribute('data-f');
        const to = el.getAttribute('data-d');
        const fromEl = board.querySelector(`.sq[data-s="${from}"]`);
        const toEl = board.querySelector(`.sq[data-s="${to}"]`);

        const move = { from, to };
        const promo = el.getAttribute('data-pr');
        const castle = el.getAttribute('data-c');
        const ep = el.getAttribute('data-e');
        if (promo) move.promotion = promo;
        if (castle) move.castle = castle;
        if (ep === 'true') move.ep = true;

        // Read CSS-computed MVV-LVA score
        move.score = parseInt(style.order, 10) || 0;

        // Enrich with piece info for GameState.applyMove
        move.piece = fromEl.getAttribute('data-p');
        move.pieceType = move.piece[1].toLowerCase();
        const toPiece = toEl.getAttribute('data-p');
        if (toPiece !== 'empty') {
          move.captured = toPiece;
          move.capturedType = toPiece[1].toLowerCase();
        }
        if (move.ep) {
          const turn = document.getElementById('game').getAttribute('data-t');
          move.captured = (turn === 'w' ? 'bP' : 'wP');
          move.capturedType = 'p';
        }

        moves.push(move);
      }
      return moves;
    });
  }

  /**
   * Check if the side to move is in check.
   * @param {GameState} gameState
   * @returns {boolean}
   */
  async isInCheck(gameState) {
    await this._updateMoveGenPosition(gameState);

    const checkVar = gameState.turn === 'w' ? '--wk-in-check' : '--bk-in-check';
    const inCheck = await this.moveGenPage.evaluate((varName) => {
      const board = document.getElementById('board');
      return getComputedStyle(board).getPropertyValue(varName).trim() === '1';
    }, checkVar);

    return inCheck;
  }
}

module.exports = { CssEvaluator };
