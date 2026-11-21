'use strict';
/* Server-level flow tests — run with: npm test (node --test).
 * These drive server.js's handlers directly on hand-built rooms (the
 * module only listens when run as `node server.js`). The first block
 * covers the failed-throw sequence the user confirmed 2026-11-19:
 *   (1) the warning goes to ALL players (the room log + a room-wide
 *       emit carry the same message) and never names who blocked it;
 *   (2) the play is rejected — the cards stay in the thrower's hand;
 *   (3) the penalty (10 per attempted card, floor 0) is deducted from
 *       the throwing team's captured points immediately;
 *   (4) the thrower's next lead must be exactly the weakest unit.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const S = require('../server');

let _id = 50000;
const C = (suit, rank) => ({ id: _id++, suit, rank });
const pair = (suit, rank) => [C(suit, rank), C(suit, rank)];

const LEVEL = 7;
const TRUMP = 'S';
const NAMES = ['Alice', 'Bob', 'Carol', 'Dave']; // seats 0..3; Alice deals (Gold), Bob/Carol/Dave follow

function makeRoom() {
  const room = S.newRoom('TEST01', 'Alice', null, 4);
  room.seats = NAMES.map((name) => ({ name, socketId: null, connected: false }));
  room.log = [];
  return room;
}

function startPlaying(room, hands, { dealerSeat = 0, turn = 0, defenderPoints = 0, dealerPoints = 0 } = {}) {
  room.phase = 'playing';
  room.round = {
    nDecks: 2, hands, bottom: [], buried: null,
    level: LEVEL, trumpSuit: TRUMP, dealerSeat,
    bids: [], bidTurn: 0, bidPassed: new Set(), currentBid: null,
    turn, trickPlays: [], trickLead: null,
    defenderTrickPoints: defenderPoints, dealerTrickPoints: dealerPoints,
    tricksPlayed: 0, lastTrickWinner: -1, lastWinCards: [], forcedLead: null,
  };
  return room.round;
}

// doPlay arms a turn timer; clear it so the test process can exit.
function settle(room) {
  clearTimeout(room.timer);
  clearTimeout(room.autoTimer);
}

describe('server: failed-throw flow', () => {
  test('defender throw blocked by a higher single: warn all, cards stay, penalty lands at once, weakest single forced', () => {
    const room = makeRoom();
    const bobThrow = [C('H', 13), C('H', 9), C('H', 8)]; // K, 9, 8 of hearts as singles
    const hands = [
      [C('H', 14), C('D', 3), C('C', 4)], // Alice holds the ace that blocks it
      [...bobThrow, C('D', 5), C('C', 6)], // Bob (defender) throws
      [C('D', 8), C('C', 9)],
      [C('D', 10), C('C', 11)],
    ];
    const r = startPlaying(room, hands, { dealerSeat: 0, turn: 1, defenderPoints: 50 });

    const res = S.doPlay(room, 1, bobThrow.map((c) => c.id), false);
    settle(room);
    assert.equal(res.ok, false);

    // (2) rejected: every attempted card is still in Bob's hand, the
    // trick has not started, and it is still Bob's turn.
    assert.equal(r.hands[1].length, 5);
    for (const c of bobThrow) assert.ok(r.hands[1].some((h) => h.id === c.id));
    assert.equal(r.trickPlays.length, 0);
    assert.equal(r.turn, 1);

    // (3) penalty applied at failure time: 3 cards x 10 off the
    // defenders' captured 50 -> 20, before any further play.
    assert.equal(r.defenderTrickPoints, 20);

    // (1) the warning is in the room log (broadcast to every player via
    // state, and also emitted room-wide by doPlay): it names the
    // thrower and the penalty, and never the blocker (Alice) or anyone
    // else.
    const msg = room.log[room.log.length - 1].msg;
    assert.ok(msg.includes('Bob'));
    assert.ok(msg.includes('30'));
    assert.ok(!msg.includes('Alice'));
    assert.ok(!msg.includes('Carol'));
    assert.ok(!msg.includes('Dave'));

    // (4) the forced lead is exactly the weakest unit (the 8).
    assert.deepEqual(r.forcedLead.cardIds, [bobThrow[2].id]);
    const wrong = S.doPlay(room, 1, [bobThrow[0].id], false); // the K instead
    settle(room);
    assert.equal(wrong.ok, false);
    assert.ok(wrong.error.includes('must lead'));
    assert.equal(r.hands[1].length, 5); // still intact after the reminder
    assert.equal(r.trickPlays.length, 0);

    const good = S.doPlay(room, 1, [bobThrow[2].id], false); // the 8 itself
    settle(room);
    assert.equal(good.ok, true);
    assert.equal(r.forcedLead, null);
    assert.equal(r.trickLead.type, 'single');
    assert.equal(r.hands[1].length, 4);
    assert.equal(r.trickPlays.length, 1);
    assert.equal(r.turn, 2);
  });

  test('dealer-team pairs throw blocked by a higher pair: penalty floors at 0, weakest pair forced', () => {
    const room = makeRoom();
    const aliceThrow = [...pair('H', 9), ...pair('H', 11)]; // 9s and Jacks of hearts
    const hands = [
      [...aliceThrow, C('D', 3)], // Alice (dealer team) throws
      [...pair('H', 12), C('C', 4)], // Bob's queen pair blocks it
      [C('D', 8), C('C', 9)],
      [C('D', 10), C('C', 11)],
    ];
    const r = startPlaying(room, hands, { dealerSeat: 0, turn: 0, defenderPoints: 50, dealerPoints: 15 });

    const res = S.doPlay(room, 0, aliceThrow.map((c) => c.id), false);
    settle(room);
    assert.equal(res.ok, false);

    // penalty 4 x 10 = 40 against the dealer team's 15 captured -> floor 0;
    // the defenders' points are untouched.
    assert.equal(r.dealerTrickPoints, 0);
    assert.equal(r.defenderTrickPoints, 50);
    assert.equal(r.hands[0].length, 5); // cards stayed in hand
    assert.equal(r.trickPlays.length, 0);

    const msg = room.log[room.log.length - 1].msg;
    assert.ok(msg.includes('Alice'));
    assert.ok(msg.includes('40'));
    assert.ok(!msg.includes('Bob')); // blocker not named

    // a different lead (the Jack pair) is rejected; the weakest pair
    // (the 9s) is accepted and leads as a pair.
    const wrong = S.doPlay(room, 0, [aliceThrow[2].id, aliceThrow[3].id], false);
    settle(room);
    assert.equal(wrong.ok, false);
    assert.ok(wrong.error.includes('must lead'));
    const good = S.doPlay(room, 0, [aliceThrow[0].id, aliceThrow[1].id], false);
    settle(room);
    assert.equal(good.ok, true);
    assert.equal(r.trickLead.type, 'pair');
    assert.equal(r.hands[0].length, 3);
  });

  test('a standing throw leads normally (no penalty, no forced lead)', () => {
    const room = makeRoom();
    const bobThrow = [...pair('H', 9), ...pair('H', 11)];
    const hands = [
      [C('H', 14), C('D', 3)], // Alice's higher SINGLE does not block a pairs throw
      [...bobThrow, C('D', 5)],
      [C('D', 8), C('C', 9)],
      [C('D', 10), C('C', 11)],
    ];
    const r = startPlaying(room, hands, { dealerSeat: 0, turn: 1, defenderPoints: 50 });
    const res = S.doPlay(room, 1, bobThrow.map((c) => c.id), false);
    settle(room);
    assert.equal(res.ok, true);
    assert.equal(r.trickLead.type, 'throw');
    assert.equal(r.trickLead.unit, 2);
    assert.equal(r.defenderTrickPoints, 50); // no penalty
    assert.equal(r.forcedLead, null);
    assert.equal(r.hands[1].length, 1); // the throw left the hand
    assert.equal(r.turn, 2);
  });
});

/* ------------------------------------------------------------------ */
/* Dispatch dealing + live bidding (owner feature, 2026-11-20).        */
/* Round-1 level is 2, so rank-2 cards are the level cards below.      */
/* ------------------------------------------------------------------ */

