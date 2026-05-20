# 8. Set Operations

In this chapter you'll combine Queries the way SQL's set operators do: UNION ALL (`.concat()`), INTERSECT (`.intersect()`), EXCEPT (`.except()`), plus the row-dedup verb (`.distinctRows()`) that composes the rest into a deduped UNION.

## UNION ALL — `.concat()`

`.concat(other)` appends every row from the other Query to the rows of this one. There's no deduplication; if both sides have the same row, both copies appear in the result.

```ts run
const orderRows = await ordersQ().toArray();
const doubled = await ordersQ().concat(ordersQ()).toArray();
expect(doubled).toHaveLength(orderRows.length * 2);
```

`.union()` is a synonym for `.concat()` — use whichever name reads better in context. For SQL-correct **UNION DISTINCT** semantics (deduped), chain `.distinctRows()` after.

## INTERSECT — `.intersect()`

`.intersect(other)` keeps rows of `this` that also appear in `other`, deduplicated.

```ts run
type Tag = { name: string };
const a: Tag[] = [{ name: 'red' }, { name: 'green' }, { name: 'blue' }, { name: 'red' }];
const b: Tag[] = [{ name: 'green' }, { name: 'yellow' }, { name: 'red' }];
const tagFields = [
	{ key: 'name', label: 'name', type: 'string' as const, getValue: (t: Tag) => t.name },
];

const inBoth = await new Query<Tag>(async () => a, tagFields)
	.intersect(new Query<Tag>(async () => b, tagFields))
	.toArray();
expect(inBoth.map((t) => t.name)).toEqual(['red', 'green']);
```

Things to notice:

- The left's `'red'` appears twice in the input. The output has it **once** — `intersect` deduplicates the result.
- Left-side input order is preserved among the survivors.
- Comparison is **full-row**: two rows match if and only if their canonical JSON forms are identical.

## EXCEPT — `.except()`

`.except(other)` keeps rows of `this` that do not appear in `other`, deduplicated.

```ts run
type Tag = { name: string };
const a: Tag[] = [{ name: 'red' }, { name: 'green' }, { name: 'blue' }, { name: 'red' }];
const b: Tag[] = [{ name: 'green' }];
const tagFields = [
	{ key: 'name', label: 'name', type: 'string' as const, getValue: (t: Tag) => t.name },
];

const onlyInA = await new Query<Tag>(async () => a, tagFields)
	.except(new Query<Tag>(async () => b, tagFields))
	.toArray();
expect(onlyInA.map((t) => t.name)).toEqual(['red', 'blue']);
```

- `'red'` survives once even though it appears twice on the left — same dedup rule as `intersect`.
- `'green'` is gone (present in `b`).
- `'blue'` survives (not in `b`).

> **From SQL:** `INTERSECT` and `EXCEPT` are queriton's spellings of the same SQL operators. Both are **set-semantics** (deduplicated). queriton doesn't ship `INTERSECT ALL` / `EXCEPT ALL` (bag-semantics) variants — they're rare, and `.semijoin()` / `.antijoin()` on a specific key cover the common partial-match cases.

## Row-level dedup — `.distinctRows()`

`.distinctRows()` keeps one row per unique full-row shape. It's the compositional foundation for UNION DISTINCT:

```ts run
type Tag = { name: string };
const a: Tag[] = [{ name: 'red' }, { name: 'green' }];
const b: Tag[] = [{ name: 'green' }, { name: 'blue' }];
const tagFields = [
	{ key: 'name', label: 'name', type: 'string' as const, getValue: (t: Tag) => t.name },
];

const unionDistinct = await new Query<Tag>(async () => a, tagFields)
	.concat(new Query<Tag>(async () => b, tagFields))
	.distinctRows()
	.toArray();
expect(unionDistinct.map((t) => t.name)).toEqual(['red', 'green', 'blue']);
```

Things to notice:

- This is SQL's `UNION` (without `ALL`). `.concat()` produces four rows; `.distinctRows()` collapses the duplicate `green` to one.
- **`.distinctRows()` is not `.distinct()`.** `.distinct(field)` is a terminal verb that returns distinct *values* of a single field as an array; `.distinctRows()` is a row-level dedup that returns a Query.
- Comparison goes through `JSON.stringify`. For queriton's typical "rows from a single loader" use, object-key order is consistent. If you're combining sources with inconsistent key order, `.select()` to a known shape first.

## When to reach for which

| Want | Use |
| --- | --- |
| Append two streams, keep duplicates | `.concat()` (or `.union()`) |
| Append two streams, dedupe | `.concat(other).distinctRows()` |
| Rows in both | `.intersect()` |
| Rows in left, not in right | `.except()` |
| Drop duplicates within one Query | `.distinctRows()` |
| Filter left by membership in right (partial-key match) | `.semijoin(other, leftKey, rightKey)` (chapter 7) |
| Filter left by non-membership in right (partial-key match) | `.antijoin(other, leftKey, rightKey)` (chapter 7) |

The set operations are full-row by design. When you need partial-row equality (e.g. "orders whose customerId exists in customers"), the semi/anti joins from chapter 7 are the right tool.

In the next chapter we'll meet the DataSet — queriton's named-collection container.
