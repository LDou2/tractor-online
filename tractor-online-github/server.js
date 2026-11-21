'use strict';
/*
 * Tractor (Shengji / 升级拖拉机) online server — Express (static client) + Socket.io.
 *
 * Human multiplayer only (no AI). The server is authoritative: every bid,
 * bury and play is validated here against the rules engine (game.js);
 * public state is broadcast to the room and each player receives only
 * their own hand.
 *
 * Bidding (real-table style, like the single-player app):
 *  - The cards are dispatched one at a time at the room's deal speed
 *    (Instant / Fast / Normal / Slow, chosen by the room creator) and
 *    bidding is LIVE during the deal: a bid is validated against the
 *    level cards of that suit the bidder holds so far. A turn-based
 *    closing round follows the deal, with the deal's high bid carried in.
 *  - Bids are made with the round level card (1 card or a pair — there
 *    are no larger bids); a pair bid needs only the pair itself — no
 *    trump-count minimum for humans. A later bid must show MORE cards
 *    than the current one: a pair takes a single, a pair cannot take a
 *    pair (so once a pair stands, no overbid is possible).
 *  - Who is the 庄家 (dealer): in the FIRST round of a match the bid
 *    winner is the 庄家 — picks up the 6 bottom cards, buries 6, leads.
 *    In every later round the 庄家 seat is predetermined before the
 *    deal by rotation from the previous round (see computeNextDealerSeat):
 *    bidding then decides ONLY the trump suit, and the predetermined
 *    庄家 picks up the bottom, buries and leads the first trick.
 *    If nobody bids at all, ALL the bottom cards are flipped one by one
 *    and the suit of the last bottom card is trump (the last suited card
 *    before it if that card is a joker); the 庄家 — round 1: the
 *    designated first-bidder seat — picks up the bottom as usual.
 *  - Defender 抠底 with only Jacks (single/pair/triple) resets the dealer
 *    team to level 2 (house rule from the app).
 *  - Throws (甩牌): a lead of 2+ same-type units (singles/pairs/triples)
 *    of one suit stands only if no other player holds a same-type unit
 *    beating its weakest unit. A failed throw is rejected (cards stay in
 *    hand), the whole room is warned (never naming who blocked it), the
 *    throwing team's captured points are docked 10 per attempted card
 *    (floor 0) at once, and that player's next lead is forced to be the
 *    throw's weakest unit.
 */

const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const G = require('./game');

const PORT = process.env.PORT || 3000;
// Deal dispatch speeds: ms per card, dealt one at a time sequentially
// around the table. Instant (0) deals the whole hand at once, as before.
const DEAL_SPEEDS = { instant: 0, fast: 257, normal: 450, slow: 1200 };
const DEAL_SPEED_NAMES = { instant: 'Instant', fast: 'Fast', normal: 'Normal', slow: 'Slow' };
const normalizeDealSpeed = (s) =>
  (Object.prototype.hasOwnProperty.call(DEAL_SPEEDS, s) ? s : 'fast');
const TURN_MS = 120000; // human action timer
const AUTO_NEXT_MS = 15000; // pause on the result screen, then the next round is dealt automatically
const AWAY_MS = 15000;  // timer for a disconnected seat's turn
const MAX_CHAT_LEN = 200;

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (req, res) => res.json({ ok: true }));

const server = http.createServer(app);
const io = new Server(server);
const rooms = new Map();

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function makeCode() {
  let c;
  do {
    c = '';
    for (let i = 0; i < 6; i++) c += CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0];
  } while (rooms.has(c));
  return c;
}
const cleanName = (n) => String(n || '').trim().slice(0, 16) || 'Player';
const teamName = (seat) => (G.TEAM_OF_SEAT(seat) === 0 ? 'Gold' : 'Blue');
const nameOf = (room, seat) => (room.seats[seat] && room.seats[seat].name) || `Seat ${seat + 1}`;

function newRoom(code, name, socketId, tableSize, dealSpeed) {
  const seats = [];
  for (let i = 0; i < tableSize; i++) seats.push({ name: null, socketId: null, connected: false });
  seats[0] = { name, socketId, connected: true };
  return {
    code, tableSize, dealSpeed: normalizeDealSpeed(dealSpeed), seats,
    phase: 'lobby', // lobby | dealing | bidding | burying | playing | roundOver | matchOver
    levels: [2, 2],
    roundNo: 0,
    dealingTeam: 0,
    lastWinnerTeam: 0,
    nextDealerSeat: null, // predetermined 庄家 seat for the next round (null before round 1 ends)
    matchWinner: -1,
    round: null,
    log: [],
    lastResult: null,
    timer: null,
    dealTimer: null,
  };
}

function log(room, msg) {
  room.log.push({ t: Date.now(), msg });
  if (room.log.length > 40) room.log.shift();
}
const filledSeats = (room) => room.seats.filter((s) => s.name).length;

// --- display sorting (server-side; client just renders) ---------------------
function sortForDisplay(hand, level, trumpSuit) {
  const ord = { T: 0, S: 1, H: 2, D: 3, C: 4 };
  return hand.slice().sort((a, b) => {
    const ea = G.effectiveSuit(a, level, trumpSuit), eb = G.effectiveSuit(b, level, trumpSuit);
    if (ord[ea] !== ord[eb]) return ord[ea] - ord[eb];
    return G.cardStrength(b, level, trumpSuit) - G.cardStrength(a, level, trumpSuit);
  });
}
const pubCard = (c) => ({ id: c.id, suit: c.suit, rank: c.rank });

