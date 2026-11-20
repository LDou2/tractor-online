# Tractor Online (升级拖拉机)

A self-hostable, real-time online multiplayer Tractor (Shengji) card game.
Built from scratch with **Node.js + Express + Socket.io** (server) and
**vanilla HTML/CSS/JS** (client, no build step).

Friends each open the hosted URL in their browser: one creates a room
(2v2, 3v3, 4v4 or 5v5), the others join with a 6-character room code, and
they play together live. The server is authoritative — every bid, bury and
play is validated against the rules engine (`game.js`), and each player
only ever receives their own hand.

> **Human multiplayer only — there are no AI players in this server
> version.** Every seat must be filled by a human.

## Quick start

```bash
cd tractor-online
npm install
npm start
```

Then open http://localhost:3000 in your browser.

- **Create Room**: enter your name, pick a table size and a deal speed
  (Instant / Fast / Normal / Slow — how fast the cards are dispatched,
  one at a time) → share the 6-character room code (or the invite link,
  which pre-fills the code).
- **Join Room**: enter your name + the room code.
- If you disconnect, rejoin with the same name + code to reclaim your seat.
- Inactive players get an auto-move after 2 minutes so the game never stalls.
- A players bar pinned at the top of the room shows every player's name in
  seat order (Gold and Blue alternating), highlights the player whose turn
  it is, and tags your own chip with "You".

## How friends join (when you host it)

1. Deploy this app somewhere with a public URL (any Node.js host works;
   the server reads the `PORT` environment variable, default `3000`).
2. Share that URL. One player creates a room and shares the room code.
3. The others open the link, enter their names + the code, and join.
4. Play! The server validates every move and keeps each hand private.

## Rules implemented

- **Tables**: 2v2 / 3v3 / 4v4 / 5v5 (Gold vs Blue). 26 cards each + 6 bottom cards.
- **Bidding** (live during the deal, real-table style): unless the room's
  deal speed is Instant, the cards are dispatched one at a time and you
  may bid **while they arrive**, using the level cards you hold so far;
  a turn-based closing round follows the deal, with the deal's high bid
  carried in. Bid a trump suit with your **level card** — 1 card, or a
  pair (there are no larger bids). A pair bid needs only the pair itself
  — no minimum trump count for human players. A later bid must show more
  cards than the current one: a pair overcalls a single, but a pair
  cannot overcall a pair (first bidder keeps it), so once a pair stands
  no overbid is possible. Who is the 庄家: in the **first round** of a
  match the bid winner is the 庄家 — picks up the 6 bottom cards,
  buries 6, and leads. In **every later round** the 庄家 seat is
  predetermined before the deal by rotation from the previous round's
  result (see Scoring), bidding decides only the trump suit, and the
  predetermined 庄家 picks up the bottom, buries, and leads the first
  trick. If nobody bids at all, **all** the bottom cards are flipped
  one by one and the suit of the **last bottom card** is trump (the
  last suited card before it if that card is a joker; ♠ if the bottom
  holds no suited card at all).
- **Trick play**: tractors (consecutive pairs/triples, incl. the
  high-trump chain — strict and consecutive only, in ascending order
  trump K → trump A → off-suit level → trump-suit level → small joker →
  big joker: adjacent groups and longer chains combining them count,
  while skipping a link never does. With level 7 / spades trump,
  `大王大王+小王小王`, `小王小王+7♠7♠`, `7♠7♠+7♥7♥`, `7♥7♥+A♠A♠`,
  `A♠A♠+K♠K♠` and the full chain count, while `7♠7♠+A♠A♠` and
  `小王小王+A♠A♠` do not. The level rank may be skipped when building
  a tractor of any length — consecutiveness is judged with the level
  rank removed from the sequence, so at level 8, `6+7+9`, `7+9` and
  `7+9+10` are tractors (pairs and triples, in natural suits and in
  trump alike); a tractor crossing the level may instead include the
  level group at face value. A suit's own level pair/triple may also join
  that suit's tractor in its natural rank place as a regular card, at
  face strength — at level 4, `♦3+♦4`, `♦4+♦5` and `♦3+♦4+♦5` are
  diamond tractors, `♦3/♦4/♦5` is weaker than `♦5/♦6/♦7`, and a lone
  `♦4♦4` is still a trump pair);
  mandatory combination-following cascade (triple→triple else pair+padding,
  quad→quad/triple/pair padded); tractor leads cascade too — a pair-tractor
  lead is answered with a pair tractor if held, else 2 separated pairs,
  else 1 pair + padding, else 4 singles (same degradation for longer
  tractors); protected combos are never broken — except that on a pair
  follow (pair lead, or the pair-tractor cascade) a held triple is never
  forced but the follower MAY split it and play 2 of the 3 cards.
