/* Equate — daily equation-guessing puzzle (Nerdle-style). Vanilla JS, mobile-first.
 * One shared 8-character equation per day (deterministic via Retention.dailySeed),
 * 6 guesses, green/yellow/gray feedback per character. Any arithmetically-true
 * equation of the right length is a valid guess — no word list needed.
 * Uses ../../shared/juice.js and ../../shared/retention.js.
 */
(function () {
  'use strict';

  var GAME = 'equate';
  var ROWS = 6, COLS = 8;
  var OPS = ['+', '-', '*'];

  // ---- DOM ----
  var boardEl   = document.getElementById('board');
  var kbEl      = document.getElementById('keyboard');
  var msgEl     = document.getElementById('msg');
  var streakEl  = document.getElementById('streak');
  var modeBadge = document.getElementById('mode-badge');
  var practiceBtn = document.getElementById('practice');
  var overlay   = document.getElementById('overlay');
  var ovTitle   = document.getElementById('ov-title');
  var ovWord    = document.getElementById('ov-word');
  var ovSub     = document.getElementById('ov-sub');
  var ovGuesses = document.getElementById('ov-guesses');
  var ovStreak  = document.getElementById('ov-streak');
  var ovShare   = document.getElementById('ov-share');
  var ovClose   = document.getElementById('ov-close');

  // ---- equation generation ----
  function genEquation(rng) {
    for (var attempt = 0; attempt < 5000; attempt++) {
      var op = OPS[Math.floor(rng() * OPS.length)];
      var a = 1 + Math.floor(rng() * 98);
      var b = 1 + Math.floor(rng() * 98);
      var result;
      if (op === '+') result = a + b;
      else if (op === '-') { if (a < b) { var tmp = a; a = b; b = tmp; } result = a - b; }
      else result = a * b;
      if (result < 0) continue;
      var eq = '' + a + op + b + '=' + result;
      if (eq.length === COLS) return eq;
    }
    return '12+34=46'; // guaranteed-valid fallback (8 chars)
  }

  function dailyEquation(dateStr) {
    return genEquation(Retention.dailyRng(GAME, dateStr));
  }

  // ---- guess validation ----
  function parseEquation(str) {
    var m = str.match(/^(\d{1,4})([+\-*])(\d{1,4})=(\d{1,4})$/);
    if (!m) return null;
    return { a: parseInt(m[1], 10), op: m[2], b: parseInt(m[3], 10), result: parseInt(m[4], 10) };
  }
  function isValidGuess(str) {
    if (str.length !== COLS) return false;
    var p = parseEquation(str);
    if (!p) return false;
    var computed = p.op === '+' ? p.a + p.b : p.op === '-' ? p.a - p.b : p.a * p.b;
    return computed === p.result;
  }

  // ---- evaluation (duplicate-char-safe, same algorithm as Wordle) ----
  function evaluate(guess, answer) {
    var res = new Array(COLS).fill('absent');
    var aArr = answer.split(''), used = new Array(COLS).fill(false);
    for (var i = 0; i < COLS; i++) {
      if (guess[i] === answer[i]) { res[i] = 'correct'; used[i] = true; }
    }
    for (var j = 0; j < COLS; j++) {
      if (res[j] === 'correct') continue;
      for (var k = 0; k < COLS; k++) {
        if (!used[k] && aArr[k] === guess[j]) { res[j] = 'present'; used[k] = true; break; }
      }
    }
    return res;
  }

  // ---- state ----
  var mode, answer, guesses, rowResults, current, done, win, keyStatus;
  var shakeRow = -1;
  var best;

  function freshRound(eq) {
    answer = eq; guesses = []; rowResults = []; current = ''; done = false; win = false; keyStatus = {};
  }

  function todayStr() { return Retention.todayStr(); }

  function loadDailyState() {
    var st = Retention.get(GAME, 'daily', null);
    var today = todayStr();
    if (st && st.date === today) {
      answer = dailyEquation(today);
      guesses = st.guesses.slice();
      rowResults = guesses.map(function (g) { return evaluate(g, answer); });
      current = ''; done = st.done; win = st.win;
      keyStatus = {};
      for (var r = 0; r < rowResults.length; r++) applyKeyStatus(guesses[r], rowResults[r]);
      return;
    }
    freshRound(dailyEquation(today));
  }

  function saveDailyState() {
    Retention.set(GAME, 'daily', { date: todayStr(), guesses: guesses, done: done, win: win });
  }

  function applyKeyStatus(guess, res) {
    var rank = { absent: 0, present: 1, correct: 2 };
    for (var i = 0; i < COLS; i++) {
      var ch = guess[i], s = res[i], prev = keyStatus[ch];
      if (!prev || rank[s] > rank[prev]) keyStatus[ch] = s;
    }
  }

  function startDaily() {
    mode = 'daily';
    modeBadge.textContent = 'Daily';
    practiceBtn.textContent = 'Practice';
    loadDailyState();
    msgEl.textContent = '';
    overlay.classList.add('hidden');
    render();
    if (done) showResultOverlay(win ? 'You got it in ' + guesses.length + ' / ' + ROWS + ' today.' : 'Today’s equation is revealed above.');
  }

  function startPractice() {
    mode = 'practice';
    modeBadge.textContent = 'Practice';
    practiceBtn.textContent = 'Daily';
    freshRound(genEquation(Math.random));
    msgEl.textContent = '';
    overlay.classList.add('hidden');
    render();
  }

  // ---- input ----
  var CHARS = /^[0-9+\-*=]$/;
  function typeChar(ch) {
    if (done) return;
    if (!CHARS.test(ch)) return;
    if (current.length >= COLS) return;
    current += ch;
    Juice.Audio.play('tap');
    render();
  }
  function backspace() {
    if (done) return;
    current = current.slice(0, -1);
    render();
  }
  function showMsg(text) {
    msgEl.textContent = text;
    setTimeout(function () { if (msgEl.textContent === text) msgEl.textContent = ''; }, 1700);
  }

  function submit() {
    if (done) return;
    if (current.length < COLS) { triggerShake(); showMsg('Equation must fill all ' + COLS + ' slots'); return; }
    if (!isValidGuess(current)) { triggerShake(); showMsg('Not a true equation'); return; }

    var res = evaluate(current, answer);
    guesses.push(current); rowResults.push(res);
    applyKeyStatus(current, res);
    var isWin = current === answer;
    current = '';

    if (isWin) {
      win = true; done = true;
      Juice.Audio.play('win'); Juice.vibrate([10, 20, 10, 20, 10]);
      finish();
    } else if (guesses.length >= ROWS) {
      win = false; done = true;
      Juice.Audio.play('lose'); Juice.vibrate([20, 40, 20]);
      finish();
    } else {
      Juice.Audio.play('pop'); Juice.vibrate(8);
    }
    render();
  }

  function triggerShake() {
    shakeRow = guesses.length;
    render();
    setTimeout(function () { shakeRow = -1; render(); }, 420);
  }

  function showResultOverlay(subText) {
    ovTitle.textContent = win ? 'Solved! 🎉' : 'So close!';
    ovWord.textContent = answer;
    ovSub.textContent = subText;
    ovGuesses.textContent = win ? guesses.length : '—';
    ovStreak.textContent = Retention.streak(GAME);
    overlay.classList.remove('hidden');
  }

  function finish() {
    if (mode === 'daily') saveDailyState();
    var score = win ? Math.max(10, (ROWS - guesses.length + 1) * 20) : 0;
    var sub = Retention.submitScore(GAME, score);
    if (sub.best > best) best = sub.best;
    showResultOverlay(win ? 'You got it in ' + guesses.length + ' / ' + ROWS + '.' : 'The equation was revealed above.');
  }

  function buildShareText() {
    var lines = ['Equate ' + (win ? guesses.length : 'X') + '/' + ROWS];
    var icon = { correct: '🟩', present: '🟨', absent: '⬜' };
    for (var r = 0; r < rowResults.length; r++) lines.push(rowResults[r].map(function (s) { return icon[s]; }).join(''));
    return lines.join('\n');
  }

  ovShare.addEventListener('click', function () {
    var text = buildShareText();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(showShareFeedback, showShareFeedback);
    } else showShareFeedback();
  });
  function showShareFeedback() {
    var prev = ovShare.textContent; ovShare.textContent = 'Copied!';
    setTimeout(function () { ovShare.textContent = prev; }, 1200);
  }
  ovClose.addEventListener('click', function () { overlay.classList.add('hidden'); });

  // ---- render ----
  function render() {
    boardEl.innerHTML = '';
    for (var r = 0; r < ROWS; r++) {
      var rowEl = document.createElement('div');
      rowEl.className = 'row' + (r === shakeRow ? ' shake' : '');
      var chars, statuses;
      if (r < guesses.length) { chars = guesses[r].split(''); statuses = rowResults[r]; }
      else if (r === guesses.length) { chars = current.split(''); statuses = null; }
      else { chars = []; statuses = null; }

      for (var c = 0; c < COLS; c++) {
        var tile = document.createElement('div');
        var ch = chars[c] || '';
        var cls = 'tile';
        if (ch) cls += ' filled';
        if (statuses) cls += ' ' + statuses[c];
        tile.className = cls;
        tile.textContent = ch;
        rowEl.appendChild(tile);
      }
      boardEl.appendChild(rowEl);
    }
    renderKeyboard();
  }

  var KROWS = ['123456789', '0+-*='];
  function renderKeyboard() {
    kbEl.innerHTML = '';
    var row1 = document.createElement('div'); row1.className = 'krow';
    for (var i = 0; i < KROWS[0].length; i++) row1.appendChild(makeKey(KROWS[0][i], KROWS[0][i], false));
    kbEl.appendChild(row1);

    var row2 = document.createElement('div'); row2.className = 'krow';
    row2.appendChild(makeKey('back', '⌫', true));
    for (var j = 0; j < KROWS[1].length; j++) row2.appendChild(makeKey(KROWS[1][j], KROWS[1][j], false));
    row2.appendChild(makeKey('enter', 'GO', true));
    kbEl.appendChild(row2);
  }
  function makeKey(action, label, wide) {
    var btn = document.createElement('button');
    btn.className = 'key' + (wide ? ' wide' : '') + (keyStatus[action] ? ' ' + keyStatus[action] : '');
    btn.textContent = label;
    btn.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      Juice.Audio.unlock();
      if (action === 'enter') submit();
      else if (action === 'back') backspace();
      else typeChar(action);
    });
    return btn;
  }

  // ---- physical keyboard ----
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); Juice.Audio.unlock(); submit(); }
    else if (e.key === 'Backspace') { e.preventDefault(); backspace(); }
    else if (CHARS.test(e.key)) { Juice.Audio.unlock(); typeChar(e.key); }
  });

  practiceBtn.addEventListener('click', function () { if (mode === 'daily') startPractice(); else startDaily(); });

  // ---- boot ----
  function boot() {
    best = Retention.best(GAME);
    streakEl.innerHTML = '🔥 ' + Retention.touchStreak(GAME) + '&nbsp;day streak';
    startDaily();
  }

  // ---- headless test hook ----
  window.__equate = {
    type: typeChar,
    backspace: backspace,
    enter: submit,
    guess: function (eq) {
      current = '';
      for (var i = 0; i < eq.length; i++) typeChar(eq[i]);
      submit();
    },
    practice: startPractice,
    daily: startDaily,
    isValidGuess: isValidGuess,
    state: function () {
      return {
        mode: mode, answer: answer, guesses: guesses.slice(), done: done, win: win,
        current: current, rowResults: rowResults.map(function (r) { return r.slice(); })
      };
    },
    reset: function () { startPractice(); }
  };

  boot();
})();
