// --- Step types ---

export type StepKind =
	| 'filter'
	| 'sort'
	| 'select'
	| 'take'
	| 'skip'
	| 'last'
	| 'reverse'
	| 'summarize'
	| 'project'
	| 'predicate'
	| 'boolFilter'
	| 'derive'
	| 'unroll'
	| 'join'
	| 'joinResolved'
	| 'semijoin'
	| 'semijoinResolved'
	| 'antijoin'
	| 'antijoinResolved'
	| 'leftjoin'
	| 'leftjoinResolved'
	| 'concat'
	| 'concatResolved'
	| 'intersect'
	| 'intersectResolved'
	| 'except'
	| 'exceptResolved'
	| 'distinctRows'
	| 'window'
	| 'topK';

export interface FilterStep {
	kind: 'filter';
	field: string;
	operator: string;
	value: string;
}

export interface SortStep {
	kind: 'sort';
	field: string;
	direction: 'asc' | 'desc';
}

export interface SelectStep {
	kind: 'select';
	fields: string[];
}

export interface TakeStep {
	kind: 'take';
	count: number;
}

export interface SkipStep {
	kind: 'skip';
	count: number;
}

export interface LastStep {
	kind: 'last';
	count: number;
}

export interface ReverseStep {
	kind: 'reverse';
}

/**
 * An aggregator that consumes the items of a group and produces a value.
 *
 * - `count` — group row count; ignores `field`.
 * - `sum` / `avg` / `min` / `max` / `median` — numeric reductions over
 *   `field`; empties and non-numeric values are skipped.
 * - `distinctCount` — count of distinct non-empty values of `field`.
 * - `first` / `last` — raw value of `field` from the first / last item in
 *   input order (including empty strings).
 * - `collect` — array of all raw `field` values in input order
 *   (including empties).
 * - `join` — string of all raw `field` values joined by `sep` (including
 *   empties). The string equivalent of `collect`; useful for round-tripping
 *   CSV-like fields without a follow-up `.derive()`.
 */
export type AggregatorOp =
	| 'count'
	| 'countIf'
	| 'sum'
	| 'avg'
	| 'min'
	| 'max'
	| 'median'
	| 'first'
	| 'last'
	| 'distinctCount'
	| 'collect'
	| 'join';

export interface AggregatorSpec {
	/** Output column name in the summary rows. */
	name: string;
	op: AggregatorOp;
	/** Field key to read; ignored when op is "count" or "countIf". */
	field?: string;
	/**
	 * For op='countIf': predicate function. Not serialisable — pipelines
	 * persisted to URL/localStorage drop the aggregator.
	 */
	predicate?: (item: unknown) => boolean;
	/** For op='countIf': boolean filter tree (URL-serialisable form). */
	filterExpr?: FilterExpr;
	/** For op='join': string separator inserted between collected values. */
	sep?: string;
}

/**
 * Reduces the input items to one row per distinct combination of `groupBy`
 * field values. Each row has one column per groupBy field plus one column
 * per aggregator (named by `AggregatorSpec.name`). After a summarize step,
 * subsequent filter/sort/take operate on the synthetic summary rows, not
 * the original entities.
 */
export interface SummarizeStep {
	kind: 'summarize';
	groupBy: string[];
	aggs: AggregatorSpec[];
}

/**
 * Projects each row into an object with only the requested fields, reading
 * values via the active field-defs. Unknown fields degrade to empty
 * strings. Distinct from `SelectStep`, which only tags visible columns in
 * UI metadata and does not transform the row shape.
 */
export interface ProjectStep {
	kind: 'project';
	fields: string[];
}

/**
 * Runs an arbitrary predicate function against each row. Not serialisable
 * — these steps are dropped by URL state / saved views.
 */
export interface PredicateStep {
	kind: 'predicate';
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	fn: (item: any) => boolean;
}

/**
 * A boolean expression tree over field/op/value leaves. Used by
 * `BoolFilterStep` to support OR / NOT / nested combinations that the
 * flat AND-chain of `.filter(field, op, value)` cannot express.
 */
export type FilterExpr =
	| { field: string; op: string; value: string }
	| { and: FilterExpr[] }
	| { or: FilterExpr[] }
	| { not: FilterExpr };

export interface BoolFilterStep {
	kind: 'boolFilter';
	expr: FilterExpr;
}

/**
 * Adds computed columns to each row via user-supplied functions. Like
 * `predicate`, not serialisable. The engine performs a shallow clone per
 * row and attaches the derived keys; downstream field-defs are appended.
 */
export interface DeriveStep {
	kind: 'derive';
	// Allow array returns so the common `.derive(...).unroll(...)` pattern
	// composes without a cast. The engine already supports array values at
	// runtime; the type just under-promised before.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	cols: Record<string, (item: any) => string | number | readonly unknown[]>;
}

/**
 * Construction-time join step. `other` is the right-hand Query whose
 * rows will be materialised by `Query.toArray()` and replaced with a
 * `joinResolved` step before the synchronous engine runs.
 */
