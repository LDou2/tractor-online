'use strict';
/*
 * Tractor (Shengji / 升级拖拉机) core rules engine — pure logic, no I/O.
 * Phase 1 of the tractor-online project: game logic + tests only.
 *
 * Card model: { id, suit, rank }
 *   suit: 'S' | 'H' | 'D' | 'C' | null   (null for jokers)
 *   rank: 2..14 (11=J, 12=Q, 13=K, 14=A) | 'SJ' | 'BJ'
 *
 * Key rules implemented:
 *  - Table sizes 2v2..5v5 (4/6/8/10 players). nDecks = players/2.
 *    26 cards per player + 6 bottom cards; jokers are added/removed to make
 *    the counts work (4p: +2 jokers, 6p: exact, 8p: -2 jokers, 10p: -4 jokers).
 *  - 1v1 mode (2 players, owner 2026-11-20): ONE 54-card set plus one
 *    extra big joker and one extra small joker = a 56-card pool (every
 *    suit card once, 2 BJ + 2 SJ). 25 cards each + 6 bottom; scoring
 *    runs at nDecks = 1 (the n*40 line is 40; a deck holds 100 points).
 *    With a single copy of each level card, only single-card bids exist.
 *  - Trump group = trump-suit cards + ALL level cards + jokers.
 *    Trump strength (level L, trump suit T), high to low:
 *      BJ > SJ > L of suit T > L of other suits (all equal) >
 *      A,K,Q,J,10,9,8,6,5,4,3,2 of suit T (level rank excluded).
 *    Non-trump suits rank A>K>Q>J>10>9>8>7>6>5>4>3>2 (level rank excluded,
 *    since level cards are trump).
 *  - Bidding: bid = { suit, rank, cards } with cards = 1 | 2.
 *    A 2-card (pair) bid requires only holding the pair — no minimum
 *    trump count for human players. First bidder keeps priority
 *    on equal bids (a later equal bid never overcalls).
 *  - Tractors: 2+ consecutive pairs or 2+ consecutive triples of one
 *    effective suit. Level-chain rule in trump (level L, trump T), strict
 *    and consecutive only, high to low:
 *      BJ > SJ > L-of-T > off-suit L > A-of-T > K-of-T. Adjacent groups and
 *      longer chains combining consecutive groups are tractors; skipping
 *      a link is never a tractor.
 *      L=7, T=S: BJ BJ+SJSJ ok; SJSJ+7S7S ok; 7S7S+7H7H ok; 7H7H+ASAS ok;
 *      ASAS+KSKS ok; BJ BJ+SJSJ+7S7S+7H7H+ASAS+KSKS ok;
 *      7S7S+ASAS NOT ok (off-suit L skipped); SJSJ+ASAS NOT ok (both L
 *      groups skipped); SJSJ+7H7H NOT ok (L-of-T skipped). Same for triples.
 *    Level-skip rule (owner, 2026-11-19 — supersedes the Oct 2026 rule
 *    under which only a 2-unit tractor could skip): within a suit's pip
 *    sequence the level rank is simply absent, so a tractor of ANY
 *    length may skip it — the ranks on either side of the level are
 *    consecutive (level 8: 6+7+9, 7+9, 7+9+10 are tractors, pairs and
 *    triples, in natural suits and in trump alike). Alternatively a
 *    tractor crossing the level may INCLUDE the level group at face
 *    value (33+44+55 at level 4).
 *    Suit-face rule: a suit's own level pair/triple may join THAT suit's
 *    tractor in its natural rank place, counted as a regular card of that
 *    suit at face strength (level 4: ♦3+♦4, ♦4+♦5, ♦3+♦4+♦5 are diamond
 *    tractors, and ♦3/♦4/♦5 is weaker than ♦5/♦6/♦7). A lone level pair
 *    (♦4♦4) is still a trump pair.
 *  - Follow rules: must follow the led effective suit; void players are free.
 *    A follower holding fewer cards of the led effective suit than the
 *    lead's count plays all of them and pads the rest with any other cards
 *    (the shortfall is measured on effective suit: a printed-suit level
 *    card is trump and never counts toward — or is forced as — its suit).
 *    Combination cascade: triple lead -> triple if held, else pair + padding;
 *    quad lead -> quad, else triple, else pair, padded to 4. A larger combo
 *    (triple/quad/pair) is "protected" — never broken — when the player can
 *    meet the follow requirement without touching it. Exception: on a pair
 *    follow (pair lead, or the pair-tractor cascade) a held triple is never
 *    forced, but the follower MAY split it and play exactly 2 of the 3
 *    cards — a free choice either way.
 *  - Unbeatable-singles rule: 2+ natural singles of one effective suit may be
 *    led together as a tractor-like combination when EACH of them outranks
 *    every card of that suit held by EVERY other player (teammates included).
 *    "Natural" = not breaking a pair/triple/quad to form them. A player void
 *    in the led suit may kill with an equal number of trumps.
 *  - Throw rule (甩牌, owner 2026-11-19): when leading, a player may throw
 *    2+ units of one type (all singles, all pairs, or all triples — never
 *    mixed) of one effective suit at once, consecutive or not (consecutive
 *    units are a tractor instead). The throw stands only if NO other
 *    player holds, in that suit, a unit of the same type beating the
 *    throw's WEAKEST unit. If one does, the throw FAILS: the play is
 *    cancelled (cards stay in hand), the throwing team's captured points
 *    are docked 10 per attempted card (floor 0), the room is warned
 *    (never naming who blocked it), and the player's next lead must be
 *    exactly that weakest unit. Followers answer a throw with the same
 *    number of cards, following suit and matching its unit structure as
 *    far as they hold it. A throw is taken only by a same-structure play
 *    whose EVERY unit beats the corresponding unit of the current best
 *    (trump over plain suit by normal precedence). A natural multi-singles
 *    lead whose every single is unbeatable still classifies as
 *    unbeatable-singles (the older, stronger type takes precedence).
 *  - Trick winner: highest combination of the led structure wins; trump beats
 *    non-trump; ties go to the earlier play. An unbeatable-singles lead wins
 *    unless killed by an equal-count trump play (highest kill wins).
 *  - Scoring (n = decks): defenders need >= n*40 to win the round.
 *    抠底: defenders winning the last trick add 2x the buried bottom cards'
 *    points to their total before judging.
 *    Dealer team: +3 if defenders scored 0 trick points; +2 if defenders'
 *    (boosted) total < n*20; otherwise +1. Each team tracks its own level.
 *    Point cards: 5=5, 10=10, K=10 (100 per deck).
 *
 * Simplifications / interpretations (documented for Phase 2):
 *  - Off-suit level pairs do not chain with each other (same rank, not
 *    consecutive).
 *  - Tractor-follow cascade: for a k-unit tractor lead, followers must play
 *    the k-unit tractor if held; else k separated (non-consecutive) units if
 *    held; else the largest m<k units held plus same-suit padding; else all
 *    singles. Larger protected combos are never broken (excluded from the
 *    follow pool before the cascade is evaluated).
 *  - "Dealer holds > n*60" is read as (dealer trick points + buried bottom
 *    points) > n*60, which is exactly the dealer-win condition, so a dealer
 *    round win always gains >= 1 level.
 *  - Trump-kill comparison uses lexicographic max trump strength.
 *  - 5+ of a kind is not a leadable combination (but a quad may be taken
 *    from it when following).
 *  - AI bidding strategy (e.g. no-bid windows, 40% rule) is client-side and
 *    out of scope here; only the hard pair-bid validation lives in the engine.
 */

