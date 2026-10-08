'use strict';

/* ============================================================
   OfflineMode — Engine & Journey Logic
   ============================================================ */

/* ---------- View Management ---------- */
const views = {};
document.querySelectorAll('.view').forEach(function (v) { views[v.id] = v; });

function showView(id) {
  const key =
    id && id.startsWith('view-') ? id :
    id === 'home'      ? 'view-home' :
    id === 'chat'      ? 'view-home' :
    id === 'activity'  ? 'view-activity' :
    id === 'offline'   ? 'view-offline' :
    id === 'reflection'? 'view-reflection' :
    id;

  Object.keys(views).forEach(function (vk) { views[vk].hidden = vk !== key; });
  window.scrollTo(0, 0);

  if (key === 'view-home' && id === 'chat') {
    const courtyard = document.getElementById('courtyard');
    if (courtyard) courtyard.scrollIntoView({ behavior: 'smooth' });
  }
}

document.querySelectorAll('[data-view]').forEach(function (el) {
  el.addEventListener('click', function (event) {
    event.preventDefault();
    showView(el.dataset.view);
  });
});

/* ---------- Local Ideas ---------- */
const LOCAL_IDEAS = [
  { activity: 'Sit with someone in your family and ask them about a celebration or custom from their childhood. Just listen.', time: '20 minutes', rule: 'No recording' },
  { activity: 'Go outside and watch the sky change color until dusk sets in.', time: '15 to 20 minutes', rule: 'No photos' },
  { activity: 'Make something small with your hands from clay, paper, cardboard, or wood available at home.', time: '30 minutes', rule: 'No online tutorials' },
  { activity: 'Cook or help prepare a meal with someone at home, with no phones in the kitchen.', time: 'Whatever the meal needs', rule: 'No phone' },
  { activity: 'Take a quiet walk and notice three subtle things in nature you usually miss.', time: '20 minutes', rule: 'No earbuds' },
  { activity: 'Play a game with people around you that does not need a screen — a board game, card game, or traditional game.', time: 'As long as it\u2019s fun' }
];

let currentIdeaIndex = -1;

function pickIdea() {
  let next;
  do { next = Math.floor(Math.random() * LOCAL_IDEAS.length); }
  while (next === currentIdeaIndex && LOCAL_IDEAS.length > 1);
  currentIdeaIndex = next;
  const idea = LOCAL_IDEAS[next];

  const actEl = document.getElementById('idea-activity');
  if (actEl) actEl.textContent = '\u201C' + idea.activity + '\u201D';

  const meta = [];
  if (idea.time) meta.push('Time: ' + idea.time);
  if (idea.rule) meta.push('Rule: ' + idea.rule);
  const metaEl = document.getElementById('idea-meta');
  if (metaEl) metaEl.textContent = meta.join('  ·  ');
  return idea;
}

document.getElementById('idea-another')?.addEventListener('click', pickIdea);
document.getElementById('idea-try')?.addEventListener('click', function () { openActivity(pickIdea()); });
document.getElementById('hero-go-offline')?.addEventListener('click', function () { openActivity(pickIdea()); });

/* ---------- Chat Engine ---------- */
const chatLog   = document.getElementById('chat-log');
const chatForm  = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const chatSend  = document.getElementById('chat-send');

const history = [];
let streaming = false;
let lastSuggestion = null;

function addWelcomeBubble() {
  if (!chatLog) return;
  const wrap = document.createElement('div');
  wrap.className = 'bubble assistant';

  const sender = document.createElement('span');
  sender.className = 'bubble-sender';
  sender.textContent = 'OfflineMode';

  const text = document.createElement('p');
  text.className = 'bubble-text';
  text.textContent = 'Hi. Tell me a little about your current situation — how much time you have, who you are with — and I\u2019ll suggest one real offline activity. I won\u2019t keep you here long.';

  wrap.appendChild(sender);
  wrap.appendChild(text);
  chatLog.appendChild(wrap);
}
addWelcomeBubble();

function addBubble(role, content) {
  const wrap = document.createElement('div');
  wrap.className = 'bubble ' + role;

  const sender = document.createElement('span');
  sender.className = 'bubble-sender';
  sender.textContent = role === 'user' ? 'You' : 'OfflineMode';

  const text = document.createElement('p');
  text.className = 'bubble-text';
  text.textContent = content;

  wrap.appendChild(sender);
  wrap.appendChild(text);
  chatLog.appendChild(wrap);
  chatLog.scrollTop = chatLog.scrollHeight;
  return wrap;
}

