'use strict';
/* Tractor engine tests — run with: npm test   (node --test test/game.test.js) */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const G = require('../game');

// Card factories (unique ids).
let _id = 10000;
const C = (suit, rank) => ({ id: _id++, suit, rank });
const SJ = () => ({ id: _id++, suit: null, rank: 'SJ' });
const BJ = () => ({ id: _id++, suit: null, rank: 'BJ' });
const pair = (suit, rank) => [C(suit, rank), C(suit, rank)];
const triple = (suit, rank) => [C(suit, rank), C(suit, rank), C(suit, rank)];

const LEVEL = 7;
const TRUMP = 'S';

describe('deck & deal', () => {
  test('buildDeck(2) has 108 cards with unique ids', () => {
    const d = G.buildDeck(2);
    assert.equal(d.length, 108);
    assert.equal(d.filter((c) => c.rank === 'SJ').length, 2);
    assert.equal(d.filter((c) => c.rank === 'BJ').length, 2);
    assert.equal(new Set(d.map((c) => c.id)).size, 108);
  });

  for (const [players, total] of [[4, 110], [6, 162], [8, 214], [10, 266]]) {
    test(`deal(${players}): 26 each + 6 bottom = ${total}`, () => {
      const { hands, bottom, nDecks } = G.deal(players);
      assert.equal(nDecks, players / 2);
      assert.equal(hands.length, players);
      for (const h of hands) assert.equal(h.length, 26);
      assert.equal(bottom.length, 6);
      const all = [...hands.flat(), ...bottom];
      assert.equal(all.length, total);
      assert.equal(new Set(all.map((c) => c.id)).size, total);
    });
  }

  test('deal throws for unsupported player counts', () => {
    assert.throws(() => G.deal(5));
  });
});

describe('trump helpers', () => {
  test('effectiveSuit: level cards and trump-suit cards are trump', () => {
    assert.equal(G.effectiveSuit(C('H', 7), LEVEL, TRUMP), 'T');
    assert.equal(G.effectiveSuit(C('S', 5), LEVEL, TRUMP), 'T');
    assert.equal(G.effectiveSuit(SJ(), LEVEL, TRUMP), 'T');
    assert.equal(G.effectiveSuit(C('H', 13), LEVEL, TRUMP), 'H');
  });

  test('trump strength order: BJ > SJ > 7S > 7H > AS > KS', () => {
    const s = (c) => G.trumpStrength(c, LEVEL, TRUMP);
    assert.ok(s(BJ()) > s(SJ()));
    assert.ok(s(SJ()) > s(C('S', 7)));
    assert.ok(s(C('S', 7)) > s(C('H', 7)));
    assert.ok(s(C('H', 7)) === s(C('D', 7))); // off-suit level cards tie
    assert.ok(s(C('H', 7)) > s(C('S', 14)));
    assert.ok(s(C('S', 14)) > s(C('S', 13)));
  });

  test('point cards: 5=5, 10/K=10, others 0', () => {
    assert.equal(G.cardPoints(C('H', 5)), 5);
    assert.equal(G.cardPoints(C('H', 10)), 10);
    assert.equal(G.cardPoints(C('H', 13)), 10);
    assert.equal(G.cardPoints(C('H', 14)), 0);
    assert.equal(G.cardPoints(SJ()), 0);
    assert.equal(G.pointsOf([...pair('H', 5), ...pair('D', 13), C('C', 3)]), 30);
  });
});

describe('bidding', () => {
  test('possibleTrumpCount counts bid suit + all level cards + jokers', () => {
    const hand = [
      C('S', 14), C('S', 13), C('S', 12), C('S', 11), C('S', 10), // 5 spades
      C('H', 7), C('D', 7), // 2 off-suit level cards
      SJ(), // 1 joker
      C('H', 5),
    ];
    assert.equal(G.possibleTrumpCount(hand, 'S', LEVEL), 8);
    assert.equal(G.possibleTrumpCount(hand, 'H', LEVEL), 4); // H7 + 7D? no: H cards + levels + jokers
  });

  test('pair bid accepted with >= 8 possible trump', () => {
    const hand = [
      ...pair('S', 9), C('S', 14), C('S', 13), C('S', 12), C('S', 11), // 6 spades
      C('H', 7), // level
      SJ(), // joker -> 8
    ];
    const r = G.validateBid(hand, { suit: 'S', rank: 9, cards: 2 }, LEVEL);
    assert.equal(r.ok, true);
  });

  test('pair bid accepted with < 8 possible trump (human-play rule)', () => {
    const hand = [...pair('S', 9), C('S', 14), C('H', 7), SJ(), C('D', 5)];
    // spades: S9,S9,S14 = 3; levels: H7 = 1; jokers: 1 -> total 5 possible trump
    const r = G.validateBid(hand, { suit: 'S', rank: 9, cards: 2 }, LEVEL);
    assert.equal(r.ok, true);
  });

  test('pair bid accepted with < 6 possible trump (no 6- or 8-trump gate on this server)', () => {
    // Every player here is human and the human player has NO bidding
    // restriction, so a pair bid requires only the pair itself. This hand
    // has exactly 2 possible trump for a hearts bid (the pair itself).
    const hand = [...pair('H', 7), C('D', 5), C('C', 9), C('D', 11)];
    assert.equal(G.possibleTrumpCount(hand, 'H', LEVEL), 2);
    const r = G.validateBid(hand, { suit: 'H', rank: 7, cards: 2 }, LEVEL);
    assert.equal(r.ok, true);
  });

  test('single bid needs only to be held; pair bid needs the pair held', () => {
    const hand = [C('S', 9), C('H', 5)];
    assert.equal(G.validateBid(hand, { suit: 'S', rank: 9, cards: 1 }, LEVEL).ok, true);
    assert.equal(G.validateBid(hand, { suit: 'S', rank: 9, cards: 2 }, LEVEL).ok, false);
    assert.equal(G.validateBid(hand, { suit: 'H', rank: 9, cards: 1 }, LEVEL).reason, 'not-held');
  });

  test('bidOutranks: pair beats single; equal never overcalls (first priority)', () => {
    assert.equal(G.bidOutranks({ cards: 2 }, { cards: 1 }), true);
    assert.equal(G.bidOutranks({ cards: 1 }, { cards: 2 }), false);
    assert.equal(G.bidOutranks({ cards: 1 }, { cards: 1 }), false);
    assert.equal(G.bidOutranks({ cards: 2 }, { cards: 2 }), false);
    assert.equal(G.bidOutranks({ cards: 1 }, null), true);
  });

  test('resolveBidding honors chronology and first-bidder priority', () => {
    const b1 = { suit: 'H', rank: 5, cards: 1 };
    const b2 = { suit: 'D', rank: 5, cards: 2 };
    const b3 = { suit: 'C', rank: 5, cards: 2 };
    const win = G.resolveBidding([
      { player: 0, bid: b1 },
      { player: 1, bid: b2 },
      { player: 2, bid: b3 }, // equal pair: does NOT displace player 1
    ]);
    assert.equal(win.player, 1);
    assert.equal(G.trumpSuitFromBid(win), 'D');
    assert.equal(G.trumpSuitFromBid(null), null);
  });
});

describe('tractor detection (level 7, spades trump)', () => {
  const t = (cards) => G.classify(cards, LEVEL, TRUMP);

  test('7S7S + 7H7H is a tractor', () => {
    const r = t([...pair('S', 7), ...pair('H', 7)]);
    assert.equal(r.type, 'tractor');
    assert.equal(r.unit, 2);
    assert.equal(r.length, 2);
  });
  test('7H7H + ASAS is a tractor', () => {
    assert.equal(t([...pair('H', 7), ...pair('S', 14)]).type, 'tractor');
  });
  test('7S7S + 7H7H + ASAS is a tractor', () => {
    const r = t([...pair('S', 7), ...pair('H', 7), ...pair('S', 14)]);
    assert.equal(r.type, 'tractor');
    assert.equal(r.length, 3);
  });
  // UPDATED 2026-11-19 (throw): non-consecutive same-type units are no
  // longer 'invalid' — classify() recognises them as a throw (甩牌).
  // They are still NOT tractors, which is what these tests are about.
  test('7S7S + ASAS is NOT a tractor (rank gap)', () => {
    assert.equal(t([...pair('S', 7), ...pair('S', 14)]).type, 'throw');
  });
  test('triples chain the same way; 7S7S7S + ASASAS is NOT', () => {
    assert.equal(t([...triple('H', 7), ...triple('S', 7)]).type, 'tractor');
    assert.equal(t([...triple('S', 7), ...triple('S', 14)]).type, 'throw'); // UPDATED 2026-11-19 (throw)
  });
  test('7H7H + 7D7D is NOT a tractor (same ladder key)', () => {
    assert.equal(t([...pair('H', 7), ...pair('D', 7)]).type, 'throw'); // UPDATED 2026-11-19 (throw)
  });
  // UPDATED 2026-11-19 (level-skip, any length): natural suits skip the
  // level rank too — with 7 removed from the sequence, 6 and 8 ARE
  // consecutive. (This previously asserted the level gap broke the chain.)
  test('natural-suit tractors work; the level rank is skipped in the sequence', () => {
    assert.equal(t([...pair('H', 13), ...pair('H', 12)]).type, 'tractor'); // KQ hearts
    assert.equal(t([...pair('H', 8), ...pair('H', 6)]).type, 'tractor'); // 7 skipped
    // UPDATED 2026-11-19 (throw): a real gap (8 missing) — a throw, not a tractor.
    assert.equal(t([...pair('H', 9), ...pair('H', 6)]).type, 'throw');
  });
  test('trump-suit natural tractor works', () => {
    assert.equal(t([...pair('S', 13), ...pair('S', 12)]).type, 'tractor'); // KQ spades
  });
  test('single pair / triple / quad classify correctly (not tractors)', () => {
    assert.equal(t(pair('H', 9)).type, 'pair');
    assert.equal(t(triple('H', 9)).type, 'triple');
    assert.equal(t([...pair('H', 9), ...pair('H', 9)]).type, 'quad');
    assert.equal(t([C('H', 9)]).type, 'single');
    assert.equal(t([SJ(), SJ()]).type, 'pair');
    assert.equal(t([C('H', 9), C('D', 9)]).type, 'invalid'); // mixed suits
  });
});