const SUITS = ['S', 'H', 'D', 'C'];
const TEAM_OF_SEAT = (seat) => seat % 2; // seats 0,2,4.. = team 0 (Gold); 1,3,5.. = team 1 (Blue)

// ---------------------------------------------------------------------------
// Card helpers
// ---------------------------------------------------------------------------

function isJoker(c) {
  return c.suit === null;
}

function isLevelCard(c, level) {
  return !isJoker(c) && c.rank === level;
}

function isTrump(c, level, trumpSuit) {
  return isJoker(c) || isLevelCard(c, level) || (trumpSuit !== null && c.suit === trumpSuit);
}

// Effective suit for follow/trick purposes: 'T' for any trump card, else natural suit.
function effectiveSuit(c, level, trumpSuit) {
  return isTrump(c, level, trumpSuit) ? 'T' : c.suit;
}

// Strength of a trump card (higher = stronger). Assumes isTrump(c).
function trumpStrength(c, level, trumpSuit) {
  if (c.rank === 'BJ') return 1000;
  if (c.rank === 'SJ') return 900;
  if (c.rank === level) return c.suit === trumpSuit ? 800 : 700;
  return 600 + c.rank; // trump-suit pip: 602..614, always below off-suit level cards
}

// Strength of a card within its effective suit.
function cardStrength(c, level, trumpSuit) {
  if (effectiveSuit(c, level, trumpSuit) === 'T') return trumpStrength(c, level, trumpSuit);
  return c.rank; // 2..14, A high
}

function cardPoints(c) {
  if (isJoker(c)) return 0;
  if (c.rank === 5) return 5;
  if (c.rank === 10 || c.rank === 13) return 10; // 10 and K
  return 0;
}

function pointsOf(cards) {
  return cards.reduce((s, c) => s + cardPoints(c), 0);
}

// Identity string for grouping identical cards (suit + rank; jokers group by type).
function cardId(c) {
  return `${c.suit}:${c.rank}`;
}

// ---------------------------------------------------------------------------
// Deck & deal
// ---------------------------------------------------------------------------

function buildDeck(nDecks) {
  const deck = [];
  let id = 1;
  for (let d = 0; d < nDecks; d++) {
    for (const s of SUITS) {
      for (let r = 2; r <= 14; r++) deck.push({ id: id++, suit: s, rank: r });
    }
    deck.push({ id: id++, suit: null, rank: 'SJ' });
    deck.push({ id: id++, suit: null, rank: 'BJ' });
  }
  return deck; // 54 * nDecks cards
}

function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// Shared dealing tail: shuffle the pool, deal round-robin (one card at
// a time around the table — the order the server's timed dispatch
// replays), then set aside the 6 bottom cards. The pool must be exactly
// handSize * numPlayers + 6 cards.
function dealOut(deck, numPlayers, handSize) {
  shuffle(deck);
  const hands = Array.from({ length: numPlayers }, () => []);
  for (let r = 0; r < handSize; r++) {
    for (let p = 0; p < numPlayers; p++) hands[p].push(deck.pop());
  }
  const bottom = [];
  for (let i = 0; i < 6; i++) bottom.push(deck.pop());
  if (deck.length !== 0) throw new Error('deal: card count mismatch');
  return { hands, bottom };
}

// Deal 26 cards per player + 6 bottom cards. numPlayers: 4, 6, 8, 10.
function deal(numPlayers) {
  if (![4, 6, 8, 10].includes(numPlayers)) {
    throw new Error('deal: numPlayers must be 4, 6, 8, or 10');
  }
  const nDecks = numPlayers / 2;
  const deck = buildDeck(nDecks);
  const needed = 26 * numPlayers + 6;
  let nextId = deck.length + 1;
  const diff = needed - deck.length;
  if (diff > 0) {
    // Add jokers (alternating SJ/BJ) to make the numbers work (2v2 case).
    for (let i = 0; i < diff; i++) {
      deck.push({ id: nextId++, suit: null, rank: i % 2 === 0 ? 'SJ' : 'BJ' });
    }
  } else if (diff < 0) {
    // Remove jokers from the end (balanced) to make the numbers work (4v4/5v5).
    let n = -diff;
    for (let i = deck.length - 1; i >= 0 && n > 0; i--) {
      if (deck[i].suit === null) {
        deck.splice(i, 1);
        n--;
      }
    }
    if (n > 0) throw new Error('deal: not enough jokers to remove');
  }
  const { hands, bottom } = dealOut(deck, numPlayers, 26);
  return { hands, bottom, nDecks };
}

// 1v1 pool (owner 2026-11-20): ONE standard 54-card set plus one extra
// big joker and one extra small joker — 56 cards: every suit card once,
// 2 big jokers, 2 small jokers.
function buildPool1v1() {
  const pool = buildDeck(1); // ids 1..54
  let nextId = pool.length + 1;
  pool.push({ id: nextId++, suit: null, rank: 'SJ' });
  pool.push({ id: nextId++, suit: null, rank: 'BJ' });
  return pool;
}

// Deal a 1v1 round: 25 cards to each player + 6 bottom (25+25+6 = 56).
// Scoring runs at nDecks = 1 (defenders' line is 40 points).
function deal1v1() {
  const { hands, bottom } = dealOut(buildPool1v1(), 2, 25);
  return { hands, bottom, nDecks: 1 };
}

// ---------------------------------------------------------------------------
// Bidding
// ---------------------------------------------------------------------------