function makeFullRoom(dealSpeed) {
  const room = S.newRoom('TEST02', 'Alice', null, 4, dealSpeed);
  room.seats = NAMES.map((name) => ({ name, socketId: null, connected: false }));
  room.log = [];
  return room;
}

function settleAll(room) {
  clearTimeout(room.timer);
  clearTimeout(room.autoTimer);
  if (room.dealTimer) { clearInterval(room.dealTimer); room.dealTimer = null; }
}

const sixFiller = () => [C('C', 3), C('C', 4), C('D', 3), C('D', 4), C('S', 3), C('S', 4)];

// Hand-built 'dealing' round: fullHands are the final hands; the first
// `dealtRounds` round-robin rounds have already been moved into hands.
function startDealing(room, fullHands, dealtRounds, bottom) {
  room.phase = 'dealing';
  room.roundNo = 1;
  room.round = {
    nDecks: 2, hands: fullHands.map((h) => h.slice(0, dealtRounds)), bottom, buried: null,
    level: 2, trumpSuit: null, dealerSeat: -1,
    bids: [], bidTurn: 0, bidPassed: new Set(), currentBid: null,
    turn: -1, trickPlays: [], trickLead: null,
    defenderTrickPoints: 0, dealerTrickPoints: 0, tricksPlayed: 0,
    lastTrickWinner: -1, lastWinCards: [], forcedLead: null,
    dealHands: fullHands, dealPos: dealtRounds * room.tableSize,
  };
  return room.round;
}

// Hand-built closing 'bidding' round (level 2, seat 0 bids first).
function startBidding(room, hands, bottom) {
  room.phase = 'bidding';
  room.roundNo = 1;
  room.round = {
    nDecks: 2, hands, bottom, buried: null,
    level: 2, trumpSuit: null, dealerSeat: -1,
    bids: [], bidTurn: 0, bidPassed: new Set(), currentBid: null,
    turn: -1, trickPlays: [], trickLead: null,
    defenderTrickPoints: 0, dealerTrickPoints: 0, tricksPlayed: 0,
    lastTrickWinner: -1, lastWinCards: [], forcedLead: null,
    dealHands: null, dealPos: 0,
  };
  return room.round;
}

