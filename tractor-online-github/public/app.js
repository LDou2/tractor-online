'use strict';
/* Tractor online — browser client (vanilla JS, no build step). */

const socket = io();
const $ = (id) => document.getElementById(id);

let mySeat = -1;
let myCode = '';
let state = null;
let selected = new Set();

// ---------- i18n (English / 中文） ----------
// Every user-visible string the client produces lives in this dictionary.
// Static page text is wired up with data-i18n / data-i18n-html /
// data-i18n-ph attributes in index.html; dynamic strings go through t().
// Deliberately NOT translated: the two rules boxes on the entry page
// (already bilingual), player names, room codes, chat text, and the
// server-sent room log lines.
const I18N = {
  en: {
    docTitle: 'Tractor Online （升级拖拉机）',
    titleText: '🚜 Tractor Online ',
    sub: 'Real-time multiplayer Shengji — host it yourself, play with friends.',
    yourName: 'Your name ',
    namePh: 'e.g. Alex',
    tableSize: 'Table size ',
    size2v2: '2 v 2', size3v3: '3 v 3', size4v4: '4 v 4', size5v5: '5 v 5',
    dealSpeed: 'Deal speed ',
    speedInstant: 'Instant — all at once', speedFast: 'Fast', speedNormal: 'Normal', speedSlow: 'Slow',
    createRoom: 'Create Room',
    fixedDivider: 'your fixed room',
    fixedLead: 'This link is for room ',
    fixedTail: '. Type your name above, then:',
    enterRoom: 'Enter Room',
    fixedNote: 'First time, the room is created for you. After that, this same link joins it.',
    orJoin: 'or join',
    roomCode: 'Room code ',
    joinRoom: 'Join Room',
    landingNoteHtml: 'Human multiplayer only — no AI players in this server version.<br>If you disconnect, rejoin with the same name + code to reclaim your seat.',
    roomWord: 'Room ',
    lobbySub: "Share the code (or this page's link) with friends.",
    startRound: 'Start Round',
    leave: 'Leave',
    biddingText: 'Bidding ',
    buryText: 'Bury the bottom ',
    bidHintHtml: 'Bid with your <b>level card</b>: 1 card, or a pair. During the deal you can bid with the level cards you hold so far.<br>A later bid must show more cards: a pair overcalls a single, but a pair cannot overcall a pair (first bidder keeps it).',
    pass: 'Pass',
    buryInfoHtml: 'You picked up the 6 bottom cards. Select <b>exactly 6</b> cards to bury.',
    yourHand: 'Your hand ',
    playSelected: 'Play selected',
    chatPh: 'Chat…',
    send: 'Send',
    enterName: 'Enter your name first.',
    enterCode: 'Enter the room code.',
    seatN: 'Seat {n}',
    you: 'You',
    empty: 'Empty',
    teamGold: 'Gold',
    teamBlue: 'Blue',
    seatLine: '{team} · seat {n}',
    waitingPlayers: 'Waiting for players ({a}/{b})…',
    roundN: 'Round {n}',
    trumpLevel: 'Trump: {sym} · Level {level}',
    defenderPts: 'Defender pts:',
    tricksN: 'Tricks {a}{b}',
    dealingBanner: '🃏 Dealing… {left} card{s} left — bidding is live!',
    bannerCurrentBid: ' Current bid: {name} — {kind} of {sym}',
    bidPair: 'pair',
    bidSingle: '1 card',
    yourTurnBid: '👉 Your turn to bid',
    biddingTurn: '{name} is bidding…',
    youAreDealerBury: '👉 You are 庄家 — bury 6 cards',
    buryingBanner: '{name} is burying the bottom…',
    yourTurnPlay: '👉 Your turn to play',
    playTurn: '{name} to play…',
    roundOverBanner: 'Round over — {team} team wins!',
    matchOverBanner: '🏆 {team} team wins the match!',
    bidStatusDealing: '<b>Dealing…</b> {left} card{s} to go. Bid live with the level cards you hold so far — a closing round in turn follows the deal.',
    bidStatusYourTurn: '<b>Your turn.</b> Bid a trump suit or pass.',
    bidStatusWaiting: 'Waiting for <b>{name}</b>…',
    currentBidLine: 'Current bid: <b>{name}</b> — {kind} of {sym}',
    noBidsYet: 'No bids yet.',
    bidTileLabel: '{kind} · hold {held}',
    bidTilePair: 'pair',
    bidTileSingle: '1 card',
    notePairBid: 'A pair is already bid — no overbid is possible.',
    noteNeedPair: 'Needs 2 cards to overbid — a pair of level cards takes the single.',
    noteNoLevelYet: 'No level cards yet — your bid tiles open as they arrive.',
    bidLogPassed: '{name} passed',
    bidLogFlip: 'bottom flip set {sym} trump',
    bidLogBid: '{name} bid {kind} {sym}',
    bidLogPair: 'pair',
    bidLogSingle: '1',
    burySelected: 'Bury selected ({n}/6)',
    selectExactly6: 'Select exactly 6 cards to bury.',
    noCardsYet: 'No cards on the table yet.',
    playHintText: 'Click cards to select, then Play. Singles, pairs, triples, tractors — or unbeatable singles together.',
    selectCardsFirst: 'Select cards first.',
    resultTitle: 'Round {n} result',
    resultWins: '<b>{team} team</b> wins the round (+{n} level{s}).',
    defenderTotalOpen: 'Defender total: <b>{total}</b> (trick pts {trick}',
    defenderTotalClose: ') · Levels now: ',
    jackReset: '🂡 Defender 抠底 with only Jacks — dealer team reset to level 2.',
    buriedBottom: 'Buried bottom: ',
    nextRound: 'Next Round',
    autoNextNote: 'Next round starts automatically in <b id="auto-count">…</b>s — the button starts it right away.',
    newMatch: 'New Match',
  },
  zh: {
    docTitle: '升级拖拉机（Tractor Online）',
    titleText: '🚜 ',
    sub: '实时多人升级——自己开服务器，和朋友一起玩。',
    yourName: '你的名字 ',
    namePh: '例如：小明',
    tableSize: '桌子人数 ',
    size2v2: '2 对 2', size3v3: '3 对 3', size4v4: '4 对 4', size5v5: '5 对 5',
    dealSpeed: '发牌速度 ',
    speedInstant: '瞬间——一次发完', speedFast: '快', speedNormal: '正常', speedSlow: '慢',
    createRoom: '创建房间',
    fixedDivider: '你的固定房间',
    fixedLead: '此链接对应房间 ',
    fixedTail: '。在上方输入你的名字，然后：',
    enterRoom: '进入房间',
    fixedNote: '第一次打开时会自动为你创建房间；之后用同一链接即可加入。',
    orJoin: '或加入房间',
    roomCode: '房间号 ',
    joinRoom: '加入房间',
    landingNoteHtml: '仅支持真人多人对战——本服务器版本没有 AI 玩家。<br>如果掉线，用相同的名字和房间号重新加入即可回到你的座位。',
    roomWord: '房间 ',
    lobbySub: '把房间号（或本页链接）分享给朋友。',
    startRound: '开始一局',
    leave: '离开',
    biddingText: '',
    buryText: '',
    bidHintHtml: '用你的<b>级牌</b>叫主：单张，或一对。发牌过程中可用已发到手的级牌叫主。<br>后叫者出示的牌必须更多：一对可压单张，但一对不能压一对（先叫者优先）。',
    pass: '过',
    buryInfoHtml: '你拿起了 6 张底牌。请选择<b>正好 6</b> 张牌扣下。',
    yourHand: '你的手牌 ',
    playSelected: '出牌',
    chatPh: '聊天…',
    send: '发送',
    enterName: '请先输入你的名字。',
    enterCode: '请输入房间号。',
    seatN: '{n} 号',
    you: '你',
    empty: '空位',
    teamGold: '金队',
    teamBlue: '蓝队',
    seatLine: '{team} · {n} 号座位',
    waitingPlayers: '等待玩家加入（{a}/{b}）…',
    roundN: '第 {n} 局',
    trumpLevel: '主牌：{sym} · 级牌 {level}',
    defenderPts: '防守方得分：',
    tricksN: '墩数 {a}{b}',
    dealingBanner: '🃏 发牌中…还剩 {left} 张——可以叫主了！',
    bannerCurrentBid: ' 当前叫主：{name} — {sym}{kind}',
    bidPair: '一对',
    bidSingle: '单张',
    yourTurnBid: '👉 轮到你叫主',
    biddingTurn: '{name} 叫主中…',
    youAreDealerBury: '👉 你是庄家——请扣 6 张底牌',
    buryingBanner: '{name} 正在扣底…',
    yourTurnPlay: '👉 轮到你出牌',
    playTurn: '轮到 {name} 出牌…',
    roundOverBanner: '本局结束——{team}获胜！',
    matchOverBanner: '🏆 {team}赢得全场！',
    bidStatusDealing: '<b>发牌中…</b>还剩 {left} 张。用你已拿到的级牌实时叫主——发牌结束后还有一轮轮流叫主。',
    bidStatusYourTurn: '<b>轮到你了。</b>叫一个主牌花色，或过。',
    bidStatusWaiting: '等待 <b>{name}</b>…',
    currentBidLine: '当前叫主：<b>{name}</b> — {sym}{kind}',
    noBidsYet: '尚无人叫主。',
    bidTileLabel: '{kind} · 有 {held} 张',
    bidTilePair: '一对',
    bidTileSingle: '单张',
    notePairBid: '已有人叫了一对——无法再压。',
    noteNeedPair: '需要一对才能压过——一对级牌可压单张。',
    noteNoLevelYet: '还没有级牌——发到级牌后叫主按钮会自动开放。',
    bidLogPassed: '{name} 过',
    bidLogFlip: '翻底定主：{sym} 为主',
    bidLogBid: '{name} 叫 {sym}{kind}',
    bidLogPair: '一对',
    bidLogSingle: '单张',
    burySelected: '扣所选牌（{n}/6）',
    selectExactly6: '请选择正好 6 张牌扣下。',
    noCardsYet: '桌上还没有牌。',
    playHintText: '点选手牌，再点“出牌”。可出单张、对子、三张、拖拉机，也可甩出多张单张。',
    selectCardsFirst: '请先选牌。',
    resultTitle: '第 {n} 局结果',
    resultWins: '<b>{team}</b> 赢下本局（升 {n} 级）。',
    defenderTotalOpen: '防守方总分：<b>{total}</b>（墩分 {trick}',
    defenderTotalClose: '）· 当前级别：',
    jackReset: '🂡 防守方抠底牌全是 J——庄家队打回 2 级。',
    buriedBottom: '所扣底牌：',
    nextRound: '下一局',
    autoNextNote: '下一局将在 <b id="auto-count">…</b> 秒后自动开始——点按钮立即开始。',
    newMatch: '新对局',
  },
};

