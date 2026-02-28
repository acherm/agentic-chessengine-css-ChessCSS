'use strict';

/**
 * Estimate Elo difference from win/loss/draw results.
 * Uses the standard formula: eloDiff = -400 * log10(1/score - 1)
 * Confidence interval via normal approximation (95% CI).
 */
function estimateElo(wins, losses, draws) {
  const total = wins + losses + draws;
  if (total === 0) return { elo: 0, confidence: 0, display: '+0 \u00b1 0' };

  const score = (wins + draws * 0.5) / total;

  let elo;
  if (score >= 1) {
    elo = Infinity;
  } else if (score <= 0) {
    elo = -Infinity;
  } else {
    elo = -400 * Math.log10(1 / score - 1);
  }

  // Confidence interval via normal approximation
  let confidence = 0;
  if (isFinite(elo) && total > 1) {
    // Score variance (treating each game outcome as: win=1, draw=0.5, loss=0)
    const scoreVar = (
      wins * (1 - score) ** 2 +
      losses * (0 - score) ** 2 +
      draws * (0.5 - score) ** 2
    ) / total;
    const scoreStdErr = Math.sqrt(scoreVar / total);

    // Derivative of Elo w.r.t. score at the observed point
    const dEdS = 400 / (score * (1 - score) * Math.log(10));

    // 95% confidence interval
    confidence = Math.round(1.96 * dEdS * scoreStdErr);
  }

  const eloRounded = isFinite(elo) ? Math.round(elo) : elo;

  let display;
  if (elo === Infinity) {
    display = '+inf';
  } else if (elo === -Infinity) {
    display = '-inf';
  } else {
    const sign = eloRounded >= 0 ? '+' : '';
    display = `${sign}${eloRounded} \u00b1 ${confidence}`;
  }

  return { elo: eloRounded, confidence, display };
}

module.exports = { estimateElo };
