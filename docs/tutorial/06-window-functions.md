# 6. Window Functions

In this chapter you'll meet `.window()` — per-row computations over a partition of related rows. Unlike `.summarize()`, it keeps every input row and adds columns; unlike `.derive()`, it can reference other rows in the same partition.

## The killer use case: top N per group

"Heaviest three penguins per species" is awkward without window functions — you'd have to roll your own bookkeeping with `derive` and grouping. With window ranking it's two chained calls:

```ts run
const heaviest3 = await penguinsQ()
	.dropNulls('body_mass_g')
	.window({
		partitionBy: 'species',
		orderBy: { field: 'body_mass_g', direction: 'desc' },
		rowNumber: 'rank',
	})
	.filter('rank', '<=', 3)
	.sort([
		{ field: 'species', direction: 'asc' },
		{ field: 'rank', direction: 'asc' },
	])
	.toArray();
expect(heaviest3).toHaveLength(9); // 3 per species × 3 species
expect(heaviest3[0]).toMatchObject({ species: 'Adelie', rank: 1, body_mass_g: 4775 });
// Gentoo top is the overall heaviest at 6300g.
const topGentoo = heaviest3.find((p) => p.species === 'Gentoo' && p.rank === 1);
expect(topGentoo?.body_mass_g).toBe(6300);
```

Things to notice:

- **`partitionBy` defines the group.** Each species gets its own ranking — Adelie ranks 1-3 are different rows from Chinstrap ranks 1-3.
- **`orderBy` defines the order within partition.** Descending body mass gives heaviest-first.
- **`rowNumber: 'rank'` adds a new column** called `rank`. The Query's row type widens to include it; the subsequent `.filter('rank', '<=', 3)` reads it like any other column.
- **Input row order is preserved by `.window()`** — I added the explicit `.sort()` at the end so the assertion above is stable. Without it, the output is in the original input row order with the rank column attached.

## Ranking variants — `rowNumber`, `rank`, `denseRank`

Three different "how to number tied values" semantics:

| Verb | Behaviour on ties (10, 10, 8, 5) |
| --- | --- |
| `rowNumber` | 1, 2, 3, 4 — sequential; ties broken by input order |
| `rank` | 1, 1, 3, 4 — ties share the rank; next rank skips |
| `denseRank` | 1, 1, 2, 3 — ties share the rank; next rank doesn't skip |

```ts run
// Toy fixture so the comparison is exact.
type Score = { group: string; player: string; score: number };
const scores: Score[] = [
	{ group: 'A', player: 'a1', score: 10 },
	{ group: 'A', player: 'a2', score: 10 },
	{ group: 'A', player: 'a3', score: 8 },
	{ group: 'A', player: 'a4', score: 5 },
];
const scoreFields = [
	{ key: 'group', label: 'g', type: 'string' as const, getValue: (r: Score) => r.group },
	{ key: 'player', label: 'p', type: 'string' as const, getValue: (r: Score) => r.player },
	{ key: 'score', label: 's', type: 'number' as const, getValue: (r: Score) => String(r.score) },
];
const ranked = await new Query<Score>(async () => scores, scoreFields)
	.window({
		partitionBy: 'group',
		orderBy: { field: 'score', direction: 'desc' },
		rowNumber: 'rn',
		rank: 'r',
		denseRank: 'dr',
	})
	.toArray();
expect(ranked.map((r) => r.rn)).toEqual([1, 2, 3, 4]);
expect(ranked.map((r) => r.r)).toEqual([1, 1, 3, 4]);
expect(ranked.map((r) => r.dr)).toEqual([1, 1, 2, 3]);
```

> **From SQL:** these are `ROW_NUMBER() OVER (PARTITION BY ... ORDER BY ...)`, `RANK()`, `DENSE_RANK()`. Same semantics, lower-case method form.

## Running aggregates — cumulative within partition

`runningSum`, `runningAvg`, `runningMin`, `runningMax`, `runningCount` each accumulate over the partition in `orderBy` order. They include rows up to and including the current row — matching SQL's default `ROWS UNBOUNDED PRECEDING`.

```ts run
const cumulative = await penguinsQ()
	.dropNulls('body_mass_g')
	.filter('species', '==', 'Gentoo')
	.window({
		orderBy: 'body_mass_g',
		runningSum: { cumMass: 'body_mass_g' },
		runningCount: 'n',
	})
	.sort('body_mass_g', 'asc')
	.toArray();
// First row: lightest Gentoo at 3950g; cumMass = 3950, n = 1.
expect(cumulative[0].body_mass_g).toBe(3950);
expect(cumulative[0].cumMass).toBe(3950);
expect(cumulative[0].n).toBe(1);
// Last row's cumMass is the total Gentoo mass.
expect(cumulative[cumulative.length - 1].body_mass_g).toBe(6300);
```

Things to notice:

