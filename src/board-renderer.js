'use strict';

const { Chess } = require('chess.js');

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

/**
 * Convert a FEN string into an HTML document with 64 sibling <div> elements
 * inside a #board container. Each div has:
 *   class="sq"
 *   data-p="wP" | "bK" | "empty" etc.
 *   data-s="a1" .. "h8"
 *
 * An #eval div follows for CSS counter readout.
 */
function fenToHtml(fen, evalCssPath, moveScoringCssPath) {
  const chess = new Chess(fen);
  const board = chess.board(); // 8x8 array, row 0 = rank 8

  const squareDivs = [];

  for (let rankIdx = 0; rankIdx < 8; rankIdx++) {
    for (let fileIdx = 0; fileIdx < 8; fileIdx++) {
      const sq = FILES[fileIdx] + (8 - rankIdx);
      const cell = board[rankIdx][fileIdx];

      let piece = 'empty';
      if (cell) {
        const color = cell.color; // 'w' or 'b'
        const type = cell.type.toUpperCase(); // 'P', 'N', etc.
        piece = color + type;
      }

      squareDivs.push(`<div class="sq" data-p="${piece}" data-s="${sq}"></div>`);
    }
  }

  const cssLinks = [];
  if (evalCssPath) {
    cssLinks.push(`<link rel="stylesheet" href="${evalCssPath}">`);
  }
  if (moveScoringCssPath) {
    cssLinks.push(`<link rel="stylesheet" href="${moveScoringCssPath}">`);
  }

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
${cssLinks.join('\n')}
</head>
<body>
<div id="board">
${squareDivs.join('\n')}
<div id="eval"></div>
</div>
</body>
</html>`;
}

/**
 * Generate HTML for move scoring. Each move is a <div class="move">
 * with data attributes describing the move for CSS to score.
 */
function movesToHtml(moves, moveScoringCssPath) {
  // moves: array of { from, to, piece, captured, flags, san }
  const moveDivs = moves.map((m, i) => {
    const attrs = [
      `class="move"`,
      `data-idx="${i}"`,
      `data-p="${m.color}${m.piece.toUpperCase()}"`,
      `data-f="${m.from}"`,
      `data-d="${m.to}"`,
    ];

    if (m.captured) {
      attrs.push(`data-captured="${m.captured.toUpperCase()}"`);
    }
    if (m.flags.includes('k') || m.flags.includes('q')) {
      attrs.push(`data-c="true"`);
    }
    if (m.flags.includes('p')) {
      const promo = (m.promotion || 'q').toUpperCase();
      attrs.push(`data-pr="${promo}"`);
    }
    if (m.san && m.san.includes('+')) {
      attrs.push(`data-check="true"`);
    }
    if (m.san && m.san.includes('#')) {
      attrs.push(`data-checkmate="true"`);
    }

    return `<div ${attrs.join(' ')}></div>`;
  });

  const cssLink = moveScoringCssPath
    ? `<link rel="stylesheet" href="${moveScoringCssPath}">`
    : '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
${cssLink}
</head>
<body>
<div id="moves">
${moveDivs.join('\n')}
</div>
</body>
</html>`;
}

/**
 * Flatten chess.js board() into an array of { type, color, square } entries.
 * Useful for reference eval comparison.
 */
function boardToEntries(fen) {
  const chess = new Chess(fen);
  const board = chess.board();
  const entries = [];

  for (let rankIdx = 0; rankIdx < 8; rankIdx++) {
    for (let fileIdx = 0; fileIdx < 8; fileIdx++) {
      const cell = board[rankIdx][fileIdx];
      if (cell) {
        const sq = FILES[fileIdx] + (8 - rankIdx);
        entries.push({ type: cell.type, color: cell.color, square: sq });
      }
    }
  }

  return entries;
}

/**
 * Generate static HTML for all candidate move elements (~1,880 elements).
 * These remain in the DOM permanently; CSS sets --pseudo-legal on the valid ones.
 */
