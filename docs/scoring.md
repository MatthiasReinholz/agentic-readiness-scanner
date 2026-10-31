# Scoring

Two scores from 0 to 100, one per dimension, plus a readiness level that is gated rather than averaged. A merchant should never see a 72 and not know what it means.

## Scores

For each dimension: sum of weights of passed checks ÷ sum of weights of applicable checks × 100, rounded. A warn counts half. Skipped checks (not applicable to the profile or platform, dependent on a failed parent, not implemented, or cut off by the budget) drop out of the denominator, so a store is never punished for a check that did not run. Checks with weight `info` are reported, never scored.

The commerce score is `null` for profiles without the commerce dimension.

The same formula is applied per catalog group and carried as `scores.groups` (keyed by group id, `null` when no check in the group applied). Reports show it as a score per section so a merchant can see at a glance which area needs work; the dimension scores remain the headline numbers.

## Levels

Levels are gates. A level holds only when every gate of that level is satisfied, and a gate is satisfied when one of its alternatives passed. The one exception: a gate whose alternatives all do not apply to the profile is satisfied, so a content site is not held back by product-only gates. Checks skipped for any other reason block the gate.

| Level | Name                  | Gate                                   |
| ----- | --------------------- | -------------------------------------- |
| 0     | Not reachable         | default                                |
| 1     | Crawlable             | A1.1, A2.2, A3.2                       |
| 2     | Readable catalog      | Level 1 and (B1.2 or B1.5), B2.1, B2.2 |
| 3     | Identifiable products | Level 2 and B3.1, B3.2, B3.6           |
| 4     | Trusted merchant      | Level 3 and B4.1, B4.2, B4.3           |
| 5     | Transactable          | Level 4 and (B5.1 or B5.3)             |

Each profile declares a maximum level: content sites stop at 1. The report leads with the level and `next_gate`, the ids standing between the store and the next level.

A gate whose check is not implemented yet blocks the level, by design: the scanner never awards a level it could not verify. While B3.6 and both B5 alternatives are unimplemented, the highest level any store can reach is 2; the README states the current ceiling.

## Profiles

| Profile           | Applies                                                  | Max level |
| ----------------- | -------------------------------------------------------- | --------- |
| WooCommerce store | all checks                                               | 5         |
| Other store       | all except checks that require the WooCommerce Store API | 5         |
| Content site      | ingestion checks only                                    | 1         |

The profile is detected (WooCommerce markers, Shopify markers, store signals such as product URLs or add-to-cart links) and can be overridden.

## Versions

The catalog version changes whenever a check, weight, dependency or fix changes. The scoring version changes whenever weights, levels or the formulas change. Both are recorded in every result so two reports can be compared, and a spec change becomes a catalog release rather than a silent score shift.

## What a score does not say

A high commerce score means the public surface is in order. It does not say Merchant Center approved the products or that a checkout works. The report says so above the commerce section, and Level 5 is named Transactable, not Approved.