export interface JoinStep {
	kind: 'join';
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	other: unknown; // Query<unknown> — typed loosely to avoid a circular import.
	leftKey: string;
	rightKey: string;
}

export interface JoinResolvedStep {
	kind: 'joinResolved';
	leftKey: string;
	rightKey: string;
	rightRows: unknown[];
	rightFields: FieldDef<unknown>[];
}

export interface SemijoinStep {
	kind: 'semijoin';
	other: unknown;
	leftKey: string;
	rightKey: string;
}

export interface SemijoinResolvedStep {
	kind: 'semijoinResolved';
	leftKey: string;
	rightKey: string;
	rightRows: unknown[];
	rightFields: FieldDef<unknown>[];
}

/**
 * Anti-join: keeps left rows that have NO match on the right. Inverse of
 * semijoin. Right side resolved at `Query.toArray()` time.
 */
export interface AntijoinStep {
	kind: 'antijoin';
	other: unknown;
	leftKey: string;
	rightKey: string;
}

export interface AntijoinResolvedStep {
	kind: 'antijoinResolved';
	leftKey: string;
	rightKey: string;
	rightRows: unknown[];
	rightFields: FieldDef<unknown>[];
}

/**
 * Left-join: keeps all left rows. Rows with a match are merged with the
 * right-side columns; rows without a match pass through unchanged.
 */
export interface LeftjoinStep {
	kind: 'leftjoin';
	other: unknown;
	leftKey: string;
	rightKey: string;
}

export interface LeftjoinResolvedStep {
	kind: 'leftjoinResolved';
	leftKey: string;
	rightKey: string;
	rightRows: unknown[];
	rightFields: FieldDef<unknown>[];
}

/**
 * Appends rows from another Query (UNION ALL — no deduplication). Active
 * field-defs are merged with right-side defs; first-defined-key wins.
 */
export interface ConcatStep {
	kind: 'concat';
	other: unknown;
}

export interface ConcatResolvedStep {
	kind: 'concatResolved';
	rightRows: unknown[];
	rightFields: FieldDef<unknown>[];
}

/**
 * INTERSECT — set-semantics intersection. Keeps rows of `this` that
 * also appear in `other`, deduplicated. Comparison is full-row via a
 * canonical JSON form (`JSON.stringify`), which is sensitive to
 * object-key order; callers who need a custom comparison should
 * `.select()` to a consistent shape first.
 */
export interface IntersectStep {
	kind: 'intersect';
	other: unknown;
}

export interface IntersectResolvedStep {
	kind: 'intersectResolved';
	rightRows: unknown[];
}

/**
 * EXCEPT — set-semantics difference. Keeps rows of `this` that do
 * not appear in `other`, deduplicated. Same comparison rule as
 * `intersect`.
 */
export interface ExceptStep {
	kind: 'except';
	other: unknown;
}

export interface ExceptResolvedStep {
	kind: 'exceptResolved';
	rightRows: unknown[];
}

/**
 * Row-level deduplication. Keeps one row per unique full-row shape
 * (canonical-JSON comparison). Composes with `.concat()` for the
 * SQL UNION DISTINCT pattern: `a.concat(b).distinctRows()`.
 *
 * Distinct from `.distinct(field)` (terminal verb that returns
 * distinct *values* of a single field).
 */
export interface DistinctRowsStep {
	kind: 'distinctRows';
}

/**
 * Spec for `lag` / `lead` window functions. The longer form lets you
 * customise the offset (default 1) and the value returned when the
 * offset reaches outside the partition (default `""`).
 */
export type WindowOffsetEntry = string | { field: string; offset?: number; default?: string };

/**
 * Window function specification. Mirrors `SummarizeSpec`'s shape — one
 * object listing every column to add and how to compute it. Unlike
 * `summarize`, `window` keeps every input row and adds columns
 * computed per partition (`partitionBy`) and per row order within
 * partition (`orderBy`).
 *
 * Ranking and running aggregates require `orderBy`; boundary
 * (firstValue / lastValue) doesn't.
 */
export interface WindowSpec {
	/** Field key(s) defining partitions. Omit for one global partition. */
	partitionBy?: string | string[];
	/** Order within partition. Required for ranking, offsets, running aggregates. */
	orderBy?: string | { field: string; direction?: 'asc' | 'desc' };

	/** Sequential within partition; ties broken by input order. */
	rowNumber?: string;
	/** Ties share a rank; next rank skips (1, 2, 2, 4). */
	rank?: string;
	/** Ties share a rank; next rank doesn't skip (1, 2, 2, 3). */
	denseRank?: string;

	/** Running aggregates — `outName → fieldKey`. Include rows up to and
	 *  including the current row (SQL `ROWS UNBOUNDED PRECEDING`). */
	runningSum?: Record<string, string>;
	runningAvg?: Record<string, string>;
	runningMin?: Record<string, string>;
	runningMax?: Record<string, string>;
	/** Running count — output column name as string (no field needed). */
	runningCount?: string;