let lang = 'en';
try { if (localStorage.getItem('tractor-lang') === 'zh') lang = 'zh'; } catch (e) { /* private mode */ }

function t(key, vars) {
  let s = (I18N[lang] && I18N[lang][key]) || I18N.en[key] || key;
  if (vars) for (const k of Object.keys(vars)) s = s.split('{' + k + '}').join(String(vars[k]));
  return s;
}

// The server sends team names as 'Gold' / 'Blue'; only the label is local.
function teamLabel(name) {
  if (name === 'Gold') return t('teamGold');
  if (name === 'Blue') return t('teamBlue');
  return name;
}

// Static text: elements carrying data-i18n get their text from the
// dictionary. When the element also contains markup (a label wrapping an
// input, a heading with a Chinese suffix span), only its first text node
// is replaced, so the inner elements — and their own data-i18n — survive.
function applyStaticI18n() {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const val = t(el.getAttribute('data-i18n'));
    const textNode = [...el.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
    if (el.children.length && textNode) textNode.textContent = val;
    else el.textContent = val;
  });
  document.querySelectorAll('[data-i18n-html]').forEach((el) => { el.innerHTML = t(el.getAttribute('data-i18n-html')); });
  document.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.getAttribute('data-i18n-ph')); });
}

function setLang(l, save) {
  lang = l === 'zh' ? 'zh' : 'en';
  if (save) { try { localStorage.setItem('tractor-lang', lang); } catch (e) { /* ignore */ } }
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  document.title = t('docTitle');
  $('lang-en').classList.toggle('on', lang === 'en');
  $('lang-zh').classList.toggle('on', lang === 'zh');
  applyStaticI18n();
  if (state) render();
}
$('lang-en').onclick = () => setLang('en', true);
$('lang-zh').onclick = () => setLang('zh', true);
setLang(lang, false);

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
const seatName = (s) => (state.seats[s] && state.seats[s].name) || t('seatN', { n: s + 1 });

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
  if (!name) return toast(t('enterName'));
  socket.emit('createRoom', { name, tableSize: $('in-size').value, dealSpeed: $('in-speed').value });
};
$('btn-join').onclick = () => {
  const name = $('in-name').value.trim();
  const code = $('in-code').value.trim().toUpperCase();
  if (!name) return toast(t('enterName'));
  if (!code) return toast(t('enterCode'));
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
  if (!name) return toast(t('enterName'));
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
    const label = s.name ? esc(s.name) : t('empty');
    const you = i === mySeat ? `<span class="you-tag">${t('you')}</span>` : '';
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
    const line = t('seatLine', { team: teamLabel(s.teamName), n: i + 1 });
    d.innerHTML = s.name
      ? `<div class="nm">${esc(s.name)}</div><div class="tm-${s.teamName.toLowerCase()}">${line}</div>`
      : `<div class="nm">${t('empty')}</div><div>${line}</div>`;
    el.appendChild(d);
  });
  const full = state.seats.every((s) => s.name);
  $('btn-start').disabled = !full;
  $('lobby-err').textContent = full ? '' : t('waitingPlayers', { a: state.seats.filter((s) => s.name).length, b: state.tableSize });
}
$('btn-start').onclick = () => socket.emit('startRound');
$('btn-leave-lobby').onclick = () => { socket.emit('leaveRoom'); location.search = ''; location.reload(); };