// --- public state ------------------------------------------------------------
function publicState(room) {
  const r = room.round;
  const st = {
    code: room.code,
    phase: room.phase,
    tableSize: room.tableSize,
    dealSpeed: room.dealSpeed,
    levels: room.levels.slice(),
    roundNo: room.roundNo,
    matchWinner: room.matchWinner,
    autoNextAt: room.autoNextAt || null,
    seats: room.seats.map((s, i) => ({
      seat: i, name: s.name, team: G.TEAM_OF_SEAT(i), teamName: teamName(i),
      connected: s.connected,
      cardCount: r && r.hands ? r.hands[i].length : 0,
      isDealer: !!(r && r.dealerSeat === i),
    })),
    log: room.log.slice(-30),
    lastResult: room.lastResult,
  };
  if (r) {
    st.roundLevel = r.level;
    // The predetermined 庄家 (round 2+) is public from the start of the
    // round, so clients can show who it is during dealing/bidding too;
    // seats[].isDealer above carries the same seat. -1 in round 1, where
    // the bid winner becomes 庄家 only when bidding ends.
    st.dealerSeat = r.dealerSeat;
    if (room.phase === 'bidding' || room.phase === 'dealing') {
      st.bid = {
        turn: room.phase === 'bidding' ? r.bidTurn : -1, // no turns during the dispatch
        dealerSeat: r.dealerSeat,
        current: r.currentBid ? { seat: r.currentBid.seat, suit: r.currentBid.bid.suit, cards: r.currentBid.bid.cards } : null,
        log: r.bids,
      };
      if (room.phase === 'dealing') {
        const total = r.dealHands ? r.dealHands[0].length * room.tableSize : 0;
        st.deal = { cardsLeft: total - r.dealPos, total };
      }
    }
    if (room.phase === 'burying' || room.phase === 'playing') {
      st.game = {
        trumpSuit: r.trumpSuit,
        dealerSeat: r.dealerSeat,
        dealerTeam: G.TEAM_OF_SEAT(r.dealerSeat),
        turn: room.phase === 'playing' ? r.turn : -1,
        defenderPoints: r.defenderTrickPoints,
        tricksPlayed: r.tricksPlayed,
        tricksTotal: null, // no fixed total: pair/tractor plays end the round in fewer tricks
        trick: r.trickPlays.length ? {
          leadType: r.trickLead.type, leadCount: r.trickLead.count,
          plays: r.trickPlays.map((p) => ({ seat: p.seat, cards: p.cards.map(pubCard) })),
        } : null,
      };
    }
  }
  return st;
}

function sendState(room) {
  const pub = publicState(room);
  room.seats.forEach((s, i) => {
    if (s.socketId && s.connected) {
      io.to(s.socketId).emit('state', {
        ...pub,
        you: {
          seat: i,
          hand: room.round && room.round.hands
            ? sortForDisplay(room.round.hands[i], room.round.level, room.round.trumpSuit).map(pubCard)
            : [],
        },
      });
    }
  });
}

// --- timers ------------------------------------------------------------------
function clearTimer(room) {
  if (room.timer) { clearTimeout(room.timer); room.timer = null; }
}
function clearDealTimer(room) {
  if (room.dealTimer) { clearInterval(room.dealTimer); room.dealTimer = null; }
}
function currentActor(room) {
  const r = room.round;
  if (!r) return -1;
  if (room.phase === 'bidding') return r.bidTurn;
  if (room.phase === 'burying') return r.dealerSeat;
  if (room.phase === 'playing') return r.turn;
  return -1;
}
function scheduleTimer(room) {
  clearTimer(room);
  const actor = currentActor(room);
  if (actor < 0) return;
  const ms = room.seats[actor].connected ? TURN_MS : AWAY_MS;
  room.timer = setTimeout(() => onTimeout(room), ms);
}
function onTimeout(room) {
  const actor = currentActor(room);
  if (actor < 0) return;
  log(room, `${nameOf(room, actor)} timed out — auto move.`);
  if (room.phase === 'bidding') passBid(room, actor, true);
  else if (room.phase === 'burying') autoBury(room, actor);
  else if (room.phase === 'playing') autoPlay(room, actor);
}

// --- round lifecycle ----------------------------------------------------------
// 庄家 seat rotation (owner's rule, 2026-11-20): from round 2 on, the
// next 庄家 is decided by the previous round's result, judged on the
// existing points line (the team opposing the 庄家 had to capture
// n*40 — 120 in a 3-deck game — to beat the 庄家's team):
//   - 庄家's team WON  -> the next seat on the SAME team (+2, seats
//     alternate Gold/Blue around the table);
//   - 庄家's team LOST -> the immediate next seat (+1, the other team).
function computeNextDealerSeat(dealerSeat, dealerTeamWon, tableSize) {
  return dealerTeamWon ? (dealerSeat + 2) % tableSize : (dealerSeat + 1) % tableSize;
}

