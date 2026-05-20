# 4. Arrays and CSV Fields

In this chapter you'll work with rows whose columns hold lists of values — both as proper arrays and as comma-separated strings. queriton has three core moves: read the array as a value, explode it with `.unroll()`, and re-collect with `.summarize()`.

## The fixture

The examples use a small fixture — five people with hobby lists — already included in the queriton tests:

| name    | hobbies                       |
| ------- | ----------------------------- |
| Alice   | `['climbing', 'coding', 'tea']` |
| Bob     | `['climbing', 'biking']`        |
| Charlie | `[]`                            |
| Dana    | `['coding']`                    |
| Eve     | `null`                          |

`hobbies` is `string[] | null`. The `peopleQ()` helper wraps it in a Query the same way `penguinsQ()` does for penguins.

## Reading array fields as strings

A FieldDef's `getValue` returns a string, so the conventional way to expose an array column is to join the elements:

```ts
{
	key: 'hobbies',
	type: 'string',
	getValue: (p: Person) => Array.isArray(p.hobbies) ? p.hobbies.join(',') : '',
}
```

That makes substring filters and natural sorts work for free:

```ts run
const climbers = await peopleQ().filter('hobbies', 'contains', 'climbing').toArray();
expect(climbers.map((p) => p.name).sort()).toEqual(['Alice', 'Bob']);
```

Things to notice:

- The match is **substring**, not array-membership. `contains 'tea'` would also match `'teacher'`. For exact element-of-array tests, use a predicate filter — `.filter((p) => p.hobbies?.includes('climbing'))`.
- Predicate filters aren't URL-serialisable (chapter 2 covered the tradeoff).
- The `startswith` and `sort` operators work too, but they operate on the _joined_ string, not on individual elements.

## Exploding arrays with `.unroll()`

`.unroll(field)` turns a column of arrays into one row per element:

```ts run
const exploded = await peopleQ().unroll('hobbies').toArray();
expect(exploded).toHaveLength(7);
```

Things to notice:

- Five input rows → seven output rows. Alice's three hobbies become three rows; Bob's two become two; Dana's one stays one.
- **Charlie is dropped.** An empty array emits zero rows — same as dplyr's `unnest` and Arquero's `unroll`.
- **Eve passes through unchanged.** Her `hobbies` is `null` (not an array). queriton interprets non-array values as "leave the row alone." If you want her dropped too, chain `.dropNulls('hobbies')` first.
- **The cell value changes type.** Pre-unroll, `row.hobbies` is `string[] | null`. Post-unroll, it's `string`. queriton replaces the column with the element.

Combine with `.countBy()` for the classic "tag-count" pattern. Drop Eve's null-row first so the count buckets contain only real hobbies:

```ts run
const popularity = await peopleQ().dropNulls('hobbies').unroll('hobbies').countBy('hobbies').toArray();
expect(popularity).toEqual([
	{ hobbies: 'climbing', count: 2 },
	{ hobbies: 'coding', count: 2 },
	{ hobbies: 'tea', count: 1 },
	{ hobbies: 'biking', count: 1 },
]);
```

Without `.dropNulls()`, Eve's null `hobbies` would pass through unroll unchanged and contribute an extra `{ hobbies: '', count: 1 }` bucket — useful sometimes (you genuinely care about "how many records have no value"), but usually you want it dropped.

This is the SQL `UNNEST … GROUP BY` pattern, condensed into one chain.

> **From SQL:** `UNNEST` is the closest analogue. queriton's version drops empty-array rows by default (SQL `UNNEST` keeps them as NULL); chain `.leftjoin()` against the original if you need them back.
>
> **From dplyr:** `tidyr::unnest_longer(hobbies)`.

## When the source is a CSV string

Not every dataset arrives with proper arrays. Sometimes the column is a single string like `"climbing,coding,tea"`. Pass `{ sep }` to `.unroll()` and queriton splits the string for you:

```ts run
type CsvPerson = { name: string; hobbies: string };
const csvRows: CsvPerson[] = [
	{ name: 'Alice', hobbies: 'climbing,coding,tea' },
	{ name: 'Bob', hobbies: 'climbing,biking' },
	{ name: 'Charlie', hobbies: '' },
	{ name: 'Dana', hobbies: 'coding' },
];
const csvFields = [
	{ key: 'name', label: 'name', type: 'string' as const, getValue: (r: CsvPerson) => r.name },
	{
		key: 'hobbies',
		label: 'hobbies',
		type: 'string' as const,
		getValue: (r: CsvPerson) => r.hobbies,
	},
];

const exploded = await new Query<CsvPerson>(async () => csvRows, csvFields)
	.unroll('hobbies', { sep: ',' })
	.toArray();
expect(exploded).toHaveLength(6);
expect(exploded.filter((r) => r.name === 'Charlie')).toHaveLength(0);
```

