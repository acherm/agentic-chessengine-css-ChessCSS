'use strict';

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { fenToHtml, movesToHtml, gameHtml } = require('./board-renderer');
const { GameState } = require('./game-state');

const EVAL_CSS_PATH = path.resolve(__dirname, '..', 'css', 'eval.css');
const MOVE_CSS_PATH = path.resolve(__dirname, '..', 'css', 'move-scoring.css');
const MOVEGEN_CSS_PATH = path.resolve(__dirname, '..', 'css', 'move-generation.css');
const CHECK_CSS_PATH = path.resolve(__dirname, '..', 'css', 'check-detection.css');

// Cache CSS content at load time
const evalCssContent = fs.readFileSync(EVAL_CSS_PATH, 'utf8');
const moveCssContent = fs.readFileSync(MOVE_CSS_PATH, 'utf8');
const movegenCssContent = fs.readFileSync(MOVEGEN_CSS_PATH, 'utf8');
const checkCssContent = fs.readFileSync(CHECK_CSS_PATH, 'utf8');

class CssEvaluator {
  constructor() {
    this.browser = null;
    this.evalPage = null;
    this.movePage = null;
    this.moveGenPage = null;
    this.moveGenReady = false;
  }

  async init() {
    this.browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    this.evalPage = await this.browser.newPage();
    this.movePage = await this.browser.newPage();
    await this.initMoveGenPage();
  }