describe('joker tractor chains (level 7, spades trump)', () => {
  const t = (cards) => G.classify(cards, LEVEL, TRUMP);

  test('small-joker pair + on-suit level pair is a tractor', () => {
    const r = t([SJ(), SJ(), ...pair('S', 7)]);
    assert.equal(r.type, 'tractor');
    assert.equal(r.unit, 2);
    assert.equal(r.length, 2);
  });
  test('big-joker pair + small-joker pair is a tractor', () => {
    const r = t([BJ(), BJ(), SJ(), SJ()]);
    assert.equal(r.type, 'tractor');
    assert.equal(r.unit, 2);
    assert.equal(r.length, 2);
  });
  test('full chain: BJ BJ + SJ SJ + 7S7S + 7H7H + ASAS is a tractor', () => {
    const r = t([BJ(), BJ(), SJ(), SJ(), ...pair('S', 7), ...pair('H', 7), ...pair('S', 14)]);
    assert.equal(r.type, 'tractor');
    assert.equal(r.unit, 2);
    assert.equal(r.length, 5);
  });
  // UPDATED 2026-11-19 (throw): the skipped-link combos below are not
  // tractors, but they ARE throws now (classify recognises 2+ same-type
  // units), so they assert 'throw' instead of the old 'invalid'.
  test('big-joker pair + on-suit level pair is NOT a tractor (SJ skipped)', () => {
    assert.equal(t([BJ(), BJ(), ...pair('S', 7)]).type, 'throw');
  });
  // UPDATED 2026-11-19 (strict chain): the old "flexible small joker"
  // rule let SJ chain directly above an off-suit level pair or the trump
  // ace. The user's new rule is consecutive-only — SJ's only neighbours
  // are BJ and the trump-suit level group — so all of these now skip a
  // link and are NOT tractors.
  test('small-joker pair + off-suit level pair is NOT a tractor (trump level skipped)', () => {
    assert.equal(t([SJ(), SJ(), ...pair('H', 7)]).type, 'throw'); // UPDATED 2026-11-19 (throw)
  });
  test('small-joker pair + trump-suit ace pair is NOT a tractor (both levels skipped)', () => {
    assert.equal(t([SJ(), SJ(), ...pair('S', 14)]).type, 'throw'); // UPDATED 2026-11-19 (throw)
  });
  test('BJ BJ + SJ SJ + 7H7H is NOT a tractor (trump level skipped)', () => {
    assert.equal(t([BJ(), BJ(), SJ(), SJ(), ...pair('H', 7)]).type, 'throw'); // UPDATED 2026-11-19 (throw)
  });
  test('BJ BJ + SJ SJ + ASAS is NOT a tractor (levels skipped)', () => {
    assert.equal(t([BJ(), BJ(), SJ(), SJ(), ...pair('S', 14)]).type, 'throw'); // UPDATED 2026-11-19 (throw)
  });
  test('SJ SJ + 7H7H + ASAS is NOT a tractor (SJ-off-suit link skips trump level)', () => {
    assert.equal(t([SJ(), SJ(), ...pair('H', 7), ...pair('S', 14)]).type, 'throw'); // UPDATED 2026-11-19 (throw)
  });
  test('trump ace pair + trump K pair IS a tractor (A-K link of the chain)', () => {
    const r = t([...pair('S', 14), ...pair('S', 13)]);
    assert.equal(r.type, 'tractor');
    assert.equal(r.unit, 2);
    assert.equal(r.length, 2);
  });
  test('full 6-group chain incl. K is a tractor', () => {
    const r = t([BJ(), BJ(), SJ(), SJ(), ...pair('S', 7), ...pair('H', 7), ...pair('S', 14), ...pair('S', 13)]);
    assert.equal(r.type, 'tractor');
    assert.equal(r.unit, 2);
    assert.equal(r.length, 6);
  });
  test('off-suit level pair + trump K pair is NOT a tractor (ace skipped)', () => {
    assert.equal(t([...pair('H', 7), ...pair('S', 13)]).type, 'throw'); // UPDATED 2026-11-19 (throw)
  });
  test('7S7S + SJ SJ + ASAS is NOT a tractor (7S-AS gap not bridged)', () => {
    assert.equal(t([...pair('S', 7), SJ(), SJ(), ...pair('S', 14)]).type, 'throw'); // UPDATED 2026-11-19 (throw)
  });
  test('SJ SJ + KSKS is NOT a tractor (several links skipped)', () => {
    assert.equal(t([SJ(), SJ(), ...pair('S', 13)]).type, 'throw'); // UPDATED 2026-11-19 (throw)
  });
  test('triples chain the same way', () => {
    const tri = (fn) => [fn(), fn(), fn()];
    assert.equal(t([...tri(SJ), ...triple('S', 7)]).type, 'tractor');
    assert.equal(t([...tri(BJ), ...tri(SJ)]).type, 'tractor');
    const full = [...tri(BJ), ...tri(SJ), ...triple('S', 7), ...triple('H', 7), ...triple('S', 14)];
    const r = t(full);
    assert.equal(r.type, 'tractor');
    assert.equal(r.unit, 3);
    assert.equal(r.length, 5);
  });
  test('triples: SJ chains only with BJ and the trump-suit level group', () => {
    const tri = (fn) => [fn(), fn(), fn()];
    // UPDATED 2026-11-19 (strict chain): SJ above 7H / AS used to be a
    // tractor under the flexible-SJ rule; both skip a link now.
    // UPDATED 2026-11-19 (throw): those skipped-link triples are throws
    // now, not 'invalid' — still not tractors.
    assert.equal(t([...tri(SJ), ...triple('H', 7)]).type, 'throw');
    assert.equal(t([...tri(SJ), ...triple('S', 14)]).type, 'throw');
    assert.equal(t([...tri(BJ), ...tri(SJ), ...triple('H', 7)]).type, 'throw');
    assert.equal(t([...triple('S', 7), ...tri(SJ), ...triple('S', 14)]).type, 'throw');
    // Adjacent triple links still work, incl. the A-K link and full chain.
    assert.equal(t([...tri(SJ), ...triple('S', 7)]).type, 'tractor');
    assert.equal(t([...triple('S', 14), ...triple('S', 13)]).type, 'tractor');
    const full = [...tri(BJ), ...tri(SJ), ...triple('S', 7), ...triple('H', 7), ...triple('S', 14), ...triple('S', 13)];
    const r = t(full);
    assert.equal(r.type, 'tractor');
    assert.equal(r.unit, 3);
    assert.equal(r.length, 6);
  });
  test('triple: BJ + on-suit level without SJ is NOT a tractor', () => {
    const tri = (fn) => [fn(), fn(), fn()];
    assert.equal(t([...tri(BJ), ...triple('S', 7)]).type, 'throw'); // UPDATED 2026-11-19 (throw)
  });
  test('rule generalizes: level 5, hearts trump', () => {
    const t2 = (cards) => G.classify(cards, 5, 'H');
    assert.equal(t2([SJ(), SJ(), ...pair('H', 5)]).type, 'tractor');
    assert.equal(t2([BJ(), BJ(), SJ(), SJ()]).type, 'tractor');
    // UPDATED 2026-11-19 (strict chain): SJ directly above an off-suit
    // level pair or the trump ace skips a link — no longer tractors.
    // UPDATED 2026-11-19 (throw): those combos are throws now, not 'invalid'.
    assert.equal(t2([SJ(), SJ(), ...pair('D', 5)]).type, 'throw'); // off-suit level
    assert.equal(t2([SJ(), SJ(), ...pair('H', 14)]).type, 'throw'); // trump ace
    assert.equal(t2([...pair('D', 5), ...pair('H', 14)]).type, 'tractor'); // off-suit L + trump A
    assert.equal(t2([...pair('H', 14), ...pair('H', 13)]).type, 'tractor'); // trump A + trump K
    assert.equal(t2([BJ(), BJ(), ...pair('H', 5)]).type, 'throw'); // UPDATED 2026-11-19 (throw)
    assert.equal(t2([...pair('H', 5), SJ(), SJ(), ...pair('H', 14)]).type, 'throw'); // gap; UPDATED 2026-11-19 (throw)
  });
  test('follow: joker-chain trump tractor lead must be matched', () => {
    const sj1 = SJ(), sj2 = SJ(), s7a = C('S', 7), s7b = C('S', 7);
    const leadCards = [sj1, sj2, s7a, s7b];
    const hand = [...leadCards, C('D', 2)];
    const lead = G.validateLead(hand, leadCards, [], LEVEL, TRUMP);
    assert.equal(lead.ok && lead.type, 'tractor');
    // Follower holds the same chain -> must play it.
    const fsj1 = SJ(), fsj2 = SJ(), f7a = C('S', 7), f7b = C('S', 7);
    const fs9 = C('S', 9), fs10 = C('S', 10);
    const fTractor = [fsj1, fsj2, f7a, f7b];
    const fHand = [...fTractor, fs9, fs10];
    assert.equal(G.validateFollow(fHand, fTractor, lead, LEVEL, TRUMP).ok, true);
    // Pair + padding while holding the chain -> reject.
    const bad = [fsj1, fsj2, fs9, fs10];
    assert.equal(G.validateFollow(fHand, bad, lead, LEVEL, TRUMP).ok, false);
  });
});