function startRound(room) {
  clearTimeout(room.autoTimer);
  clearDealTimer(room);
  room.autoNextAt = null;
  room.roundNo += 1;
  // The previous round's winning team deals: a winning dealer team stays
  // the ZhuangJia team; defenders become it only by winning (n*40+).
  // That team is also the rotated 庄家 seat's team (same team on a win,
  // the other team on a loss), so the round level below is the 庄家
  // team's own level in every round after the first.
  room.dealingTeam = room.roundNo === 1 ? 0 : room.lastWinnerTeam;
  const level = room.levels[room.dealingTeam];
  const { hands, bottom, nDecks } = G.deal(room.tableSize);
  const firstBidder = (room.roundNo - 1) % room.tableSize;
  // Round 1 has no predetermined 庄家 (the bid winner becomes it);
  // later rounds start with the rotated seat already fixed.
  const predeterminedDealer =
    room.roundNo > 1 && room.nextDealerSeat != null ? room.nextDealerSeat : -1;
  room.round = {
    nDecks, hands, bottom, buried: null,
    level, trumpSuit: null, dealerSeat: predeterminedDealer,
    bids: [], bidTurn: firstBidder,
    bidPassed: new Set(), currentBid: null,
    turn: -1, trickPlays: [], trickLead: null,
    defenderTrickPoints: 0, dealerTrickPoints: 0, tricksPlayed: 0,
    lastTrickWinner: -1, lastWinCards: [],
    forcedLead: null, // set after a failed throw: { seat, cardIds, unitName }
    dealHands: null, dealPos: 0, // dispatch state (timed deal speeds only)
  };
  room.lastResult = null;
  const ms = DEAL_SPEEDS[room.dealSpeed] || 0;
  if (ms > 0) {
    // Real-table dispatch: the bottom cards are already set aside above
    // and are never part of the dispatch. The hands are dealt out one
    // card at a time, in the same round-robin order G.deal produced
    // them, while live bidding runs (see doBid).
    const r = room.round;
    r.dealHands = hands;
    r.hands = hands.map(() => []);
    r.dealPos = 0;
    room.phase = 'dealing';
    log(room, `Round ${room.roundNo} — dispatching cards (${DEAL_SPEED_NAMES[room.dealSpeed]}). Level ${level}; dealing team: ${room.dealingTeam === 0 ? 'Gold' : 'Blue'}.${predeterminedDealer >= 0 ? ` ${nameOf(room, predeterminedDealer)} is 庄家 this round; bidding only sets trump.` : ''} Bidding is live during the deal; ${nameOf(room, firstBidder)} starts the closing round.`);
    sendState(room);
    room.dealTimer = setInterval(() => dealTick(room), ms);
    if (room.dealTimer.unref) room.dealTimer.unref();
    return;
  }
  room.phase = 'bidding';
  log(room, `Round ${room.roundNo} dealt. Level ${level}; dealing team: ${room.dealingTeam === 0 ? 'Gold' : 'Blue'}.${predeterminedDealer >= 0 ? ` ${nameOf(room, predeterminedDealer)} is 庄家 this round; bidding only sets trump.` : ''} ${nameOf(room, room.round.bidTurn)} bids first.`);
  sendState(room);
  scheduleTimer(room);
}

// One dispatch step: the next card in round-robin order goes to its seat
// and every player is sent the new state (their own updated hand; the
// others see only the card counts). Exported for the server tests, which
// drive the deal synchronously instead of waiting on the timer.
function dealTick(room) {
  const r = room.round;
  if (!r || room.phase !== 'dealing' || !r.dealHands) { clearDealTimer(room); return; }
  const n = room.tableSize;
  const total = r.dealHands[0].length * n;
  if (r.dealPos >= total) { finishDealing(room); return; }
  const seat = r.dealPos % n;
  const idx = Math.floor(r.dealPos / n);
  r.hands[seat].push(r.dealHands[seat][idx]);
  r.dealPos += 1;
  if (r.dealPos >= total) { finishDealing(room); return; }
  sendState(room);
}

// Dispatch finished: the turn-based bidding runs as a closing round. The
// high bid from the deal (if any) carries in; the pass count starts
// fresh, and the first bidder opens the round.
function finishDealing(room) {
  clearDealTimer(room);
  const r = room.round;
  r.dealHands = null;
  room.phase = 'bidding';
  r.bidPassed = new Set();
  log(room, `All cards dealt — closing bidding round.${r.currentBid
    ? ` Current bid: ${nameOf(room, r.currentBid.seat)} (${suitName(r.currentBid.bid.suit)}, ${r.currentBid.bid.cards === 2 ? 'pair' : '1 card'}).`
    : ' No bids during the deal.'}`);
  sendState(room);
  scheduleTimer(room);
}

function advanceBidTurn(room) {
  const r = room.round;
  r.bidTurn = (r.bidTurn + 1) % room.tableSize;
}

const BID_REASONS = {
  'bad-suit': 'Invalid suit.', 'bad-count': 'Bid 1 or 2 cards.',
  'not-held': 'You do not hold those bid cards (bid with your level card).',
};
function friendlyBidReason(v) {
  return BID_REASONS[v.reason] || 'Invalid bid.';
}

// One bid path for both phases: during 'dealing' anyone may bid at any
// time (validated against their partial hand; no turns, no timers — the
// dispatch keeps running), while the closing 'bidding' round is
// turn-based exactly as before. The overbid rule is the same in both:
// the new bid must show MORE cards than the current high bid (a pair
// takes a single; a pair cannot take a pair, so a standing pair cannot
// be overbid at all). Overbidding your own bid is allowed.
function doBid(room, seat, suit, cards, auto) {
  const r = room.round;
  if (!r || (room.phase !== 'bidding' && room.phase !== 'dealing')) {
    return { ok: false, error: 'Not in bidding.' };
  }
  if (room.phase === 'bidding' && seat !== r.bidTurn) {
    return { ok: false, error: 'Not your turn to bid.' };
  }
  cards = Number(cards);
  const bid = { suit, rank: r.level, cards };
  const v = G.validateBid(r.hands[seat], bid, r.level);
  if (!v.ok) return { ok: false, error: friendlyBidReason(v) };
  if (r.currentBid && !G.bidOutranks(bid, r.currentBid.bid)) {
    return { ok: false, error: 'Does not overcall the current bid (first bidder keeps ties).' };
  }
  r.bids.push({ seat, suit, cards });
  r.currentBid = { seat, bid };
  log(room, `${nameOf(room, seat)} bids ${cards === 2 ? 'a pair' : 'one card'} of ${suitName(suit)}${room.phase === 'dealing' ? ' during the deal' : ''}${auto ? ' (auto)' : ''}.`);
  if (room.phase === 'dealing') {
    sendState(room);
    return { ok: true };
  }
  r.bidPassed = new Set();
  if (!checkBiddingEnd(room)) advanceBidTurn(room);
  sendState(room);
  scheduleTimer(room);
  return { ok: true };
}

