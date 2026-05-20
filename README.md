# queriton

TDR: A lazy, typed pipeline-of-verb-steps query API for in-memory JSON-shaped
collections. 

SUMMARY: dplyr-style verbs (`filter`, `sort`, `summarize`, `join`,
`unroll`, `derive`, …) build up a `Step[]` that's executed on demand
when you materialise the `Query`.

## Installing into your code

queriton is currently published to **GitHub Packages**, not the public
npm registry. Add this to your project's `.npmrc`:

```
@thesevenpens:registry=https://npm.pkg.github.com
```

You'll also need to be authenticated to GitHub Packages. For local
development, a personal access token with `read:packages` scope works:

```
//npm.pkg.github.com/:_authToken=YOUR_PAT
```

In CI, `secrets.GITHUB_TOKEN` (added to `.npmrc` via the standard
[setup-node action](https://github.com/actions/setup-node#use-private-packages))
is sufficient.

Then:

```bash
npm install @thesevenpens/queriton
```

```ts
import { Query, DataSet, type Loader, type AnyFieldDef } from '@thesevenpens/queriton';
```

Public npmjs.org release is tracked at [DrawTab #143](https://github.com/TheSevenPens/DrawTabDataExplorer/issues/143)
(deferred to 2027).

## Tutorial

A 10-chapter narrative introduction lives at [docs/tutorial/](docs/tutorial/README.md).
Every code block in the tutorial is extracted and run as part of the
test suite, so what you read is what works.

## Minimal example

Register a collection on a `DataSet`, run a query, materialise it.

```ts
import { DataSet, type AnyFieldDef } from '@thesevenpens/queriton';

interface Car {
	model: string;
	mpg: number;
	cyl: number;
}

const carFields: AnyFieldDef[] = [
	{ key: 'model', label: 'Model', type: 'string', group: 'data', getValue: (c: Car) => c.model },
	{ key: 'mpg', label: 'MPG', type: 'number', group: 'data', getValue: (c: Car) => String(c.mpg) },
	{ key: 'cyl', label: 'Cyl', type: 'number', group: 'data', getValue: (c: Car) => String(c.cyl) },
];

const ds = new DataSet();
ds.registerCollection<Car>('cars', async () => fetchCarsFromSomewhere(), carFields);

const topMpg = await ds
	.get<Car>('cars')
	.filter('cyl', '==', 4)
	.sort('mpg', 'desc')
	.take(3)
	.toArray();
```

The `load` function is invoked at most once per `DataSet` instance —
every `Query.toArray()` call against the same name reuses the cached
Promise.

## The verb set

- **Filter** — `.filter(field, op, value)`, `.filter(predicateFn)`, `.filter(boolExpr)`, `.filterIn(field, values)`, `.filterNotIn(field, values)`
- **Sort** — `.sort(field, direction?)`, `.sort([{field, direction?}, …])` (primary-first)
- **Pagination** — `.take(n)`, `.skip(n)`, `.last(n)`, `.reverse()`
- **Project** — `.select([fields])`
- **Compute** — `.derive({col: row => …})`
- **Group / aggregate** — `.summarize({by, count, sum, avg, min, max, median, distinctCount, first, last, collect})`
- **Distinct** — `.distinct(field)` / `.values(field)` (synonym)
- **Joins** — `.join(other, leftKey, rightKey)`, `.semijoin`, `.antijoin`, `.leftjoin`
- **Combine** — `.concat(other)` / `.union(other)` (synonym)
- **Unroll arrays** — `.unroll(field)`
- **Materialise** — `.toArray()`, `.find(predicateFn)`, `.count()`, `.keyBy(field)`, `.collectBy(field)`
- **Introspect** — `.toSteps()` returns the `Step[]` that the pipeline will execute (canonical hook for saved views / URL state)

### Filter operators

`==` · `!=` · `contains` · `notcontains` · `startswith` · `notstartswith`
· `containsStrict` · `notcontainsStrict` · `startswithStrict` ·
`notstartswithStrict` · `empty` · `notempty` · `>` · `>=` · `<` · `<=` ·
`in` (pipe-separated values) · `notin` · `between` (`'lo|hi'`,
inclusive).

`contains` / `startswith` are case-insensitive; the `Strict` variants
preserve case.

## SummaryRow widening

After `.summarize(…)` or `.select([…])`, the row shape becomes
`SummaryRow`:

```ts
type SummaryRow = Record<string, string | number | string[]>;
```

So `Query<T>` becomes `Query<SummaryRow>` and downstream verbs read
columns by name as opaque keys. This is a deliberate loosening — the
shape change is what makes "summarize then sort by the count column" a
chainable one-liner — but it does mean you trade compile-time field
narrowing for runtime flexibility at the summarize boundary.

## Null handling

Every documented null behaviour is pinned in
[`test/nulls.test.ts`](./test/nulls.test.ts). The headlines:

- `empty` / `notempty` match missing / undefined / `""`. `==` with
  refValue `""` matches null/missing fields (both stringify to `""`).
- Numeric operators (`>`, `>=`, `<`, `<=`, `between`) **exclude** null
  values (the engine short-circuits on `val === ''`).
- Sort places null values **first** in ascending order, **last** in
  descending order (`""` is the smallest string in `localeCompare`).
- `count` includes null rows; `sum` / `avg` / `min` / `max` / `median`
  skip them; `distinctCount` skips them; `first` / `last` / `collect`
  **include** them as `""` entries.
- `.distinct()`, `.keyBy()`, `.collectBy()` skip null keys.
- **Joins treat null keys as equal** — two rows with missing join keys
  will pair up. This is opposite of SQL's `NULL != NULL`. Deliberate
  design choice, pinned in tests; revisit behind an option if it bites.
- `.unroll()` on a null / non-array value passes the row through; on
  `[]` drops it; on `[null, …]` the null element survives as its own
  emitted row.

## A note on `FieldDef`

`FieldDef<T>` is the contract queriton uses to read values out of your
records (`getValue`) and present them in filter UIs (`type`,
`enumValues`, `label`). It also carries a few hooks that are really
display affordances — `getDisplayValue`, `getHref`, `group`. Non-UI
consumers can ignore them; a future split into a thinner core type plus
a `FieldDisplayDef` extension is tracked in
[#142](https://github.com/TheSevenPens/DrawTabDataExplorer/issues/142).

## Plan rewrites

Before execution, `Query.toArray()` runs the `Step[]` through a small
plan-rewrite pass that does four safe local optimizations:

- `sort(f, dir).take(n)` → a single `topK` step (stable bounded top-K
  reads each row once instead of fully sorting)
- adjacent `filter(...)` steps → one `boolFilter` with an `and` tree
  (one row-visit instead of N)
- `take(a).take(b)` → `take(min(a, b))`; `skip(a).skip(b)` → `skip(a+b)`
- `reverse().reverse()` and `skip(0)` → dropped; redundant adjacent
  sort on the same field/direction → first one dropped

The rewritten plan is what the engine sees; `.toSteps()` still returns
the user-authored pre-rewrite plan (which is what saved-view
persistence and URL state want). Disable the pass for debugging via:

```ts
import { rewriteConfig } from '@thesevenpens/queriton';
rewriteConfig.enabled = false;
```

The test suite runs each rewrite both ways (with and without) to pin
result-equivalence.

## Running the tests

The 227-test suite is filesystem- and network-free:

```bash
npm install
npm test
```

The fixtures live under [`test/fixtures/`](./test/fixtures/):

- `mtcars.ts` — classic 32 × 11 dataset; drives most verb coverage
- `penguins.ts` — Palmer Penguins (344 rows, naturally-occurring nulls)
- `orders-customers.ts` — 6 + 4 rows for the four join variants
- `people-hobbies.ts` — array column for `.unroll()`
- `with-nulls.ts` — 8-row null-handling fixture

The tutorial under [`docs/tutorial/`](./docs/tutorial/README.md) also
contributes 50 snippet tests via `scripts/build-tutorial-tests.mjs`,
which extracts every ` ```ts run ` block at test time.

## License

ISC.
