'use strict';
/* Tractor online — browser client (vanilla JS, no build step). */

const socket = io();
const $ = (id) => document.getElementById(id);

let mySeat = -1;
let myCode = '';
let state = null;
let selected = new Set();

const SUIT_SYM = { S: '♠', H: '♥', D: '♦', C: '♣' };
function rankLabel(r) {
  if (r === 'SJ') return '小王';
  if (r === 'BJ') return '大王';
  return { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' }[r] || String(r);
}
function cardHTML(c, cls) {
  const red = (c.suit === 'H' || c.suit === 'D') ? ' red' : '';
  const sym = c.suit ? SUIT_SYM[c.suit] : (c.rank === 'BJ' ? '🃏' : '🂠');
  return `<div class="${cls}${red}" data-id="${c.id}">
    <div class="r">${rankLabel(c.rank)}${c.suit ? sym : ''}</div>
    <div class="s">${sym}</div></div>`;
}
const miniHTML = (c) => {
  const red = (c.suit === 'H' || c.suit === 'D') ? ' red' : '';
  const sym = c.suit ? SUIT_SYM[c.suit] : (c.rank === 'BJ' ? '🃏' : '🂠');
  return `<span class="mini${red}">${rankLabel(c.rank)}${sym}</span>`;
};
const seatName = (s) => (state.seats[s] && state.seats[s].name) || `Seat ${s + 1}`;

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.add('hidden'), 3500);
}

// ---------- landing ----------
$('btn-create').onclick = () => {
  const name = $('in-name').value.trim();
  if (!name) return toast('Enter your name first.');
  socket.emit('createRoom', { name, tableSize: $('in-size').value, dealSpeed: $('in-speed').value });
};
$('btn-join').onclick = () => {
  const name = $('in-name').value.trim();
  const code = $('in-code').value.trim().toUpperCase();
  if (!name) return toast('Enter your name first.');
  if (!code) return toast('Enter the room code.');
  socket.emit('joinRoom', { name, code });
};
const urlCode = (new URLSearchParams(location.search).get('code') || '').trim().toUpperCase();
(function () {
  if (!urlCode) return;
  $('in-code').value = urlCode;
  $('fixed-code').textContent = urlCode;
  $('fixed-room').classList.remove('hidden');
})();
$('btn-enter').onclick = () => {
  const name = $('in-name').value.trim();
  if (!name) return toast('Enter your name first.');
  socket.emit('enterRoom', { name, code: urlCode, tableSize: $('in-size').value, dealSpeed: $('in-speed').value });
};

socket.on('joined', ({ code, seat }) => {
  myCode = code; mySeat = seat;
  history.replaceState(null, '', `?code=${code}`);
});
socket.on('errorMsg', (msg) => toast(msg));
socket.on('chatMsg', ({ from, text }) => {
  const d = document.createElement('div');
  d.innerHTML = `<span class="chat-from">${esc(from)}:</span> ${esc(text)}`;
  $('chatlog').appendChild(d);
  $('chatlog').scrollTop = 1e6;
});
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- state rendering ----------
socket.on('state', (s) => {
  state = s;
  selected = new Set([...selected].filter((id) => s.you.hand.some((c) => c.id === id)));
  render();
});

function showView(id) {
  for (const v of ['view-landing', 'view-lobby', 'view-game']) $(v).classList.toggle('hidden', v !== id);
}

function render() {
  if (!state) return;
  renderPlayersBar();
  if (state.phase === 'lobby') { showView('view-lobby'); renderLobby(); return; }
  showView('view-game');
  renderScorebar();
  renderBanner();
  renderBid();
  renderBury();
  renderTable();
  renderHand();
  renderResult();
  renderLog();
}

// Seat whose turn it is to act right now; -1 when nobody acts (lobby,
// dealing, round/match over). Mirrors the server's currentActor.
function actorSeat() {
  if (!state) return -1;
  if (state.phase === 'bidding' && state.bid) return state.bid.turn;
  if (state.phase === 'burying' && state.game) return state.game.dealerSeat;
  if (state.phase === 'playing' && state.game) return state.game.turn;
  return -1;
}

