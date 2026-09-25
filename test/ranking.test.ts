// .top() / .bottom() ranking shorthand and .pluck() single-column values
// (DrawTabDataExplorer #202, #203).
import { describe, it, expect } from 'vitest';
import { Query } from '../src/index.js';
import { mtcars, mtcarsFields, type Car } from './fixtures/mtcars.js';
import { withNulls, withNullsFields, type NullRow } from './fixtures/with-nulls.js';

const carsQ = () => new Query<Car>(async () => mtcars, mtcarsFields);
const nullsQ = () => new Query<NullRow>(async () => withNulls, withNullsFields);

describe('Query — top / bottom', () => {
	it('top(n, field) is sort desc + take on rows that have a value', async () => {
		const top = await carsQ().top(3, 'mpg').toArray();
		const expected = await carsQ().sort('mpg', 'desc').take(3).toArray();
		expect(top).toEqual(expected);
		expect(top.map((c) => c.mpg)).toEqual([33.9, 32.4, 30.4]);
	});

	it('bottom(n, field) is sort asc + take on rows that have a value', async () => {
		const bottom = await carsQ().bottom(2, 'mpg').pluck('mpg');
		expect(bottom).toEqual(['10.4', '10.4']);
	});

	it('bottom leaves out rows with no value — asc sort would rank them first', async () => {
		// value is null on row c; the literal sort-asc-take puts it on top.
		expect((await nullsQ().sort('value', 'asc').take(1).toArray())[0].id).toBe('c');
		expect(await nullsQ().bottom(2, 'value').pluck('id')).toEqual(['e', 'a']);
	});

	it('top leaves them out too when there are fewer valued rows than n', async () => {
		const ids = await nullsQ().top(10, 'tag').pluck('id');
		expect(ids).toHaveLength(5); // 8 rows, 3 with a null or empty tag
		expect(ids).not.toContain('b');
	});

	it('without a field: top keeps the first n, bottom the last n of the current order', async () => {
		const byMpg = carsQ().sort('mpg', 'desc');
		expect(await byMpg.top(2).toArray()).toEqual(await byMpg.take(2).toArray());
		expect(await byMpg.bottom(2).toArray()).toEqual(await byMpg.last(2).toArray());
	});
});

describe('Query — pluck', () => {
	it('returns one value per row, in order, keeping duplicates and empties', async () => {
		expect(await nullsQ().pluck('tag')).toEqual(['red', '', 'blue', 'red', '', 'green', '', 'red']);
	});

	it('differs from distinct, which dedupes, drops empties and sorts', async () => {
		expect(await nullsQ().distinct('tag')).toEqual(['blue', 'green', 'red']);
	});

	it('reads computed columns that select / summarize created', async () => {
		const counts = await nullsQ()
			.summarize({ by: 'category', count: 'n' })
			.sort('category', 'asc')
			.pluck('n');
		expect(counts).toEqual(['2', '3', '2', '1']); // "", X, Y, Z
	});
});
