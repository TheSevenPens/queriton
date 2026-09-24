import { describe, expect, it } from 'vitest';
import { DataSet } from '../src/dataset.js';

describe('DataSet.registerCollection caching', () => {
	it('loads once and reuses a successful result', async () => {
		let calls = 0;
		const ds = new DataSet();
		const q = ds.registerCollection(
			'rows',
			async () => {
				calls++;
				return [{ n: 1 }];
			},
			[],
		);
		expect(await q.toArray()).toEqual([{ n: 1 }]);
		expect(await q.toArray()).toEqual([{ n: 1 }]);
		expect(calls).toBe(1);
	});

	it('does not cache a failure: the next access retries', async () => {
		let calls = 0;
		const ds = new DataSet();
		const q = ds.registerCollection(
			'rows',
			async () => {
				calls++;
				if (calls === 1) throw new Error('HTTP 503');
				return [{ n: 1 }];
			},
			[],
		);
		await expect(q.toArray()).rejects.toThrow('HTTP 503');
		expect(await q.toArray()).toEqual([{ n: 1 }]);
		expect(calls).toBe(2);
	});

	it('shares one in-flight load between concurrent callers', async () => {
		let calls = 0;
		const ds = new DataSet();
		const q = ds.registerCollection(
			'rows',
			async () => {
				calls++;
				return [{ n: 1 }];
			},
			[],
		);
		await Promise.all([q.toArray(), q.toArray(), q.toArray()]);
		expect(calls).toBe(1);
	});
});