describe('server: dispatch dealing + live bidding', () => {
  test('deal speed is stored on the room (default fast, unknown falls back)', () => {
    assert.equal(S.newRoom('TSPD1', 'A', null, 4, 'slow').dealSpeed, 'slow');
    assert.equal(S.newRoom('TSPD2', 'A', null, 4, 'instant').dealSpeed, 'instant');
    assert.equal(S.newRoom('TSPD3', 'A', null, 4).dealSpeed, 'fast');
    assert.equal(S.newRoom('TSPD4', 'A', null, 4, 'warp').dealSpeed, 'fast');
  });

  test('deal speed delays: fast 257 / normal 450 / slow 1200 ms per card, instant 0', () => {
    // Redefined 2026-11-20 as fractions of the old Slow pace (180 ms/card):
    // Fast = 180/0.70 ≈ 257, Normal = 180/0.40 = 450, Slow = 180/0.15 = 1200.
    assert.deepEqual(S.DEAL_SPEEDS, { instant: 0, fast: 257, normal: 450, slow: 1200 });
  });

  test('instant speed deals at once into the bidding phase (previous behavior)', () => {
    const room = makeFullRoom('instant');
    S.startRound(room);
    settleAll(room);
    assert.equal(room.phase, 'bidding');
    assert.equal(room.dealTimer, null);
    assert.ok(room.round.hands.every((h) => h.length === 26));
    assert.equal(room.round.bottom.length, 6);
  });

  test('dispatch deals every card, bottom set aside, then closes into bidding', () => {
    const room = makeFullRoom('fast');
    S.startRound(room);
    assert.equal(room.phase, 'dealing');
    assert.equal(room.round.bottom.length, 6); // set aside before dealing starts
    assert.ok(room.round.hands.every((h) => h.length === 0));
    let guard = 0;
    while (room.phase === 'dealing' && guard++ < 1000) S.dealTick(room);
    settleAll(room);
    assert.equal(room.phase, 'bidding');
    assert.ok(room.round.hands.every((h) => h.length === 26));
    const ids = new Set([...room.round.hands.flat(), ...room.round.bottom].map((c) => c.id));
    assert.equal(ids.size, 110); // 2 decks (108) + 2 extra jokers, all unique
    assert.equal(room.round.currentBid, null);
    assert.equal(room.dealTimer, null); // deal timer cleared at the transition
  });

  test('live bid during dealing validates against the partial hand', () => {
    const room = makeFullRoom('fast');
    const full = [
      [C('H', 2), C('C', 5), C('S', 2), C('C', 6)], // seat 0: 2♥ first, 2♠ only in round 3
      [C('C', 7), C('C', 8), C('C', 9), C('C', 10)],
      [C('D', 5), C('D', 6), C('D', 7), C('D', 8)],
      [C('S', 5), C('S', 6), C('S', 7), C('S', 8)],
    ];
    const r = startDealing(room, full, 1, sixFiller()); // everyone holds only their 1st card
    // 2♠ has not been dealt to seat 0 yet -> rejected as not held.
    let res = S.doBid(room, 0, 'S', 1, false);
    assert.equal(res.ok, false);
    assert.match(res.error, /do not hold/i);
    // A pair of hearts: only one 2♥ held so far -> rejected.
    res = S.doBid(room, 0, 'H', 2, false);
    assert.equal(res.ok, false);
    assert.match(res.error, /do not hold/i);
    // A bid of 3 cards is not a legal bid size at all (bids are 1 or 2).
    res = S.doBid(room, 0, 'H', 3, false);
    assert.equal(res.ok, false);
    assert.match(res.error, /1 or 2 cards/);
    // The single 2♥ actually held -> accepted, and the deal keeps running.
    res = S.doBid(room, 0, 'H', 1, false);
    assert.equal(res.ok, true);
    assert.equal(room.phase, 'dealing');
    assert.deepEqual(
      { seat: r.currentBid.seat, suit: r.currentBid.bid.suit, cards: r.currentBid.bid.cards },
      { seat: 0, suit: 'H', cards: 1 });
    settleAll(room);
  });

  test('overbid rule during dealing: equal rejected, pair takes single, pair cannot take pair', () => {
    const room = makeFullRoom('fast');
    const full = [
      [C('H', 2), C('H', 2), C('C', 5), C('C', 6)], // seat 0: both 2♥ arrive in rounds 1-2
      [C('D', 2), C('D', 2), C('C', 7), C('C', 8)], // seat 1: both 2♦ arrive in rounds 1-2
      [C('C', 9), C('C', 10), C('C', 11), C('C', 12)],
      [C('S', 5), C('S', 6), C('S', 7), C('S', 8)],
    ];
    const r = startDealing(room, full, 1, sixFiller());
    // Seat 0 (Gold) opens with the single 2♥ held so far. Seat 1 is on
    // the OTHER team — bidding is open to every seated player.
    assert.equal(S.doBid(room, 0, 'H', 1, false).ok, true);
    // Seat 1's single 2♦ is equal — cannot take it.
    let res = S.doBid(room, 1, 'D', 1, false);
    assert.equal(res.ok, false);
    assert.match(res.error, /overcall/);
    // Deal one more round: both pairs are now complete.
    for (let i = 0; i < 4; i++) S.dealTick(room);
    assert.equal(room.phase, 'dealing');
    // Seat 0 overbids its OWN single with the pair — allowed.
    assert.equal(S.doBid(room, 0, 'H', 2, false).ok, true);
    assert.equal(r.currentBid.bid.cards, 2);
    // A pair cannot take a pair: seat 1's 2♦ pair is turned away.
    res = S.doBid(room, 1, 'D', 2, false);
    assert.equal(res.ok, false);
    assert.match(res.error, /overcall/);
    assert.equal(r.currentBid.bid.suit, 'H');
    settleAll(room);
  });

  test('deal -> closing round keeps the high bid; passing out makes the bidder dealer', () => {
    const room = makeFullRoom('fast');
    const full = [
      [C('H', 2), C('C', 5), C('C', 6)],
      [C('C', 7), C('C', 8), C('C', 9)],
      [C('D', 5), C('D', 6), C('D', 7)],
      [C('S', 5), C('S', 6), C('S', 7)],
    ];
    const r = startDealing(room, full, 1, sixFiller());
    assert.equal(S.doBid(room, 0, 'H', 1, false).ok, true);
    let guard = 0;
    while (room.phase === 'dealing' && guard++ < 100) S.dealTick(room);
    assert.equal(room.phase, 'bidding');
    assert.equal(r.currentBid.bid.suit, 'H'); // the deal's high bid carried in
    assert.equal(r.bidTurn, 0); // closing round opens with the usual first bidder
    guard = 0;
    while (room.phase === 'bidding' && guard++ < 20) {
      assert.equal(S.passBid(room, r.bidTurn, false).ok, true);
    }
    settleAll(room);
    assert.equal(room.phase, 'burying');
    assert.equal(r.dealerSeat, 0);
    assert.equal(r.trumpSuit, 'H');
    assert.equal(r.hands[0].length, 3 + 6); // full hand + the bottom picked up
  });

  // UPDATED 2026-11-20 (ZhuangJia rotation): the no-bid flip no longer
  // stops at the first level card — ALL bottom cards are flipped and
  // the LAST bottom card's suit is trump.
  test('no-bid closing round flips ALL bottom cards: last bottom card sets trump, first bidder is ZhuangJia (round 1)', () => {
    const room = makeFullRoom('instant');
    const hands = [
      [C('C', 5), C('C', 6)],
      [C('C', 7), C('C', 8)],
      [C('D', 5), C('D', 6)],
      [C('S', 5), C('S', 6)],
    ];
    // Bottom holds a level card 2♦ mid-way, but the LAST card is the
    // ♣J — clubs become trump, not diamonds.
    const bottom = [C('S', 9), C('H', 13), C('D', 2), C('C', 9), C('C', 10), C('C', 11)];
    const r = startBidding(room, hands, bottom);
    for (let i = 0; i < 4; i++) {
      assert.equal(S.passBid(room, r.bidTurn, false).ok, true);
    }
    settleAll(room);
    assert.equal(room.phase, 'burying');
    assert.equal(r.trumpSuit, 'C');
    assert.equal(r.dealerSeat, 0); // round 1: the designated first-bidder seat
    assert.equal(r.hands[0].length, 2 + 6); // picked up the bottom
    // The flip shows every bottom card, and the state carries them too.
    const flipLog = room.log.map((e) => e.msg).find((m) => /flipped all the bottom/.test(m));
    assert.ok(flipLog);
    for (const s of ['♠9', '♥K', '♦2', '♣9', '♣10', '♣J']) assert.ok(flipLog.includes(s), s);
    assert.equal(r.currentBid.flippedCards.length, 6);
  });

  // UPDATED 2026-11-20 (ZhuangJia rotation): same expectation as the old
  // "last flipped suit" case, but now because the last card IS the ♣Q.
  test('no-bid flip: the last bottom card is trump (♣Q last)', () => {
    const room = makeFullRoom('instant');
    const hands = [
      [C('C', 5), C('C', 6)],
      [C('C', 7), C('C', 8)],
      [C('D', 5), C('D', 6)],
      [C('S', 5), C('S', 6)],
    ];
    const bottom = [C('S', 9), C('H', 13), C('D', 9), C('S', 10), C('H', 9), C('C', 12)];
    const r = startBidding(room, hands, bottom);
    for (let i = 0; i < 4; i++) {
      assert.equal(S.passBid(room, r.bidTurn, false).ok, true);
    }
    settleAll(room);
    assert.equal(room.phase, 'burying');
    assert.equal(r.trumpSuit, 'C');
    assert.equal(r.dealerSeat, 0);
  });

  test('no-bid flip with a joker last: trump is the last suited card before it', () => {
    const room = makeFullRoom('instant');
    const hands = [
      [C('C', 5), C('C', 6)],
      [C('C', 7), C('C', 8)],
      [C('D', 5), C('D', 6)],
      [C('S', 5), C('S', 6)],
    ];
    // A level card 2♥ sits early in the bottom and the last card is the
    // big joker — trump follows the last SUITED card, the 5♦.
    const bottom = [C('H', 2), C('S', 9), C('H', 13), C('C', 10), C('D', 5), C(null, 'BJ')];
    const r = startBidding(room, hands, bottom);
    for (let i = 0; i < 4; i++) {
      assert.equal(S.passBid(room, r.bidTurn, false).ok, true);
    }
    settleAll(room);
    assert.equal(room.phase, 'burying');
    assert.equal(r.trumpSuit, 'D');
    assert.equal(r.dealerSeat, 0);
  });

  test('no-bid flip with an all-joker bottom: trump falls back to spades', () => {
    const room = makeFullRoom('instant');
    const hands = [
      [C('C', 5), C('C', 6)],
      [C('C', 7), C('C', 8)],
      [C('D', 5), C('D', 6)],
      [C('S', 5), C('S', 6)],
    ];
    const bottom = [C(null, 'SJ'), C(null, 'BJ'), C(null, 'SJ'), C(null, 'BJ'), C(null, 'SJ'), C(null, 'BJ')];
    const r = startBidding(room, hands, bottom);
    for (let i = 0; i < 4; i++) {
      assert.equal(S.passBid(room, r.bidTurn, false).ok, true);
    }
    settleAll(room);
    assert.equal(room.phase, 'burying');
    assert.equal(r.trumpSuit, 'S');
    assert.equal(r.dealerSeat, 0);
  });
});

