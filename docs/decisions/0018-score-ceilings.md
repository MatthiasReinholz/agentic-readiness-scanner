# 0018. Scores are capped by the capability that decides whether agents can use the store

Date: 2026-11-03. Status: accepted.

## Context

Each dimension score is a weighted average of its checks. Averages reward breadth: a store with complete product data, identifiers and policies but no checkout an agent can use read 90 for "Agentic commerce: can agents trust and buy?", because the checkout checks carried 10 of 62 commerce weight points. The same arithmetic gave thomann.de 84 and bol.com 78 for ingestion while both challenged every honest agent at the door (Level 0).

A rescan of 16 real stores on 2026-11-03 showed the other side of the problem. Shopify stores whose Agentic storefronts channel is active, so agents can find and buy through UCP, scored 74 to 79 for commerce and sat at Level 2 because products lack GTINs. Stores agents cannot buy from scored as high or higher.

The Level 5 gate had a hole as well: a UCP profile with empty `services` and `payment_handlers` (B5.1 pass) made a store "Transactable".

## Decision

**Ceilings.** The catalog gains `ceilings` (`packages/catalog/data/ceilings.json`). A ceiling names gates in the level sense and a maximum per dimension; while any gate is unmet, the dimension cannot score above it. Two ceilings ship:

- `not-crawlable`: the Level 1 gates (A1.1, A2.2, A2.4, A3.2). Ingestion at most 40, commerce at most 30. Agents that cannot reach or read the site can neither cite nor buy.
- `no-checkout`: one of B5.2 (a UCP profile declaring a checkout capability and a payment handler), B5.3 (an ACP discovery document) or B5.8 (an active Shopify agentic storefront). Commerce at most 60.

The lowest ceiling in force wins. `scores.ceilings` records it with the raw weighted score, the reason and the checks that lift it (limited to what the owner can act on, as `next_gate` is). Every report states the cap next to the score, with the raw score and the lifting checks. Group scores are not capped: they describe a section, not a capability.

**Level 5 uses the same gate.** Transactable now needs B5.2, B5.3 or B5.8, not B5.1. An empty UCP profile no longer counts as a checkout, and the level and the commerce score agree on whether agents can buy.

**Weights follow the gate.** B5.1 (the profile, without which no UCP checkout can be found) and B5.2 (the checkout capability) are weight 3, blocking, so the "What to do" list puts them under "Fix first".

Scoring 0.6.0. `scores.ceilings` is an optional addition; the schema id is unchanged.

## Alternatives considered

- **Score bands per level** (Level 4 maps to 70 to 80, and so on) make the score a restatement of the level. A store that is transactable but lacks GTINs would read lower than one that is not transactable, the opposite of what agents experience.
- **Raising the checkout weights** alone moves a 90 to about 80. Any weight small enough to keep the average meaningful is too small to say "agents cannot buy here".
- **Multipliers** (commerce × 0.7 without a checkout) do the same as a ceiling but are harder to explain in one sentence and still let a weak store read higher than a strong one.
- **Reordering the levels** so that Transactable comes before Identifiable products would match what Shopify stores can do today, but GTINs decide matching in Google's merchant listings and the level ladder is the owner's work order. Revisit when the checkout programmes' requirements settle.

## Consequences

On the 16-store sample, stores without an agent checkout move from 51 to 67 to at most 60, Shopify stores with the channel active stay at 76 to 85, and the two stores that challenge agents drop from 84 and 78 to 40 for ingestion. Monitoring sends a score change for watched stores after the first rescan under scoring 0.6.0; the history records the scoring version so the change is not mistaken for a regression of the store.