// Players bar: one chip per seat in seat order (teams alternate Gold/Blue
// around the table), the acting player's chip highlighted, own chip tagged.
function renderPlayersBar() {
  const actor = actorSeat();
  const html = state.seats.map((s, i) => {
    const cls = 'pchip ' + s.teamName.toLowerCase() +
      (s.name ? '' : ' empty') +
      (s.name && !s.connected ? ' offline' : '') +
      (i === actor ? ' active' : '');
    const label = s.name ? esc(s.name) : 'Empty';
    const you = i === mySeat ? '<span class="you-tag">You</span>' : '';
    return `<span class="${cls}"><span class="pname">${label}</span>${you}</span>`;
  }).join('');
  for (const id of ['players-bar', 'players-bar-lobby']) {
    const el = $(id);
    if (el) el.innerHTML = html;
  }
}

function renderLobby() {
  $('lobby-code').textContent = state.code;
  const el = $('lobby-seats');
  el.innerHTML = '';
  state.seats.forEach((s, i) => {
    const d = document.createElement('div');
    d.className = 'seat' + (s.name ? '' : ' empty') + (i === mySeat ? ' me' : '');
    d.innerHTML = s.name
      ? `<div class="nm">${esc(s.name)}</div><div class="tm-${s.teamName.toLowerCase()}">${s.teamName} · seat ${i + 1}</div>`
      : `<div class="nm">Empty</div><div>${s.teamName} · seat ${i + 1}</div>`;
    el.appendChild(d);
  });
  const full = state.seats.every((s) => s.name);
  $('btn-start').disabled = !full;
  $('lobby-err').textContent = full ? '' : `Waiting for players (${state.seats.filter((s) => s.name).length}/${state.tableSize})…`;
}
$('btn-start').onclick = () => socket.emit('startRound');
$('btn-leave-lobby').onclick = () => { socket.emit('leaveRoom'); location.search = ''; location.reload(); };

function renderScorebar() {
  const g = state.game;
  $('scorebar').innerHTML =
    `<span class="gold">Gold ${state.levels[0]}</span><span>vs</span><span class="blue">Blue ${state.levels[1]}</span>` +
    `<span>Round ${state.roundNo}</span>` +
    (g && g.trumpSuit ? `<span>Trump: ${SUIT_SYM[g.trumpSuit]} · Level ${state.roundLevel}</span>` : '') +
    (mySeat >= 0 ? `<span class="me-name">${esc(seatName(mySeat))} (${esc(state.seats[mySeat].teamName)})</span>` : '') +
    (g ? `<span class="pts-chip">Defender pts: <b>${g.defenderPoints}</b></span><span>Tricks ${g.tricksPlayed}${g.tricksTotal ? '/' + g.tricksTotal : ''}</span>` : '') +
    (g && g.dealerSeat >= 0 ? `<span>庄家: ${esc(seatName(g.dealerSeat))}</span>` : '');
}

function renderBanner() {
  const b = $('phase-banner');
  const g = state.game;
  if (state.phase === 'dealing') {
    const left = state.deal ? state.deal.cardsLeft : 0;
    const cur = state.bid && state.bid.current;
    b.textContent = `🃏 Dealing… ${left} card${left === 1 ? '' : 's'} left — bidding is live!` +
      (cur ? ` Current bid: ${seatName(cur.seat)} — ${cur.cards === 2 ? 'pair' : '1 card'} of ${SUIT_SYM[cur.suit]}` : '');
  } else if (state.phase === 'bidding') {
    const t = state.bid.turn === mySeat ? '👉 Your turn to bid' : `${esc(seatName(state.bid.turn))} is bidding…`;
    b.textContent = t;
  } else if (state.phase === 'burying') {
    b.textContent = g.dealerSeat === mySeat ? '👉 You are 庄家 — bury 6 cards' : `${esc(seatName(g.dealerSeat))} is burying the bottom…`;
  } else if (state.phase === 'playing') {
    b.textContent = g.turn === mySeat ? '👉 Your turn to play' : `${esc(seatName(g.turn))} to play…`;
  } else if (state.phase === 'roundOver') {
    b.textContent = `Round over — ${state.lastResult.winnerName} team wins!`;
  } else if (state.phase === 'matchOver') {
    b.textContent = `🏆 ${state.matchWinner === 0 ? 'Gold' : 'Blue'} team wins the match!`;
  } else b.textContent = '';
}