/* ------------------------------------------------------------------ */
/* ZhuangJia rotation (owner's rule, 2026-11-20). Round 1: the final   */
/* bidder is the ZhuangJia. From round 2 on the ZhuangJia seat is      */
/* predetermined by rotation from the previous round's result (win:    */
/* next seat on the same team, +2; loss: the immediate next seat, +1), */
/* bidding decides only trump, and the ZhuangJia buries and leads the  */
/* first trick — confirmed explicitly by the owner (point D).          */
/* ------------------------------------------------------------------ */

// Hand-built closing 'bidding' round for round 2, with the rotated
// ZhuangJia seat already fixed (as startRound sets it in real play).
function startBiddingRound2(room, hands, bottom, dealerSeat) {
  const r = startBidding(room, hands, bottom);
  room.roundNo = 2;
  r.dealerSeat = dealerSeat;
  return r;
}

// Play out a one-card-each final trick so endRound runs: the dealer
// leads, everyone follows with their only (heart, non-point) card.
function playOutLastTrick(room, { dealerSeat, defenderPoints }) {
  const hands = [
    [C('H', 3)], [C('H', 4)], [C('H', 6)], [C('H', 8)],
  ];
  hands[dealerSeat] = [C('H', 14)]; // the dealer always wins this trick
  const r = startPlaying(room, hands, { dealerSeat, turn: dealerSeat, defenderPoints });
  r.buried = [];
  room.roundNo = 1;
  const order = [0, 1, 2, 3].map((i) => (dealerSeat + i) % 4);
  const ids = hands.map((h) => h[0].id);
  for (const seat of order) {
    const res = S.doPlay(room, seat, [ids[seat]], false);
    assert.equal(res.ok, true, `seat ${seat} play: ${res.error || ''}`);
  }
  settle(room);
  return r;
}