function passBid(room, seat, auto) {
  const r = room.round;
  if (!r || room.phase !== 'bidding') return { ok: false, error: 'Not in bidding.' };
  if (seat !== r.bidTurn) return { ok: false, error: 'Not your turn to bid.' };
  r.bids.push({ seat, pass: true });
  r.bidPassed.add(seat);
  if (!auto) log(room, `${nameOf(room, seat)} passes.`);
  if (!checkBiddingEnd(room)) advanceBidTurn(room);
  sendState(room);
  scheduleTimer(room);
  return { ok: true };
}

function checkBiddingEnd(room) {
  const r = room.round;
  const n = room.tableSize;
  if (r.currentBid && r.bidPassed.size >= n - 1) { endBidding(room); return true; }
  if (!r.currentBid && r.bidPassed.size >= n) {
    // Nobody bid at all: flip the bottom (owner's resolution, below).
    resolveNoBid(room);
    return true;
  }
  return false;
}

const SUIT_SYM = { S: '♠', H: '♥', D: '♦', C: '♣' };
const RANK_SHORT = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
function cardShort(c) {
  if (!c.suit) return c.rank === 'BJ' ? '大王' : '小王';
  return `${SUIT_SYM[c.suit]}${RANK_SHORT[c.rank] || c.rank}`;
}

// No-bid resolution (owner's rule, updated 2026-11-20): flip through
// ALL the bottom cards one by one (the flip is shown in the room log and
// carried in the bid log / state) — the suit of the LAST card in the
// bottom is trump. If that last card is a joker (no suit), trump is the
// suit of the last suited card before it; a bottom with no suited card
// at all falls back to ♠ (kept from the original flip logic). The
// 庄家 — round 1: the designated first-bidder seat (seat 0); later
// rounds: the predetermined 庄家 — then picks up the bottom and buries.
function resolveNoBid(room) {
  const r = room.round;
  const seat = r.dealerSeat >= 0 ? r.dealerSeat : (room.roundNo - 1) % room.tableSize;
  const flipped = r.bottom.slice(); // every bottom card, in bottom order
  let trumpSuit = null;
  for (const c of flipped) {
    if (c.suit) trumpSuit = c.suit; // ends as the last suited card's suit
  }
  // (A bottom of nothing but jokers has no suit at all — fall back to ♠.)
  if (!trumpSuit) trumpSuit = 'S';
  r.currentBid = {
    seat, bid: { suit: trumpSuit, rank: r.level, cards: 0 }, flipped: true,
    flippedCards: flipped.map(pubCard),
  };
  r.bids.push({ seat, suit: trumpSuit, cards: 0, flipped: true, flippedCards: flipped.map(cardShort) });
  log(room, `No bids — flipped all the bottom cards (${flipped.map(cardShort).join(' ')}): the last card makes ${suitName(trumpSuit)} trump. ${nameOf(room, seat)} is 庄家 and takes the bottom.`);
  endBidding(room);
}

function endBidding(room) {
  const r = room.round;
  // 庄家 determination: round 1 (no predetermined seat) — the final
  // bidder IS the 庄家. Later rounds — dealerSeat was fixed by rotation
  // at round start and bidding does NOT change it; the bid only set the
  // trump suit (in r.currentBid).
  if (r.dealerSeat < 0) r.dealerSeat = r.currentBid.seat;
  r.trumpSuit = r.currentBid.bid.suit;
  r.hands[r.dealerSeat] = r.hands[r.dealerSeat].concat(r.bottom);
  room.phase = 'burying';
  if (r.currentBid.flipped) {
    log(room, `${nameOf(room, r.dealerSeat)} (庄家) picks up the bottom and buries 6.`);
  } else if (r.currentBid.seat === r.dealerSeat) {
    log(room, `${nameOf(room, r.dealerSeat)} wins the bid (${suitName(r.trumpSuit)} trump), picks up the bottom and buries 6.`);
  } else {
    log(room, `${nameOf(room, r.currentBid.seat)} wins the bid (${suitName(r.trumpSuit)} trump); ${nameOf(room, r.dealerSeat)} (庄家) picks up the bottom and buries 6.`);
  }
  sendState(room);
  scheduleTimer(room);
}

function suitName(s) { return { S: '♠ Spades', H: '♥ Hearts', D: '♦ Diamonds', C: '♣ Clubs' }[s] || s; }

// --- bury ----------------------------------------------------------------------
function doBury(room, seat, cardIds, auto) {
  const r = room.round;
  if (!r || room.phase !== 'burying') return { ok: false, error: 'Not burying now.' };
  if (seat !== r.dealerSeat) return { ok: false, error: 'Only the 庄家 buries.' };
  if (!Array.isArray(cardIds) || cardIds.length !== 6) return { ok: false, error: 'Bury exactly 6 cards.' };
  if (new Set(cardIds).size !== 6) return { ok: false, error: 'Duplicate cards.' };
  const byId = new Map(r.hands[seat].map((c) => [c.id, c]));
  const buried = [];
  for (const id of cardIds) {
    const c = byId.get(id);
    if (!c) return { ok: false, error: 'Card not in hand.' };
    buried.push(c);
  }
  const ids = new Set(cardIds);
  r.hands[seat] = r.hands[seat].filter((c) => !ids.has(c.id));
  r.buried = buried;
  r.turn = r.dealerSeat;
  r.trickPlays = [];
  r.trickLead = null;
  room.phase = 'playing';
  log(room, `${nameOf(room, seat)} buried 6 and leads${auto ? ' (auto)' : ''}.`);
  sendState(room);
  scheduleTimer(room);
  return { ok: true };
}