// UPDATED 2026-11-19 (level-skip, any length): the user superseded the
// Oct 2026 rule under which only a 2-unit tractor could skip the level
// and 3+ units had to include it. Now the level rank may be skipped by a
// tractor of ANY length, so 33+55+66 and 22+33+55 (pairs and triples)
// ARE tractors; including the level at face value (33+44+55) still works.
describe('level-skip tractor rule (level 4, spades trump)', () => {
  const L4 = 4;
  const t4 = (cards) => G.classify(cards, L4, TRUMP);

  test('33+55 is a valid 2-pair tractor (level skipped)', () => {
    const r = t4([...pair('S', 3), ...pair('S', 5)]);
    assert.equal(r.type, 'tractor');
    assert.equal(r.unit, 2);
    assert.equal(r.length, 2);
  });
  test('33+44+55 is a valid 3-pair tractor (level bridges 3 and 5)', () => {
    const r = t4([...pair('S', 3), ...pair('S', 4), ...pair('S', 5)]);
    assert.equal(r.type, 'tractor');
    assert.equal(r.length, 3);
  });
  test('33+55+66 IS a tractor (3-pair may skip the level)', () => {
    const r = t4([...pair('S', 3), ...pair('S', 5), ...pair('S', 6)]);
    assert.equal(r.type, 'tractor');
    assert.equal(r.length, 3);
  });
  test('22+33+55 IS a tractor (3-pair may skip the level)', () => {
    const r = t4([...pair('S', 2), ...pair('S', 3), ...pair('S', 5)]);
    assert.equal(r.type, 'tractor');
    assert.equal(r.length, 3);
  });
  test('33+44 and 44+55 are valid 2-pair tractors (level at face value)', () => {
    assert.equal(t4([...pair('S', 3), ...pair('S', 4)]).type, 'tractor');
    assert.equal(t4([...pair('S', 4), ...pair('S', 5)]).type, 'tractor');
  });
  test('55+66+77 still valid (no level involved)', () => {
    assert.equal(t4([...pair('S', 5), ...pair('S', 6), ...pair('S', 7)]).type, 'tractor');
  });
  test('non-trump suits skip the level too: 5H+6H+7H valid; 3H+5H is a tractor (4 skipped)', () => {
    assert.equal(t4([...pair('H', 5), ...pair('H', 6), ...pair('H', 7)]).type, 'tractor');
    assert.equal(t4([...pair('H', 3), ...pair('H', 5)]).type, 'tractor');
    // UPDATED 2026-11-19 (throw): a real gap (5 missing) — a throw, not a tractor.
    assert.equal(t4([...pair('H', 3), ...pair('H', 6)]).type, 'throw');
  });
  test('triples follow the same rule', () => {
    assert.equal(t4([...triple('S', 3), ...triple('S', 5)]).type, 'tractor');
    assert.equal(t4([...triple('S', 3), ...triple('S', 4), ...triple('S', 5)]).type, 'tractor');
    // UPDATED 2026-11-19: 3-unit triples may skip the level too.
    assert.equal(t4([...triple('S', 3), ...triple('S', 5), ...triple('S', 6)]).type, 'tractor');
    assert.equal(t4([...triple('S', 2), ...triple('S', 3), ...triple('S', 5)]).type, 'tractor');
  });
  test('level-combining rule still works: 4S4S+4H4H is a tractor', () => {
    assert.equal(t4([...pair('S', 4), ...pair('H', 4)]).type, 'tractor');
  });
  test('lead: 33+55+66 and 33+44+55 are both accepted', () => {
    const skipLead = [...pair('S', 3), ...pair('S', 5), ...pair('S', 6)];
    const skipHand = [...skipLead, C('D', 2)];
    const lead1 = G.validateLead(skipHand, skipLead, [], L4, TRUMP);
    assert.equal(lead1.ok && lead1.type, 'tractor');
    const goodLead = [...pair('S', 3), ...pair('S', 4), ...pair('S', 5)];
    const goodHand = [...goodLead, C('D', 2)];
    const lead = G.validateLead(goodHand, goodLead, [], L4, TRUMP);
    assert.equal(lead.ok && lead.type, 'tractor');
  });
});

// The user's own examples for the 2026-11-19 rule (level 8): the level
// rank may be skipped by tractors of any length — 6+7+9, 7+9 and
// 7+9+10 are all tractors, as pairs and as triples, in trump and in
// natural suits. Including the 8s at face value also still works.
describe('level-skip, any length (level 8, spades trump — the user\'s examples)', () => {
  const L8 = 8;
  const t8 = (cards) => G.classify(cards, L8, TRUMP);

  test('pairs, trump suit: 6+7+9, 7+9 and 7+9+10 are tractors', () => {
    const r1 = t8([...pair('S', 6), ...pair('S', 7), ...pair('S', 9)]);
    assert.equal(r1.type, 'tractor');
    assert.equal(r1.length, 3);
    const r2 = t8([...pair('S', 7), ...pair('S', 9)]);
    assert.equal(r2.type, 'tractor');
    assert.equal(r2.length, 2);
    const r3 = t8([...pair('S', 7), ...pair('S', 9), ...pair('S', 10)]);
    assert.equal(r3.type, 'tractor');
    assert.equal(r3.length, 3);
  });
  test('pairs, natural suit: 6+7+9, 7+9 and 7+9+10 are tractors', () => {
    for (const ranks of [[6, 7, 9], [7, 9], [7, 9, 10]]) {
      const r = t8(ranks.flatMap((rk) => pair('H', rk)));
      assert.equal(r.type, 'tractor');
      assert.equal(r.effSuit, 'H');
      assert.equal(r.length, ranks.length);
    }
  });
  test('triples follow the same shapes, trump and natural', () => {
    for (const suit of ['S', 'H']) {
      for (const ranks of [[6, 7, 9], [7, 9], [7, 9, 10]]) {
        const r = t8(ranks.flatMap((rk) => triple(suit, rk)));
        assert.equal(r.type, 'tractor');
        assert.equal(r.unit, 3);
        assert.equal(r.length, ranks.length);
      }
    }
  });
  test('longer runs skip too; real gaps are still not tractors', () => {
    const r = t8([5, 6, 7, 9, 10].flatMap((rk) => pair('S', rk)));
    assert.equal(r.type, 'tractor');
    assert.equal(r.length, 5);
    // UPDATED 2026-11-19 (throw): real gaps (9 missing) — throws, not tractors.
    assert.equal(t8([...pair('S', 6), ...pair('S', 7), ...pair('S', 10)]).type, 'throw');
    assert.equal(t8([...pair('S', 7), ...pair('S', 10)]).type, 'throw');
    assert.equal(t8([...pair('H', 6), ...pair('H', 7), ...pair('H', 10)]).type, 'throw'); // natural too
  });
  test('including the 8s still works: 6+7+8+9 is a tractor in trump and in a natural suit', () => {
    const rt = t8([6, 7, 8, 9].flatMap((rk) => pair('S', rk))); // face-value inclusion in trump
    assert.equal(rt.type, 'tractor');
    assert.equal(rt.length, 4);
    const rn = t8([6, 7, 8, 9].flatMap((rk) => pair('H', rk))); // suit-face inclusion in hearts
    assert.equal(rn.type, 'tractor');
    assert.equal(rn.effSuit, 'H');
    assert.equal(rn.suitFace, true);
  });
  test('follow: a skipping tractor lead must be answered with a tractor if held', () => {
    // Trump tractor lead 7+9+10 (3 pairs) at level 8.
    const leadCards = [...pair('S', 7), ...pair('S', 9), ...pair('S', 10)];
    const lead = G.validateLead([...leadCards, C('H', 2)], leadCards, [], L8, TRUMP);
    assert.equal(lead.ok && lead.type, 'tractor');
    assert.equal(lead.length, 3);
    // Follower holds the skipping tractor 6+7+9 plus a Q pair and singles.
    const fTractor = [...pair('S', 6), ...pair('S', 7), ...pair('S', 9)];
    const fHand = [...fTractor, ...pair('S', 12), C('S', 3), C('S', 4)];
    assert.equal(G.validateFollow(fHand, fTractor, lead, L8, TRUMP).ok, true);
    // 2 pairs + padding while holding that tractor -> reject.
    const bad = [fHand[6], fHand[7], fHand[4], fHand[5], fHand[8], fHand[9]];
    assert.equal(G.validateFollow(fHand, bad, lead, L8, TRUMP).ok, false);
  });
});

describe('suit-face tractors (level 4, spades trump; diamonds are a natural suit)', () => {
  const L4 = 4;
  const t4 = (cards) => G.classify(cards, L4, TRUMP);

  test('♦3+♦4 and ♦4+♦5 are tractors (level pair at face value in its own suit)', () => {
    const r1 = t4([...pair('D', 3), ...pair('D', 4)]);
    assert.equal(r1.type, 'tractor');
    assert.equal(r1.unit, 2);
    assert.equal(r1.length, 2);
    assert.equal(r1.effSuit, 'D');
    assert.equal(t4([...pair('D', 4), ...pair('D', 5)]).type, 'tractor');
  });
  test('♦3+♦4+♦5 is a 3-pair tractor', () => {
    const r = t4([...pair('D', 3), ...pair('D', 4), ...pair('D', 5)]);
    assert.equal(r.type, 'tractor');
    assert.equal(r.length, 3);
    assert.equal(r.effSuit, 'D');
  });
  // UPDATED 2026-11-19 (level-skip, any length): ♦3+♦5 IS a tractor now
  // — not via the suit-face path (no level group is included) but as a
  // plain natural diamond tractor: with the level rank 4 removed from
  // the sequence, 3 and 5 are consecutive. (Previously invalid because
  // natural suits did not skip the level.)
  test('♦3+♦5 IS a tractor (natural diamonds, level 4 skipped)', () => {
    const r = t4([...pair('D', 3), ...pair('D', 5)]);
    assert.equal(r.type, 'tractor');
    assert.equal(r.effSuit, 'D');
    assert.equal(r.suitFace, undefined); // natural tractor, not suit-face
  });
  test('a lone ♦4 pair is still a trump pair, not a diamond pair', () => {
    const r = t4(pair('D', 4));
    assert.equal(r.type, 'pair');
    assert.equal(r.effSuit, 'T');
  });
  test('triples follow the same rule', () => {
    assert.equal(t4([...triple('D', 3), ...triple('D', 4)]).type, 'tractor');
    assert.equal(t4([...triple('D', 4), ...triple('D', 5)]).type, 'tractor');
    const r = t4([...triple('D', 3), ...triple('D', 4), ...triple('D', 5)]);
    assert.equal(r.type, 'tractor');
    assert.equal(r.unit, 3);
    // UPDATED 2026-11-19 (level-skip, any length): ♦3+♦5 triples skip 4.
    assert.equal(t4([...triple('D', 3), ...triple('D', 5)]).type, 'tractor');
  });
  // UPDATED 2026-11-19 (level-skip, any length): ♣8+♣10 is a tractor too
  // — 9 is the level and is skipped in the clubs sequence.
  test('rule generalizes: level 9, hearts trump — ♣8+♣9, ♣9+♣10 and ♣8+♣10 are tractors', () => {
    const t9 = (cards) => G.classify(cards, 9, 'H');
    assert.equal(t9([...pair('C', 8), ...pair('C', 9)]).type, 'tractor');
    assert.equal(t9([...pair('C', 9), ...pair('C', 10)]).type, 'tractor');
    assert.equal(t9([...pair('C', 8), ...pair('C', 10)]).type, 'tractor');
    assert.equal(t9(pair('C', 9)).effSuit, 'T'); // lone level pair still trump
  });
  test('lead: ♦3+♦4+♦5 and ♦3+♦5 are both legal diamond tractor leads', () => {
    const good = [...pair('D', 3), ...pair('D', 4), ...pair('D', 5)];
    const lead = G.validateLead([...good, C('C', 2)], good, [], L4, TRUMP);
    assert.equal(lead.ok, true);
    assert.equal(lead.type, 'tractor');
    assert.equal(lead.effSuit, 'D');
    // UPDATED 2026-11-19 (level-skip, any length): ♦3+♦5 leads legally.
    const skip = [...pair('D', 3), ...pair('D', 5)];
    const lead2 = G.validateLead([...skip, C('C', 2)], skip, [], L4, TRUMP);
    assert.equal(lead2.ok, true);
    assert.equal(lead2.type, 'tractor');
    assert.equal(lead2.effSuit, 'D');
  });
  test('face strength: ♦3/♦4/♦5 tractor is weaker than ♦5/♦6/♦7 in both directions', () => {
    const mk = (player, cards) => ({ player, cards });
    const weak = [...pair('D', 3), ...pair('D', 4), ...pair('D', 5)];
    const strong = [...pair('D', 5), ...pair('D', 6), ...pair('D', 7)];
    // weak leads, strong follows -> strong wins (face key 7 > 5, not trump 700)
    const leadWeak = G.validateLead([...weak, C('C', 2)], weak, [], L4, TRUMP);
    assert.equal(G.trickWinner([mk(0, weak), mk(1, strong)], leadWeak, L4, TRUMP), 1);
    // strong leads, weak follows -> leader holds
    const leadStrong = G.validateLead([...strong, C('C', 2)], strong, [], L4, TRUMP);
    assert.equal(G.trickWinner([mk(0, strong), mk(1, weak)], leadStrong, L4, TRUMP), 0);
  });
  test('follow: a suit-face tractor must be answered with a tractor if held', () => {
    // Diamond pair-tractor lead ♦8+♦9 (natural, no level involved).
    const leadCards = [...pair('D', 8), ...pair('D', 9)];
    const lead = G.validateLead([...leadCards, C('C', 2)], leadCards, [], L4, TRUMP);
    assert.equal(lead.ok && lead.type, 'tractor');
    assert.equal(lead.effSuit, 'D');
    // Follower holds the suit-face tractor ♦3+♦4 plus ♦10/♦J singles.
    const fTractor = [...pair('D', 3), ...pair('D', 4)];
    const fHand = [...fTractor, C('D', 10), C('D', 11), C('H', 2)];
    assert.equal(G.validateFollow(fHand, fTractor, lead, L4, TRUMP).ok, true);
    // Pair + padding while holding that tractor -> reject.
    const bad = [fHand[0], fHand[1], fHand[4], fHand[5]];
    assert.equal(G.validateFollow(fHand, bad, lead, L4, TRUMP).ok, false);
  });
  test('a level pair does NOT follow its printed suit on a non-tractor lead', () => {
    // Diamond pair lead; holding only ♦4♦4 (trump) + hearts means void in
    // diamonds for a pair lead — the ♦4 pair stays trump, play is free.
    const leadCards = pair('D', 9);
    const lead = G.validateLead([...leadCards, C('C', 2)], leadCards, [], L4, TRUMP);
    assert.equal(lead.type, 'pair');
    const d4 = pair('D', 4);
    const hand = [...d4, C('H', 3)];
    assert.equal(G.validateFollow(hand, d4, lead, L4, TRUMP).ok, true);
  });
});