function renderBid() {
  const p = $('bid-panel');
  const phase = state.phase;
  if (phase !== 'bidding' && phase !== 'dealing') { p.classList.add('hidden'); return; }
  p.classList.remove('hidden');
  const b = state.bid || { turn: -1, current: null, log: [] };
  const cur = b.current;
  const level = state.roundLevel;
  const heldCount = (s) => state.you.hand.filter((c) => c.suit === s && c.rank === level).length;
  if (phase === 'dealing') {
    const left = state.deal ? state.deal.cardsLeft : 0;
    $('bid-status').innerHTML = `<b>Dealing…</b> ${left} card${left === 1 ? '' : 's'} to go. Bid live with the level cards you hold so far — a closing round in turn follows the deal.`;
  } else {
    const mine = b.turn === mySeat;
    $('bid-status').innerHTML = mine
      ? '<b>Your turn.</b> Bid a trump suit or pass.'
      : `Waiting for <b>${esc(seatName(b.turn))}</b>…`;
  }
  $('bid-current').innerHTML = cur
    ? `Current bid: <b>${esc(seatName(cur.seat))}</b> — ${cur.cards === 2 ? 'pair' : '1 card'} of ${SUIT_SYM[cur.suit]}`
    : 'No bids yet.';
  $('bid-current').classList.toggle('has-bid', !!cur);
  const grid = $('bid-buttons');
  grid.innerHTML = '';
  for (const s of ['S', 'H', 'D', 'C']) {
    const held = heldCount(s);
    for (const n of [1, 2]) {
      const btn = document.createElement('button');
      btn.innerHTML = `${SUIT_SYM[s]}<small>${n === 2 ? 'pair' : '1 card'} · hold ${held}</small>`;
      if (s === 'H' || s === 'D') btn.classList.add('red');
      // Bids are only ever 1 or 2 cards. During the deal a tile is live
      // when the level cards are already in hand and the bid would show
      // more cards than the standing bid; in the closing round the tiles
      // follow the turn, as before.
      btn.disabled = phase === 'dealing'
        ? (held < n || (cur && n <= cur.cards))
        : (b.turn !== mySeat);
      btn.onclick = () => socket.emit('bid', { suit: s, cards: n });
      grid.appendChild(btn);
    }
  }
  const note = $('bid-note');
  if (cur && cur.cards === 2) {
    note.textContent = 'A pair is already bid — no overbid is possible.';
  } else if (cur && cur.cards === 1) {
    const canOver = ['S', 'H', 'D', 'C'].some((s) => heldCount(s) >= 2);
    note.textContent = canOver ? '' : 'Needs 2 cards to overbid — a pair of level cards takes the single.';
  } else if (phase === 'dealing' && !['S', 'H', 'D', 'C'].some((s) => heldCount(s) >= 1)) {
    note.textContent = 'No level cards yet — your bid tiles open as they arrive.';
  } else {
    note.textContent = '';
  }
  const pass = $('btn-pass-bid');
  pass.classList.toggle('hidden', phase === 'dealing');
  pass.disabled = phase !== 'bidding' || b.turn !== mySeat;
  pass.onclick = () => socket.emit('passBid');
  const logHtml = b.log.slice(-8).map((e) => {
    if (e.pass) return `${esc(seatName(e.seat))} passed`;
    if (e.flipped) return `bottom flip set ${SUIT_SYM[e.suit]} trump`;
    return `${esc(seatName(e.seat))} bid ${e.cards === 2 ? 'pair' : '1'} ${SUIT_SYM[e.suit]}`;
  }).join(' · ');
  if (logHtml) $('bid-status').innerHTML += `<br><span class="hint">${logHtml}</span>`;
}

function renderBury() {
  const p = $('bury-panel');
  const show = state.phase === 'burying' && state.game.dealerSeat === mySeat;
  p.classList.toggle('hidden', !show);
  if (show) $('btn-bury').textContent = `Bury selected (${selected.size}/6)`;
}
$('btn-bury').onclick = () => {
  if (selected.size !== 6) return toast('Select exactly 6 cards to bury.');
  socket.emit('bury', { cardIds: [...selected] });
};

function renderTable() {
  const t = $('table');
  const g = state.game;
  t.innerHTML = '';
  if (!g || !g.trick) {
    t.innerHTML = '<span class="hint">No cards on the table yet.</span>';
    return;
  }
  const order = [];
  const n = state.tableSize;
  const first = g.trick.plays[0].seat;
  for (let k = 0; k < n; k++) order.push((first + k) % n);
  for (const s of order) {
    const play = g.trick.plays.find((p) => p.seat === s);
    const d = document.createElement('div');
    d.className = 'trick-play';
    d.innerHTML = `<div class="who${g.turn === s ? ' turn' : ''}">${esc(seatName(s))}</div>` +
      `<div class="mini-cards">${play ? play.cards.map(miniHTML).join('') : '<span class="hint">…</span>'}</div>`;
    t.appendChild(d);
  }
}