function autoBury(room, seat) {
  const r = room.round;
  const level = r.level, T = r.trumpSuit;
  const low = r.hands[seat].slice().sort((a, b) =>
    G.cardPoints(a) - G.cardPoints(b) || G.cardStrength(a, level, T) - G.cardStrength(b, level, T));
  doBury(room, seat, low.slice(0, 6).map((c) => c.id), true);
}

// --- play ----------------------------------------------------------------------
const FOLLOW_REASONS = {
  'empty': 'Select cards to play.', 'not-in-hand': 'Card not in hand.',
  'wrong-count': 'Wrong number of cards for this trick.',
  'must-follow-suit': 'You must follow the led suit.',
  'must-include-all-held-suit': 'You must include every card of the led suit you hold.',
  'broke-protected-combo': 'That would break a protected combination.',
  'must-match-throw-structure': 'You must answer a throw with as many matching pairs/triples of the led suit as you hold.',
};

function doPlay(room, seat, cardIds, auto) {
  const r = room.round;
  if (!r || room.phase !== 'playing') return { ok: false, error: 'Not playing now.' };
  if (seat !== r.turn) return { ok: false, error: 'Not your turn.' };
  if (!Array.isArray(cardIds) || cardIds.length === 0) return { ok: false, error: 'Select cards to play.' };
  if (new Set(cardIds).size !== cardIds.length) return { ok: false, error: 'Duplicate cards.' };
  const byId = new Map(r.hands[seat].map((c) => [c.id, c]));
  const cards = [];
  for (const id of cardIds) {
    const c = byId.get(id);
    if (!c) return { ok: false, error: 'Card not in hand.' };
    cards.push(c);
  }
  const level = r.level, T = r.trumpSuit;
  let leadInfo;
  if (r.trickPlays.length === 0) {
    // After a failed throw, this player's next lead must be exactly the
    // throw's weakest unit — anything else is rejected with a reminder.
    if (r.forcedLead && r.forcedLead.seat === seat) {
      const want = r.forcedLead.cardIds;
      const exact =
        want.length === cardIds.length && want.every((id) => cardIds.includes(id));
      if (!exact) {
        return {
          ok: false,
          error: `Your throw failed — you must lead its smallest ${r.forcedLead.unitName} (${want.length} card${want.length > 1 ? 's' : ''}) next.`,
        };
      }
      r.forcedLead = null; // the forced lead itself is validated normally below
    }
    const otherHands = r.hands.filter((_, i) => i !== seat);
    const v = G.validateLead(r.hands[seat], cards, otherHands, level, T);
    if (!v.ok && v.reason === 'throw-blocked') {
      // Failed throw (甩牌), the user's sequence: (1) warn the WHOLE room
      // (the log entry + a room-wide toast; the message never names who
      // blocked it), (2) the play is rejected — the cards stay in the
      // player's hand, (3) the penalty (10 per attempted card, floor 0)
      // comes off the throwing team's captured points immediately, and
      // (4) the player's next lead is forced to the throw's weakest unit.
      const info = v.throwInfo;
      const dealerTeam = G.TEAM_OF_SEAT(r.dealerSeat);
      if (G.TEAM_OF_SEAT(seat) === dealerTeam) {
        r.dealerTrickPoints = G.applyThrowPenalty(r.dealerTrickPoints, info.count);
      } else {
        r.defenderTrickPoints = G.applyThrowPenalty(r.defenderTrickPoints, info.count);
      }
      r.forcedLead = {
        seat,
        cardIds: info.weakestCards.map((c) => c.id),
        unitName: { 1: 'single', 2: 'pair', 3: 'triple' }[info.unit],
      };
      const msg = G.throwFailureAnnouncement(nameOf(room, seat), info);
      log(room, msg);
      io.to(room.code).emit('errorMsg', msg); // broadcast to every player
      sendState(room);
      scheduleTimer(room); // same player's turn continues
      return { ok: false, error: msg, quiet: true }; // already broadcast; don't toast twice
    }
    if (!v.ok) return { ok: false, error: leadReason(v.reason) };
    leadInfo = v;
    r.trickLead = { type: v.type, unit: v.unit, length: v.length, count: v.count, effSuit: v.effSuit };
  } else {
    const v = G.validateFollow(r.hands[seat], cards, r.trickLead, level, T);
    if (!v.ok) return { ok: false, error: FOLLOW_REASONS[v.reason] || `Illegal play (${v.reason}).` };
  }
  const ids = new Set(cardIds);
  r.hands[seat] = r.hands[seat].filter((c) => !ids.has(c.id));
  r.trickPlays.push({ seat, cards });
  log(room, `${nameOf(room, seat)} plays ${describePlay(cards, r.trickLead, level, T)}${auto ? ' (auto)' : ''}.`);

  if (r.trickPlays.length === room.tableSize) resolveTrick(room);
  else r.turn = (seat + 1) % room.tableSize;
  sendState(room);
  scheduleTimer(room);
  return { ok: true };
}

function leadReason(reason) {
  return {
    'empty': 'Select cards to lead.', 'not-in-hand': 'Card not in hand.',
    'invalid-lead': 'Those cards do not form a legal lead (single, pair, triple, quad, tractor, or unbeatable singles).',
    'invalid-combination': 'Those cards do not form a legal lead (single, pair, triple, quad, tractor, unbeatable singles, or a throw — all singles, all pairs, or all triples of one suit).',
  }[reason] || `Illegal lead (${reason}).`;
}