describe('follow cascade', () => {
  // Lead a hearts triple; follower hands are hearts (+ extras).
  const leadTriple = () => {
    const t = triple('H', 13);
    const hand = [...t, C('D', 2)];
    return G.validateLead(hand, t, [], LEVEL, TRUMP);
  };

  test('triple lead: must play triple if held', () => {
    const lead = leadTriple();
    assert.equal(lead.ok && lead.type, 'triple');
    const t = triple('H', 12);
    const hand = [...t, C('H', 5), C('D', 3)];
    assert.equal(G.validateFollow(hand, t, lead, LEVEL, TRUMP).ok, true);
    const bad = G.validateFollow(hand, [t[0], t[1], hand[3]], lead, LEVEL, TRUMP);
    assert.equal(bad.ok, false); // pair + single while holding a triple
  });

  test('triple lead: no triple -> pair + same-suit padding', () => {
    const lead = leadTriple();
    const h2 = [...pair('H', 12), C('H', 5), C('H', 6)];
    assert.equal(G.validateFollow(h2, [h2[0], h2[1], h2[2]], lead, LEVEL, TRUMP).ok, true);
    const bad = G.validateFollow(h2, [h2[0], h2[2], h2[3]], lead, LEVEL, TRUMP);
    assert.equal(bad.ok, false); // no pair in play
  });

  test('triple lead: protected quad is not broken', () => {
    const lead = leadTriple();
    const quad = [C('H', 13), C('H', 13), C('H', 13), C('H', 13)];
    const hand = [...quad, C('H', 5), C('H', 6), C('H', 8), C('D', 2)];
    // playing a triple out of the quad -> invalid (protected)
    assert.equal(G.validateFollow(hand, [quad[0], quad[1], quad[2]], lead, LEVEL, TRUMP).ok, false);
    // three singles instead -> valid
    assert.equal(G.validateFollow(hand, [hand[4], hand[5], hand[6]], lead, LEVEL, TRUMP).ok, true);
  });

  test('triple lead: lone quad must be broken (no alternative)', () => {
    const lead = leadTriple();
    const quad = [C('H', 13), C('H', 13), C('H', 13), C('H', 13)];
    const hand = [...quad, C('D', 2)];
    assert.equal(G.validateFollow(hand, [quad[0], quad[1], quad[2]], lead, LEVEL, TRUMP).ok, true);
  });

  test('quad lead cascade: quad > triple > pair', () => {
    const qhand = [...pair('H', 9), ...pair('H', 9)];
    const lead = G.validateLead(qhand, [qhand[0], qhand[1], qhand[2], qhand[3]], [], LEVEL, TRUMP);
    assert.equal(lead.type, 'quad');
    // holder of a quad must play it
    const h1 = [C('H', 8), C('H', 8), C('H', 8), C('H', 8), C('D', 2)];
    assert.equal(G.validateFollow(h1, [h1[0], h1[1], h1[2], h1[3]], lead, LEVEL, TRUMP).ok, true);
    // holder of triple only -> triple + padding
    const h2 = [C('H', 8), C('H', 8), C('H', 8), C('H', 5), C('H', 6)];
    assert.equal(G.validateFollow(h2, [h2[0], h2[1], h2[2], h2[3]], lead, LEVEL, TRUMP).ok, true);
    assert.equal(G.validateFollow(h2, [h2[0], h2[1], h2[3], h2[4]], lead, LEVEL, TRUMP).ok, false);
    // holder of pair only -> pair + 2 padding
    const h3 = [C('H', 8), C('H', 8), C('H', 5), C('H', 6), C('H', 10)];
    assert.equal(G.validateFollow(h3, [h3[0], h3[1], h3[2], h3[3]], lead, LEVEL, TRUMP).ok, true);
  });

  test('pair lead: protected triple is not broken (but MAY be split)', () => {
    const phand = [...pair('H', 9), C('D', 2)];
    const lead = G.validateLead(phand, [phand[0], phand[1]], [], LEVEL, TRUMP);
    assert.equal(lead.type, 'pair');
    const h = [C('H', 13), C('H', 13), C('H', 13), C('H', 5), C('H', 6)];
    // splitting the triple is a free choice -> now valid ...
    assert.equal(G.validateFollow(h, [h[0], h[1]], lead, LEVEL, TRUMP).ok, true);
    // ... and keeping it intact is still valid
    assert.equal(G.validateFollow(h, [h[3], h[4]], lead, LEVEL, TRUMP).ok, true);
    // a protected QUAD still cannot be split
    const q = [C('H', 12), C('H', 12), C('H', 12), C('H', 12), C('H', 5), C('H', 6)];
    assert.equal(G.validateFollow(q, [q[0], q[1]], lead, LEVEL, TRUMP).ok, false);
  });

  test('pair lead: lone triple must be broken', () => {
    const phand = [...pair('H', 9), C('D', 2)];
    const lead = G.validateLead(phand, [phand[0], phand[1]], [], LEVEL, TRUMP);
    const h = [C('H', 13), C('H', 13), C('H', 13)];
    assert.equal(G.validateFollow(h, [h[0], h[1]], lead, LEVEL, TRUMP).ok, true);
  });

  test('void player is free; must-follow-suit enforced', () => {
    const lead = leadTriple();
    const voidHand = [C('S', 9), SJ(), C('D', 3)];
    assert.equal(G.validateFollow(voidHand, [voidHand[0], voidHand[1], voidHand[2]], lead, LEVEL, TRUMP).ok, true);
    const h2 = [C('H', 5), C('H', 6), C('H', 8), C('D', 2), SJ(), BJ()];
    assert.equal(G.validateFollow(h2, [h2[3], h2[4], h2[5]], lead, LEVEL, TRUMP).ok, false); // has hearts, must play them
  });

  test('short suit: must include every card of the led suit held', () => {
    const lead = leadTriple();
    const h = [C('H', 5), C('H', 6), C('D', 2), SJ()];
    assert.equal(G.validateFollow(h, [h[0], h[1], h[3]], lead, LEVEL, TRUMP).ok, true);
    assert.equal(G.validateFollow(h, [h[0], h[2], h[3]], lead, LEVEL, TRUMP).ok, false);
  });

  test('wrong count rejected', () => {
    const lead = leadTriple();
    const h = [C('H', 5), C('H', 6), C('H', 8)];
    assert.equal(G.validateFollow(h, [h[0], h[1]], lead, LEVEL, TRUMP).ok, false);
  });
});

