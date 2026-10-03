.PHONY: install dev build preview clean test test-watch typecheck

install:
	npm install

dev:
	npm run dev -- --open

build:
	npm run build

preview:
	npm run preview

test:
	npm test -- --run

test-watch:
	npm run test:watch

typecheck:
	npx tsc --noEmit

clean:
	rm -rf node_modules dist dev-dist