- **No `partitionBy` means one global partition.** All non-null-mass Gentoos accumulate as a single running total.
- **The `.sort()` at the end** sorts the *output* — the window step already ordered the partition internally, but `.window()` preserves input order, so the rows come back in their original order with the cumulative columns attached. Sort if you want the output ordered by the same key.
- **Running aggregates skip null/non-numeric values** for the aggregate but advance the rowCount. Same rule as `summarize`'s aggregators.

## Offsets — `lag` and `lead`

Read the previous (`lag`) or next (`lead`) row's value in the partition. Common for diffing consecutive measurements.

```ts run
type TimeSeries = { day: number; temp: number };
const measurements: TimeSeries[] = [
	{ day: 1, temp: 20 },
	{ day: 2, temp: 22 },
	{ day: 3, temp: 21 },
	{ day: 4, temp: 25 },
];
const tsFields = [
	{ key: 'day', label: 'd', type: 'number' as const, getValue: (r: TimeSeries) => String(r.day) },
	{ key: 'temp', label: 't', type: 'number' as const, getValue: (r: TimeSeries) => String(r.temp) },
];

const withLag = await new Query<TimeSeries>(async () => measurements, tsFields)
	.window({
		orderBy: 'day',
		lag: { yesterday: { field: 'temp', default: '0' } },
		lead: { tomorrow: 'temp' },
	})
	.toArray();
// Day 1 has no yesterday → default '0'. Day 4 has no tomorrow → '' (no default given).
expect(withLag[0]).toMatchObject({ day: 1, yesterday: '0', tomorrow: '22' });
expect(withLag[1]).toMatchObject({ day: 2, yesterday: '20', tomorrow: '21' });
expect(withLag[3]).toMatchObject({ day: 4, yesterday: '21', tomorrow: '' });
```

Things to notice:

- **Short form `lag: { name: 'fieldKey' }`** uses offset 1 and empty-string default.
- **Long form `lag: { name: { field, offset?, default? } }`** lets you reach further back or substitute a sentinel value.
- **Out-of-range values are `""` by default.** Use the `default` option to substitute (here `'0'` for missing yesterday, useful for taking diffs without conditional logic).
- **Returned values are strings** — they come through the field's `getValue`. Convert with `Number()` if you need to do arithmetic in a follow-up `.derive()`.

## Boundary — `firstValue` and `lastValue`

The first/last row's value in the partition. Useful for "value relative to group start/end" computations.

```ts run
const withBoundary = await penguinsQ()
	.dropNulls('body_mass_g')
	.window({
		partitionBy: 'species',
		orderBy: { field: 'body_mass_g', direction: 'desc' },
		firstValue: { heaviest: 'body_mass_g' },
		lastValue: { lightest: 'body_mass_g' },
	})
	.filter('species', '==', 'Gentoo')
	.take(1)
	.toArray();
// Every Gentoo row sees the same heaviest/lightest values:
expect(withBoundary[0].heaviest).toBe('6300');
expect(withBoundary[0].lightest).toBe('3950');
```

`firstValue` / `lastValue` don't strictly require `orderBy` — without one, they read the first/last row of the partition in input order. Pairing them with `orderBy` gives "highest" / "lowest" semantics for free.

## Summary table

| Verb | Returns | Needs orderBy? | Use case |
| --- | --- | --- | --- |
| `rowNumber` | sequential int | yes | Top N per group, stable numbering |
| `rank` | int (ties share) | yes | Olympic-style ranking with gaps |
| `denseRank` | int (ties share, no gaps) | yes | Tier-style ranking |
| `runningSum` / `runningAvg` / `runningMin` / `runningMax` | number | yes | Cumulative metrics |
| `runningCount` | int | optional | Position counter |
| `lag` / `lead` | string | yes | Diff vs prev/next |
| `firstValue` / `lastValue` | string | optional | Value at partition endpoint |

## What's not implemented

queriton's v1 window-function surface covers the common cases. The deferred functions, in case you need them:

| Deferred | Workaround |
| --- | --- |
| `ntile(N)` | Compute `rowNumber`, then `.derive({ tile: (r) => Math.ceil((r.rn as number) * N / partitionSize) })` — but you need the partition size. Easier: `.summarize({ by: 'group', count: 'n' })` first to get sizes, then `.leftjoin` and derive. |
| `percentRank` / `cumeDist` | Same flavour — derive from `rowNumber` + partition size. |
| `percentileCont` / `percentileDisc` | For now use `.summarize({ by: 'group', median: ... })` if percentile 50; for other percentiles, sort the partition and pick by index in a `.derive()`. |
| `nthValue(n)` | Combine `rowNumber` with a self-`leftjoin` on `(group, rowNumber=n)`. |
| Custom frames (`ROWS BETWEEN ... AND ...`) | Not yet — `runningSum` and friends use the default `ROWS UNBOUNDED PRECEDING`. |

If your use case ends up at "I'm reaching for `ntile` constantly," file an issue — the implementation is straightforward and the API can match the SQL form (`ntile(n)` as a spec entry alongside `rowNumber`).

In the next chapter we'll pin down exactly what happens when those summarize aggregators meet null values.