describe('follow shortfall padding (level 2, spades trump)', () => {
  const L2 = 2;
  // LD's diamond pair-tractor lead: A♦A♦ K♦K♦ (the reported live-game case).
  const leadTractor = () => {
    const cards = [...pair('D', 14), ...pair('D', 13)];
    const lead = G.validateLead([...cards, C('C', 5)], cards, [], L2, TRUMP);
    assert.equal(lead.ok && lead.type, 'tractor');
    assert.equal(lead.effSuit, 'D');
    return lead;
  };

  test('reported case: only 3 effective diamonds (2♦ is trump) -> off-suit padding accepted', () => {
    const lead = leadTractor();
    // GZ's hand: J♦ 8♦ 8♦ are his only diamonds — 2♦ is the level card,
    // i.e. trump, so he is one diamond short of the 4-card follow.
    const hand = [C('D', 11), C('D', 8), C('D', 8), C('D', 2), C('H', 4), C('H', 9), C('C', 7)];
    const play = [hand[0], hand[1], hand[2], hand[4]]; // J♦ 8♦ 8♦ + 4♥ padding
    assert.equal(G.validateFollow(hand, play, lead, L2, TRUMP).ok, true);
    // Padding with the 2♦ itself (played as the trump it is) is also legal.
    const play2 = [hand[0], hand[1], hand[2], hand[3]];
    assert.equal(G.validateFollow(hand, play2, lead, L2, TRUMP).ok, true);
  });

  test('enough diamonds held: off-suit padding is rejected', () => {
    const lead = leadTractor();
    const hand = [C('D', 11), C('D', 8), C('D', 8), C('D', 5), C('H', 4)];
    const play = [hand[0], hand[1], hand[2], hand[4]]; // 4 diamonds held, pads anyway
    assert.equal(G.validateFollow(hand, play, lead, L2, TRUMP).ok, false);
  });

  test('short on diamonds but holds one back: rejected (must include all held)', () => {
    const lead = leadTractor();
    const hand = [C('D', 11), C('D', 8), C('D', 8), C('D', 2), C('H', 4), C('H', 9)];
    const play = [hand[0], hand[1], hand[4], hand[5]]; // only 2 of 3 diamonds + 2 padding
    assert.equal(G.validateFollow(hand, play, lead, L2, TRUMP).ok, false);
  });

  test('pair lead: exactly 1 diamond held -> 1 diamond + 1 padding accepted', () => {
    const leadCards = pair('D', 9);
    const lead = G.validateLead([...leadCards, C('C', 5)], leadCards, [], L2, TRUMP);
    assert.equal(lead.ok && lead.type, 'pair');
    const hand = [C('D', 6), C('D', 2), C('H', 4)]; // one diamond; 2♦ is trump
    assert.equal(G.validateFollow(hand, [hand[0], hand[2]], lead, L2, TRUMP).ok, true);
    // ...but skipping the one held diamond entirely is still refused.
    assert.equal(G.validateFollow(hand, [hand[1], hand[2]], lead, L2, TRUMP).ok, false);
  });

  test('single lead: void in diamonds (only the trump 2♦) is free', () => {
    const leadCards = [C('D', 9)];
    const lead = G.validateLead([...leadCards, C('C', 5)], leadCards, [], L2, TRUMP);
    assert.equal(lead.ok && lead.type, 'single');
    const hand = [C('D', 2), C('H', 4)]; // 2♦ is trump: no effective diamond at all
    assert.equal(G.validateFollow(hand, [hand[1]], lead, L2, TRUMP).ok, true);
  });

  test('throw lead: short on the led suit pads the same way', () => {
    // Pair throw ♦9♦9 + ♦5♦5 (non-consecutive pairs), 4 cards.
    const throwCards = [...pair('D', 9), ...pair('D', 5)];
    const others = [[C('D', 3)], [C('H', 3)], [C('C', 3)]];
    const lead = G.validateLead([...throwCards, C('C', 4)], throwCards, others, L2, TRUMP);
    assert.equal(lead.ok && lead.type, 'throw');
    const hand = [C('D', 11), C('D', 8), C('D', 8), C('D', 2), C('H', 4)];
    const play = [hand[0], hand[1], hand[2], hand[4]]; // 3 diamonds + 4♥ padding
    assert.equal(G.validateFollow(hand, play, lead, L2, TRUMP).ok, true);
  });
});

describe('unbeatable-singles rule', () => {
  test('accept: each single outranks every other player\'s cards of the suit', () => {
    const hand = [C('S', 14), C('S', 13), C('H', 5)];
    const others = [[C('S', 12), C('D', 5)], [C('S', 11)], [C('C', 9)]]; // opp, teammate, opp
    const r = G.validateLead(hand, [hand[0], hand[1]], others, LEVEL, TRUMP);
    assert.equal(r.ok, true);
    assert.equal(r.type, 'unbeatable-singles');
  });

  test('reject: an opponent holds a higher card of the suit', () => {
    const hand = [C('S', 13), C('S', 12), C('H', 5)];
    const others = [[C('S', 14)], [C('S', 11)], []];
    const r = G.validateLead(hand, [hand[0], hand[1]], others, LEVEL, TRUMP);
    assert.equal(r.ok, false);
  });

  test('reject: a TEAMMATE holds a higher card of the suit', () => {
    const hand = [C('S', 13), C('S', 12), C('H', 5)];
    const others = [[C('S', 11)], [C('S', 14)], []]; // teammate (seat 2) has AS
    const r = G.validateLead(hand, [hand[0], hand[1]], others, LEVEL, TRUMP);
    assert.equal(r.ok, false);
  });

  // UPDATED 2026-11-19 (throw): A♠+K♠ broken out of the held K pair is
  // still NOT an unbeatable-singles lead (that rule needs natural
  // singles), but it IS a legal singles throw now: no other player holds
  // a spade beating its weakest single (K♠ > Q♠), so the throw stands.
  test('breaking a pair: not unbeatable-singles, but a legal singles throw', () => {
    const k1 = C('S', 13), k2 = C('S', 13);
    const hand = [C('S', 14), k1, k2, C('H', 5)];
    const others = [[C('S', 12)], [], []];
    const r = G.validateLead(hand, [hand[0], k1], others, LEVEL, TRUMP);
    assert.equal(r.ok, true);
    assert.equal(r.type, 'throw');
    assert.equal(r.unit, 1);
  });

  test('reject: mixed suits / single card', () => {
    const hand = [C('S', 14), C('H', 13), C('H', 5)];
    const others = [[], [], []];
    assert.equal(G.validateLead(hand, [hand[0], hand[1]], others, LEVEL, TRUMP).ok, false);
    const s = G.validateLead(hand, [hand[0]], others, LEVEL, TRUMP);
    assert.equal(s.ok && s.type, 'single');
  });

  test('non-trump suit unbeatable singles also work', () => {
    const hand = [C('H', 14), C('H', 13), C('D', 5)];
    const others = [[C('H', 12)], [C('H', 11)], []];
    const r = G.validateLead(hand, [hand[0], hand[1]], others, LEVEL, TRUMP);
    assert.equal(r.ok, true);
  });
});

describe('trump kill', () => {
  const leadOf = () => {
    const hand = [C('H', 14), C('H', 13), C('D', 5)];
    const others = [[C('H', 12)], [C('H', 5)], []];
    return G.validateLead(hand, [hand[0], hand[1]], others, LEVEL, TRUMP);
  };

  test('void player may kill with an equal number of trumps', () => {
    const lead = leadOf();
    assert.equal(lead.type, 'unbeatable-singles');
    const sj = SJ(), d7 = C('D', 7); // both trump
    const hand = [sj, d7, C('C', 9)];
    assert.equal(G.validateFollow(hand, [sj, d7], lead, LEVEL, TRUMP).ok, true);
  });

  test('void player may also discard (fewer trumps)', () => {
    const lead = leadOf();
    const sj = SJ();
    const hand = [sj, C('C', 9), C('D', 3)];
    assert.equal(G.validateFollow(hand, [sj, hand[1]], lead, LEVEL, TRUMP).ok, true);
  });

  test('non-void player must follow the led suit', () => {
    const lead = leadOf();
    const sj = SJ();
    const hand = [C('H', 5), C('H', 6), sj];
    assert.equal(G.validateFollow(hand, [sj, C('D', 7)], lead, LEVEL, TRUMP).ok, false);
  });

  test('kill wins the trick; higher kill wins', () => {
    const lead = leadOf();
    const mk = (player, cards) => ({ player, cards });
    const sj = SJ(), bj = BJ();
    const w1 = G.trickWinner(
      [mk(0, [C('H', 14), C('H', 13)]), mk(1, [C('H', 12), C('H', 5)]), mk(2, [sj, C('D', 7)]), mk(3, [C('H', 9), C('H', 8)])],
      lead, LEVEL, TRUMP
    );
    assert.equal(w1, 2);
    const w2 = G.trickWinner(
      [mk(0, [C('H', 14), C('H', 13)]), mk(1, [sj, C('S', 5)]), mk(2, [bj, C('S', 2)])],
      lead, LEVEL, TRUMP
    );
    assert.equal(w2, 2); // BJ kill beats SJ kill
    const w3 = G.trickWinner(
      [mk(0, [C('H', 14), C('H', 13)]), mk(1, [C('H', 12), C('H', 5)])],
      lead, LEVEL, TRUMP
    );
    assert.equal(w3, 0); // no kill: leader wins
  });
});

describe('trick winner (standard)', () => {
  const mk = (player, cards) => ({ player, cards });
  const singleLead = { type: 'single', effSuit: 'H', count: 1, unit: 1, length: 1 };

  test('highest of led suit wins; trump beats; ties keep first', () => {
    const plays = [mk(0, [C('H', 13)]), mk(1, [C('H', 14)]), mk(2, [C('H', 5)])];
    assert.equal(G.trickWinner(plays, singleLead, LEVEL, TRUMP), 1);
    const plays2 = [mk(0, [C('H', 13)]), mk(1, [C('H', 13)]), mk(2, [C('H', 5)])];
    assert.equal(G.trickWinner(plays2, singleLead, LEVEL, TRUMP), 0); // tie -> first
    const plays3 = [mk(0, [C('H', 14)]), mk(1, [C('S', 2)])];
    assert.equal(G.trickWinner(plays3, singleLead, LEVEL, TRUMP), 1); // trump wins
  });

  test('pairs and tractors: higher top unit wins', () => {
    const pairLead = { type: 'pair', effSuit: 'H', count: 2, unit: 2, length: 1 };
    const plays = [mk(0, [...pair('H', 12)]), mk(1, [...pair('H', 13)])];
    assert.equal(G.trickWinner(plays, pairLead, LEVEL, TRUMP), 1);
    const tLead = { type: 'tractor', effSuit: 'H', count: 4, unit: 2, length: 2 };
    const tp = [mk(0, [...pair('H', 13), ...pair('H', 12)]), mk(1, [...pair('H', 14), ...pair('H', 13)])];
    assert.equal(G.trickWinner(tp, tLead, LEVEL, TRUMP), 1);
  });
});

