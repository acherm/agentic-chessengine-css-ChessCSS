#!/usr/bin/env node
'use strict';

/**
 * Generates dynamic-move-scoring.css — CSS rules that read board state via :has()
 * to compute MVV-LVA capture scores and attacker values for move ordering.
 *
 * ~773 rules total:
 *   - 384 capture-value rules (64 squares × 6 piece types)
 *   - 384 attacker-value rules (64 squares × 6 piece types)
 *   - 4 promotion bonus rules
 *   - 1 base rule with defaults + order calc
 */

const fs = require('fs');
const path = require('path');

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

const PIECES = [
  { type: 'P', value: 100 },
  { type: 'N', value: 320 },
  { type: 'B', value: 330 },
  { type: 'R', value: 500 },
  { type: 'Q', value: 900 },
  { type: 'K', value: 20000 },
];

function generate() {
  const lines = [];

  lines.push('/* Auto-generated dynamic move scoring CSS */');
  lines.push('/* Uses :has() to read board state for MVV-LVA scoring */');
  lines.push('');

  // Base rule with defaults and combined order calc
  lines.push('.move {');
  lines.push('  --capture-value: 0;');
  lines.push('  --attacker-value: 0;');
  lines.push('  --promo-bonus: 0;');
  lines.push('  order: calc(var(--capture-value) * 10 - var(--attacker-value) + var(--promo-bonus));');
  lines.push('}');
  lines.push('');

  // Promotion bonuses
  lines.push('/* Promotion bonuses */');
  lines.push('.move[data-promotion="q"] { --promo-bonus: 9000; }');
  lines.push('.move[data-promotion="r"] { --promo-bonus: 5000; }');
  lines.push('.move[data-promotion="b"] { --promo-bonus: 3300; }');
  lines.push('.move[data-promotion="n"] { --promo-bonus: 3200; }');
  lines.push('');

  // Capture value rules: for each square × piece type, if that piece is there,
  // any move targeting that square gets its value as --capture-value
  lines.push('/* Capture value: value of piece on target square (64 sq × 6 types = 384 rules) */');
  for (let f = 0; f < 8; f++) {
    for (let r = 1; r <= 8; r++) {
      const sq = FILES[f] + r;
      for (const piece of PIECES) {
        lines.push(
          `#game:has(.sq[data-sq="${sq}"]:is([data-piece="w${piece.type}"],[data-piece="b${piece.type}"])) .move[data-to="${sq}"] { --capture-value: ${piece.value}; }`
        );
      }
    }
  }
  lines.push('');

  // Attacker value rules: for each square × piece type, if that piece is there,
  // any move originating from that square gets its value as --attacker-value
  lines.push('/* Attacker value: value of piece on source square (64 sq × 6 types = 384 rules) */');
  for (let f = 0; f < 8; f++) {
    for (let r = 1; r <= 8; r++) {
      const sq = FILES[f] + r;
      for (const piece of PIECES) {
        lines.push(
          `#game:has(.sq[data-sq="${sq}"]:is([data-piece="w${piece.type}"],[data-piece="b${piece.type}"])) .move[data-from="${sq}"] { --attacker-value: ${piece.value}; }`
        );
      }
    }
  }

  return lines.join('\n') + '\n';
}

const css = generate();
const outPath = path.resolve(__dirname, '..', 'css', 'dynamic-move-scoring.css');
fs.writeFileSync(outPath, css, 'utf8');

const ruleCount = (css.match(/\{/g) || []).length;
console.log(`Generated ${outPath} (${ruleCount} rules, ${(css.length / 1024).toFixed(1)} KB)`);