function addAssistantBubble() {
  const wrap = document.createElement('div');
  wrap.className = 'bubble assistant';

  const sender = document.createElement('span');
  sender.className = 'bubble-sender';
  sender.textContent = 'OfflineMode';

  const text = document.createElement('p');
  text.className = 'bubble-text';
  text.textContent = '';

  const actionBtn = document.createElement('button');
  actionBtn.className = 'act-btn';
  actionBtn.textContent = 'I\u2019m going offline';
  actionBtn.hidden = true;

  wrap.appendChild(sender);
  wrap.appendChild(text);
  wrap.appendChild(actionBtn);
  chatLog.appendChild(wrap);
  chatLog.scrollTop = chatLog.scrollHeight;
  return { wrap, text, actionBtn };
}

function parseActivity(fullText) {
  const s = {};
  const ma = fullText.match(/Activity:\s*(.*)/i);
  const mt = fullText.match(/Time:\s*(.*)/i);
  const mr = fullText.match(/Rule:\s*(.*)/i);
  if (ma) s.activity = ma[1].trim();
  if (mt) s.time = mt[1].trim();
  if (mr) s.rule = mr[1].trim();
  if (s.activity) return s;
  return { activity: fullText.trim() };
}

async function sendMessage(text) {
  const prompt = text.trim();
  if (streaming || !prompt) return;

  history.push({ role: 'user', content: prompt });
  addBubble('user', prompt);

  streaming = true;
  chatSend.disabled = true;
  chatInput.placeholder = 'Thinking…';
  chatInput.disabled = true;

  const assistant = addAssistantBubble();

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: history.slice(-10) })
    });

    if (!res.ok) {
      let message = 'Could not reach the local AI server.';
      try {
        const payload = await res.json();
        if (payload && payload.error) message = payload.error;
      } catch (ignore) {}
      assistant.text.textContent = message;
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let full = '';

    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      let nl;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        let evt;
        try { evt = JSON.parse(line); } catch (ignore) { continue; }
        if (evt && evt.error) { assistant.text.textContent = evt.error; return; }
        if (evt && evt.delta) {
          full += evt.delta;
          assistant.text.textContent = full;
          chatLog.scrollTop = chatLog.scrollHeight;
        }
      }
    }

    assistant.text.textContent = full || '(No response)';

    if (full.trim().length > 0) {
      history.push({ role: 'assistant', content: full });
      lastSuggestion = parseActivity(full);
      assistant.actionBtn.hidden = full.trim().length < 20;
    }
  } catch (err) {
    assistant.text.textContent = 'Error connecting to local server. Make sure OfflineMode is running.';
  } finally {
    streaming = false;
    chatSend.disabled = false;
    chatInput.disabled = false;
    chatInput.placeholder = 'For example: I\u2019m bored and my parents are sitting nearby…';
    chatInput.focus();
  }
}

chatForm?.addEventListener('submit', function (event) {
  event.preventDefault();
  const value = chatInput.value;
  chatInput.value = '';
  sendMessage(value);
});

document.querySelectorAll('.chip').forEach(function (chip) {
  if (chip.dataset.prompt) {
    chip.addEventListener('click', function () { sendMessage(chip.dataset.prompt); });
  }
});

/* ---------- Activity View ---------- */
function openActivity(suggestion) {
  lastSuggestion = suggestion;
  const body = document.getElementById('activity-body');
  if (!body) return;
  body.textContent = '';

  const act = document.createElement('p');
  act.className = 'activity-main';
  act.textContent = suggestion.activity;
  body.appendChild(act);

  if (suggestion.time) {
    const t = document.createElement('p');
    t.className = 'muted';
    t.textContent = 'Time · ' + suggestion.time;
    body.appendChild(t);
  }
  if (suggestion.rule) {
    const r = document.createElement('p');
    r.className = 'muted';
    r.textContent = 'Rule · ' + suggestion.rule;
    body.appendChild(r);
  }

  showView('view-activity');
}

chatLog?.addEventListener('click', function (event) {
  if (event.target.classList.contains('act-btn') && lastSuggestion) {
    openActivity(lastSuggestion);
  }
});

document.getElementById('act-go')?.addEventListener('click', function () {
  showView('view-offline');
});

/* ---------- Timer ---------- */
const timerDisplay = document.getElementById('timer-display');
const timerStart   = document.getElementById('timer-start');
const timerReset   = document.getElementById('timer-reset');
const timerDone    = document.getElementById('timer-done');

let timerState = 'idle';
let durationMin = 20;
let remainingSec = durationMin * 60;
let elapsedSec = 0;
let interval = null;

function formatTime(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return (m < 10 ? '0' + m : String(m)) + ':' + (s < 10 ? '0' + s : String(s));
}

function renderTimer() {
  if (!timerDisplay) return;
  if (durationMin === 0) {
    timerDisplay.textContent = formatTime(elapsedSec);
  } else if (timerState === 'idle') {
    timerDisplay.textContent = formatTime(durationMin * 60);
  } else {
    timerDisplay.textContent = formatTime(remainingSec);
  }
}

function stopInterval() {
  if (interval) { clearInterval(interval); interval = null; }
}