describe('tractor-follow cascade', () => {
  // Pair-tractor lead (2 consecutive pairs, 4 cards): H9H9 + H10H10.
  // Level 7, spades trump; hearts is a natural suit.
  const leadPairTractor = () => {
    const cards = [...pair('H', 9), ...pair('H', 10)];
    const hand = [...cards, C('D', 2)];
    const lead = G.validateLead(hand, cards, [], LEVEL, TRUMP);
    assert.equal(lead.ok && lead.type, 'tractor');
    assert.equal(lead.unit, 2);
    assert.equal(lead.length, 2);
    return lead;
  };

  test('pair tractor: must play own tractor if held', () => {
    const lead = leadPairTractor();
    const t = [...pair('H', 5), ...pair('H', 6)];
    const hand = [...t, ...pair('H', 12), C('H', 3), C('H', 4)];
    assert.equal(G.validateFollow(hand, t, lead, LEVEL, TRUMP).ok, true);
    // pair + padding while holding a tractor -> reject
    const bad = [hand[4], hand[5], hand[6], hand[7]];
    assert.equal(G.validateFollow(hand, bad, lead, LEVEL, TRUMP).ok, false);
    // 4 singles while holding a tractor -> reject
    const h2 = [...t, C('H', 3), C('H', 4), C('H', 8), C('H', 11)];
    const bad2 = [h2[4], h2[5], h2[6], h2[7]];
    assert.equal(G.validateFollow(h2, bad2, lead, LEVEL, TRUMP).ok, false);
  });

  test('pair tractor: no tractor -> 2 separated pairs', () => {
    const lead = leadPairTractor();
    const hand = [...pair('H', 5), ...pair('H', 8), C('H', 3), C('H', 4)];
    const good = [hand[0], hand[1], hand[2], hand[3]];
    assert.equal(G.validateFollow(hand, good, lead, LEVEL, TRUMP).ok, true);
    // 1 pair + padding while holding 2 pairs -> reject
    const bad = [hand[0], hand[1], hand[4], hand[5]];
    assert.equal(G.validateFollow(hand, bad, lead, LEVEL, TRUMP).ok, false);
  });

  test('pair tractor: 1 pair -> pair + padding', () => {
    const lead = leadPairTractor();
    const hand = [...pair('H', 5), C('H', 3), C('H', 4), C('H', 8), C('H', 11)];
    const good = [hand[0], hand[1], hand[2], hand[3]];
    assert.equal(G.validateFollow(hand, good, lead, LEVEL, TRUMP).ok, true);
    // 4 singles while holding a pair -> reject
    const bad = [hand[2], hand[3], hand[4], hand[5]];
    assert.equal(G.validateFollow(hand, bad, lead, LEVEL, TRUMP).ok, false);
  });

  test('pair tractor: no pairs -> 4 singles', () => {
    const lead = leadPairTractor();
    const hand = [C('H', 3), C('H', 4), C('H', 5), C('H', 6), C('H', 8)];
    const good = [hand[0], hand[1], hand[2], hand[3]];
    assert.equal(G.validateFollow(hand, good, lead, LEVEL, TRUMP).ok, true);
  });

  test('pair tractor: protected triple is not broken', () => {
    const lead = leadPairTractor();
    // triple KKK + pairs 88,99 + 2 singles = 9 hearts; triple protected (9-3>=4)
    const hand = [...triple('H', 13), ...pair('H', 8), ...pair('H', 9), C('H', 5), C('H', 6)];
    // pool (triple excluded) holds the 8899 tractor -> must play it
    const good = [hand[3], hand[4], hand[5], hand[6]];
    assert.equal(G.validateFollow(hand, good, lead, LEVEL, TRUMP).ok, true);
    // breaking the protected triple -> reject
    const bad = [hand[0], hand[1], hand[3], hand[4]];
    assert.equal(G.validateFollow(hand, bad, lead, LEVEL, TRUMP).ok, false);
  });

  test('pair tractor: protected quad is not broken', () => {
    const lead = leadPairTractor();
    // quad 9999 + pairs 55,88 (not consecutive) + 2 singles = 10 hearts; quad protected
    const quad = [C('H', 9), C('H', 9), C('H', 9), C('H', 9)];
    const hand = [...quad, ...pair('H', 5), ...pair('H', 8), C('H', 3), C('H', 4)];
    // pool has 2 separated pairs -> must play them, quad stays intact
    const good = [hand[4], hand[5], hand[6], hand[7]];
    assert.equal(G.validateFollow(hand, good, lead, LEVEL, TRUMP).ok, true);
    const bad = [hand[0], hand[1], hand[4], hand[5]];
    assert.equal(G.validateFollow(hand, bad, lead, LEVEL, TRUMP).ok, false);
  });

  test('pair tractor: lone triple is broken when no alternative', () => {
    const lead = leadPairTractor();
    const hand = [...triple('H', 5), C('H', 6)]; // 4 hearts; triple NOT protected (4-3<4)
    // triple + single satisfies "1 pair + padding" (pair taken from the triple)
    assert.equal(G.validateFollow(hand, hand, lead, LEVEL, TRUMP).ok, true);
  });

  // 3-pair tractor lead ("triple tractor"): H8H8 + H9H9 + H10H10 (6 cards).
  const leadTriplePairTractor = () => {
    const cards = [...pair('H', 8), ...pair('H', 9), ...pair('H', 10)];
    const hand = [...cards, C('D', 2)];
    const lead = G.validateLead(hand, cards, [], LEVEL, TRUMP);
    assert.equal(lead.ok && lead.type, 'tractor');
    assert.equal(lead.unit, 2);
    assert.equal(lead.length, 3);
    return lead;
  };

  test('3-pair tractor: must play own tractor if held', () => {
    const lead = leadTriplePairTractor();
    const t = [...pair('H', 3), ...pair('H', 4), ...pair('H', 5)];
    const hand = [...t, ...pair('H', 12), C('H', 6), C('H', 7), C('H', 8), C('H', 9)];
    assert.equal(G.validateFollow(hand, t, lead, LEVEL, TRUMP).ok, true);
    const bad = [hand[6], hand[7], hand[8], hand[9], hand[10], hand[11]];
    assert.equal(G.validateFollow(hand, bad, lead, LEVEL, TRUMP).ok, false);
  });

  test('3-pair tractor: no tractor -> 3 separated pairs', () => {
    const lead = leadTriplePairTractor();
    const hand = [...pair('H', 3), ...pair('H', 6), ...pair('H', 9), C('H', 4), C('H', 11)];
    const good = [hand[0], hand[1], hand[2], hand[3], hand[4], hand[5]];
    assert.equal(G.validateFollow(hand, good, lead, LEVEL, TRUMP).ok, true);
    // 2 pairs + padding while holding 3 pairs -> reject
    const bad = [hand[0], hand[1], hand[2], hand[3], hand[6], hand[7]];
    assert.equal(G.validateFollow(hand, bad, lead, LEVEL, TRUMP).ok, false);
  });

  test('3-pair tractor: fewer pairs + padding degradation', () => {
    const lead = leadTriplePairTractor();
    // 2 pairs + singles -> must play 2 pairs + padding
    const h1 = [...pair('H', 3), ...pair('H', 6), C('H', 4), C('H', 11), C('H', 12), C('H', 13)];
    const good1 = [h1[0], h1[1], h1[2], h1[3], h1[4], h1[5]];
    assert.equal(G.validateFollow(h1, good1, lead, LEVEL, TRUMP).ok, true);
    const bad1 = [h1[0], h1[1], h1[4], h1[5], h1[6], h1[7]];
    assert.equal(G.validateFollow(h1, bad1, lead, LEVEL, TRUMP).ok, false);
    // 1 pair + singles -> must play pair + padding
    const h2 = [...pair('H', 3), C('H', 4), C('H', 6), C('H', 11), C('H', 12), C('H', 13)];
    const good2 = [h2[0], h2[1], h2[2], h2[3], h2[4], h2[5]];
    assert.equal(G.validateFollow(h2, good2, lead, LEVEL, TRUMP).ok, true);
  });

  test('3-pair tractor: no pairs -> 6 singles', () => {
    const lead = leadTriplePairTractor();
    const hand = [C('H', 3), C('H', 4), C('H', 5), C('H', 6), C('H', 8), C('H', 11), C('H', 12)];
    const good = [hand[0], hand[1], hand[2], hand[3], hand[4], hand[5]];
    assert.equal(G.validateFollow(hand, good, lead, LEVEL, TRUMP).ok, true);
  });

  // 2-triple tractor lead (unit 3): H8H8H8 + H9H9H9 (6 cards).
  const leadTripleUnitTractor = () => {
    const cards = [...triple('H', 8), ...triple('H', 9)];
    const hand = [...cards, C('D', 2)];
    const lead = G.validateLead(hand, cards, [], LEVEL, TRUMP);
    assert.equal(lead.ok && lead.type, 'tractor');
    assert.equal(lead.unit, 3);
    assert.equal(lead.length, 2);
    return lead;
  };

  test('2-triple tractor: must play own tractor if held', () => {
    const lead = leadTripleUnitTractor();
    const t = [...triple('H', 5), ...triple('H', 6)];
    const hand = [...t, ...triple('H', 12), C('H', 3), C('H', 4), C('H', 11)];
    assert.equal(G.validateFollow(hand, t, lead, LEVEL, TRUMP).ok, true);
    // triple + padding while holding a tractor -> reject
    const bad = [hand[6], hand[7], hand[8], hand[9], hand[10], hand[11]];
    assert.equal(G.validateFollow(hand, bad, lead, LEVEL, TRUMP).ok, false);
  });

  test('2-triple tractor: no tractor -> 2 separated triples', () => {
    const lead = leadTripleUnitTractor();
    const hand = [...triple('H', 5), ...triple('H', 8), C('H', 3), C('H', 4), C('H', 11)];
    const good = [hand[0], hand[1], hand[2], hand[3], hand[4], hand[5]];
    assert.equal(G.validateFollow(hand, good, lead, LEVEL, TRUMP).ok, true);
    // 1 triple + padding while holding 2 triples -> reject
    const bad = [hand[0], hand[1], hand[2], hand[6], hand[7], hand[8]];
    assert.equal(G.validateFollow(hand, bad, lead, LEVEL, TRUMP).ok, false);
  });

  test('2-triple tractor: 1 triple -> must include it (triple + padding)', () => {
    const lead = leadTripleUnitTractor();
    const hand = [...triple('H', 5), C('H', 3), C('H', 4), C('H', 6), C('H', 11), C('H', 12), C('H', 13)];
    const good = [hand[0], hand[1], hand[2], hand[3], hand[4], hand[5]];
    assert.equal(G.validateFollow(hand, good, lead, LEVEL, TRUMP).ok, true);
    // 6 singles while holding a triple -> reject
    const bad = [hand[3], hand[4], hand[5], hand[6], hand[7], hand[8]];
    assert.equal(G.validateFollow(hand, bad, lead, LEVEL, TRUMP).ok, false);
  });

  test('2-triple tractor: no triples -> 6 singles', () => {
    const lead = leadTripleUnitTractor();
    const hand = [C('H', 3), C('H', 4), C('H', 5), C('H', 6), C('H', 8), C('H', 11), C('H', 12)];
    const good = [hand[0], hand[1], hand[2], hand[3], hand[4], hand[5]];
    assert.equal(G.validateFollow(hand, good, lead, LEVEL, TRUMP).ok, true);
  });
});

