.PHONY: install dev build preview clean

install:
	npm install

dev:
	npm run dev -- --open

build:
	npm run build

preview:
	npm run preview

clean:
	rm -rf node_modules dist dev-dist
