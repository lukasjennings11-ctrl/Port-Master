/* Five — daily word/logic puzzle (Wordle-style). Vanilla JS, mobile-first.
 * One shared word per day (deterministic via Retention.dailySeed), 6 guesses,
 * standard green/yellow/gray feedback handling duplicate letters correctly.
 * "Practice" mode offers unlimited random rounds without touching the daily
 * streak/result. Uses ../../shared/juice.js, ../../shared/retention.js, words.js.
 */
(function () {
  'use strict';

  var GAME = 'wordle';
  var ANSWERS = window.WORDS.ANSWERS;
  var VALID_SET = {};
  for (var i = 0; i < window.WORDS.VALID.length; i++) VALID_SET[window.WORDS.VALID[i]] = true;

  var ROWS = 6, COLS = 5;
  var KROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];

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

  // ---- daily word ----
  function dailyIndex(dateStr) { return Retention.dailySeed(GAME, dateStr) % ANSWERS.length; }
  function dailyWord(dateStr) { return ANSWERS[dailyIndex(dateStr)]; }

  // ---- evaluation ----
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

  function freshRound(ans) {
    answer = ans; guesses = []; rowResults = []; current = ''; done = false; win = false; keyStatus = {};
  }

  function todayStr() { return Retention.todayStr(); }

  function loadDailyState() {
    var st = Retention.get(GAME, 'daily', null);
    var today = todayStr();
    if (st && st.date === today) {
      answer = dailyWord(today);
      guesses = st.guesses.slice();
      rowResults = guesses.map(function (g) { return evaluate(g, answer); });
      current = ''; done = st.done; win = st.win;
      keyStatus = {};
      for (var r = 0; r < rowResults.length; r++) applyKeyStatus(guesses[r], rowResults[r]);
      return;
    }
    freshRound(dailyWord(today));
  }

  function saveDailyState() {
    Retention.set(GAME, 'daily', { date: todayStr(), guesses: guesses, done: done, win: win });
  }

  function applyKeyStatus(guess, res) {
    for (var i = 0; i < COLS; i++) {
      var L = guess[i], s = res[i];
      var prev = keyStatus[L];
      var rank = { absent: 0, present: 1, correct: 2 };
      if (!prev || rank[s] > rank[prev]) keyStatus[L] = s;
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
    if (done) showResultOverlay(win ? 'You got it in ' + guesses.length + ' / ' + ROWS + ' today.' : 'Today’s word is revealed above.');
  }

  function startPractice() {
    mode = 'practice';
    modeBadge.textContent = 'Practice';
    practiceBtn.textContent = 'Daily';
    var w = ANSWERS[(Math.random() * ANSWERS.length) | 0];
    freshRound(w);
    msgEl.textContent = '';
    overlay.classList.add('hidden');
    render();
  }

  // ---- input ----
  function typeLetter(L) {
    if (done) return;
    L = L.toLowerCase();
    if (!/^[a-z]$/.test(L)) return;
    if (current.length >= COLS) return;
    current += L;
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
    setTimeout(function () { if (msgEl.textContent === text) msgEl.textContent = ''; }, 1600);
  }

  function submit() {
    if (done) return;
    if (current.length < COLS) { triggerShake(); showMsg('Not enough letters'); return; }
    if (!VALID_SET[current]) { triggerShake(); showMsg('Not in word list'); return; }

    var res = evaluate(current, answer);
    guesses.push(current); rowResults.push(res);
    applyKeyStatus(current, res);
    var isWin = current === answer;
    var wordGuessed = current;
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

  var best; // best = highest score across daily completions

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
    showResultOverlay(win ? 'You got it in ' + guesses.length + ' / ' + ROWS + '.' : 'The word was revealed above.');
  }

  function buildShareText() {
    var lines = ['Five ' + (win ? guesses.length : 'X') + '/' + ROWS];
    var icon = { correct: '🟩', present: '🟨', absent: '⬜' };
    for (var r = 0; r < rowResults.length; r++) {
      lines.push(rowResults[r].map(function (s) { return icon[s]; }).join(''));
    }
    return lines.join('\n');
  }

  ovShare.addEventListener('click', function () {
    var text = buildShareText();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { showShareFeedback(); }, function () { showShareFeedback(); });
    } else { showShareFeedback(); }
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
      var letters, statuses;
      if (r < guesses.length) { letters = guesses[r].split(''); statuses = rowResults[r]; }
      else if (r === guesses.length) { letters = current.split(''); statuses = null; }
      else { letters = []; statuses = null; }

      for (var c = 0; c < COLS; c++) {
        var tile = document.createElement('div');
        var L = letters[c] || '';
        var cls = 'tile';
        if (L) cls += ' filled';
        if (statuses) cls += ' ' + statuses[c];
        tile.className = cls;
        tile.textContent = L;
        rowEl.appendChild(tile);
      }
      boardEl.appendChild(rowEl);
    }
    renderKeyboard();
  }

  function renderKeyboard() {
    kbEl.innerHTML = '';
    for (var r = 0; r < KROWS.length; r++) {
      var krow = document.createElement('div'); krow.className = 'krow';
      if (r === 2) krow.appendChild(makeKey('enter', 'ENTER', true));
      for (var c = 0; c < KROWS[r].length; c++) {
        var L = KROWS[r][c];
        krow.appendChild(makeKey(L, L, false));
      }
      if (r === 2) krow.appendChild(makeKey('back', '⌫', true));
      kbEl.appendChild(krow);
    }
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
      else typeLetter(action);
    });
    return btn;
  }

  // ---- physical keyboard ----
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); Juice.Audio.unlock(); submit(); }
    else if (e.key === 'Backspace') { e.preventDefault(); backspace(); }
    else if (/^[a-zA-Z]$/.test(e.key)) { Juice.Audio.unlock(); typeLetter(e.key); }
  });

  // ---- mode toggle ----
  practiceBtn.addEventListener('click', function () {
    if (mode === 'daily') startPractice(); else startDaily();
  });

  // ---- boot ----
  function boot() {
    best = Retention.best(GAME);
    streakEl.innerHTML = '🔥 ' + Retention.touchStreak(GAME) + '&nbsp;day streak';
    startDaily();
  }

  // ---- headless test hook ----
  window.__wordle = {
    type: typeLetter,
    backspace: backspace,
    enter: submit,
    guess: function (word) {
      word = word.toLowerCase();
      current = '';
      for (var i = 0; i < word.length; i++) typeLetter(word[i]);
      submit();
    },
    practice: startPractice,
    daily: startDaily,
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