function describePlay(cards, lead, level, T) {
  if (!lead) return `${cards.length} card(s)`;
  const names = { single: 'single', pair: 'pair', triple: 'triple', quad: 'quad', tractor: 'tractor', 'unbeatable-singles': 'unbeatable singles', throw: 'throw (甩牌)' };
  return `${names[lead.type] || lead.type} (${cards.length})`;
}

function resolveTrick(room) {
  const r = room.round;
  const plays = r.trickPlays.map((p) => ({ cards: p.cards }));
  const wIdx = G.trickWinner(plays, r.trickLead, r.level, r.trumpSuit);
  const winnerSeat = r.trickPlays[wIdx].seat;
  const trickPts = G.pointsOf(r.trickPlays.flatMap((p) => p.cards));
  const dealerTeam = G.TEAM_OF_SEAT(r.dealerSeat);
  if (G.TEAM_OF_SEAT(winnerSeat) !== dealerTeam) r.defenderTrickPoints += trickPts;
  else r.dealerTrickPoints += trickPts; // tracked so a failed-throw penalty can be deducted from it
  r.lastTrickWinner = winnerSeat;
  r.lastWinCards = r.trickPlays[wIdx].cards;
  r.tricksPlayed += 1;
  log(room, `${nameOf(room, winnerSeat)} takes the trick${trickPts ? ` (+${trickPts} pts)` : ''}.`);

  // The round ends when the cards are gone. With pair/tractor plays the
  // hands empty in FEWER than 26 tricks, so a fixed trick count stalls the
  // game on an empty hand (found in live play 2026-10-16: stuck at 18/26).
  if (r.tricksPlayed >= 26 || r.hands.every((h) => h.length === 0)) { endRound(room); return; }
  r.turn = winnerSeat;
  r.trickPlays = [];
  r.trickLead = null;
}

// --- timeout auto-play ------------------------------------------------------------
function autoPlay(room, seat) {
  const ids = findAutoPlay(room, seat);
  if (ids && ids.length) doPlay(room, seat, ids, true);
  else {
    log(room, `No auto move found for ${nameOf(room, seat)} — turn kept.`);
    scheduleTimer(room); // re-arm so a stuck turn retries instead of dying silently
  }
}

function findAutoPlay(room, seat) {
  const r = room.round;
  const hand = r.hands[seat], level = r.level, T = r.trumpSuit;
  const str = (c) => G.cardStrength(c, level, T);
  const low = (arr) => arr.slice().sort((a, b) => str(a) - str(b));
  const eff = (c) => G.effectiveSuit(c, level, T);

  if (!r.trickPlays.length) {
    if (!hand.length) return null; // no cards — the round should already be over
    // A player whose throw failed must lead the throw's weakest unit.
    if (r.forcedLead && r.forcedLead.seat === seat) return r.forcedLead.cardIds.slice();
    return [low(hand)[0].id]; // lead lowest single
  }

  const lead = r.trickLead, N = lead.count, S = lead.effSuit;
  // Suit-face rule: for a natural-suit tractor lead, the led suit's own
  // level cards (trump by effective suit) also count as led-suit cards.
  const suit = hand.filter((c) => eff(c) === S ||
    (lead.type === 'tractor' && S !== 'T' && c.suit === S && c.rank === level));
  const tryIds = (cards) => {
    if (cards.length !== N) return null;
    return G.validateFollow(hand, cards, lead, level, T).ok ? cards.map((c) => c.id) : null;
  };

  // group led-suit cards by identical identity
  const groups = new Map();
  for (const c of suit) {
    const k = `${c.suit || 'J'}:${c.rank}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  }
  const grp = [...groups.values()].sort((a, b) => str(a[0]) - str(b[0]));
  const fill = (pool, n, exclude) => {
    const out = [];
    for (const c of low(pool)) {
      if (out.length >= n) break;
      if (!exclude.has(c.id)) out.push(c);
    }
    return out;
  };

  const cands = [];
  // tractor lead: try an equal-length tractor built from consecutive pairs
  if (lead.type === 'tractor' && lead.unit === 2) {
    const tr = findTractor(suit, lead.length, level, T);
    if (tr) cands.push(tr);
  }
  // natural combos of the led suit, largest first
  for (const g of grp) {
    if (g.length >= 4) cands.push(g.slice(0, 4));
    if (g.length >= 3) cands.push(g.slice(0, 3));
    if (g.length >= 2) cands.push(g.slice(0, 2));
  }
  // combo + padding
  for (const g of grp) {
    for (const u of [3, 2]) {
      if (g.length >= u && N > u) {
        const ex = new Set(g.slice(0, u).map((c) => c.id));
        const pad = fill(suit, N - u, ex);
        if (pad.length === N - u) cands.push([...g.slice(0, u), ...pad]);
      }
    }
  }
  // singles of the suit
  for (const c of low(suit)) cands.push([c]);
  // suit fill (or all suit + lowest others when short)
  if (suit.length >= N) cands.push(fill(suit, N, new Set()));
  else {
    const suitIds = new Set(suit.map((c) => c.id));
    const others = low(hand.filter((c) => eff(c) !== S && !suitIds.has(c.id)));
    if (suit.length + others.length >= N) cands.push([...suit, ...others.slice(0, N - suit.length)]);
  }

  for (const cd of cands) {
    const ok = tryIds(cd);
    if (ok) return ok;
  }
  return null;
}

// Find `pairCount` consecutive pairs in the led suit (for timeout fallback).
function findTractor(suit, pairCount, level, T) {
  const groups = new Map();
  for (const c of suit) {
    const k = `${c.suit || 'J'}:${c.rank}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  }
  const pairGroups = [...groups.values()].filter((g) => g.length >= 2);
  if (pairGroups.length < pairCount) return null;
  // brute-force combinations of pair groups; verify with the engine
  const idx = pairGroups.map((_, i) => i);
  const combos = [];
  const rec = (start, chosen) => {
    if (chosen.length === pairCount) { combos.push(chosen.slice()); return; }
    for (let i = start; i < idx.length; i++) { chosen.push(idx[i]); rec(i + 1, chosen); chosen.pop(); }
  };
  rec(0, []);
  if (combos.length > 3000) return null;
  for (const combo of combos) {
    const cards = combo.flatMap((i) => pairGroups[i].slice(0, 2));
    const info = G.classify(cards, level, T);
    if (info.type === 'tractor' && info.unit === 2 && info.length === pairCount) return cards;
  }
  return null;
}