describe('server: ZhuangJia rotation', () => {
  test('computeNextDealerSeat: win -> +2 seats (same team), loss -> +1 seat (other team), wrapping', () => {
    assert.equal(S.computeNextDealerSeat(0, true, 4), 2);
    assert.equal(S.computeNextDealerSeat(0, false, 4), 1);
    assert.equal(S.computeNextDealerSeat(3, true, 4), 1); // wraps, still Blue
    assert.equal(S.computeNextDealerSeat(3, false, 4), 0); // wraps to Gold
    assert.equal(S.computeNextDealerSeat(5, true, 6), 1);
    assert.equal(S.computeNextDealerSeat(5, false, 6), 0);
  });

  test('round-1 bid winner is the ZhuangJia (existing closing-round flow)', () => {
    // Covered in detail by 'deal -> closing round keeps the high bid'
    // above (dealerSeat ends on the bidder in round 1); here the same
    // outcome from a plain instant round-1 bidding round.
    const room = makeFullRoom('instant');
    const hands = [
      [C('H', 2), C('C', 5)],
      [C('C', 7), C('C', 8)],
      [C('D', 5), C('D', 6)],
      [C('S', 5), C('S', 6)],
    ];
    const r = startBidding(room, hands, sixFiller());
    assert.equal(r.dealerSeat, -1); // nobody predetermined in round 1
    assert.equal(S.doBid(room, 0, 'H', 1, false).ok, true);
    for (let i = 0; i < 3; i++) assert.equal(S.passBid(room, r.bidTurn, false).ok, true);
    settleAll(room);
    assert.equal(room.phase, 'burying');
    assert.equal(r.dealerSeat, 0); // the final bidder
    assert.equal(r.trumpSuit, 'H');
  });

  test('after a ZhuangJia-team win, round 2 starts with the +2 seat as predetermined ZhuangJia', () => {
    const room = makeRoom(); // 4 seats, dealer seat 0 (Gold)
    playOutLastTrick(room, { dealerSeat: 0, defenderPoints: 0 }); // defenders scored 0 < 80: dealer team wins
    settleAll(room);
    assert.equal(room.lastWinnerTeam, 0); // Gold keeps the deal
    assert.equal(room.nextDealerSeat, 2); // next Gold seat
    room.dealSpeed = 'instant';
    S.startRound(room);
    settleAll(room);
    assert.equal(room.roundNo, 2);
    assert.equal(room.round.dealerSeat, 2); // known before bidding starts
    assert.equal(room.phase, 'bidding');
  });

  test('after a ZhuangJia-team loss, round 2 starts with the +1 seat as predetermined ZhuangJia', () => {
    const room = makeRoom(); // dealer seat 1 (Blue) this time
    playOutLastTrick(room, { dealerSeat: 1, defenderPoints: 80 }); // defenders reached 2x40: dealer team loses
    settleAll(room);
    assert.equal(room.lastWinnerTeam, 0); // the opposing (Gold) team takes the deal
    assert.equal(room.nextDealerSeat, 2); // immediate next seat after seat 1 — a Gold seat
    room.dealSpeed = 'instant';
    S.startRound(room);
    settleAll(room);
    assert.equal(room.roundNo, 2);
    assert.equal(room.round.dealerSeat, 2);
    assert.equal(room.phase, 'bidding');
  });

  test('round 2: bidding winner is NOT the ZhuangJia — trump from the bid, ZhuangJia buries and leads the first trick', () => {
    const room = makeFullRoom('instant');
    const hands = [
      [C('C', 5), C('C', 6)],   // seat 0 Alice
      [C('H', 2), C('C', 7)],   // seat 1 Bob holds the level card 2♥
      [C('D', 5), C('D', 6)],   // seat 2 Carol — predetermined ZhuangJia
      [C('S', 5), C('S', 6)],   // seat 3 Dave
    ];
    const r = startBiddingRound2(room, hands, sixFiller(), 2);
    assert.equal(S.passBid(room, 0, false).ok, true); // Alice passes
    assert.equal(S.doBid(room, 1, 'H', 1, false).ok, true); // Bob bids hearts
    assert.equal(S.passBid(room, 2, false).ok, true);
    assert.equal(S.passBid(room, 3, false).ok, true);
    assert.equal(S.passBid(room, 0, false).ok, true); // passing out ends bidding
    settleAll(room);
    assert.equal(room.phase, 'burying');
    assert.equal(r.trumpSuit, 'H'); // trump came from Bob's bid
    assert.equal(r.dealerSeat, 2); // but Carol is still the ZhuangJia
    assert.equal(r.hands[2].length, 2 + 6); // Carol picked up the bottom
    assert.equal(r.hands[1].length, 2); // Bob's hand untouched
    // Point D (owner-confirmed): after burying, the FIRST TRICK is led
    // by the ZhuangJia (seat 2), not by the bidding winner (seat 1).
    const buryIds = r.hands[2].slice(0, 6).map((c) => c.id);
    const bury = S.doBury(room, 2, buryIds, false);
    settleAll(room);
    assert.equal(bury.ok, true);
    assert.equal(room.phase, 'playing');
    assert.equal(r.turn, 2);
  });

  test('round 2 no-bid: flip sets trump from the last bottom card and the predetermined ZhuangJia takes the bottom', () => {
    const room = makeFullRoom('instant');
    const hands = [
      [C('C', 5), C('C', 6)],
      [C('C', 7), C('C', 8)],
      [C('D', 5), C('D', 6)],
      [C('S', 5), C('S', 6)],
    ];
    // Last bottom card is the K♠ — spades trump, whatever came before.
    const bottom = [C('H', 2), C('D', 9), C('C', 10), C('H', 9), C('D', 11), C('S', 13)];
    const r = startBiddingRound2(room, hands, bottom, 3); // Dave is ZhuangJia
    for (let i = 0; i < 4; i++) {
      assert.equal(S.passBid(room, r.bidTurn, false).ok, true);
    }
    settleAll(room);
    assert.equal(room.phase, 'burying');
    assert.equal(r.trumpSuit, 'S');
    assert.equal(r.dealerSeat, 3); // unchanged by the flip
    assert.equal(r.hands[3].length, 2 + 6);
  });

  test('entry page: Chinese rules box and new bullets present, deleted bullets gone', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    // The new English bullets.
    assert.ok(html.includes('Bidding rules'));
    assert.ok(html.includes('before the ZhuangJia taking the "Dipai" (底牌)'));
    assert.ok(html.includes('whether the player is on the ZhuangJia team or non-ZhuangJia team'));
    assert.ok(html.includes('Bidding does not change the ZhuangJia'));
    assert.ok(html.includes('all the bottom cards are flipped over one by one — the suit of the last bottom card is trump'));
    // The Chinese box, with the same six rules.
    assert.ok(html.includes('叫主规则（中文）'));
    assert.ok(html.includes('叫主决定主牌花色'));
    assert.ok(html.includes('发牌时即可叫主'));
    assert.ok(html.includes('桌上任何人都可以叫主'));
    assert.ok(html.includes('后叫主出示的牌必须比前一位多'));
    assert.ok(html.includes('叫主不改变庄家'));
    assert.ok(html.includes('若无人叫主，逐张翻开全部底牌'));
    // Deleted / replaced text must be gone.
    assert.ok(!html.includes('a pair is enough on its own'));
    assert.ok(!html.includes('player whose bid stands is the ZhuangJia'));
    assert.ok(!html.includes('first to bid becomes the ZhuangJia'));
    assert.ok(!html.includes("doesn't matter which team the current ZhuangJia is on"));
    assert.ok(!html.includes('flipped until a level card appears'));
  });
});

/* ------------------------------------------------------------------ */
/* Round-end summary + manual advance (owner's live-test notes,      */
/* 2026-11-20): (1) the summary once showed a dealer-team win as      */
/* "升0级" — the client re-derived the winner's gain by comparing     */
/* teams against a `game` state that no longer exists at roundOver,   */
/* so it always displayed the defenders' number (0 on a dealer win).  */
/* The server now sends winnerLevels, picked from the same result     */
/* that drives applyLevels and the rotation. (2) The result screen    */
/* no longer auto-advances: it stays until any player presses         */
/* "Next Round".                                                      */
/* ------------------------------------------------------------------ */