  /**
   * Initialize the move-generation page with all CSS loaded and all candidate
   * move elements. This page persists; we mutate data-piece attributes to
   * update the position instead of rebuilding HTML.
   */
  async initMoveGenPage() {
    this.moveGenPage = await this.browser.newPage();

    // Create initial position HTML with move-generation + check-detection CSS
    const initialState = GameState.fromFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    const combinedCss = movegenCssContent + '\n' + checkCssContent;
    const html = gameHtml(initialState, combinedCss);

    await this.moveGenPage.setContent(html, { waitUntil: 'domcontentloaded' });
    this.moveGenReady = true;
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  /**
   * Evaluate a position given as FEN.
   * Returns the evaluation in centipawns from white's perspective.
   */
  async evaluate(fen) {
    const html = fenToHtml(fen);
    const htmlWithCss = html.replace('</head>', `<style>${evalCssContent}</style></head>`);

    await this.evalPage.setContent(htmlWithCss, { waitUntil: 'domcontentloaded' });

    const evalValue = await this.evalPage.evaluate(() => {
      const squares = document.querySelectorAll('.sq');
      let sum = 0;
      for (const sq of squares) {
        const val = getComputedStyle(sq).getPropertyValue('--piece-value').trim();
        sum += parseInt(val, 10) || 0;
      }
      return sum;
    });

    return evalValue;
  }

  /**
   * Score moves for move ordering.
   * Returns an array of { move, score } sorted by score descending.
   */
  async scoreMoves(moves) {
    if (moves.length === 0) return [];

    const html = movesToHtml(moves);
    const htmlWithCss = html.replace('</head>', `<style>${moveCssContent}</style></head>`);

    await this.movePage.setContent(htmlWithCss, { waitUntil: 'domcontentloaded' });

    const scores = await this.movePage.evaluate(() => {
      const moveEls = document.querySelectorAll('.move');
      const results = [];
      for (const el of moveEls) {
        const idx = parseInt(el.getAttribute('data-idx'), 10);
        const style = getComputedStyle(el);
        const order = parseInt(style.order, 10) || 0;
        results.push({ idx, score: order });
      }
      return results;
    });

    const scored = scores.map(s => ({
      move: moves[s.idx],
      score: s.score,
    }));

    scored.sort((a, b) => b.score - a.score);

    return scored;
  }

  /**
   * Update the move-generation page DOM to match the given game state.
   * Mutates data-piece on all 64 squares and updates game-level attributes.
   */
  async _updateMoveGenPosition(gameState) {
    await this.moveGenPage.evaluate((state) => {
      const game = document.getElementById('game');
      game.setAttribute('data-turn', state.turn);
      game.setAttribute('data-castle-wk', state.castleWK ? '1' : '0');
      game.setAttribute('data-castle-wq', state.castleWQ ? '1' : '0');
      game.setAttribute('data-castle-bk', state.castleBK ? '1' : '0');
      game.setAttribute('data-castle-bq', state.castleBQ ? '1' : '0');
      game.setAttribute('data-ep', state.epSquare || 'none');

      const squares = document.querySelectorAll('.sq');
      for (const sqEl of squares) {
        const sq = sqEl.getAttribute('data-sq');
        sqEl.setAttribute('data-piece', state.board[sq] || 'empty');
      }
    }, {
      turn: gameState.turn,
      castleWK: gameState.castleWK,
      castleWQ: gameState.castleWQ,
      castleBK: gameState.castleBK,
      castleBQ: gameState.castleBQ,
      epSquare: gameState.epSquare,
      board: gameState.board,
    });
  }

  /**
   * Get all legal moves for the given game state using CSS.
   *
   * 1. Mutate DOM to match position
   * 2. Read --pseudo-legal from all candidate move elements
   * 3. Filter for legality: for each pseudo-legal move, apply it in DOM,
   *    check if own king is in check via CSS, then undo.
   *
   * @param {GameState} gameState
   * @returns {Array<{from, to, promotion?, castle?, ep?}>}
   */
  async getLegalMoves(gameState) {
    await this._updateMoveGenPosition(gameState);

    const legalMoves = await this.moveGenPage.evaluate((turn) => {
      const board = document.getElementById('board');
      const candidates = document.querySelectorAll('#candidates .move');
      const checkVar = turn === 'w' ? '--wk-in-check' : '--bk-in-check';

      // Step 1: Find all pseudo-legal moves
      const pseudoLegal = [];
      for (const el of candidates) {
        const style = getComputedStyle(el);
        const val = style.getPropertyValue('--pseudo-legal').trim();
        if (val === '1') {
          const move = {
            from: el.getAttribute('data-from'),
            to: el.getAttribute('data-to'),
          };
          const promo = el.getAttribute('data-promotion');
          const castle = el.getAttribute('data-castle');
          const ep = el.getAttribute('data-ep');
          if (promo) move.promotion = promo;
          if (castle) move.castle = castle;
          if (ep) move.ep = true;
          pseudoLegal.push(move);
        }
      }

      // Helper to get square element
      function getSqEl(sq) {
        return board.querySelector(`.sq[data-sq="${sq}"]`);
      }

      // Step 2: Filter for legality using DOM mutation + check detection
      const legal = [];
      for (const move of pseudoLegal) {
        const fromEl = getSqEl(move.from);
        const toEl = getSqEl(move.to);
        const origFrom = fromEl.getAttribute('data-piece');
        const origTo = toEl.getAttribute('data-piece');
        const savedExtras = [];

        const movingPiece = origFrom;

        // Apply the move
        if (move.promotion) {
          toEl.setAttribute('data-piece', turn + move.promotion.toUpperCase());
        } else {
          toEl.setAttribute('data-piece', movingPiece);
        }
        fromEl.setAttribute('data-piece', 'empty');

        // Handle en passant capture
        if (move.ep) {
          const epCaptureSq = move.to[0] + move.from[1];
          const epEl = getSqEl(epCaptureSq);
          savedExtras.push({ el: epEl, was: epEl.getAttribute('data-piece') });
          epEl.setAttribute('data-piece', 'empty');
        }

        // Handle castling rook
        if (move.castle) {
          let rookFrom, rookTo;
          if (move.castle === 'wk') { rookFrom = 'h1'; rookTo = 'f1'; }
          else if (move.castle === 'wq') { rookFrom = 'a1'; rookTo = 'd1'; }
          else if (move.castle === 'bk') { rookFrom = 'h8'; rookTo = 'f8'; }
          else if (move.castle === 'bq') { rookFrom = 'a8'; rookTo = 'd8'; }
          const rfEl = getSqEl(rookFrom);
          const rtEl = getSqEl(rookTo);
          savedExtras.push(
            { el: rfEl, was: rfEl.getAttribute('data-piece') },
            { el: rtEl, was: rtEl.getAttribute('data-piece') }
          );
          rtEl.setAttribute('data-piece', rfEl.getAttribute('data-piece'));
          rfEl.setAttribute('data-piece', 'empty');
        }

        // Read CSS check detection
        const inCheck = getComputedStyle(board).getPropertyValue(checkVar).trim() === '1';

        // For castling, also check that king is not in check before move
        // and that king doesn't pass through check
        let castleIllegal = false;
        if (move.castle && !inCheck) {
          // Undo the move first to check starting position
          fromEl.setAttribute('data-piece', origFrom);
          toEl.setAttribute('data-piece', origTo);
          for (const s of savedExtras) {
            s.el.setAttribute('data-piece', s.was);
          }

          // Check: king currently in check?
          const inCheckNow = getComputedStyle(board).getPropertyValue(checkVar).trim() === '1';
          if (inCheckNow) {
            castleIllegal = true;
          } else {
            // Check intermediate square
            let midSq;
            if (move.castle === 'wk') midSq = 'f1';
            else if (move.castle === 'wq') midSq = 'd1';
            else if (move.castle === 'bk') midSq = 'f8';
            else if (move.castle === 'bq') midSq = 'd8';

            // Move king to intermediate square
            const midEl = getSqEl(midSq);
            const origMid = midEl.getAttribute('data-piece');
            midEl.setAttribute('data-piece', movingPiece);
            fromEl.setAttribute('data-piece', 'empty');

            const inCheckMid = getComputedStyle(board).getPropertyValue(checkVar).trim() === '1';

            // Restore
            fromEl.setAttribute('data-piece', origFrom);
            midEl.setAttribute('data-piece', origMid);

            if (inCheckMid) {
              castleIllegal = true;
            }
          }

          // Already restored, skip normal undo
          if (!castleIllegal) {
            legal.push(move);
          }
          continue;
        }

        // Undo the move
        fromEl.setAttribute('data-piece', origFrom);
        toEl.setAttribute('data-piece', origTo);
        for (const s of savedExtras) {
          s.el.setAttribute('data-piece', s.was);
        }

        if (!inCheck && !castleIllegal) {
          legal.push(move);
        }
      }

      return legal;
    }, gameState.turn);

    return legalMoves;
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