	/** Previous-row value within partition. Out-of-range → "" (or `default`). */
	lag?: Record<string, WindowOffsetEntry>;
	/** Next-row value within partition. Out-of-range → "" (or `default`). */
	lead?: Record<string, WindowOffsetEntry>;

	/** First row's value in partition (per order). */
	firstValue?: Record<string, string>;
	/** Last row's value in partition (per order). */
	lastValue?: Record<string, string>;
}

export interface WindowStep {
	kind: 'window';
	spec: WindowSpec;
}

/**
 * Explodes an array-valued top-level field into one row per element. Rows
 * with non-array or empty-array values for the field are dropped (matches
 * Arquero / dplyr's `unnest` semantics).
 *
 * If `sep` is set, the field is read as a string and `.split(sep)` is
 * applied first; empty-string elements are dropped (so `''.split(',')`
 * doesn't produce a phantom row). Lets you operate on CSV-like string
 * fields without a separate `.derive()` to convert them to arrays.
 */
export interface UnrollStep {
	kind: 'unroll';
	field: string;
	sep?: string;
}

/**
 * Fused sort-then-take. Produced by the rewrite pass when a `sort` step is
 * immediately followed by a `take` step — semantically identical to running
 * the sort and then taking the first `count` rows, but the engine can do it
 * in a single pass via a stable bounded priority queue (O(n log count)
 * instead of O(n log n)).
 */
export interface TopKStep {
	kind: 'topK';
	field: string;
	direction: 'asc' | 'desc';
	count: number;
}

export type Step =
	| FilterStep
	| SortStep
	| SelectStep
	| TakeStep
	| SkipStep
	| LastStep
	| ReverseStep
	| SummarizeStep
	| ProjectStep
	| PredicateStep
	| BoolFilterStep
	| DeriveStep
	| UnrollStep
	| TopKStep
	| JoinStep
	| JoinResolvedStep
	| SemijoinStep
	| SemijoinResolvedStep
	| AntijoinStep
	| AntijoinResolvedStep
	| LeftjoinStep
	| LeftjoinResolvedStep
	| ConcatStep
	| ConcatResolvedStep
	| IntersectStep
	| IntersectResolvedStep
	| ExceptStep
	| ExceptResolvedStep
	| DistinctRowsStep
	| WindowStep;

/**
 * Shape of rows produced by a `summarize` or `project` step. Keys are the
 * groupBy / projected field names. Values are typically strings (groupBy
 * keys, projected getValue results), numbers (numeric aggregators), or
 * arrays of strings (`collect` aggregator).
 */
export type SummaryRow = Record<string, string | number | string[]>;

// --- Field metadata ---

/**
 * Core field descriptor used by the query engine. Carries only what's
 * needed to read, filter, sort, and group values from a row — no
 * UI-rendering hints. Non-UI consumers of queriton (CLI tools, backend
 * query layers) should depend on this type.
 *
 * UI layers that need display affordances (grouping, link rendering,
 * unit-aware formatting, computed-badge) should use `FieldDisplayDef<T>`
 * instead, which extends this with optional display metadata.
 */
export interface FieldDef<T> {
	key: string;
	label: string;
	getValue: (item: T) => string;
	type: 'string' | 'number' | 'enum';
	enumValues?: string[];
}

/**
 * Display-layer extension of `FieldDef`. Adds the optional metadata UI
 * components rely on: a `group` for sectioned rendering, display-only
 * value/href overrides, a `computed` flag for the badge, and an
 * optional `unit` consumed by the value formatters.
 *
 * Field arrays exported from app/entity code should be typed as
 * `FieldDisplayDef<T>[]` so UI components see the richer shape; the
 * engine still accepts them anywhere a `FieldDef<T>[]` is required.
 */
export interface FieldDisplayDef<T> extends FieldDef<T> {
	/** Section label used by FieldPicker, ColumnBar, DetailView, etc. */
	group: string;
	/** Override display text shown in DetailView (does not affect filtering/sorting). */
	getDisplayValue?: (item: T) => string;
	/** Return an internal href (no base prefix needed) to render the value as a link in DetailView. */
	getHref?: (item: T) => string | null;
	/** Marks a derived/computed field; UI shows a badge. */
	computed?: boolean;
	/** Unit suffix consumed by unit-aware value formatters. */
	unit?: string;
}

// --- Convenience aliases ---

/**
 * A FieldDef where the item type is not statically known.
 * Use this in generic engine helpers that don't need display metadata.
 * UI components should prefer `AnyFieldDisplayDef`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyFieldDef = FieldDef<any>;

/**
 * A FieldDisplayDef where the item type is not statically known.
 * Use this in generic UI components (EntityExplorer, ResultsTable,
 * FilterBar, etc.) that operate on field definitions for any entity.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyFieldDisplayDef = FieldDisplayDef<any>;