describe('server: round-end summary & manual advance', () => {
  test('dealer-team shutout win: lastResult.winnerLevels is 3, levels and rotation agree', () => {
    const room = makeRoom(); // dealer seat 0 (Gold), levels [2, 2]
    playOutLastTrick(room, { dealerSeat: 0, defenderPoints: 0 });
    settleAll(room);
    assert.equal(room.phase, 'roundOver');
    const r = room.lastResult;
    assert.equal(r.winnerTeam, 0);
    assert.equal(r.dealerLevels, 3);
    assert.equal(r.defenderLevels, 0);
    assert.equal(r.winnerLevels, 3); // never the loser's 0 — this was the "升0级" bug
    assert.deepEqual(room.levels, [5, 2]); // the gain was really applied
    assert.equal(room.nextDealerSeat, S.computeNextDealerSeat(0, true, 4)); // rotation used the same win
  });

  test('dealer-team normal win: winnerLevels is 1 (not 0)', () => {
    const room = makeRoom();
    playOutLastTrick(room, { dealerSeat: 0, defenderPoints: 70 }); // 70 < 80 line, >= 40: dealer +1
    settleAll(room);
    assert.equal(room.phase, 'roundOver');
    assert.equal(room.lastResult.winnerTeam, 0);
    assert.equal(room.lastResult.dealerLevels, 1);
    assert.equal(room.lastResult.winnerLevels, 1);
    assert.deepEqual(room.levels, [3, 2]);
  });

  test('defender win: winnerLevels is the defenders\u2019 gain', () => {
    const room = makeRoom();
    playOutLastTrick(room, { dealerSeat: 0, defenderPoints: 80 }); // exactly the 2x40 line
    settleAll(room);
    assert.equal(room.phase, 'roundOver');
    assert.equal(room.lastResult.winnerTeam, 1);
    assert.equal(room.lastResult.defenderLevels, 1);
    assert.equal(room.lastResult.winnerLevels, 1);
    assert.deepEqual(room.levels, [2, 3]);
    assert.equal(room.nextDealerSeat, S.computeNextDealerSeat(0, false, 4));
  });

  test('round over: no auto-advance — simulated time far past the old 15 s leaves the room on the result screen', () => {
    const { mock } = require('node:test');
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const room = makeRoom();
      playOutLastTrick(room, { dealerSeat: 0, defenderPoints: 0 });
      assert.equal(room.phase, 'roundOver');
      // Nothing is armed any more: no auto-next timestamp, no timer.
      assert.equal(room.autoNextAt, undefined);
      assert.equal(room.autoTimer, undefined);
      assert.equal(room.timer, null); // endRound cleared the turn timer
      mock.timers.tick(20 * 60 * 1000); // 20 simulated minutes >> the old 15 s pause
      assert.equal(room.phase, 'roundOver'); // still on the summary page
      assert.equal(room.roundNo, 1); // no new round was dealt
      assert.ok(room.lastResult);
    } finally {
      mock.timers.reset();
    }
  });

  test('round over: a Next Round press from a non-dealer seat starts the next round', () => {
    const room = makeRoom();
    playOutLastTrick(room, { dealerSeat: 0, defenderPoints: 0 }); // dealer is seat 0
    settleAll(room);
    assert.equal(room.phase, 'roundOver');
    assert.equal(room.roundNo, 1); // the room waits on the summary page
    // The 'startRound' socket handler accepts the press from ANY player
    // in the room — its only gates are the phase and a full table; it
    // never checks which seat sent it. A press from seat 3 (not the
    // dealer, not the room creator) therefore runs startRound(room):
    room.dealSpeed = 'instant';
    S.startRound(room);
    settleAll(room);
    assert.equal(room.roundNo, 2);
    assert.equal(room.phase, 'bidding');
  });

  test('client: no countdown/auto-start text remains in either language; Next Round labels intact', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
    assert.ok(!js.includes('autoNextNote'));
    assert.ok(!js.includes('auto-count'));
    assert.ok(!js.includes('autoNextAt'));
    assert.ok(!js.includes('starts automatically'));
    assert.ok(!js.includes('自动开始'));
    assert.ok(js.includes("nextRound: 'Next Round'"));
    assert.ok(js.includes("nextRound: '下一局'"));
    // The summary line reads the server-sent winnerLevels.
    assert.ok(js.includes('r.winnerLevels'));
  });
});

/* ------------------------------------------------------------------ */
/* 1v1 mode (owner 2026-11-20): a 2-seat room deals from ONE 54-card   */
/* set + an extra big and small joker (56 cards), 25 each + 6 bottom,  */
/* scoring at nDecks = 1 under the owner's 1v1 table (UPDATED          */
/* 2026-11-20: 40–79 = takeover with no levels). Only single-card      */
/* bids can occur — each suit's level card exists exactly once.        */
/* ------------------------------------------------------------------ */

const G = require('../game');
const NAMES_1V1 = ['Alice', 'Bob'];

function makeRoom1v1(dealSpeed) {
  const room = S.newRoom('TEST1V', 'Alice', null, 2, dealSpeed);
  room.seats = NAMES_1V1.map((name) => ({ name, socketId: null, connected: false }));
  room.log = [];
  return room;
}

// Play out a one-card-each final trick in a 1v1 room so endRound runs
// with a preset non-dealer point total: the dealer leads the A♥ and
// wins the trick (no point cards in it, defenders do not 抠底), so the
// round's T is exactly `defenderPoints`.
function playOutLastTrick1v1(room, { dealerSeat, defenderPoints }) {
  const hands = [[C('H', 3)], [C('H', 4)]];
  hands[dealerSeat] = [C('H', 14)]; // the dealer always wins this trick
  room.phase = 'playing';
  room.roundNo = 1;
  room.round = {
    nDecks: 1, hands, bottom: [], buried: [],
    level: 2, trumpSuit: 'S', dealerSeat,
    bids: [], bidTurn: 0, bidPassed: new Set(), currentBid: null,
    turn: dealerSeat, trickPlays: [], trickLead: null,
    defenderTrickPoints: defenderPoints, dealerTrickPoints: 100 - defenderPoints,
    tricksPlayed: 24, lastTrickWinner: -1, lastWinCards: [], forcedLead: null,
    dealHands: null, dealPos: 0,
  };
  const r = room.round;
  for (const seat of [dealerSeat, 1 - dealerSeat]) {
    const res = S.doPlay(room, seat, [hands[seat][0].id], false);
    assert.equal(res.ok, true, `seat ${seat} play: ${res.error || ''}`);
  }
  settleAll(room);
  return r;
}