function generateCandidateMovesHtml() {
  const divs = [];
  const PROMO_PIECES = ['q', 'r', 'b', 'n'];

  for (let ff = 0; ff < 8; ff++) {
    for (let fr = 0; fr < 8; fr++) {
      const from = FILES[ff] + (fr + 1);
      for (let tf = 0; tf < 8; tf++) {
        for (let tr = 0; tr < 8; tr++) {
          if (ff === tf && fr === tr) continue;
          const to = FILES[tf] + (tr + 1);

          // Check if this could be a promotion move (pawn reaching last rank)
          const isWhitePromo = fr === 6 && tr === 7; // rank 7 -> rank 8
          const isBlackPromo = fr === 1 && tr === 0;  // rank 2 -> rank 1
          const isPawnLike = ff === tf || Math.abs(ff - tf) === 1; // same file or adjacent for capture
          const isOneForward = Math.abs(tr - fr) === 1;

          if ((isWhitePromo || isBlackPromo) && isPawnLike && isOneForward) {
            // Promotion candidates: one per promotion piece (for pawns)
            for (const promo of PROMO_PIECES) {
              divs.push(`<div class="move" data-f="${from}" data-d="${to}" data-pr="${promo}"></div>`);
            }
            // Also generate a normal move candidate (for non-pawn pieces
            // like king/knight that can also move between these squares)
            divs.push(`<div class="move" data-f="${from}" data-d="${to}"></div>`);
          } else {
            // Normal move candidate
            divs.push(`<div class="move" data-f="${from}" data-d="${to}"></div>`);
          }
        }
      }
    }
  }

  // En passant candidates: pawns on rank 5 (white) or rank 4 (black) capturing diagonally
  for (let ff = 0; ff < 8; ff++) {
    for (const df of [-1, 1]) {
      const tf = ff + df;
      if (tf < 0 || tf >= 8) continue;

      // White EP: from rank 5 to rank 6
      const wFrom = FILES[ff] + '5';
      const wTo = FILES[tf] + '6';
      divs.push(`<div class="move" data-f="${wFrom}" data-d="${wTo}" data-e="true"></div>`);

      // Black EP: from rank 4 to rank 3
      const bFrom = FILES[ff] + '4';
      const bTo = FILES[tf] + '3';
      divs.push(`<div class="move" data-f="${bFrom}" data-d="${bTo}" data-e="true"></div>`);
    }
  }

  // Castling candidates
  divs.push(`<div class="move" data-f="e1" data-d="g1" data-c="wk"></div>`);
  divs.push(`<div class="move" data-f="e1" data-d="c1" data-c="wq"></div>`);
  divs.push(`<div class="move" data-f="e8" data-d="g8" data-c="bk"></div>`);
  divs.push(`<div class="move" data-f="e8" data-d="c8" data-c="bq"></div>`);

  return divs.join('\n');
}

/**
 * Generate the full game HTML with board squares, candidate moves, and CSS.
 * @param {GameState} gameState
 * @param {string} cssContent - concatenated CSS content for all stylesheets
 */
function gameHtml(gameState, cssContent) {
  // Generate board squares in a1, a2, ..., h7, h8 order
  const squareDivs = [];
  for (let f = 0; f < 8; f++) {
    for (let r = 1; r <= 8; r++) {
      const sq = FILES[f] + r;
      const piece = gameState.board[sq] || 'empty';
      squareDivs.push(`<div class="sq" data-p="${piece}" data-s="${sq}"></div>`);
    }
  }

  const ep = gameState.epSquare || 'none';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>${cssContent}</style>
</head>
<body>
<div id="game" data-t="${gameState.turn}" data-cwk="${gameState.castleWK ? 1 : 0}" data-cwq="${gameState.castleWQ ? 1 : 0}" data-cbk="${gameState.castleBK ? 1 : 0}" data-cbq="${gameState.castleBQ ? 1 : 0}" data-e="${ep}">
<div id="board">
${squareDivs.join('\n')}
</div>
<div id="candidates">
${generateCandidateMovesHtml()}
</div>
</div>
</body>
</html>`;
}

module.exports = { fenToHtml, movesToHtml, boardToEntries, generateCandidateMovesHtml, gameHtml };