- **Unbeatable singles**: 2+ natural singles of one suit, each outranking
  every other player's cards of that suit (teammates included), may be led
  together as a tractor; a void player may kill with an equal number of trumps.
- **Throw (甩牌)**: when leading, a player may throw 2+ units of one type —
  all singles, all pairs, or all triples (never mixed) — of one suit at
  once, even if they are not consecutive (consecutive units form a tractor
  instead). The throw stands only if no other player holds, in that suit,
  a unit of the same type beating the throw's weakest unit (a higher
  single never blocks a pairs throw; a higher pair does). If it is
  blocked, the throw **fails**: the whole room is warned (the message
  never names who blocked it), the cards go back to the thrower's hand,
  a penalty of **10 points per attempted card** is deducted from the
  throwing team's captured points immediately (never below zero), and
  the thrower's next lead must be exactly the throw's weakest unit —
  anything else is rejected with a reminder. Followers answer a throw
  with the same number of cards, following suit and matching its unit
  structure as far as they hold it (pairs answered with pairs, triples
  with triples). A throw is beaten only by a same-structure play whose
  **every** unit beats the corresponding unit of the current best play
  (trump over plain suit by normal precedence); a partial beat never
  takes the trick. Players void in the led suit may trump it.
- **Scoring** (n = decks): defenders win the round at `n×40` points —
  that is the ZhuangJia switch criterion (120 points in a 3-deck game):
  below it the dealer team advances and keeps the deal for the next
  round; the defenders take over the deal only by reaching it. The
  庄家 **seat** rotates with the result: if the 庄家's team won the
  round, the next 庄家 is the next seat on the same team; if it lost,
  the next 庄家 is the immediate next seat (the other team). Scoring
  is always the 庄家's team against the opposing team, regardless of
  who won the bidding.
  抠底: defenders taking the last trick add 2× the buried bottom points.
  Dealer team: +1 level above `n×60` dealer points, +2 when defenders are
  below `n×20`, +3 when defenders score nothing. Defenders advance one
  level per extra `n×20`. Each team keeps its own level; first past level A
  wins the match.
- **House rule**: defender 抠底 with only Jacks (single/pair/triple) resets
  the dealer team to level 2.

## Bidding rules

(The same text is shown on the game's entry screen, so friends can read
it before joining.)

- A bid names the trump suit: show 1 level card of a suit, or a pair of them. If your bid stands when bidding ends, that suit is trump.
- You can bid while the cards are being dealt, using the level cards you have received so far. After the deal there is a final round of bidding, in turn, before the ZhuangJia taking the "Dipai" (底牌).
- Anyone at the table can bid — it doesn't matter whether the player is on the ZhuangJia team or non-ZhuangJia team.
- A later bid must show MORE cards than the bid before it: a pair takes a single, but a pair cannot take a pair — the first bidder keeps it.
- Bidding does not change the ZhuangJia. ZhuangJia will pick up the bottom cards and bury the same number back. The winner of Bidding can be ZhuangJia or non-ZhuangJia.
- If nobody bids at all, all the bottom cards are flipped over one by one — the suit of the last bottom card is trump.

## Simplified vs the single-player app

- Bids are made with the round level card (no free choice of bid rank).
- The bid winner is the 庄家 in the first round only; in later rounds the 庄家 seat rotates by the previous round's result and bidding only sets trump (no human-priority dealer rule).
- No AI players, no bots — all seats are human.
- No "show AI hands" / dealt-cards views (everyone sees only their own hand).

## Tests

```bash
npm test   # 157 tests (node --test): 137 engine tests + 20 server-flow tests
```

## Project layout

```
tractor-online/
  game.js            # pure rules engine (shared, tested)
  server.js          # Express + Socket.io authoritative server
  public/            # browser client (index.html, style.css, app.js)
  test/game.test.js  # engine tests
  test/server.test.js # server-flow tests (failed-throw sequence, dispatch dealing + live bidding, ZhuangJia rotation)
  README.md
  package.json
```