function tick() {
  if (timerState !== 'running') return;
  if (durationMin === 0) {
    elapsedSec += 1;
  } else {
    remainingSec -= 1;
    if (remainingSec <= 0) {
      remainingSec = 0;
      timerState = 'finished';
      stopInterval();
      if (timerDone) timerDone.hidden = false;
    }
  }
  renderTimer();
}

function resetTimer() {
  stopInterval();
  timerState = 'idle';
  remainingSec = durationMin * 60;
  elapsedSec = 0;
  if (timerDone) timerDone.hidden = true;
  if (timerStart) timerStart.textContent = 'Start';
  renderTimer();
}

function startOrPause() {
  if (timerState === 'running') {
    timerState = 'paused';
    stopInterval();
    if (timerStart) timerStart.textContent = 'Start';
    return;
  }
  if (timerState === 'paused' || timerState === 'idle') {
    timerState = 'running';
    if (timerDone) timerDone.hidden = true;
    if (timerStart) timerStart.textContent = 'Pause';
    stopInterval();
    interval = setInterval(tick, 1000);
  }
}

timerStart?.addEventListener('click', startOrPause);
timerReset?.addEventListener('click', resetTimer);

document.querySelectorAll('#timer-chips .chip').forEach(function (chip) {
  chip.addEventListener('click', function () {
    document.querySelectorAll('#timer-chips .chip').forEach(function (c) {
      c.classList.remove('selected');
    });
    chip.classList.add('selected');
    durationMin = parseInt(chip.dataset.timer, 10);
    resetTimer();
  });
});

/* ---------- Reflection & Memory Stamps ---------- */
const MOODS = ['🪔  Hands-on craft', '🌅  Sunset & sky', '🍵  Family conversation', '🌧️  Quiet rain watch'];
const moodsBox = document.getElementById('moods');
const reflectionNote = document.getElementById('reflection-note');
const reflectionSaved = document.getElementById('reflection-saved');
let selectedMood = null;

if (moodsBox) {
  MOODS.forEach(function (mood) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.textContent = mood;
    chip.addEventListener('click', function () {
      if (selectedMood) selectedMood.classList.remove('selected');
      chip.classList.add('selected');
      selectedMood = chip;
    });
    moodsBox.appendChild(chip);
  });
}

function renderStamps() {
  const c = document.getElementById('stamps-container');
  if (!c) return;
  c.innerHTML = '';

  let stored = [];
  try { stored = JSON.parse(localStorage.getItem('offlinemode_reflections') || '[]'); }
  catch (e) {}

  if (stored.length === 0) {
    c.innerHTML = '<p class="muted">No saved stamps yet. Complete an offline moment to claim your first memory stamp.</p>';
    return;
  }

  stored.slice().reverse().forEach(function (item) {
    const stamp = document.createElement('div');
    stamp.className = 'stamp-card';

    const icon = document.createElement('span');
    icon.className = 'stamp-icon';
    icon.textContent = item.mood ? item.mood.trim().split(' ')[0] : '🪔';

    const title = document.createElement('div');
    title.className = 'stamp-title';
    title.textContent = (item.mood || 'Offline moment').replace(/^[^\s]+\s+/, '');

    const date = document.createElement('div');
    date.className = 'stamp-date';
    date.textContent = item.date;

    stamp.appendChild(icon);
    stamp.appendChild(title);
    stamp.appendChild(date);
    c.appendChild(stamp);
  });
}

function saveReflection() {
  const mood = selectedMood ? selectedMood.textContent : '🪔  Offline moment';
  const note = reflectionNote ? reflectionNote.value.trim() : '';
  try {
    const stored = JSON.parse(localStorage.getItem('offlinemode_reflections') || '[]');
    stored.push({ date: new Date().toISOString().slice(0, 10), mood: mood, note: note });
    localStorage.setItem('offlinemode_reflections', JSON.stringify(stored));
  } catch (err) {}

  if (reflectionNote) reflectionNote.value = '';
  if (reflectionSaved) reflectionSaved.hidden = false;
  renderStamps();
}

document.getElementById('reflection-save')?.addEventListener('click', saveReflection);

document.getElementById('offline-back')?.addEventListener('click', function () {
  if (reflectionSaved) reflectionSaved.hidden = true;
  showView('view-reflection');
});

/* ---------- Init ---------- */
resetTimer();
renderTimer();
pickIdea();
renderStamps();
showView('home');

/* ---------- Scroll-Reveal (movement on scroll) ---------- */
(function initReveal() {
  const targets = document.querySelectorAll(
    '.scene .paper-card, .scene .ritual, .scene .courtyard, .scene .idea, .scene .exit, .scene .section-heading, .arrival'
  );
  if (!targets.length || !('IntersectionObserver' in window)) return;

  targets.forEach(function (el, i) {
    el.classList.add('reveal');
    el.style.transitionDelay = (i % 3) * 90 + 'ms';
  });

  const io = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -60px 0px' });

  targets.forEach(function (el) { io.observe(el); });
})();