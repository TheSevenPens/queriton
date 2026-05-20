// Array-column fixture for `.unroll()`. Covers the four shapes the
// engine has to handle:
//
//   - non-empty array        → one row per element
//   - empty array            → row is dropped
//   - null / missing value   → row passes through unchanged
//   - array with null member → null survives as its own emitted row

import type { AnyFieldDef } from '../../src/index.js';

export interface Person {
	name: string;
	hobbies: string[] | null;
}

export const people: Person[] = [
	{ name: 'Alice', hobbies: ['climbing', 'coding', 'tea'] },
	{ name: 'Bob', hobbies: ['climbing', 'biking'] },
	{ name: 'Charlie', hobbies: [] },
	{ name: 'Dana', hobbies: ['coding'] },
	{ name: 'Eve', hobbies: null },
];

export const peopleFields: AnyFieldDef[] = [
	{
		key: 'name',
		label: 'Name',
		type: 'string',
		group: 'data',
		getValue: (row: Person) => row.name,
	},
	{
		key: 'hobbies',
		label: 'Hobbies',
		type: 'string',
		group: 'data',
		// Pre-unroll the column is `string[] | null`; post-unroll it's a
		// single string element. The getValue needs to handle both so that
		// downstream verbs like `.countBy('hobbies')` work after an unroll.
		getValue: (row: Person) => {
			const v = row.hobbies as unknown;
			if (Array.isArray(v)) return v.join(',');
			if (typeof v === 'string') return v;
			return '';
		},
	},
];
