'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const path = require('path');

const DRIVER_PATH = path.join(__dirname, '..', 'src', 'driver.js');

/**
 * Send UCI commands to the engine and wait for expected output.
 * Sends each command and waits for a trigger string before sending the next.
 * The final command should be 'quit' or the process will be killed on timeout.
 */
function uciSession(steps, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const driver = spawn('node', [DRIVER_PATH], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let stepIdx = 0;

    const timer = setTimeout(() => {
      driver.kill();
      reject(new Error(
        `UCI timeout after ${timeoutMs}ms at step ${stepIdx}/${steps.length}.\n` +
        `stdout: ${stdout}\nstderr: ${stderr}`
      ));
    }, timeoutMs);

    driver.stdout.on('data', (data) => {
      stdout += data.toString();
      advance();
    });

    driver.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    driver.on('close', () => {
      clearTimeout(timer);
      resolve({ stdout, stderr });
    });

    function advance() {
      while (stepIdx < steps.length) {
        const step = steps[stepIdx];
        if (step.waitFor && !stdout.includes(step.waitFor)) {
          break; // Wait for this trigger
        }
        if (step.cmd) {
          driver.stdin.write(step.cmd + '\n');
        }
        stepIdx++;
      }
    }

    // Start advancing immediately
    advance();
  });
}

describe('UCI Protocol', () => {
  it('responds to uci with id and uciok', async () => {
    const { stdout } = await uciSession([
      { cmd: 'uci' },
      { waitFor: 'uciok', cmd: 'quit' },
    ]);
    assert.ok(stdout.includes('id name CSSChessEngine'), 'Should include engine name');
    assert.ok(stdout.includes('uciok'), 'Should include uciok');
  });

  it('responds to isready with readyok', async () => {
    const { stdout } = await uciSession([
      { cmd: 'uci' },
      { waitFor: 'uciok', cmd: 'isready' },
      { waitFor: 'readyok', cmd: 'quit' },
    ]);
    assert.ok(stdout.includes('readyok'), 'Should include readyok');
  });

  it('returns bestmove for startpos depth 1', async () => {
    const { stdout } = await uciSession([
      { cmd: 'uci' },
      { waitFor: 'uciok', cmd: 'isready' },
      { waitFor: 'readyok', cmd: 'position startpos' },
      { cmd: 'go depth 1' },
      { waitFor: 'bestmove', cmd: 'quit' },
    ]);
    assert.ok(stdout.includes('bestmove'), `Should include bestmove. Got: ${stdout}`);

    const match = stdout.match(/bestmove\s+(\S+)/);
    assert.ok(match, 'Should have a bestmove token');
    const move = match[1];
    assert.ok(/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move), `Invalid move format: ${move}`);
  });

  it('returns bestmove for a specific position', async () => {
    const { stdout } = await uciSession([
      { cmd: 'uci' },
      { waitFor: 'uciok', cmd: 'isready' },
      { waitFor: 'readyok', cmd: 'position fen rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2' },
      { cmd: 'go depth 1' },
      { waitFor: 'bestmove', cmd: 'quit' },
    ]);
    assert.ok(stdout.includes('bestmove'), 'Should include bestmove');
  });

  it('handles position startpos moves', async () => {
    const { stdout } = await uciSession([
      { cmd: 'uci' },
      { waitFor: 'uciok', cmd: 'isready' },
      { waitFor: 'readyok', cmd: 'position startpos moves e2e4 e7e5' },
      { cmd: 'go depth 1' },
      { waitFor: 'bestmove', cmd: 'quit' },
    ]);
    assert.ok(stdout.includes('bestmove'), 'Should include bestmove');
  });

  it('outputs info with depth and score', async () => {
    const { stdout } = await uciSession([
      { cmd: 'uci' },
      { waitFor: 'uciok', cmd: 'isready' },
      { waitFor: 'readyok', cmd: 'position startpos' },
      { cmd: 'go depth 1' },
      { waitFor: 'bestmove', cmd: 'quit' },
    ]);
    assert.ok(stdout.includes('info depth'), 'Should include info depth');
    assert.ok(stdout.includes('score cp'), 'Should include score cp');
  });
});