function renderScorebar() {
  const g = state.game;
  $('scorebar').innerHTML =
    `<span class="gold">${t('teamGold')} ${state.levels[0]}</span><span>vs</span><span class="blue">${t('teamBlue')} ${state.levels[1]}</span>` +
    `<span>${t('roundN', { n: state.roundNo })}</span>` +
    (g && g.trumpSuit ? `<span>${t('trumpLevel', { sym: SUIT_SYM[g.trumpSuit], level: state.roundLevel })}</span>` : '') +
    (mySeat >= 0 ? `<span class="me-name">${esc(seatName(mySeat))} (${esc(teamLabel(state.seats[mySeat].teamName))})</span>` : '') +
    (g ? `<span class="pts-chip">${t('defenderPts')} <b>${g.defenderPoints}</b></span><span>${t('tricksN', { a: g.tricksPlayed, b: g.tricksTotal ? '/' + g.tricksTotal : '' })}</span>` : '') +
    (g && g.dealerSeat >= 0 ? `<span>庄家: ${esc(seatName(g.dealerSeat))}</span>` : '');
}

function renderBanner() {
  const b = $('phase-banner');
  const g = state.game;
  // From round 2 the 庄家 is predetermined before the deal (the server
  // sends dealerSeat with the dealing/bidding state); name them so the
  // table knows whose bottom it will be. Round 1 has none yet (-1).
  const dealerNote = state.dealerSeat >= 0 ? ` · 庄家: ${esc(seatName(state.dealerSeat))}` : '';
  if (state.phase === 'dealing') {
    const left = state.deal ? state.deal.cardsLeft : 0;
    const cur = state.bid && state.bid.current;
    b.textContent = t('dealingBanner', { left, s: left === 1 ? '' : 's' }) +
      (cur ? t('bannerCurrentBid', { name: seatName(cur.seat), kind: t(cur.cards === 2 ? 'bidPair' : 'bidSingle'), sym: SUIT_SYM[cur.suit] }) : '') +
      dealerNote;
  } else if (state.phase === 'bidding') {
    const turn = state.bid.turn === mySeat ? t('yourTurnBid') : t('biddingTurn', { name: seatName(state.bid.turn) });
    b.textContent = turn + dealerNote;
  } else if (state.phase === 'burying') {
    b.textContent = g.dealerSeat === mySeat ? t('youAreDealerBury') : t('buryingBanner', { name: seatName(g.dealerSeat) });
  } else if (state.phase === 'playing') {
    b.textContent = g.turn === mySeat ? t('yourTurnPlay') : t('playTurn', { name: seatName(g.turn) });
  } else if (state.phase === 'roundOver') {
    b.textContent = t('roundOverBanner', { team: teamLabel(state.lastResult.winnerName) });
  } else if (state.phase === 'matchOver') {
    b.textContent = t('matchOverBanner', { team: teamLabel(state.matchWinner === 0 ? 'Gold' : 'Blue') });
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
    $('bid-status').innerHTML = t('bidStatusDealing', { left, s: left === 1 ? '' : 's' });
  } else {
    const mine = b.turn === mySeat;
    $('bid-status').innerHTML = mine
      ? t('bidStatusYourTurn')
      : t('bidStatusWaiting', { name: esc(seatName(b.turn)) });
  }
  $('bid-current').innerHTML = cur
    ? t('currentBidLine', { name: esc(seatName(cur.seat)), kind: t(cur.cards === 2 ? 'bidTilePair' : 'bidTileSingle'), sym: SUIT_SYM[cur.suit] })
    : t('noBidsYet');
  $('bid-current').classList.toggle('has-bid', !!cur);
  const grid = $('bid-buttons');
  grid.innerHTML = '';
  for (const s of ['S', 'H', 'D', 'C']) {
    const held = heldCount(s);
    for (const n of [1, 2]) {
      const btn = document.createElement('button');
      btn.innerHTML = `${SUIT_SYM[s]}<small>${t('bidTileLabel', { kind: t(n === 2 ? 'bidTilePair' : 'bidTileSingle'), held })}</small>`;
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
    note.textContent = t('notePairBid');
  } else if (cur && cur.cards === 1) {
    const canOver = ['S', 'H', 'D', 'C'].some((s) => heldCount(s) >= 2);
    note.textContent = canOver ? '' : t('noteNeedPair');
  } else if (phase === 'dealing' && !['S', 'H', 'D', 'C'].some((s) => heldCount(s) >= 1)) {
    note.textContent = t('noteNoLevelYet');
  } else {
    note.textContent = '';
  }
  const pass = $('btn-pass-bid');
  pass.classList.toggle('hidden', phase === 'dealing');
  pass.disabled = phase !== 'bidding' || b.turn !== mySeat;
  pass.onclick = () => socket.emit('passBid');
  const logHtml = b.log.slice(-8).map((e) => {
    if (e.pass) return t('bidLogPassed', { name: esc(seatName(e.seat)) });
    if (e.flipped) return t('bidLogFlip', { sym: SUIT_SYM[e.suit] });
    return t('bidLogBid', { name: esc(seatName(e.seat)), kind: t(e.cards === 2 ? 'bidLogPair' : 'bidLogSingle'), sym: SUIT_SYM[e.suit] });
  }).join(' · ');
  if (logHtml) $('bid-status').innerHTML += `<br><span class="hint">${logHtml}</span>`;
}

function renderBury() {
  const p = $('bury-panel');
  const show = state.phase === 'burying' && state.game.dealerSeat === mySeat;
  p.classList.toggle('hidden', !show);
  if (show) $('btn-bury').textContent = t('burySelected', { n: selected.size });
}
$('btn-bury').onclick = () => {
  if (selected.size !== 6) return toast(t('selectExactly6'));
  socket.emit('bury', { cardIds: [...selected] });
};

function renderTable() {
  const tbl = $('table');
  const g = state.game;
  tbl.innerHTML = '';
  if (!g || !g.trick) {
    tbl.innerHTML = `<span class="hint">${t('noCardsYet')}</span>`;
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
    tbl.appendChild(d);
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
      if (state.phase === 'burying') $('btn-bury').textContent = t('burySelected', { n: selected.size });
    };
    el.appendChild(card);
  }
  const pb = $('btn-play');
  const showPlay = state.phase === 'playing' && state.game.turn === mySeat;
  pb.classList.toggle('hidden', !showPlay);
  $('play-hint').textContent = showPlay
    ? t('playHintText')
    : '';
}
$('btn-play').onclick = () => {
  if (!selected.size) return toast(t('selectCardsFirst'));
  socket.emit('play', { cardIds: [...selected] });
};