describe('pair follow: triple split rule', () => {
  // Pair lead (2 same cards); LEVEL=7, spades trump.
  const pairLead = () => {
    const phand = [...pair('H', 9), C('D', 2)];
    const lead = G.validateLead(phand, [phand[0], phand[1]], [], LEVEL, TRUMP);
    assert.equal(lead.ok && lead.type, 'pair');
    return lead;
  };

  test('triple kept + another pair played = valid', () => {
    const lead = pairLead();
    // triple KKK protected (6-3>=2); pool holds the 88 pair
    const h = [...triple('H', 13), ...pair('H', 8), C('H', 5)];
    assert.equal(G.validateFollow(h, [h[3], h[4]], lead, LEVEL, TRUMP).ok, true);
  });

  test('triple kept + singles played (no other pair) = valid', () => {
    const lead = pairLead();
    const h = [...triple('H', 13), C('H', 5), C('H', 6)];
    assert.equal(G.validateFollow(h, [h[3], h[4]], lead, LEVEL, TRUMP).ok, true);
  });

  test('triple split into 2 cards = valid (free choice)', () => {
    const lead = pairLead();
    const h = [...triple('H', 13), C('H', 5), C('H', 6)];
    assert.equal(G.validateFollow(h, [h[0], h[1]], lead, LEVEL, TRUMP).ok, true);
  });

  test('split is a free choice even when another pair is held', () => {
    const lead = pairLead();
    const h = [...triple('H', 13), ...pair('H', 8), C('H', 5)];
    // may split the triple instead of playing the 88 pair
    assert.equal(G.validateFollow(h, [h[0], h[1]], lead, LEVEL, TRUMP).ok, true);
    // or play the 88 pair and keep the triple
    assert.equal(G.validateFollow(h, [h[3], h[4]], lead, LEVEL, TRUMP).ok, true);
  });

  test('split cards must form a valid pair follow', () => {
    const lead = pairLead();
    const h = [...triple('H', 13), ...pair('H', 8), C('H', 5)];
    // 1 triple card + 1 other card is not a pair -> reject (pool has a pair)
    assert.equal(G.validateFollow(h, [h[0], h[5]], lead, LEVEL, TRUMP).ok, false);
    // 2 cards from two different protected groups -> reject
    const h2 = [...triple('H', 13), ...triple('H', 12), C('H', 5)];
    assert.equal(G.validateFollow(h2, [h2[0], h2[3]], lead, LEVEL, TRUMP).ok, false);
  });

  test('works in trump too (small-joker triple split)', () => {
    const leadHand = [...pair('H', 7), C('D', 2)]; // H7H7: trump pair lead
    const lead = G.validateLead(leadHand, [leadHand[0], leadHand[1]], [], LEVEL, TRUMP);
    assert.equal(lead.ok && lead.type, 'pair');
    assert.equal(lead.effSuit, 'T');
    const sj1 = SJ(), sj2 = SJ(), sj3 = SJ();
    const h = [sj1, sj2, sj3, ...pair('S', 9), C('S', 5)]; // 6 trump; SJ triple protected
    assert.equal(G.validateFollow(h, [sj1, sj2], lead, LEVEL, TRUMP).ok, true); // split
    assert.equal(G.validateFollow(h, [h[3], h[4]], lead, LEVEL, TRUMP).ok, true); // keep, play 99
  });

  test('pair-tractor cascade: split triple counts toward the follow', () => {
    // pair-tractor lead H9H9 + H10H10 (4 cards)
    const tcards = [...pair('H', 9), ...pair('H', 10)];
    const thand = [...tcards, C('D', 2)];
    const lead = G.validateLead(thand, tcards, [], LEVEL, TRUMP);
    assert.equal(lead.ok && lead.type, 'tractor');
    // triple KKK protected (7-3>=4); pool = 88 + 5 + 6
    const h = [...triple('H', 13), ...pair('H', 8), C('H', 5), C('H', 6)];
    // split triple + pair 88 -> satisfies "1 pair + padding"
    assert.equal(G.validateFollow(h, [h[0], h[1], h[3], h[4]], lead, LEVEL, TRUMP).ok, true);
    // keep triple, play pair + padding -> also valid
    assert.equal(G.validateFollow(h, [h[3], h[4], h[5], h[6]], lead, LEVEL, TRUMP).ok, true);
  });

  test('pair-tractor cascade: held tractor still beats a split', () => {
    const tcards = [...pair('H', 9), ...pair('H', 10)];
    const thand = [...tcards, C('D', 2)];
    const lead = G.validateLead(thand, tcards, [], LEVEL, TRUMP);
    // triple KKK protected, but pool holds the 8899 tractor -> must play it
    const h = [...triple('H', 13), ...pair('H', 8), ...pair('H', 9), C('H', 5), C('H', 6)];
    const good = [h[3], h[4], h[5], h[6]];
    assert.equal(G.validateFollow(h, good, lead, LEVEL, TRUMP).ok, true);
    const bad = [h[0], h[1], h[3], h[4]]; // split triple + 88, skipping the tractor
    assert.equal(G.validateFollow(h, bad, lead, LEVEL, TRUMP).ok, false);
  });
});

describe('scoring & levels (n = decks)', () => {
  test('defenders win at exactly n*40 -> +1 level', () => {
    const r = G.scoreRound({ nDecks: 2, defenderTrickPoints: 80, bottomPoints: 10, defendersWonLastTrick: false });
    assert.equal(r.winner, 'defenders');
    assert.equal(r.defenderLevels, 1);
  });
  test('defenders advance per extra n*20', () => {
    const r = G.scoreRound({ nDecks: 2, defenderTrickPoints: 120, bottomPoints: 0, defendersWonLastTrick: false });
    assert.equal(r.defenderLevels, 2); // 80 + 40
    const r2 = G.scoreRound({ nDecks: 2, defenderTrickPoints: 100, bottomPoints: 0, defendersWonLastTrick: false });
    assert.equal(r2.defenderLevels, 1);
  });
  test('dealer +1 / +2 / +3', () => {
    const base = { nDecks: 2, bottomPoints: 10, defendersWonLastTrick: false };
    const r1 = G.scoreRound({ ...base, defenderTrickPoints: 70 });
    assert.equal(r1.winner, 'dealer');
    assert.equal(r1.dealerLevels, 1);
    const r2 = G.scoreRound({ ...base, defenderTrickPoints: 30 });
    assert.equal(r2.dealerLevels, 2);
    const r3 = G.scoreRound({ ...base, defenderTrickPoints: 0 });
    assert.equal(r3.dealerLevels, 3);
  });
  test('抠底: last-trick win adds 2x bottom points and can flip the result', () => {
    const r = G.scoreRound({ nDecks: 2, defenderTrickPoints: 70, bottomPoints: 20, defendersWonLastTrick: true });
    assert.equal(r.defenderTotal, 110);
    assert.equal(r.winner, 'defenders');
    const r2 = G.scoreRound({ nDecks: 2, defenderTrickPoints: 70, bottomPoints: 20, defendersWonLastTrick: false });
    assert.equal(r2.winner, 'dealer');
    // not enough to flip
    const r3 = G.scoreRound({ nDecks: 2, defenderTrickPoints: 50, bottomPoints: 10, defendersWonLastTrick: true });
    assert.equal(r3.winner, 'dealer');
    assert.equal(r3.dealerLevels, 1);
  });
  test('applyLevels: each team advances separately; caps at A(14)', () => {
    const r = G.scoreRound({ nDecks: 2, defenderTrickPoints: 80, bottomPoints: 0, defendersWonLastTrick: false });
    const a1 = G.applyLevels([2, 2], r, 0); // team 0 dealt; team 1 defended and won
    assert.deepEqual(a1.levels, [2, 3]);
    assert.equal(a1.matchWon, null);
    const rd = G.scoreRound({ nDecks: 2, defenderTrickPoints: 0, bottomPoints: 0, defendersWonLastTrick: false });
    const a2 = G.applyLevels([5, 7], rd, 0);
    assert.deepEqual(a2.levels, [8, 7]);
    const a3 = G.applyLevels([14, 14], rd, 1);
    assert.deepEqual(a3.levels, [14, 14]);
    assert.equal(a3.matchWon, 1);
  });
  test('teamOfSeat: even seats team 0, odd seats team 1', () => {
    assert.equal(G.TEAM_OF_SEAT(0), 0);
    assert.equal(G.TEAM_OF_SEAT(3), 1);
    assert.equal(G.TEAM_OF_SEAT(8), 0);
  });
  test('ZhuangJia switch criterion (3 decks): defenders at 110 do NOT take over — dealer +1 and keeps the deal', () => {
    const r = G.scoreRound({ nDecks: 3, defenderTrickPoints: 110, bottomPoints: 0, defendersWonLastTrick: false });
    assert.equal(r.winner, 'dealer'); // 110 < 120 = 3*40 switch line
    assert.equal(r.dealerLevels, 1);
    assert.equal(G.nextDealingTeam(0, r), 0); // same dealer team deals next
    assert.equal(G.nextDealingTeam(1, r), 1);
    const a = G.applyLevels([4, 6], r, 0);
    assert.deepEqual(a.levels, [5, 6]); // dealer team advanced, defenders unchanged
  });
  test('ZhuangJia switch criterion (3 decks): defenders at exactly 120 take over the deal', () => {
    const r = G.scoreRound({ nDecks: 3, defenderTrickPoints: 120, bottomPoints: 0, defendersWonLastTrick: false });
    assert.equal(r.winner, 'defenders');
    assert.equal(G.nextDealingTeam(0, r), 1); // deal switches to defenders
    assert.equal(G.nextDealingTeam(1, r), 0);
  });
  test('ZhuangJia switch criterion scales with decks: 110 takes over in a 2-deck game (line 80) but not 3-deck', () => {
    const r2 = G.scoreRound({ nDecks: 2, defenderTrickPoints: 110, bottomPoints: 0, defendersWonLastTrick: false });
    assert.equal(r2.winner, 'defenders');
    assert.equal(G.nextDealingTeam(0, r2), 1);
    const r4 = G.scoreRound({ nDecks: 4, defenderTrickPoints: 110, bottomPoints: 0, defendersWonLastTrick: false });
    assert.equal(r4.winner, 'dealer'); // 110 < 160
    assert.equal(G.nextDealingTeam(0, r4), 0);
  });
});