// Cards in hand that would be trump if bidSuit became the trump suit.
function possibleTrumpCount(hand, bidSuit, level) {
  let n = 0;
  for (const c of hand) {
    if (c.suit === bidSuit) n++;
    else if (isJoker(c)) n++;
    else if (c.rank === level) n++;
  }
  return n;
}

// bid = { suit, rank, cards } with cards = 1 | 2 (single or pair shown).
function validateBid(hand, bid, level) {
  if (!bid || !SUITS.includes(bid.suit)) return { ok: false, reason: 'bad-suit' };
  if (bid.cards !== 1 && bid.cards !== 2) return { ok: false, reason: 'bad-count' };
  const held = hand.filter((c) => c.suit === bid.suit && c.rank === bid.rank).length;
  if (held < bid.cards) return { ok: false, reason: 'not-held' };
  // Human-play rule (owner request 2026-10-16): a pair bid needs only the
  // pair itself — no minimum trump count, no 40%-in-first-10-cards rule.
  return { ok: true };
}

// Does newBid displace curBid? More cards win; equal cards -> first bidder
// keeps priority (a later equal bid never overcalls).
function bidOutranks(newBid, curBid) {
  if (!curBid) return true;
  if (newBid.cards !== curBid.cards) return newBid.cards > curBid.cards;
  return false;
}

// bidEvents: [{ player, bid }] in chronological order. Returns winning event or null.
function resolveBidding(bidEvents) {
  let win = null;
  for (const e of bidEvents) {
    if (!win || bidOutranks(e.bid, win.bid)) win = e;
  }
  return win;
}

function trumpSuitFromBid(win) {
  return win ? win.bid.suit : null;
}

// ---------------------------------------------------------------------------
// Combination classification (incl. level-chain tractors)
// ---------------------------------------------------------------------------

// Position of a pip rank in the sequence with the level rank removed
// (ranks 2..14 minus `level`): the ranks on either side of the level are
// adjacent here (6 and 8 are consecutive when L=7; 7 and 9 when L=8).
// Returns null when rank IS the level rank.
function pipKey(rank, level) {
  let k = 0;
  for (let r = 2; r <= 14; r++) {
    if (r === level) continue;
    if (r === rank) return k;
    k++;
  }
  return null;
}

// Tractor ladder key for a card within its effective suit.
// Trump ladder (level L, trump T), low -> high:
//   T-suit pips (L excluded, so K=10 and A=11 are adjacent) < off-suit L
//   (12) < L of suit T (13) < SJ (14) < BJ (15). The chain is strict:
//   only numerically adjacent keys may sit next to each other (see
//   keysChainAdjacent) — skipping a link is never a tractor.
// Natural suit ladder: raw rank. (isValidTractor judges natural
// consecutiveness on the level-removed pip sequence via pipKey — or on
// these raw ranks when the suit's own level group is one of the groups,
// i.e. it is included at face value; the suit-face rule in classify()
// handles a classified play containing that suit's level cards.)
function tractorKey(c, level, trumpSuit, effSuit) {
  if (effSuit === 'T') {
    if (c.rank === 'BJ') return 15;
    if (c.rank === 'SJ') return 14;
    if (isJoker(c)) return null; // defensive: jokers are always trump
    if (c.rank === level) return c.suit === trumpSuit ? 13 : 12;
    // Trump-suit pips: the level rank is NOT between its neighbors here
    // (the 主L sits above A), so 6 and 8 ARE consecutive when L=7.
    return pipKey(c.rank, level);
  }
  // Natural suit: raw rank (see the note above for how it is judged).
  return c.rank;
}

// Two trump ladder keys are "chain-adjacent" (may sit next to each other
// in a tractor) only when they are numerically consecutive. No link of
// the chain K -> A -> off-suit L -> L-of-T -> SJ -> BJ may be skipped:
// e.g. SJ (14) chains only with BJ (15) and L-of-T (13), never directly
// with an off-suit L (12) or the trump ace (11).
function keysChainAdjacent(a, b) {
  return Math.abs(a - b) === 1;
}

// Face-value key for trump-suit cards in tractor formation: the rank at
// face value, with the trump-suit level card sitting between its neighbors
// (e.g. level 4 → 3 < 4 < 5). Returns null for non-trump-suit cards and
// jokers (those use the high-trump chain via tractorKey).
function faceValueKey(c, level, trumpSuit) {
  if (c.suit !== trumpSuit) return null;
  if (isJoker(c)) return null;
  return c.rank;
}

// Level-skip tractor rule (owner, 2026-11-19 — supersedes the Oct 2026
// rule under which only a 2-unit tractor could skip the level and 3+
// units had to include it): consecutiveness is judged on the rank
// sequence with the level rank removed, for tractors of ANY number of
// units, pairs and triples, in natural suits and in trump alike. At
// level 8, 6+7+9, 7+9 and 7+9+10 are all tractors; at level 4, 33+55+66
// and 22+33+55 are tractors. A tractor crossing the level may instead
// INCLUDE the level group at face value (33+44+55 at level 4): in trump
// via the face-value check below, in a natural suit via the suit-face
// path in classify() (classified plays) or the raw-rank check below
// (follow-pool subsets in hasTractorOf, the only place a natural-suit
// group set can contain the level group).
// `groups` is an array of card-arrays, each of length `unit` (2|3).
function isValidTractor(groups, level, trumpSuit, effSuit) {
  const k = groups.length;
  if (k < 2) return false;

  const stdKeys = groups.map((g) => tractorKey(g[0], level, trumpSuit, effSuit));
  if (stdKeys.some((x) => x === null)) return false;
  const stdUniq = [...new Set(stdKeys)].sort((a, b) => a - b);
  if (stdUniq.length !== stdKeys.length) return false; // duplicate ladder keys

  if (effSuit !== 'T') {
    // Natural suit. If the suit's own level group is among the groups it
    // counts at face value, so the raw ranks must be consecutive.
    if (groups.some((g) => g[0].rank === level)) {
      const raw = groups.map((g) => g[0].rank).sort((a, b) => a - b);
      for (let i = 1; i < raw.length; i++) {
        if (raw[i] !== raw[i - 1] + 1) return false;
      }
      return true;
    }
    // Otherwise the level rank is skipped: judge on the pip sequence
    // with the level rank removed.
    const comp = groups.map((g) => pipKey(g[0].rank, level)).sort((a, b) => a - b);
    return keysFormChain(comp);
  }

  // Trump: the standard ladder already removes the level rank from the
  // pip sequence (and chains the high-trump links), so a chain of any
  // length may skip the level.
  if (keysFormChain(stdUniq)) return true;
  // Alternative: the level group included at face value — trump-suit
  // ranks face-consecutive (33+44, 33+44+55 at level 4).
  const faceKeys = groups.map((g) => faceValueKey(g[0], level, trumpSuit));
  if (!faceKeys.every((x) => x !== null)) return false;
  const fUniq = [...new Set(faceKeys)].sort((a, b) => a - b);
  if (fUniq.length !== faceKeys.length) return false;
  for (let i = 1; i < fUniq.length; i++) {
    if (fUniq[i] !== fUniq[i - 1] + 1) return false;
  }
  return true;
}