function renderResult() {
  const p = $('result-panel');
  const r = state.lastResult;
  const show = (state.phase === 'roundOver' || state.phase === 'matchOver') && r;
  p.classList.toggle('hidden', !show);
  if (!show) return;
  const lv = r.winnerTeam === (state.game ? state.game.dealerTeam : -1) ? r.dealerLevels : r.defenderLevels;
  p.innerHTML =
    `<h3>${t('resultTitle', { n: r.roundNo })}</h3>` +
    `<p>${t('resultWins', { team: teamLabel(r.winnerName), n: lv, s: lv > 1 ? 's' : '' })}</p>` +
    `<p>${t('defenderTotalOpen', { total: r.defenderTotal, trick: r.defenderTrickPoints })}` +
    (r.defendersWonLastTrick ? ` + 抠底 2×${r.bottomPoints}` : '') + t('defenderTotalClose') +
    `<span class="gold" style="color:#ffd34d">${t('teamGold')} ${r.levels[0]}</span> / ` +
    `<span style="color:#8ecbff">${t('teamBlue')} ${r.levels[1]}</span></p>` +
    (r.jackReset ? `<p>${t('jackReset')}</p>` : '') +
    `<p class="hint">${t('buriedBottom')}${r.buried.map(miniHTML).join(' ')}</p>` +
    (state.phase === 'roundOver' ? `<button id="btn-next" class="primary">${t('nextRound')}</button>` +
      (state.autoNextAt ? `<p class="hint">${t('autoNextNote')}</p>` : '') : '') +
    (state.phase === 'matchOver' ? `<button id="btn-newmatch" class="primary">${t('newMatch')}</button>` : '');
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