// Throw rule (甩牌, owner 2026-11-19): a lead of 2+ units of ONE type
// (all singles, all pairs, or all triples) of one effective suit,
// consecutive or not. It stands only if no other player holds a unit of
// the same type, in that suit, beating its weakest unit.
describe('throw rule (甩牌)', () => {
  test('classify: non-consecutive same-type units are a throw, with weakest key', () => {
    const p = G.classify([...pair('H', 9), ...pair('H', 11)], LEVEL, TRUMP);
    assert.equal(p.type, 'throw');
    assert.equal(p.unit, 2);
    assert.equal(p.length, 2);
    assert.equal(p.effSuit, 'H');
    assert.equal(p.weakestKey, 9);
    const s = G.classify([C('H', 14), C('H', 9), C('H', 8)], LEVEL, TRUMP);
    assert.equal(s.type, 'throw');
    assert.equal(s.unit, 1);
    assert.equal(s.length, 3);
    assert.equal(s.weakestKey, 8);
    const t3 = G.classify([...triple('H', 9), ...triple('H', 11)], LEVEL, TRUMP);
    assert.equal(t3.type, 'throw');
    assert.equal(t3.unit, 3);
    // consecutive units are still a tractor, never a throw
    assert.equal(G.classify([...pair('H', 9), ...pair('H', 10)], LEVEL, TRUMP).type, 'tractor');
  });

  test('mixed-type multi-unit leads are rejected (not a throw, not anything)', () => {
    assert.equal(G.classify([...pair('H', 9), C('H', 11)], LEVEL, TRUMP).type, 'invalid'); // pair + single
    assert.equal(G.classify([...triple('H', 9), ...pair('H', 11)], LEVEL, TRUMP).type, 'invalid'); // triple + pair
    const hand = [...pair('H', 9), C('H', 11), C('D', 2)];
    const r = G.validateLead(hand, [hand[0], hand[1], hand[2]], [[], [], []], LEVEL, TRUMP);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'invalid-combination');
  });

  test('valid pairs throw stands — higher opposing singles do NOT block it', () => {
    const cards = [...pair('H', 9), ...pair('H', 11)];
    const hand = [...cards, C('D', 3)];
    const others = [
      [C('H', 14), C('H', 13)],        // higher singles, no pair -> no block
      [...pair('H', 5), C('H', 12)],   // a lower pair -> no block
      [C('C', 2)],
    ];
    const r = G.validateLead(hand, cards, others, LEVEL, TRUMP);
    assert.equal(r.ok, true);
    assert.equal(r.type, 'throw');
    assert.equal(r.unit, 2);
    assert.equal(r.length, 2);
  });

  test('pairs throw blocked by a higher pair: failure info carries weakest unit + penalty, never the blocker', () => {
    const cards = [...pair('H', 9), ...pair('H', 11)];
    const hand = [...cards, C('D', 3)];
    const r = G.validateLead(hand, cards, [[...pair('H', 12)], [], []], LEVEL, TRUMP);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'throw-blocked');
    assert.equal(r.throwInfo.unit, 2);
    assert.equal(r.throwInfo.penalty, 40); // 4 cards x 10
    // the weakest unit is the 9 pair — the actual cards to lead next
    assert.deepEqual(
      r.throwInfo.weakestCards.map((c) => c.id).sort((a, b) => a - b),
      [cards[0].id, cards[1].id].sort((a, b) => a - b)
    );
    // the failure info has exactly these fields — nothing identifies
    // which hand blocked the throw
    assert.deepEqual(Object.keys(r.throwInfo).sort(), [
      'count', 'effSuit', 'length', 'penalty', 'unit', 'weakestCards', 'weakestKey',
    ]);
  });

  test('singles throw blocked by a higher single: weakest single + 10-per-card penalty', () => {
    const cards = [C('H', 13), C('H', 9), C('H', 8)];
    const hand = [...cards, C('D', 3)];
    const r = G.validateLead(hand, cards, [[C('H', 14)], [], []], LEVEL, TRUMP);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'throw-blocked');
    assert.equal(r.throwInfo.unit, 1);
    assert.equal(r.throwInfo.penalty, 30); // 3 cards x 10
    assert.deepEqual(r.throwInfo.weakestCards.map((c) => c.id), [cards[2].id]); // the 8
  });

  test('valid singles throw stands when its weakest single is unbeaten', () => {
    // A+K thrown as singles out of a held K pair (not natural, so not
    // unbeatable-singles); nobody holds a spade over the K -> stands.
    const k1 = C('S', 13);
    const hand = [C('S', 14), k1, C('S', 13), C('D', 5)];
    const r = G.validateLead(hand, [hand[0], k1], [[C('S', 12)], [], []], LEVEL, TRUMP);
    assert.equal(r.ok, true);
    assert.equal(r.type, 'throw');
    assert.equal(r.unit, 1);
  });

  test('triples throw: stands against pairs/singles; a higher opposing triple blocks it', () => {
    const cards = [...triple('S', 9), ...triple('S', 11)];
    const hand = [...cards, C('D', 3)];
    const ok = G.validateLead(hand, cards, [[...pair('S', 12), C('S', 14)], [], []], LEVEL, TRUMP);
    assert.equal(ok.ok, true);
    assert.equal(ok.type, 'throw');
    assert.equal(ok.unit, 3);
    const blocked = G.validateLead(hand, cards, [[...triple('S', 12)], [], []], LEVEL, TRUMP);
    assert.equal(blocked.ok, false);
    assert.equal(blocked.reason, 'throw-blocked');
    assert.equal(blocked.throwInfo.weakestCards.length, 3); // the 9 triple
    assert.equal(blocked.throwInfo.penalty, 60); // 6 cards x 10
  });

  test('penalty math: 10 points per attempted card, deducted with floor 0', () => {
    assert.equal(G.throwPenalty(4), 40);
    assert.equal(G.throwPenalty(1), 10);
    assert.equal(G.applyThrowPenalty(100, 3), 70);
    assert.equal(G.applyThrowPenalty(30, 3), 0);
    assert.equal(G.applyThrowPenalty(25, 3), 0); // floor 0 — the rest is forgiven
    assert.equal(G.applyThrowPenalty(0, 5), 0);
  });

  test('failure announcement names the thrower and the penalty, never a blocker', () => {
    const info = { unit: 2, length: 2, count: 4, effSuit: 'H', weakestKey: 9, weakestCards: [], penalty: 40 };
    const msg = G.throwFailureAnnouncement('Bob', info);
    assert.ok(msg.includes('Bob'));
    assert.ok(msg.includes('40'));
    assert.ok(!msg.includes('Alice'));
  });

  test('follow: a pairs throw must be answered with pairs as far as held', () => {
    const lead = { type: 'throw', unit: 2, length: 2, count: 4, effSuit: 'H' };
    // holds 1 pair -> pair + padding ok; 4 singles while holding a pair -> reject
    const h1 = [...pair('H', 5), C('H', 3), C('H', 4), C('H', 6), C('H', 8), C('D', 2)];
    assert.equal(G.validateFollow(h1, [h1[0], h1[1], h1[2], h1[3]], lead, LEVEL, TRUMP).ok, true);
    const bad1 = G.validateFollow(h1, [h1[2], h1[3], h1[4], h1[5]], lead, LEVEL, TRUMP);
    assert.equal(bad1.ok, false);
    assert.equal(bad1.reason, 'must-match-throw-structure');
    // holds 2 pairs -> must play both pairs
    const h2 = [...pair('H', 5), ...pair('H', 6), C('H', 3), C('H', 4), C('D', 2)];
    assert.equal(G.validateFollow(h2, [h2[0], h2[1], h2[2], h2[3]], lead, LEVEL, TRUMP).ok, true);
    assert.equal(G.validateFollow(h2, [h2[0], h2[1], h2[4], h2[5]], lead, LEVEL, TRUMP).ok, false);
    // void in hearts -> free
    const h3 = [C('S', 9), SJ(), C('D', 3), C('C', 4)];
    assert.equal(G.validateFollow(h3, h3, lead, LEVEL, TRUMP).ok, true);
  });

  test('follow: a triples throw must be answered with triples as far as held; a singles throw takes any cards of the suit', () => {
    const leadT = { type: 'throw', unit: 3, length: 2, count: 6, effSuit: 'H' };
    const h = [...triple('H', 5), C('H', 3), C('H', 4), C('H', 6), C('H', 8), C('H', 9), C('D', 2)];
    // triple + padding ok
    assert.equal(G.validateFollow(h, [h[0], h[1], h[2], h[3], h[4], h[5]], leadT, LEVEL, TRUMP).ok, true);
    // breaking the triple into singles while holding it -> reject
    assert.equal(G.validateFollow(h, [h[0], h[3], h[4], h[5], h[6], h[7]], leadT, LEVEL, TRUMP).ok, false);
    const leadS = { type: 'throw', unit: 1, length: 3, count: 3, effSuit: 'H' };
    const hs = [...pair('H', 5), C('H', 3), C('H', 4), C('D', 2)];
    // any 3 hearts, even breaking the pair
    assert.equal(G.validateFollow(hs, [hs[0], hs[2], hs[3]], leadS, LEVEL, TRUMP).ok, true);
  });

  test('trick: a same-structure trump throw beating EVERY unit wins; a partial beat does not', () => {
    const mk = (player, cards) => ({ player, cards });
    // plain hearts pairs throw A A + Q Q (units 14, 12)
    const leadH = { type: 'throw', unit: 2, length: 2, count: 4, effSuit: 'H', weakestKey: 12 };
    const leadHPlay = [...pair('H', 14), ...pair('H', 12)];
    // trump pairs K K + Q Q (units 613, 612) — every unit beats -> wins
    const kill = [...pair('S', 13), ...pair('S', 12)];
    assert.equal(G.trickWinner([mk(0, leadHPlay), mk(1, kill)], leadH, LEVEL, TRUMP), 1);
    // same-suit K K + Q Q (13, 12): top unit does not beat the ace pair -> leader holds
    const partialSuit = [...pair('H', 13), ...pair('H', 12)];
    assert.equal(G.trickWinner([mk(0, leadHPlay), mk(1, partialSuit)], leadH, LEVEL, TRUMP), 0);
    // trump pairs throw J J + 9 9 (units 611, 609) led
    const leadT = { type: 'throw', unit: 2, length: 2, count: 4, effSuit: 'T', weakestKey: 609 };
    const leadTPlay = [...pair('S', 11), ...pair('S', 9)];
    // A A + 8 8 (614, 608): top beats, bottom does NOT -> partial, leader holds
    const partial = [...pair('S', 14), ...pair('S', 8)];
    assert.equal(G.trickWinner([mk(0, leadTPlay), mk(1, partial)], leadT, LEVEL, TRUMP), 0);
    // A A + 10 10 (614, 610): every unit beats -> wins
    const full = [...pair('S', 14), ...pair('S', 10)];
    assert.equal(G.trickWinner([mk(0, leadTPlay), mk(1, full)], leadT, LEVEL, TRUMP), 1);
    // a non-matching structure (pair + 2 singles) can never take a throw
    const junk = [...pair('S', 14), C('S', 3), C('S', 4)];
    assert.equal(G.trickWinner([mk(0, leadTPlay), mk(1, junk)], leadT, LEVEL, TRUMP), 0);
  });

  test('trick: a singles throw is taken by a trump singles throw, not by lower same-suit singles', () => {
    const mk = (player, cards) => ({ player, cards });
    const lead = { type: 'throw', unit: 1, length: 3, count: 3, effSuit: 'H', weakestKey: 8 };
    const leadPlay = [C('H', 14), C('H', 9), C('H', 8)];
    const trumpSingles = [SJ(), C('S', 3), C('S', 2)];
    assert.equal(G.trickWinner([mk(0, leadPlay), mk(1, trumpSingles)], lead, LEVEL, TRUMP), 1);
    const lowerHearts = [C('H', 13), C('H', 12), C('H', 11)];
    assert.equal(G.trickWinner([mk(0, leadPlay), mk(1, lowerHearts)], lead, LEVEL, TRUMP), 0);
  });
});