Things to notice:

- queriton drops empty-string elements automatically. `''.split(',')` returns `['']` (a one-element array containing the empty string), which would otherwise emit a phantom row per input row — Charlie would appear with `hobbies=''`, and a trailing comma in `"climbing,coding,"` would produce an empty-third-element row. The defensive `.filter(Boolean)` from older code is built in.
- The cell type changes the same way as the array form: pre-unroll, `hobbies` is the CSV string; post-unroll, it's a single element.
- Non-string values (e.g. `null`) fall through to the passthrough rule, same as a non-array cell in the no-`sep` form.

## Lenient splitting

Real CSV-like data often has whitespace around tokens (`"climbing, coding, tea"`) or uses other separators (`;`, `|`, tabs). If a single string-separator isn't enough, derive a real array first via a regex split, then `.unroll()` without `sep`:

```ts run
type LenientRow = { name: string; tags: string };
const lenient: LenientRow[] = [
	{ name: 'A', tags: 'red, green , blue' }, // commas with whitespace
];
const lenientFields = [
	{ key: 'name', label: 'name', type: 'string' as const, getValue: (r: LenientRow) => r.name },
	{ key: 'tags', label: 'tags', type: 'string' as const, getValue: (r: LenientRow) => r.tags },
];

const result = await new Query<LenientRow>(async () => lenient, lenientFields)
	.derive({ tagList: (r) => r.tags.split(/\s*,\s*/).filter(Boolean) })
	.unroll('tagList')
	.toArray();
expect(result.map((r) => r.tagList)).toEqual(['red', 'green', 'blue']);
```

Things to notice:

- `.derive()` accepts array returns natively — no cast needed. The widened return type also covers `number` and the existing `string`.
- For real CSV with quoted-embedded-commas (`"rock, paper, scissors"` as a single hobby), use a real CSV parser at the loader layer. queriton's job stops at "give me clean fields"; CSV parsing belongs upstream of the Query.

## Round-trip: split → manipulate → rejoin

The full pattern when you want to keep the CSV-string output shape but mutate the contents: explode with `unroll(sep)`, change the elements like any other rows, then rejoin with the `join` aggregator:

```ts run
type CsvPerson = { name: string; hobbies: string };
const csvRows: CsvPerson[] = [
	{ name: 'Alice', hobbies: 'climbing,coding,tea' },
	{ name: 'Bob', hobbies: 'climbing,biking' },
	{ name: 'Dana', hobbies: 'coding' },
];
const csvFields = [
	{ key: 'name', label: 'name', type: 'string' as const, getValue: (r: CsvPerson) => r.name },
	{
		key: 'hobbies',
		label: 'hobbies',
		type: 'string' as const,
		getValue: (r: CsvPerson) => r.hobbies,
	},
];

const cleaned = await new Query<CsvPerson>(async () => csvRows, csvFields)
	.unroll('hobbies', { sep: ',' })
	.filter('hobbies', '!=', 'tea')
	.summarize({ by: 'name', join: { hobbies: { field: 'hobbies', sep: ',' } } })
	.sort('name', 'asc')
	.toArray();
expect(cleaned).toEqual([
	{ name: 'Alice', hobbies: 'climbing,coding' },
	{ name: 'Bob', hobbies: 'climbing,biking' },
	{ name: 'Dana', hobbies: 'coding' },
]);
```

Three chain steps. No casts. No defensive boilerplate. The middle of the chain (`.filter('hobbies', '!=', 'tea')`) operates on individual hobby rows like any other Query.

The `join` aggregator is the string-producing counterpart to `collect` from chapter 5. Where `collect` returns an array, `join` joins those values with a separator. Empty/null members are included as `""` — same rule as `collect` — so `"x,,y"` after a join means the middle row had a null/empty value for that field.

## What queriton doesn't do with arrays

For comparison with what other query languages offer:

- **No first-class `Map<K, V>` type.** Store key-value collections as objects; surface specific keys with `.derive()`.
- **No array indexing in the filter operator language.** You can't write `.filter('hobbies[0]', '==', 'climbing')`. Use a predicate filter, or `.derive` a scalar first.
- **No nested unroll in one step.** If a row has an array of objects each containing an inner array, `.derive` the inner array onto the top level first, then `.unroll`.

In the next chapter we'll meet `.summarize()` properly — including the `collect` aggregator that's `join`'s array-shaped sibling.