function renderHand() {
  const hz = $('hand-zone');
  const show = ['dealing', 'bidding', 'burying', 'playing'].includes(state.phase);
  hz.classList.toggle('hidden', !show);
  if (!show) return;
  const hand = state.you.hand;
  $('hand-count').textContent = `(${hand.length})`;
  const el = $('hand');
  el.innerHTML = '';
  const canAct =
    (state.phase === 'playing' && state.game.turn === mySeat) ||
    (state.phase === 'burying' && state.game.dealerSeat === mySeat);
  for (const c of hand) {
    const w = document.createElement('div');
    w.innerHTML = cardHTML(c, 'card');
    const card = w.firstChild;
    if (selected.has(c.id)) card.classList.add('sel');
    if (canAct) card.onclick = () => {
      if (selected.has(c.id)) selected.delete(c.id); else selected.add(c.id);
      renderHand();
      if (state.phase === 'burying') $('btn-bury').textContent = `Bury selected (${selected.size}/6)`;
    };
    el.appendChild(card);
  }
  const pb = $('btn-play');
  const showPlay = state.phase === 'playing' && state.game.turn === mySeat;
  pb.classList.toggle('hidden', !showPlay);
  $('play-hint').textContent = showPlay
    ? 'Click cards to select, then Play. Singles, pairs, triples, tractors — or unbeatable singles together.'
    : '';
}
$('btn-play').onclick = () => {
  if (!selected.size) return toast('Select cards first.');
  socket.emit('play', { cardIds: [...selected] });
};

function renderResult() {
  const p = $('result-panel');
  const r = state.lastResult;
  const show = (state.phase === 'roundOver' || state.phase === 'matchOver') && r;
  p.classList.toggle('hidden', !show);
  if (!show) return;
  p.innerHTML =
    `<h3>Round ${r.roundNo} result</h3>` +
    `<p><b>${r.winnerName} team</b> wins the round ` +
    (r.winnerTeam === (state.game ? state.game.dealerTeam : -1)
      ? `(+${r.dealerLevels} level${r.dealerLevels > 1 ? 's' : ''})`
      : `(+${r.defenderLevels} level${r.defenderLevels > 1 ? 's' : ''})`) + `.</p>` +
    `<p>Defender total: <b>${r.defenderTotal}</b> (trick pts ${r.defenderTrickPoints}` +
    (r.defendersWonLastTrick ? ` + 抠底 2×${r.bottomPoints}` : '') + `) · ` +
    `Levels now: <span class="gold" style="color:#ffd34d">Gold ${r.levels[0]}</span> / ` +
    `<span style="color:#8ecbff">Blue ${r.levels[1]}</span></p>` +
    (r.jackReset ? `<p>🂡 Defender 抠底 with only Jacks — dealer team reset to level 2.</p>` : '') +
    `<p class="hint">Buried bottom: ${r.buried.map(miniHTML).join(' ')}</p>` +
    (state.phase === 'roundOver' ? `<button id="btn-next" class="primary">Next Round</button>` +
      (state.autoNextAt ? `<p class="hint">Next round starts automatically in <b id="auto-count">…</b>s — the button starts it right away.</p>` : '') : '') +
    (state.phase === 'matchOver' ? `<button id="btn-newmatch" class="primary">New Match</button>` : '');
  const nb = $('btn-next');
  if (nb) nb.onclick = () => socket.emit('startRound');
  const nm = $('btn-newmatch');
  if (nm) nm.onclick = () => socket.emit('startRound');
}

// Tick the auto-next-round countdown on the result screen.
setInterval(() => {
  const el = $('auto-count');
  if (el && state && state.autoNextAt) {
    el.textContent = Math.max(0, Math.ceil((state.autoNextAt - Date.now()) / 1000));
  }
}, 500);

function renderLog() {
  $('log').innerHTML = state.log.map((e) => esc(e.msg)).join('<br>');
  $('log').scrollTop = 1e6;
}

// ---------- chat ----------
function sendChat() {
  const v = $('in-chat').value.trim();
  if (v) socket.emit('chat', { text: v });
  $('in-chat').value = '';
}
$('btn-chat').onclick = sendChat;
$('in-chat').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });
