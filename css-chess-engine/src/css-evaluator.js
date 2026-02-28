'use strict';

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { gameHtml } = require('./board-renderer');
const { GameState } = require('./game-state');

const EVAL_CSS_PATH = path.resolve(__dirname, '..', 'css', 'eval.css');
const MOVEGEN_CSS_PATH = path.resolve(__dirname, '..', 'css', 'move-generation.css');
const CHECK_CSS_PATH = path.resolve(__dirname, '..', 'css', 'check-detection.css');

// Cache CSS content at load time
const evalCssContent = fs.readFileSync(EVAL_CSS_PATH, 'utf8');
const movegenCssContent = fs.readFileSync(MOVEGEN_CSS_PATH, 'utf8');
const checkCssContent = fs.readFileSync(CHECK_CSS_PATH, 'utf8');

// MVV-LVA piece values for move scoring (same formula as dynamic-move-scoring.css)
const PIECE_VALUES = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };
const PROMO_BONUS = { q: 9000, r: 5000, b: 3300, n: 3200 };

class CssEvaluator {
  constructor() {
    this.browser = null;
    this.moveGenPage = null;
    this.moveGenReady = false;
    this._lastFen = null; // Position cache to skip redundant DOM updates
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
   * check-detection, and evaluation.
   * All candidate move elements are pre-allocated. We mutate data-piece
   * attributes to update the position instead of rebuilding HTML.
   *
   * Note: dynamic-move-scoring.css exists as a CSS proof-of-concept for
   * MVV-LVA scoring via :has() rules, but its 768 :has() selectors cause
   * a ~20x slowdown when evaluated across 1,880 candidate elements.
   * We compute the identical scores in JS from the enriched move data instead.
   */
  async initMoveGenPage() {
    this.moveGenPage = await this.browser.newPage();

    const initialState = GameState.fromFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    const combinedCss = movegenCssContent + '\n' + checkCssContent + '\n' + evalCssContent;
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
   * Combined evaluation for quiescence: check detection + position eval +
   * legal capture generation in a SINGLE page.evaluate call.
   * This eliminates redundant Puppeteer round-trips.
   *
   * @param {GameState} gameState
   * @returns {{ inCheck: boolean, eval: number, captures: Array }}
   */
  async evaluateAndGetCaptures(gameState) {
    await this._updateMoveGenPosition(gameState);

    const result = await this.moveGenPage.evaluate((turn) => {
      const board = document.getElementById('board');
      const checkVar = turn === 'w' ? '--wk-in-check' : '--bk-in-check';

      // 1. Check detection
      const inCheck = getComputedStyle(board).getPropertyValue(checkVar).trim() === '1';

      // 2. Position evaluation (sum of --piece-value on all squares)
      let evalSum = 0;
      for (const sq of document.querySelectorAll('#board .sq')) {
        evalSum += parseInt(getComputedStyle(sq).getPropertyValue('--piece-value').trim(), 10) || 0;
      }

      // 3. Find pseudo-legal capture moves
      const candidates = document.querySelectorAll('#candidates .move');
      const pseudoLegalCaptures = [];
      for (const el of candidates) {
        const style = getComputedStyle(el);
        if (style.getPropertyValue('--pseudo-legal').trim() !== '1') continue;

        const to = el.getAttribute('data-to');
        const toEl = board.querySelector(`.sq[data-sq="${to}"]`);
        const toPiece = toEl ? toEl.getAttribute('data-piece') : 'empty';
        const isCapture = toPiece !== 'empty';
        const ep = el.getAttribute('data-ep');
        const isEp = ep === 'true';
        if (!isCapture && !isEp) continue;

        const move = {
          from: el.getAttribute('data-from'),
          to: to,
        };
        const promo = el.getAttribute('data-promotion');
        const castle = el.getAttribute('data-castle');
        if (promo) move.promotion = promo;
        if (castle) move.castle = castle;
        if (isEp) move.ep = true;
        pseudoLegalCaptures.push(move);
      }

      // 4. Check legality of captures only (much fewer DOM mutations than full move list)
      function getSqEl(sq) {
        return board.querySelector(`.sq[data-sq="${sq}"]`);
      }

      const legalCaptures = [];
      for (const move of pseudoLegalCaptures) {
        const fromEl = getSqEl(move.from);
        const toEl = getSqEl(move.to);
        const origFrom = fromEl.getAttribute('data-piece');
        const origTo = toEl.getAttribute('data-piece');
        const savedExtras = [];
        const movingPiece = origFrom;

        // Apply move
        if (move.promotion) {
          toEl.setAttribute('data-piece', turn + move.promotion.toUpperCase());
        } else {
          toEl.setAttribute('data-piece', movingPiece);
        }
        fromEl.setAttribute('data-piece', 'empty');

        if (move.ep) {
          const epCaptureSq = move.to[0] + move.from[1];
          const epEl = getSqEl(epCaptureSq);
          savedExtras.push({ el: epEl, was: epEl.getAttribute('data-piece') });
          epEl.setAttribute('data-piece', 'empty');
        }

        // Check legality
        const moveInCheck = getComputedStyle(board).getPropertyValue(checkVar).trim() === '1';

        // Undo
        fromEl.setAttribute('data-piece', origFrom);
        toEl.setAttribute('data-piece', origTo);
        for (const s of savedExtras) {
          s.el.setAttribute('data-piece', s.was);
        }

        if (!moveInCheck) {
          if (origTo !== 'empty') {
            move.captured = origTo;
            move.capturedType = origTo[1].toLowerCase();
          }
          if (move.ep) {
            move.captured = (turn === 'w' ? 'bP' : 'wP');
            move.capturedType = 'p';
          }
          move.piece = origFrom;
          move.pieceType = origFrom[1].toLowerCase();
          legalCaptures.push(move);
        }
      }

      return { inCheck, eval: evalSum, captures: legalCaptures };
    }, gameState.turn);

    // Compute MVV-LVA scores for captures
    for (const move of result.captures) {
      const captureValue = move.capturedType ? (PIECE_VALUES[move.capturedType] || 0) : 0;
      const attackerValue = PIECE_VALUES[move.pieceType] || 0;
      const promoBonus = move.promotion ? (PROMO_BONUS[move.promotion] || 0) : 0;
      move.score = captureValue * 10 - attackerValue + promoBonus;
    }

    return result;
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
   * 4. Enrich legal moves with capture/piece info and MVV-LVA scores
   *
   * @param {GameState} gameState
   * @returns {Array<{from, to, promotion?, castle?, ep?, captured?, capturedType?, piece?, pieceType?, score}>}
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
            move.piece = origFrom;
            move.pieceType = origFrom[1].toLowerCase();
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
          // Enrich with capture and piece info
          if (origTo !== 'empty') {
            move.captured = origTo;
            move.capturedType = origTo[1].toLowerCase();
          }
          if (move.ep) {
            move.captured = (turn === 'w' ? 'bP' : 'wP');
            move.capturedType = 'p';
          }
          move.piece = origFrom;
          move.pieceType = origFrom[1].toLowerCase();
          legal.push(move);
        }
      }

      return legal;
    }, gameState.turn);

    // Compute MVV-LVA scores from enriched data
    // Same formula as dynamic-move-scoring.css:
    //   order = capture_value * 10 - attacker_value + promo_bonus
    for (const move of legalMoves) {
      const captureValue = move.capturedType ? (PIECE_VALUES[move.capturedType] || 0) : 0;
      const attackerValue = PIECE_VALUES[move.pieceType] || 0;
      const promoBonus = move.promotion ? (PROMO_BONUS[move.promotion] || 0) : 0;
      move.score = captureValue * 10 - attackerValue + promoBonus;
    }

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