// --- round end --------------------------------------------------------------------
function endRound(room) {
  clearTimer(room);
  const r = room.round;
  const dealerTeam = G.TEAM_OF_SEAT(r.dealerSeat);
  const defenderTeam = 1 - dealerTeam;
  const bottomPoints = G.pointsOf(r.buried);
  const defendersWonLast = G.TEAM_OF_SEAT(r.lastTrickWinner) === defenderTeam;
  const result = G.scoreRound({
    nDecks: r.nDecks, defenderTrickPoints: r.defenderTrickPoints,
    bottomPoints, defendersWonLastTrick: defendersWonLast,
  });
  const applied = G.applyLevels(room.levels, result, dealerTeam);
  room.levels = applied.levels;
  // House rule: defender 抠底 with only Jacks (single/pair/triple) resets dealer team to level 2.
  let jackReset = false;
  if (defendersWonLast && r.lastWinCards.length >= 1 && r.lastWinCards.length <= 3 &&
      r.lastWinCards.every((c) => c.rank === 11)) {
    room.levels[dealerTeam] = 2;
    jackReset = true;
  }
  // ZhuangJia switch criterion: the defenders take over the deal only
  // by winning the round (reaching n*40 in scoreRound — 120 in a 3-deck
  // game). On a dealer-team win the same dealer team keeps the deal.
  // dealerTeam here is the 庄家's team (TEAM_OF_SEAT(dealerSeat)) — the
  // scoring basis is the 庄家 vs the opposing team, never the bid
  // winner's team.
  room.lastWinnerTeam = G.nextDealingTeam(dealerTeam, result);
  // Next round's 庄家 seat, by rotation from THIS round's 庄家:
  // this team won -> next seat on the same team; lost -> next seat.
  room.nextDealerSeat = computeNextDealerSeat(r.dealerSeat, result.winner === 'dealer', room.tableSize);
  room.lastResult = {
    winnerTeam: room.lastWinnerTeam,
    winnerName: room.lastWinnerTeam === 0 ? 'Gold' : 'Blue',
    defenderTotal: result.defenderTotal,
    dealerPoints: result.dealerPoints,
    defenderLevels: result.defenderLevels,
    dealerLevels: result.dealerLevels,
    defenderTrickPoints: r.defenderTrickPoints,
    bottomPoints,
    defendersWonLastTrick: defendersWonLast,
    jackReset,
    levels: room.levels.slice(),
    dealerSeat: r.dealerSeat,
    trumpSuit: r.trumpSuit,
    trumpSuitName: suitName(r.trumpSuit),
    buried: r.buried.map(pubCard),
    roundNo: room.roundNo,
  };
  room.phase = applied.matchWon != null ? 'matchOver' : 'roundOver';
  if (applied.matchWon != null) {
    room.matchWinner = applied.matchWon;
    log(room, `Match over — ${applied.matchWon === 0 ? 'Gold' : 'Blue'} team wins past level A!`);
  } else {
    log(room, `Round over: ${room.lastResult.winnerName} team wins the round` +
      (result.winner === 'defenders' ? ` (+${result.defenderLevels} level${result.defenderLevels > 1 ? 's' : ''})` : ` (+${result.dealerLevels} level${result.dealerLevels > 1 ? 's' : ''})`) +
      (jackReset ? ' — dealer reset to level 2 (Jacks 抠底)' : '') +
      `. Levels now Gold ${room.levels[0]} / Blue ${room.levels[1]}.`);
  }
  sendState(room);
  if (room.phase === 'roundOver') {
    // Auto-advance: after a short pause on the result screen, deal the next
    // round by itself (dealing team + level already advanced above, and the
    // next 庄家 seat already rotated — the new bid only decides trump).
    // Anyone may press "Next Round" to skip the wait.
    room.autoNextAt = Date.now() + AUTO_NEXT_MS;
    clearTimeout(room.autoTimer);
    room.autoTimer = setTimeout(() => {
      if (room.phase === 'roundOver') startRound(room);
    }, AUTO_NEXT_MS);
    sendState(room);
  }
}

