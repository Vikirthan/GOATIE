// fake-indexeddb ships its own types, but its package "exports" map is not
// visible to the bundler module resolution used here — fall back to untyped.
declare module 'fake-indexeddb/auto';