// Structural classification. Does NOT handle the unbeatable-singles lead
// (that needs other players' hands; see validateLead).
// Returns { type, unit, length, count, effSuit } or { type:'invalid', ... }.
// Types: single | pair | triple | quad | tractor (unit 2|3, length = #units)
// | throw (unit 1|2|3, length = #units, plus weakestKey).
function classify(cards, level, trumpSuit) {
  const n = cards.length;
  if (n === 0) return { type: 'invalid', count: 0, effSuit: null };

  const groups = new Map();
  for (const c of cards) {
    const k = cardId(c);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  }
  const counts = [...groups.values()].map((g) => g.length);

  const suits = new Set(cards.map((c) => effectiveSuit(c, level, trumpSuit)));
  if (suits.size !== 1) {
    // Suit-face tractor: a suit's own level pair/triple joins that suit's
    // tractor in its natural rank place, as regular cards of that suit.
    // The level cards' effective suit is trump, so such a tractor mixes
    // effective suits; it is recognised by printed suit instead: every
    // card printed in one non-trump suit S, one group is S's level rank,
    // every group is a pair or a triple, and the group ranks are face-
    // consecutive (♦3+♦4, ♦4+♦5, ♦3+♦4+♦5 at level 4).
    // A lone level pair never reaches here as a tractor (single group)
    // and stays a trump pair below.
    const printed = new Set(cards.map((c) => c.suit));
    if (printed.size === 1 && !cards.some((c) => isJoker(c))) {
      const S = [...printed][0];
      if (S !== trumpSuit && cards.some((c) => c.rank === level)) {
        for (const unit of [2, 3]) {
          if (n % unit !== 0) continue;
          const k = n / unit;
          if (k < 2) continue;
          if (!counts.every((x) => x === unit)) continue;
          const ranks = [...groups.values()].map((g) => g[0].rank).sort((a, b) => a - b);
          let consecutive = ranks.length === k;
          for (let i = 1; i < ranks.length; i++) {
            if (ranks[i] !== ranks[i - 1] + 1) consecutive = false;
          }
          if (consecutive) {
            return { type: 'tractor', unit, length: k, count: n, effSuit: S, suitFace: true };
          }
        }
      }
    }
    return { type: 'invalid', count: n, effSuit: null };
  }
  const effSuit = [...suits][0];

  if (n === 1) return { type: 'single', unit: 1, length: 1, count: n, effSuit };
  if (n === 2 && counts.length === 1) return { type: 'pair', unit: 2, length: 1, count: n, effSuit };
  if (n === 3 && counts.length === 1) return { type: 'triple', unit: 3, length: 1, count: n, effSuit };
  if (n === 4 && counts.length === 1) return { type: 'quad', unit: 4, length: 1, count: n, effSuit };

  for (const unit of [2, 3]) {
    if (n % unit !== 0) continue;
    const k = n / unit;
    if (k < 2) continue;
    if (!counts.every((x) => x === unit)) continue;
    if (!isValidTractor([...groups.values()], level, trumpSuit, effSuit)) continue;
    return { type: 'tractor', unit, length: k, count: n, effSuit };
  }

  // Throw (甩牌): 2+ units all of the same size (unit 1|2|3) of one
  // effective suit that do NOT form a tractor. Mixed unit sizes are not
  // a throw. Whether the throw stands is NOT decided here — that needs
  // the other players' hands (see throwFailureInfo / validateLead).
  for (const unit of [1, 2, 3]) {
    if (n % unit !== 0) continue;
    const k = n / unit;
    if (k < 2) continue;
    if (!counts.every((x) => x === unit)) continue;
    const weakestKey = Math.min(
      ...[...groups.values()].map((g) => cardStrength(g[0], level, trumpSuit))
    );
    return { type: 'throw', unit, length: k, count: n, effSuit, weakestKey };
  }
  return { type: 'invalid', count: n, effSuit };
}

// ---------------------------------------------------------------------------
// Lead validation (incl. unbeatable-singles rule)
// ---------------------------------------------------------------------------

function isSubsetById(hand, cards) {
  const counts = new Map();
  for (const c of hand) counts.set(c.id, (counts.get(c.id) || 0) + 1);
  for (const c of cards) {
    const n = counts.get(c.id) || 0;
    if (n === 0) return false;
    counts.set(c.id, n - 1);
  }
  return true;
}