// --- socket wiring ------------------------------------------------------------------
io.on('connection', (socket) => {
  socket.data.room = null;

  const getRoom = () => (socket.data.room ? rooms.get(socket.data.room.code) : null);
  const mySeat = () => (socket.data.room ? socket.data.room.seat : -1);

  const doCreate = (name, tableSize, forcedCode, dealSpeed) => {
    tableSize = [4, 6, 8, 10].includes(Number(tableSize)) ? Number(tableSize) : 6;
    const code = forcedCode || makeCode();
    const room = newRoom(code, cleanName(name), socket.id, tableSize, dealSpeed);
    rooms.set(code, room);
    socket.data.room = { code, seat: 0 };
    socket.join(code);
    log(room, `${room.seats[0].name} created a ${tableSize / 2}v${tableSize / 2} room (deal speed: ${DEAL_SPEED_NAMES[room.dealSpeed]}).`);
    socket.emit('joined', { code, seat: 0 });
    sendState(room);
  };

  const doJoin = (room, name) => {
    name = cleanName(name);
    let seat = -1;
    for (let i = 0; i < room.tableSize; i++) {
      if (room.seats[i].name === name && !room.seats[i].connected) { seat = i; break; }
    }
    if (seat < 0) {
      if (room.phase !== 'lobby') return socket.emit('errorMsg', 'Game already started.');
      for (let i = 0; i < room.tableSize; i++) {
        if (!room.seats[i].name) { seat = i; break; }
      }
    }
    if (seat < 0) return socket.emit('errorMsg', 'Room is full.');
    room.seats[seat] = { name, socketId: socket.id, connected: true };
    socket.data.room = { code: room.code, seat };
    socket.join(room.code);
    log(room, `${name} joined seat ${seat + 1} (${teamName(seat)}).`);
    socket.emit('joined', { code: room.code, seat });
    sendState(room);
    scheduleTimer(room);
  };

  socket.on('createRoom', ({ name, tableSize, dealSpeed }) => doCreate(name, tableSize, null, dealSpeed));

  socket.on('joinRoom', ({ code, name }) => {
    code = String(code || '').trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return socket.emit('errorMsg', 'Room not found. Check the code.');
    doJoin(room, name);
  });

  // Fixed-link entry (…/?code=XXXXXX): join the room with that exact code if
  // it exists, otherwise create it with that code. One permanent family link.
  socket.on('enterRoom', ({ code, name, tableSize, dealSpeed }) => {
    code = String(code || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{4,8}$/.test(code)) return socket.emit('errorMsg', 'That room code is not valid.');
    const room = rooms.get(code);
    if (room) return doJoin(room, name);
    doCreate(name, tableSize, code, dealSpeed);
  });

  socket.on('startRound', () => {
    const room = getRoom();
    if (!room) return;
    if (room.phase !== 'lobby' && room.phase !== 'roundOver' && room.phase !== 'matchOver') return;
    if (filledSeats(room) < room.tableSize) return socket.emit('errorMsg', `Need ${room.tableSize} players to start.`);
    if (room.phase === 'matchOver') {
      // New match: both teams back to level 2, Gold deals first again,
      // and there is no predetermined 庄家 — round 1's bid winner is it.
      room.levels = [2, 2];
      room.roundNo = 0;
      room.lastWinnerTeam = 0;
      room.nextDealerSeat = null;
      room.matchWinner = null;
    }
    startRound(room);
  });

  socket.on('bid', ({ suit, cards }) => {
    const room = getRoom();
    if (!room) return;
    const r = doBid(room, mySeat(), suit, cards, false);
    if (!r.ok) socket.emit('errorMsg', r.error);
  });

  socket.on('passBid', () => {
    const room = getRoom();
    if (!room) return;
    const r = passBid(room, mySeat(), false);
    if (!r.ok) socket.emit('errorMsg', r.error);
  });

  socket.on('bury', ({ cardIds }) => {
    const room = getRoom();
    if (!room) return;
    const r = doBury(room, mySeat(), Array.isArray(cardIds) ? cardIds : [], false);
    if (!r.ok) socket.emit('errorMsg', r.error);
  });

  socket.on('play', ({ cardIds }) => {
    const room = getRoom();
    if (!room) return;
    const r = doPlay(room, mySeat(), Array.isArray(cardIds) ? cardIds : [], false);
    if (!r.ok && !r.quiet) socket.emit('errorMsg', r.error);
  });

  socket.on('chat', ({ text }) => {
    const room = getRoom();
    if (!room) return;
    text = String(text || '').trim().slice(0, MAX_CHAT_LEN);
    if (!text) return;
    io.to(room.code).emit('chatMsg', { from: nameOf(room, mySeat()), text });
  });

  socket.on('leaveRoom', () => {
    const room = getRoom();
    if (!room) return;
    const seat = mySeat();
    socket.leave(room.code);
    socket.data.room = null;
    if (room.phase === 'lobby') {
      room.seats[seat] = { name: null, socketId: null, connected: false };
      log(room, `Seat ${seat + 1} is free.`);
    } else {
      room.seats[seat].connected = false;
      room.seats[seat].socketId = null;
      log(room, `${room.seats[seat].name} disconnected (seat kept for rejoin).`);
    }
    sendState(room);
    scheduleTimer(room);
  });

  socket.on('disconnect', () => {
    const room = getRoom();
    if (!room) return;
    const seat = mySeat();
    if (room.phase === 'lobby') {
      room.seats[seat] = { name: null, socketId: null, connected: false };
    } else {
      room.seats[seat].connected = false;
      room.seats[seat].socketId = null;
      log(room, `${room.seats[seat].name || 'Player'} disconnected (seat kept for rejoin).`);
    }
    sendState(room);
    scheduleTimer(room);
  });
});

// Prune empty rooms every 10 minutes.
const pruneTimer = setInterval(() => {
  for (const [code, room] of rooms) {
    const anyone = room.seats.some((s) => s.name && s.connected);
    if (!anyone) { clearTimer(room); clearDealTimer(room); clearTimeout(room.autoTimer); rooms.delete(code); }
  }
}, 10 * 60 * 1000);
pruneTimer.unref();

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Tractor online server listening on http://localhost:${PORT}`);
  });
}

// Exported for the server-flow tests (test/server.test.js); running
// `node server.js` (npm start) is unaffected.
module.exports = { server, io, rooms, newRoom, doPlay, doBid, passBid, doBury, dealTick, startRound, computeNextDealerSeat, DEAL_SPEEDS };