// Hand-built closing 'bidding' round for a 1v1 room (level 2).
function startBidding1v1(room, hands, bottom) {
  room.phase = 'bidding';
  room.roundNo = 1;
  room.round = {
    nDecks: 1, hands, bottom, buried: null,
    level: 2, trumpSuit: null, dealerSeat: -1,
    bids: [], bidTurn: 0, bidPassed: new Set(), currentBid: null,
    turn: -1, trickPlays: [], trickLead: null,
    defenderTrickPoints: 0, dealerTrickPoints: 0, tricksPlayed: 0,
    lastTrickWinner: -1, lastWinCards: [], forcedLead: null,
    dealHands: null, dealPos: 0,
  };
  return room.round;
}

describe('server: 1v1 mode', () => {
  test('rotation with 2 seats: win -> same seat (+2 mod 2), loss -> the other player (+1)', () => {
    assert.equal(S.computeNextDealerSeat(0, true, 2), 0);
    assert.equal(S.computeNextDealerSeat(0, false, 2), 1);
    assert.equal(S.computeNextDealerSeat(1, true, 2), 1);
    assert.equal(S.computeNextDealerSeat(1, false, 2), 0);
  });

  test('instant deal: 25 / 25 + 6 bottom from the 56-card pool, nDecks 1', () => {
    const room = makeRoom1v1('instant');
    assert.equal(room.tableSize, 2);
    assert.equal(room.seats.length, 2);
    S.startRound(room);
    settleAll(room);
    assert.equal(room.phase, 'bidding');
    const r = room.round;
    assert.equal(r.nDecks, 1);
    assert.equal(r.hands[0].length, 25);
    assert.equal(r.hands[1].length, 25);
    assert.equal(r.bottom.length, 6);
    const all = [...r.hands.flat(), ...r.bottom];
    assert.equal(all.length, 56);
    assert.equal(new Set(all.map((c) => c.id)).size, 56);
    assert.equal(all.filter((c) => c.rank === 'BJ').length, 2);
    assert.equal(all.filter((c) => c.rank === 'SJ').length, 2);
    assert.equal(new Set(all.filter((c) => c.suit !== null).map((c) => `${c.suit}:${c.rank}`)).size, 52);
  });

  test('timed dispatch: cards arrive one at a time, bottom set aside, closes into bidding at 25 each', () => {
    const room = makeRoom1v1('fast');
    S.startRound(room);
    assert.equal(room.phase, 'dealing');
    assert.equal(room.round.bottom.length, 6); // set aside before dealing starts
    assert.ok(room.round.hands.every((h) => h.length === 0));
    let guard = 0;
    while (room.phase === 'dealing' && guard++ < 500) S.dealTick(room);
    settleAll(room);
    assert.equal(room.phase, 'bidding');
    assert.equal(room.round.hands[0].length, 25);
    assert.equal(room.round.hands[1].length, 25);
    assert.equal(room.dealTimer, null);
  });

  test('a single-card bid sets trump; a pair bid is impossible (only one copy of each level card)', () => {
    const room = makeRoom1v1('instant');
    const hands = [
      [C('H', 2), C('C', 5), C('C', 6)], // Alice holds the only 2♥ in the pool
      [C('C', 7), C('C', 8), C('C', 9)],
    ];
    const r = startBidding1v1(room, hands, sixFiller());
    // A pair of 2♥ can never be held in 1v1 — the bid is rejected.
    let res = S.doBid(room, 0, 'H', 2, false);
    assert.equal(res.ok, false);
    assert.match(res.error, /do not hold/i);
    // The single 2♥ bids fine.
    res = S.doBid(room, 0, 'H', 1, false);
    assert.equal(res.ok, true);
    // Bob's pass ends the closing round (n - 1 = 1 pass needed).
    assert.equal(S.passBid(room, 1, false).ok, true);
    settleAll(room);
    assert.equal(room.phase, 'burying');
    assert.equal(r.trumpSuit, 'H');
    assert.equal(r.dealerSeat, 0); // round 1: the final bidder is 庄家
    assert.equal(r.hands[0].length, 3 + 6); // picked up the bottom
  });

  test('no-bid flip works in 1v1: last bottom card sets trump, first bidder takes the bottom', () => {
    const room = makeRoom1v1('instant');
    const hands = [
      [C('C', 5), C('C', 6)],
      [C('C', 7), C('C', 8)],
    ];
    const bottom = [C('S', 9), C('H', 13), C('D', 9), C('S', 10), C('H', 9), C('C', 12)];
    const r = startBidding1v1(room, hands, bottom);
    assert.equal(S.passBid(room, 0, false).ok, true);
    assert.equal(S.passBid(room, 1, false).ok, true);
    settleAll(room);
    assert.equal(room.phase, 'burying');
    assert.equal(r.trumpSuit, 'C'); // the last bottom card is the ♣Q
    assert.equal(r.dealerSeat, 0);
    assert.equal(r.hands[0].length, 2 + 6);
  });

  test('a complete scripted 1v1 round: bury, all 25 tricks, 40-point line, levels and rotation for round 2', () => {
    const room = makeRoom1v1('instant');
    S.startRound(room);
    const r = room.round;
    // Closing bidding: the first seat holding a level card bids its
    // suit (single — the only bid that exists in 1v1); everyone else
    // passes. If nobody holds one, both pass and the bottom flip runs.
    let guard = 0;
    while (room.phase === 'bidding' && guard++ < 10) {
      const seat = r.bidTurn;
      let acted = false;
      if (!r.currentBid) {
        for (const s of G.SUITS) {
          if (r.hands[seat].some((c) => c.suit === s && c.rank === r.level)) {
            assert.equal(S.doBid(room, seat, s, 1, false).ok, true);
            acted = true;
            break;
          }
        }
      }
      if (!acted) assert.equal(S.passBid(room, seat, false).ok, true);
    }
    assert.equal(room.phase, 'burying');
    const dealerSeat = r.dealerSeat;
    assert.ok(dealerSeat === 0 || dealerSeat === 1);
    assert.equal(r.hands[dealerSeat].length, 25 + 6);
    // Bury the first 6 cards of the dealer's hand.
    const buryIds = r.hands[dealerSeat].slice(0, 6).map((c) => c.id);
    assert.equal(S.doBury(room, dealerSeat, buryIds, false).ok, true);
    assert.equal(room.phase, 'playing');
    assert.equal(r.turn, dealerSeat); // the 庄家 leads the first trick
    // Play out every trick with singles: leader plays their lowest
    // card; the follower answers with their lowest card of the led
    // effective suit, or their lowest card overall when void.
    guard = 0;
    while (room.phase === 'playing' && guard++ < 200) {
      const seat = r.turn;
      const hand = r.hands[seat];
      const byStrength = hand.slice().sort((a, b) =>
        G.cardStrength(a, r.level, r.trumpSuit) - G.cardStrength(b, r.level, r.trumpSuit));
      let card;
      if (r.trickPlays.length === 0) {
        card = byStrength[0];
      } else {
        const S0 = r.trickLead.effSuit;
        card = byStrength.find((c) => G.effectiveSuit(c, r.level, r.trumpSuit) === S0) || byStrength[0];
      }
      const res = S.doPlay(room, seat, [card.id], false);
      assert.equal(res.ok, true, `seat ${seat} play: ${res.error || ''}`);
    }
    settleAll(room);
    assert.equal(room.phase, 'roundOver');
    assert.equal(r.tricksPlayed, 25);
    assert.ok(r.hands.every((h) => h.length === 0));
    // Scoring under the owner's 1v1 table (2026-11-20) and the summary
    // the client renders. T = the non-dealer side's total.
    const lr = room.lastResult;
    const dealerTeam = G.TEAM_OF_SEAT(dealerSeat);
    const defenderTeam = 1 - dealerTeam;
    const T = lr.defenderTotal;
    const defendersWon = T >= 40;
    const expDef = T >= 80 ? 1 : 0;                          // +1 only at 80+ (flat)
    const expDeal = T >= 40 ? 0 : T === 0 ? 3 : T < 20 ? 2 : 1;
    assert.equal(lr.winnerTeam, defendersWon ? defenderTeam : dealerTeam);
    assert.equal(lr.defenderLevels, expDef);
    assert.equal(lr.dealerLevels, expDeal);
    assert.equal(lr.winnerLevels, defendersWon ? expDef : expDeal);
    if (!lr.jackReset) {
      assert.equal(room.levels[defenderTeam], 2 + expDef);
      assert.equal(room.levels[dealerTeam], 2 + expDeal);
    } else {
      assert.equal(room.levels[dealerTeam], 2); // Jacks 抠底 reset
      assert.equal(room.levels[defenderTeam], 2 + expDef);
    }
    // Rotation for game 2: win -> same seat, loss -> the other player.
    assert.equal(room.nextDealerSeat, S.computeNextDealerSeat(dealerSeat, !defendersWon, 2));
    assert.equal(room.nextDealerSeat, defendersWon ? 1 - dealerSeat : dealerSeat);
    // Round 2 starts with the rotated 庄家 predetermined, 25 each again.
    S.startRound(room);
    settleAll(room);
    assert.equal(room.roundNo, 2);
    assert.equal(room.phase, 'bidding');
    assert.equal(room.round.dealerSeat, room.nextDealerSeat);
    assert.equal(room.round.nDecks, 1);
    assert.equal(room.round.hands[0].length, 25);
    assert.equal(room.round.hands[1].length, 25);
    assert.equal(room.dealingTeam, lr.winnerTeam);
  });

  test('a scripted 1v1 round in the 40-79 takeover band: levels unchanged, the other player is next ZhuangJia', () => {
    // UPDATED 2026-11-20 (owner's 1v1 table): 40 <= T < 80 takes the
    // deal with NO level for either side — winnerLevels 0 here is the
    // truth, not the old "升0级" display bug.
    for (const T of [40, 55, 79]) {
      const room = makeRoom1v1('instant'); // dealer seat 0 (Alice, Gold)
      playOutLastTrick1v1(room, { dealerSeat: 0, defenderPoints: T });
      assert.equal(room.phase, 'roundOver');
      const lr = room.lastResult;
      assert.equal(lr.defenderTotal, T);
      assert.equal(lr.winnerTeam, 1);        // the non-dealer side takes over
      assert.equal(lr.winnerLevels, 0);      // ...with no level gained
      assert.equal(lr.defenderLevels, 0);
      assert.equal(lr.dealerLevels, 0);
      assert.deepEqual(room.levels, [2, 2]); // neither side moved
      assert.equal(room.nextDealerSeat, 1);  // the other player deals next
      // Round 2 starts with Bob as the predetermined ZhuangJia.
      S.startRound(room);
      settleAll(room);
      assert.equal(room.roundNo, 2);
      assert.equal(room.phase, 'bidding');
      assert.equal(room.round.dealerSeat, 1);
      assert.equal(room.round.nDecks, 1);
      assert.equal(room.round.hands[0].length, 25);
      assert.equal(room.round.hands[1].length, 25);
    }
  });

  test('client: the creation page offers a clearly labeled 1v1 option; bid tiles are single-only in 1v1', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
    assert.ok(html.includes('<option value="2" data-i18n="size1v1">'));
    assert.ok(js.includes("size1v1: '1 v 1 (1 deck + extra jokers)'"));
    assert.ok(js.includes('size1v1:')); // zh label present too
    assert.ok(js.includes('noteNoOverbid1v1'));
    assert.ok(js.includes('bidHintHtml1v1'));
    // The tile loop offers only the single tile in a 2-seat room.
    assert.ok(js.includes('is1v1 ? [1] : [1, 2]'));
    // The takeover band (winnerLevels 0) renders its own summary line
    // in BOTH languages — never the bare "升 0 级" of resultWins.
    assert.ok(js.includes('takes over as ZhuangJia — no level change.'));
    assert.ok(js.includes('接庄——本局不升级。'));
    assert.ok(js.includes("t('resultTakeover'"));
    assert.ok(js.includes('lv === 0'));
  });
});