// Unbeatable-singles lead: 2+ natural singles of one effective suit, each
// outranking every card of that suit held by EVERY other player (teammates
// included). "Natural" = not breaking a pair/triple/quad to form them.
function isUnbeatableSinglesLead(cards, fullHand, otherHands, level, trumpSuit) {
  if (!cards || cards.length < 2) return false;
  const S = effectiveSuit(cards[0], level, trumpSuit);
  for (const c of cards) {
    if (effectiveSuit(c, level, trumpSuit) !== S) return false;
  }
  for (const c of cards) {
    const id = cardId(c);
    if (fullHand.filter((h) => cardId(h) === id).length !== 1) return false; // would break a combo
  }
  for (const c of cards) {
    const s = cardStrength(c, level, trumpSuit);
    for (const hand of otherHands) {
      for (const oc of hand) {
        if (effectiveSuit(oc, level, trumpSuit) === S && cardStrength(oc, level, trumpSuit) >= s) {
          return false;
        }
      }
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Throw (甩牌) support
// ---------------------------------------------------------------------------

// The cards forming the weakest unit of a throw-shaped play (the single
// lowest card / lowest pair / lowest triple among the played cards).
// Ties (equal-strength units, e.g. two off-suit level pairs in trump)
// break deterministically by card identity.
function weakestUnitCards(cards, level, trumpSuit) {
  const groups = new Map();
  for (const c of cards) {
    const id = cardId(c);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(c);
  }
  let best = null;
  let bestKey = Infinity;
  let bestId = null;
  for (const [id, g] of groups) {
    const k = cardStrength(g[0], level, trumpSuit);
    if (k < bestKey || (k === bestKey && (bestId === null || id < bestId))) {
      best = g;
      bestKey = k;
      bestId = id;
    }
  }
  return best ? best.slice() : [];
}

// Failed-throw penalty: 10 points per card in the attempted throw,
// deducted from the throwing team's captured points (never below zero).
function throwPenalty(cardCount) {
  return 10 * cardCount;
}
function applyThrowPenalty(capturedPoints, cardCount) {
  return Math.max(0, capturedPoints - throwPenalty(cardCount));
}

// Checks a throw-shaped play against the other players' hands. Returns
// null when the throw stands; otherwise the failure info the server
// needs to run the failed-throw flow: the throw's weakest unit (the
// cards the player must lead next) and the penalty. The info NEVER
// identifies which hand blocked the throw.
function throwFailureInfo(cards, otherHands, level, trumpSuit) {
  const info = classify(cards, level, trumpSuit);
  if (!info || info.type !== 'throw') return null;
  const S = info.effSuit;
  for (const hand of otherHands || []) {
    const groups = new Map();
    for (const c of hand) {
      if (effectiveSuit(c, level, trumpSuit) !== S) continue;
      const id = cardId(c);
      if (!groups.has(id)) groups.set(id, []);
      groups.get(id).push(c);
    }
    for (const [, g] of groups) {
      // A unit of the throw's type (a single card / a pair / a triple —
      // a larger group contains the smaller unit) that beats the
      // throw's weakest unit blocks the throw. A higher SINGLE never
      // blocks a pairs throw, and so on.
      if (g.length >= info.unit && cardStrength(g[0], level, trumpSuit) > info.weakestKey) {
        return {
          unit: info.unit,
          length: info.length,
          count: info.count,
          effSuit: S,
          weakestKey: info.weakestKey,
          weakestCards: weakestUnitCards(cards, level, trumpSuit),
          penalty: throwPenalty(info.count),
        };
      }
    }
  }
  return null;
}

// Public announcement for a failed throw. Built ONLY from the thrower's
// name and the throw info, so it can never name (or hint at) the player
// who blocked the throw.
function throwFailureAnnouncement(throwerName, info) {
  const unitName = { 1: 'single', 2: 'pair', 3: 'triple' }[info.unit] || 'unit';
  return (
    `${throwerName}'s throw (甩牌) failed — another player holds a ${unitName} ` +
    `that beats its smallest ${unitName}. Penalty: ${info.penalty} points ` +
    `(10 × ${info.count} cards) deducted from their team's captured points. ` +
    `The cards stay in ${throwerName}'s hand, and they must now lead that ` +
    `smallest ${unitName}.`
  );
}

// otherHands: array of the other players' hands (may be [] or omitted when
// only structural validation is needed).
function validateLead(hand, cards, otherHands, level, trumpSuit) {
  if (!cards || cards.length === 0) return { ok: false, reason: 'empty' };
  if (!isSubsetById(hand, cards)) return { ok: false, reason: 'not-in-hand' };
  const info = classify(cards, level, trumpSuit);
  if (info.type === 'throw') {
    // A natural multi-singles lead whose EVERY single is unbeatable
    // keeps the older, stronger unbeatable-singles type (precedence
    // preserved from before the throw rule existed).
    if (
      info.unit === 1 &&
      otherHands &&
      isUnbeatableSinglesLead(cards, hand, otherHands, level, trumpSuit)
    ) {
      return {
        ok: true,
        type: 'unbeatable-singles',
        unit: 1,
        length: cards.length,
        count: cards.length,
        effSuit: info.effSuit,
      };
    }
    if (otherHands) {
      const fail = throwFailureInfo(cards, otherHands, level, trumpSuit);
      if (fail) return { ok: false, reason: 'throw-blocked', throwInfo: fail };
    }
    return {
      ok: true,
      type: 'throw',
      unit: info.unit,
      length: info.length,
      count: cards.length,
      effSuit: info.effSuit,
      weakestKey: info.weakestKey,
    };
  }
  if (info.type !== 'invalid') {
    return { ok: true, type: info.type, unit: info.unit, length: info.length, count: cards.length, effSuit: info.effSuit };
  }
  if (
    otherHands &&
    isUnbeatableSinglesLead(cards, hand, otherHands, level, trumpSuit)
  ) {
    return {
      ok: true,
      type: 'unbeatable-singles',
      unit: 1,
      length: cards.length,
      count: cards.length,
      effSuit: effectiveSuit(cards[0], level, trumpSuit),
    };
  }
  return { ok: false, reason: 'invalid-combination' };
}

// ---------------------------------------------------------------------------
// Follow validation (must-follow-suit + combination cascade)
// ---------------------------------------------------------------------------

// Number of rank-groups with at least `unit` cards.
function unitsIn(cards, unit) {
  const groups = new Map();
  for (const c of cards) {
    const id = cardId(c);
    groups.set(id, (groups.get(id) || 0) + 1);
  }
  let n = 0;
  for (const [, cnt] of groups) if (cnt >= unit) n++;
  return n;
}
const pairsIn = (cards) => unitsIn(cards, 2);
const triplesIn = (cards) => unitsIn(cards, 3);
const quadsIn = (cards) => unitsIn(cards, 4);

// A combo is "protected" (must not be broken) when it is strictly larger than
// the largest unit the follow requires AND the player can still meet the
// follow count without touching it.
function findProtectedIds(suitCards, N, maxUnit) {
  const groups = new Map();
  for (const c of suitCards) {
    const id = cardId(c);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(c);
  }
  const combos = [];
  for (const [, g] of groups) {
    if (g.length >= 4) combos.push({ ids: g.slice(0, 4).map((c) => c.id), size: 4 });
    else if (g.length === 3) combos.push({ ids: g.map((c) => c.id), size: 3 });
    else if (g.length === 2) combos.push({ ids: g.map((c) => c.id), size: 2 });
  }
  combos.sort((a, b) => b.size - a.size);
  const prot = new Set();
  let remaining = suitCards.length;
  for (const combo of combos) {
    if (combo.size > maxUnit && remaining - combo.size >= N) {
      combo.ids.forEach((id) => prot.add(id));
      remaining -= combo.size;
    }
  }
  return prot;
}

function patternSatisfiable(pat, pool) {
  for (const u of pat) {
    if (u === 1) continue;
    if (unitsIn(pool, u) < 1) return false;
  }
  return true;
}

function playMatchesPattern(play, pat, level, trumpSuit) {
  if (pat.every((u) => u === 1)) return true;
  if (pat.length === 1) {
    const want = { 2: 'pair', 3: 'triple', 4: 'quad' }[pat[0]];
    return classify(play, level, trumpSuit).type === want;
  }
  // e.g. [2,1], [3,1], [2,1,1]: must contain the big unit; smaller units are padding
  const big = Math.max(...pat);
  return unitsIn(play, big) >= 1;
}

// Can `cards` supply a k-unit tractor (unit 2|3) of effective suit S?
// Do k distinct ladder keys (sorted ascending) form a valid tractor chain
// under keysChainAdjacent?
function keysFormChain(sortedKeys) {
  for (let i = 1; i < sortedKeys.length; i++) {
    if (!keysChainAdjacent(sortedKeys[i - 1], sortedKeys[i])) return false;
  }
  return true;
}

function hasTractorOf(cards, k, unit, level, trumpSuit, effSuit) {
  const groups = new Map();
  for (const c of cards) {
    const id = cardId(c);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(c);
  }
  const candidates = [];
  for (const [, g] of groups) {
    if (g.length >= unit) candidates.push(g.slice(0, unit));
  }
  if (candidates.length < k) return false;
  // Check every k-subset with the (level-skip aware) tractor validator.
  // (k <= 5 and few distinct trump ranks, so the combinatorics stay tiny.)
  const idx = Array.from({ length: k }, (_, i) => i);
  const n = candidates.length;
  for (;;) {
    const subset = idx.map((i) => candidates[i]);
    if (isValidTractor(subset, level, trumpSuit, effSuit)) return true;
    let i = k - 1;
    while (i >= 0 && idx[i] === n - k + i) i--;
    if (i < 0) return false;
    idx[i]++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
  }
}

// Tractor-follow cascade (matches the desktop rule): for a k-unit tractor
// lead (unit u, k units, N = u*k cards), every follower must play, in suit:
//   1. their own k-unit tractor if held;
//   2. else k separated (non-consecutive) u-units if held;
//   3. else the largest m in [1, k-1] u-units held, plus same-suit padding;
//   4. else N singles.
// Larger protected combos are never broken: the caller strips protected cards
// from `pool` (and rejects plays touching them) before this runs, so every
// unit count below is computed on unprotected cards only. Step 2 needs no
// explicit "non-consecutive" check: step 1 already established that the pool
// holds no k-unit tractor, and the play is a subset of the pool, so any k
// units in the play are automatically separated.
function checkTractorFollow(pool, play, lead, level, trumpSuit) {
  const { unit, length: k } = lead;
  const S = lead.effSuit;
  // 1. k-unit tractor if held.
  if (hasTractorOf(pool, k, unit, level, trumpSuit, S)) {
    const pi = classify(play, level, trumpSuit);
    if (pi.type === 'tractor' && pi.unit === unit && pi.length === k && pi.effSuit === S) {
      return { ok: true };
    }
    return { ok: false, reason: 'must-play-tractor' };
  }
  const unitsHeld = unitsIn(pool, unit);
  // 2. k separated units if held.
  if (unitsHeld >= k) {
    if (unitsIn(play, unit) >= k) return { ok: true };
    return { ok: false, reason: 'must-play-separated-units' };
  }
  // 3. largest m < k units held, plus same-suit padding to N.
  for (let m = k - 1; m >= 1; m--) {
    if (unitsHeld >= m) {
      if (unitsIn(play, unit) >= m) return { ok: true };
      return { ok: false, reason: 'must-play-units-plus-padding' };
    }
  }
  // 4. all singles (in-suit membership already verified by the caller).
  return { ok: true };
}

// Throw-follow: a throw of k units of size u is answered with as many
// u-units of the led suit as the follower holds (up to k), plus same-suit
// padding — the units need NOT be consecutive (that is what separates a
// throw from a tractor). Protected-combo handling (incl. the triple-split
// exception for pair follows) is the caller's, exactly as for tractors.
function checkThrowFollow(pool, play, lead, level, trumpSuit) {
  const { unit, length: k } = lead;
  const need = Math.min(k, unitsIn(pool, unit));
  if (unitsIn(play, unit) >= need) return { ok: true };
  return { ok: false, reason: 'must-match-throw-structure' };
}

function checkCascade(suitCards, play, lead, N, level, trumpSuit) {
  const maxUnit =
    lead.type === 'tractor' || lead.type === 'throw'
      ? lead.unit
      : { pair: 2, triple: 3, quad: 4 }[lead.type];
  const protectedIds = findProtectedIds(suitCards, N, maxUnit);
  // Rule clarification: a follower holding a triple in the led suit is never
  // forced to play it, but MAY voluntarily split it and play exactly 2 of
  // its 3 cards as (part of) a pair follow — a free choice, for pair leads
  // and the pair-tractor follow cascade alike. (A protected quad stays
  // protected; only triples may be split.)
  const splitIds = new Set();
  {
    const inPlay = new Map();
    for (const c of play) {
      const gid = cardId(c);
      if (!inPlay.has(gid)) inPlay.set(gid, []);
      inPlay.get(gid).push(c);
    }
    for (const [gid, pcs] of inPlay) {
      if (pcs.length === 2 && pcs.every((c) => protectedIds.has(c.id))) {
        const handCount = suitCards.filter((c) => cardId(c) === gid).length;
        if (handCount === 3) pcs.forEach((c) => splitIds.add(c.id));
      }
    }
  }
  for (const c of play) {
    if (protectedIds.has(c.id) && !splitIds.has(c.id)) {
      return { ok: false, reason: 'broke-protected-combo' };
    }
  }
  const pool = suitCards.filter((c) => !protectedIds.has(c.id));

  if (lead.type === 'tractor') return checkTractorFollow(pool, play, lead, level, trumpSuit);
  if (lead.type === 'throw') return checkThrowFollow(pool, play, lead, level, trumpSuit);

  const patterns = {
    pair: [[2], [1, 1]],
    triple: [[3], [2, 1], [1, 1, 1]],
    quad: [[4], [3, 1], [2, 1, 1], [1, 1, 1, 1]],
  }[lead.type];
  for (const pat of patterns) {
    if (patternSatisfiable(pat, pool)) {
      if (playMatchesPattern(play, pat, level, trumpSuit)) return { ok: true };
      return { ok: false, reason: 'must-follow-' + pat.join('+') };
    }
  }
  return { ok: false, reason: 'no-valid-follow' };
}

// lead: { type, effSuit, count, unit, length } as returned by validateLead.
function validateFollow(hand, play, lead, level, trumpSuit) {
  const N = lead.count;
  const S = lead.effSuit;
  if (!play || play.length !== N) return { ok: false, reason: 'wrong-count' };
  if (!isSubsetById(hand, play)) return { ok: false, reason: 'not-in-hand' };

  // For a natural-suit TRACTOR lead, a card printed in the led suit at the
  // level rank also counts as a card of that suit: it may join the suit's
  // tractor at face value under the suit-face rule (classify). For every
  // other lead a level card stays trump only, so a lone level pair is
  // still a trump pair and does not follow its printed suit.
  const isSuitMember = (c) =>
    effectiveSuit(c, level, trumpSuit) === S ||
    (lead.type === 'tractor' && S !== 'T' && c.suit === S && c.rank === level);
  const suitCards = hand.filter(isSuitMember);
  if (suitCards.length === 0) return { ok: true, note: 'void-free' }; // void: free (may trump-kill)

  // The follow OBLIGATION is measured on the led EFFECTIVE suit only: a
  // printed-suit level card is trump, so it never counts toward the number
  // of led-suit cards a follower holds (and can never be forced out as a
  // card of its printed suit). It may still be PLAYED as a suit member —
  // the suit-face tractor path above — but that is the follower's choice.
  // Short on the effective suit: the follower plays every effective-suit
  // card held and pads the rest with anything (off-suit cards, or the
  // level card played as trump). Enough of the suit: no padding at all —
  // every played card must be a suit member, as before.
  const effHeld = hand.filter((c) => effectiveSuit(c, level, trumpSuit) === S);
  const playSuit = play.filter(isSuitMember);
  if (effHeld.length < N) {
    // Not enough of the led suit: must include every card of it held.
    const playEff = play.filter((c) => effectiveSuit(c, level, trumpSuit) === S);
    if (playEff.length !== effHeld.length) return { ok: false, reason: 'must-include-all-held-suit' };
    return { ok: true };
  }
  if (playSuit.length !== N) return { ok: false, reason: 'must-follow-suit' };

  // Single-type leads (incl. unbeatable-singles): any N cards of the suit.
  if (lead.type === 'single' || lead.type === 'unbeatable-singles') return { ok: true };
  // A singles throw is likewise answered with any N cards of the suit
  // (every card is a single unit, so the structure trivially matches).
  if (lead.type === 'throw' && lead.unit === 1) return { ok: true };
  return checkCascade(suitCards, play, lead, N, level, trumpSuit);
}

// ---------------------------------------------------------------------------
// Trick winner
// ---------------------------------------------------------------------------

// What it takes for `cards` to contend for this trick, or null if it cannot.
// Key: { tier, key } — tier 2 (trump over non-trump lead) beats tier 1;
// within a tier the higher key wins; ties keep the earlier play.
function contendingKey(cards, lead, isLead, level, trumpSuit) {
  const S = lead.effSuit;
  const leadIsTrump = S === 'T';
  // A suit-face tractor mixes effective suits (its level cards are trump
  // by effective suit but diamond/club/etc. by printed suit); classify()
  // reports its real suit. Every other play is single-effective-suit.
  const playInfo = classify(cards, level, trumpSuit);
  const suits = new Set(cards.map((c) => effectiveSuit(c, level, trumpSuit)));
  if (suits.size !== 1 && !(playInfo && playInfo.suitFace)) return null;
  const s = playInfo && playInfo.suitFace ? playInfo.effSuit : [...suits][0];
  const isTrumpPlay = s === 'T';

  if (lead.type === 'unbeatable-singles') {
    if (isLead) return { tier: leadIsTrump ? 2 : 1, key: Infinity };
    // Only an equal-count trump kill can beat it (when the lead isn't trump).
    if (!leadIsTrump && isTrumpPlay && cards.length === lead.count) {
      const ks = cards.map((c) => trumpStrength(c, level, trumpSuit)).sort((a, b) => b - a);
      return { tier: 2, key: ks };
    }
    return null;
  }

  if (lead.type === 'throw') {
    // Only a play with the SAME unit structure contends: a throw of the
    // same unit size and unit count, or a tractor built from the same
    // units. Its key is the list of unit strengths, strongest first —
    // taking the trick requires beating EVERY unit (see throwKeyBeats).
    const infoT = playInfo;
    if (!infoT || (infoT.type !== 'throw' && infoT.type !== 'tractor')) return null;
    if (infoT.unit !== lead.unit || infoT.length !== lead.length) return null;
    const groups = new Map();
    for (const c of cards) {
      const id = cardId(c);
      if (!groups.has(id)) groups.set(id, []);
      groups.get(id).push(c);
    }
    const units = [...groups.values()]
      .map((g) => (infoT.suitFace ? g[0].rank : cardStrength(g[0], level, trumpSuit)))
      .sort((a, b) => b - a);
    if (s === S) return { tier: leadIsTrump ? 2 : 1, key: units };
    if (isTrumpPlay && !leadIsTrump) return { tier: 2, key: units };
    return null;
  }

  const info = classify(cards, level, trumpSuit);
  if (!info || info.type === 'invalid') return null;
  const sameStructure =
    (lead.type === 'single' && info.type === 'single') ||
    (lead.type === 'pair' && info.type === 'pair') ||
    (lead.type === 'triple' && info.type === 'triple') ||
    (lead.type === 'quad' && info.type === 'quad') ||
    (lead.type === 'tractor' &&
      info.type === 'tractor' &&
      info.unit === lead.unit &&
      info.length === lead.length);
  if (!sameStructure) return null;

  const keyOf = (cs) => {
    if (info.type === 'single') return cardStrength(cs[0], level, trumpSuit);
    // Suit-face tractor: every unit counts at face rank (the level cards
    // are regular cards of the suit here, NOT trump-strength), so the
    // ♦3/♦4/♦5 tractor's key is 5 — weaker than ♦5/♦6/♦7's 7.
    if (info.suitFace) return Math.max(...cs.map((c) => c.rank));
    // pair / triple / quad / tractor: strength of the highest unit
    const groups = new Map();
    for (const c of cs) {
      const id = cardId(c);
      if (!groups.has(id)) groups.set(id, []);
      groups.get(id).push(c);
    }
    let best = -Infinity;
    for (const [, g] of groups) {
      const v = cardStrength(g[0], level, trumpSuit);
      if (v > best) best = v;
    }
    return best;
  };

  if (s === S) return { tier: leadIsTrump ? 2 : 1, key: keyOf(cards) };
  if (isTrumpPlay && !leadIsTrump) return { tier: 2, key: keyOf(cards) };
  return null;
}

function compareKeys(a, b) {
  if (a.tier !== b.tier) return a.tier - b.tier;
  const ka = Array.isArray(a.key) ? a.key : [a.key];
  const kb = Array.isArray(b.key) ? b.key : [b.key];
  for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
    const x = ka[i] === undefined ? 0 : ka[i];
    const y = kb[i] === undefined ? 0 : kb[i];
    if (x !== y) return x - y;
  }
  return 0;
}

// Throw trick comparison: unlike ordinary plays (where the highest
// unit decides), a throw is taken only by a same-structure play whose
// EVERY unit beats the corresponding unit of the current best play
// (both unit lists sorted descending) — a partial beat never takes it.
// A higher tier (a trump throw over a plain-suit throw lead) still wins
// outright; every trump unit outranks every plain-suit unit anyway.
function throwKeyBeats(a, b) {
  if (a.tier !== b.tier) return a.tier > b.tier;
  const ka = Array.isArray(a.key) ? a.key : [a.key];
  const kb = Array.isArray(b.key) ? b.key : [b.key];
  if (ka.length !== kb.length) return false;
  for (let i = 0; i < ka.length; i++) {
    if (!(ka[i] > kb[i])) return false;
  }
  return true;
}

// plays: [{ player, cards }] in play order. lead: validateLead result.
// Returns the index into plays of the winning play.
function trickWinner(plays, lead, level, trumpSuit) {
  let win = 0;
  let winKey = contendingKey(plays[0].cards, lead, true, level, trumpSuit);
  for (let i = 1; i < plays.length; i++) {
    const k = contendingKey(plays[i].cards, lead, false, level, trumpSuit);
    if (!k || !winKey) continue;
    const better =
      lead.type === 'throw' ? throwKeyBeats(k, winKey) : compareKeys(k, winKey) > 0;
    if (better) {
      win = i;
      winKey = k;
    }
  }
  return win;
}

// ---------------------------------------------------------------------------
// Scoring & level movement
// ---------------------------------------------------------------------------

// nDecks = n. defenderTrickPoints: points from tricks won by defenders.
// bottomPoints: points in the 6 buried cards. defendersWonLastTrick: 抠底.
// Returns { winner: 'defenders'|'dealer', defenderLevels, dealerLevels,
//           defenderTotal, dealerPoints }.
function scoreRound({ nDecks, defenderTrickPoints, bottomPoints, defendersWonLastTrick }) {
  const n = nDecks;
  // 抠底: double the buried bottom points are ADDED to the defenders' total.
  const defenderTotal = defenderTrickPoints + (defendersWonLastTrick ? 2 * bottomPoints : 0);
  // "Dealer holds": trick points + buried bottom (always > n*60 on a dealer win).
  const dealerPoints = n * 100 - defenderTrickPoints;

  if (n === 1) {
    // 1v1 scoring table (owner's spec, 2026-11-20) — REPLACES the generic
    // band formula for the 1-deck game only. T = the non-dealer side's
    // total (defenderTotal above; one deck holds 100 points):
    //   T = 0        -> dealer side +3
    //   0 < T < 20   -> dealer side +2
    //   20 <= T < 40 -> dealer side +1
    //   40 <= T < 80 -> NEITHER side gains a level, but the deal passes:
    //                   winner is 'defenders' with 0 levels, so rotation
    //                   (nextDealingTeam / computeNextDealerSeat) still
    //                   hands the deal to the non-dealer side.
    //   T >= 80      -> defenders +1 (flat — no higher bands)
    const T = defenderTotal;
    if (T >= 80) {
      return { winner: 'defenders', defenderLevels: 1, dealerLevels: 0, defenderTotal, dealerPoints };
    }
    if (T >= 40) {
      return { winner: 'defenders', defenderLevels: 0, dealerLevels: 0, defenderTotal, dealerPoints };
    }
    const dealerLevels = T === 0 ? 3 : T < 20 ? 2 : 1;
    return { winner: 'dealer', dealerLevels, defenderLevels: 0, defenderTotal, dealerPoints };
  }

  if (defenderTotal >= n * 40) {
    const defenderLevels = 1 + Math.floor((defenderTotal - n * 40) / (n * 20));
    return { winner: 'defenders', defenderLevels, dealerLevels: 0, defenderTotal, dealerPoints };
  }
  let dealerLevels;
  if (defenderTrickPoints === 0) dealerLevels = 3; // dealer captured every trick point
  else if (defenderTotal < n * 20) dealerLevels = 2;
  else dealerLevels = 1; // dealerPoints > n*60 is guaranteed here
  return { winner: 'dealer', dealerLevels, defenderLevels: 0, defenderTotal, dealerPoints };
}

// levels: [team0Level, team1Level] (each 2..14). dealerTeam: 0|1.
// Applies the round result; levels cap at 14 (A). matchWon: team or null.
function applyLevels(levels, result, dealerTeam) {
  const nl = [levels[0], levels[1]];
  const defenderTeam = 1 - dealerTeam;
  if (result.winner === 'defenders') nl[defenderTeam] += result.defenderLevels;
  else nl[dealerTeam] += result.dealerLevels;
  let matchWon = null;
  for (let t = 0; t < 2; t++) {
    if (nl[t] > 14) {
      nl[t] = 14;
      matchWon = t;
    }
  }
  return { levels: nl, matchWon };
}

// Which team deals (is the ZhuangJia team, playing at its own level) in
// the NEXT round. The defending team takes over only when it won the
// round — i.e. reached the n*40 switch criterion in scoreRound (120
// points in a 3-deck game). On any dealer-team win (e.g. defenders
// stalled at 110 of 120) the SAME dealer team keeps the deal for the
// next round; the defenders take it only on their win.
function nextDealingTeam(dealerTeam, result) {
  return result.winner === 'defenders' ? 1 - dealerTeam : dealerTeam;
}

module.exports = {
  SUITS,
  TEAM_OF_SEAT,
  isJoker,
  isLevelCard,
  isTrump,
  effectiveSuit,
  trumpStrength,
  cardStrength,
  cardPoints,
  pointsOf,
  buildDeck,
  shuffle,
  deal,
  buildPool1v1,
  deal1v1,
  possibleTrumpCount,
  validateBid,
  bidOutranks,
  resolveBidding,
  trumpSuitFromBid,
  tractorKey,
  faceValueKey,
  isValidTractor,
  classify,
  isUnbeatableSinglesLead,
  weakestUnitCards,
  throwPenalty,
  applyThrowPenalty,
  throwFailureInfo,
  throwFailureAnnouncement,
  validateLead,
  isSubsetById,
  unitsIn,
  validateFollow,
  trickWinner,
  scoreRound,
  applyLevels,
  nextDealingTeam,
};
