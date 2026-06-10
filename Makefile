# Cockpit LINCOT — build and install.
#
# Quick start:
#   make                  # build the plugin into dist/ (fetches pkg/lib, npm ci)
#   sudo make install     # install plugin system-wide (/usr/share/cockpit/lincot)
#   make devel-install    # symlink dist/ into ~/.local/share/cockpit for development
#   make watch            # rebuild on change
#   make deb rpm          # build Debian and RPM packages with nfpm

# extract name from package.json
PACKAGE_NAME := $(shell awk '/"name":/ {gsub(/[",]/, "", $$2); print $$2}' package.json)
PKG_NAME := cockpit-$(PACKAGE_NAME)
# Do not use "git describe | sed" alone: if describe fails, sed still exits 0 and T stays empty.
VERSION_RAW := $(shell \
	T=$$(git describe --tags 2>/dev/null | sed 's/^v//'); \
	if [ -z "$$T" ]; then T=0.0.0; fi; \
	echo "$$T" | tr '-' '.')
VERSION := $(if $(strip $(VERSION_RAW)),$(VERSION_RAW),0.0.0)
PREFIX ?= /usr
DESTDIR ?=
APPSTREAMFILE = org.cockpit_project.$(subst -,_,$(PACKAGE_NAME)).metainfo.xml

# committed lockfile + stamp refreshed by npm ci when package.json / lock changes
PACKAGE_LOCK = package-lock.json
NODE_MODULES_STAMP = node_modules/.npm-stamp
# one example file in dist/ from bundler that already ran
DIST_TEST = dist/manifest.json
# one example file in pkg/lib to check if it was already checked out
COCKPIT_REPO_STAMP = pkg/lib/cockpit-po-plugin.js

all: $(DIST_TEST)

#
# Cockpit build helpers (pkg/lib) are vendored from the Cockpit repo at a pinned
# commit. No API stability guarantee; bump occasionally.
#
COCKPIT_REPO_FILES = pkg/lib
COCKPIT_REPO_URL = https://github.com/cockpit-project/cockpit.git
COCKPIT_REPO_COMMIT = 7776f5476411577da93a0fc8ba9ba467d846358f

$(COCKPIT_REPO_FILES): $(COCKPIT_REPO_STAMP)
COCKPIT_REPO_TREE = '$(strip $(COCKPIT_REPO_COMMIT))^{tree}'
$(COCKPIT_REPO_STAMP): Makefile
	@git rev-list --quiet --objects $(COCKPIT_REPO_TREE) -- 2>/dev/null || \
	    git fetch --no-tags --no-write-fetch-head --depth=1 $(COCKPIT_REPO_URL) $(COCKPIT_REPO_COMMIT)
	git archive $(COCKPIT_REPO_TREE) -- $(COCKPIT_REPO_FILES) | tar x

#
# i18n
#
LINGUAS = $(basename $(notdir $(wildcard po/*.po)))

po/$(PACKAGE_NAME).js.pot:
	xgettext --default-domain=$(PACKAGE_NAME) --output=- --language=C --keyword= \
		--add-comments=Translators: \
		--keyword=_:1,1t --keyword=_:1c,2,2t --keyword=C_:1c,2 \
		--keyword=N_ --keyword=NC_:1c,2 \
		--keyword=gettext:1,1t --keyword=gettext:1c,2,2t \
		--keyword=ngettext:1,2,3t --keyword=ngettext:1c,2,3,4t \
		--keyword=gettextCatalog.getString:1,3c --keyword=gettextCatalog.getPlural:2,3,4c \
		--from-code=UTF-8 $$(find src/ -name '*.[jt]s' -o -name '*.[jt]sx') | \
		sed '/^#/ s/, c-format//' > $@

po/$(PACKAGE_NAME).html.pot: $(NODE_MODULES_STAMP) $(COCKPIT_REPO_STAMP)
	pkg/lib/html2po -o $@ $$(find src -name '*.html')

po/$(PACKAGE_NAME).manifest.pot: $(COCKPIT_REPO_STAMP)
	pkg/lib/manifest2po -o $@ src/manifest.json

po/$(PACKAGE_NAME).metainfo.pot: $(APPSTREAMFILE)
	xgettext --default-domain=$(PACKAGE_NAME) --output=$@ $<

po/$(PACKAGE_NAME).pot: po/$(PACKAGE_NAME).html.pot po/$(PACKAGE_NAME).js.pot po/$(PACKAGE_NAME).manifest.pot po/$(PACKAGE_NAME).metainfo.pot
	msgcat --sort-output --output-file=$@ $^

po/LINGUAS:
	echo $(LINGUAS) | tr ' ' '\n' > $@

#
# Build / install
#
$(DIST_TEST): $(NODE_MODULES_STAMP) $(COCKPIT_REPO_STAMP) $(shell find src/ -type f) package.json build.js
	NODE_ENV=$(NODE_ENV) node ./build.js

watch: $(NODE_MODULES_STAMP) $(COCKPIT_REPO_STAMP)
	NODE_ENV=$(NODE_ENV) node ./build.js --watch

COCKPITDIR = $(DESTDIR)$(PREFIX)/share/cockpit/$(PACKAGE_NAME)

install: $(DIST_TEST) po/LINGUAS
	mkdir -p $(COCKPITDIR)
	cp -r dist/* $(COCKPITDIR)
	mkdir -p $(DESTDIR)$(PREFIX)/share/metainfo/
	msgfmt --xml -d po --template $(APPSTREAMFILE) \
		-o $(DESTDIR)$(PREFIX)/share/metainfo/$(APPSTREAMFILE) 2>/dev/null || \
		cp $(APPSTREAMFILE) $(DESTDIR)$(PREFIX)/share/metainfo/$(APPSTREAMFILE)
	mkdir -p $(DESTDIR)$(PREFIX)/share/polkit-1/rules.d
	install -m 0644 packaging/49-cockpit-lincot.rules \
		$(DESTDIR)$(PREFIX)/share/polkit-1/rules.d/49-cockpit-lincot.rules
	@echo "Installed plugin -> $(COCKPITDIR)"

uninstall:
	rm -rf $(COCKPITDIR)
	rm -f $(DESTDIR)$(PREFIX)/share/metainfo/$(APPSTREAMFILE)
	rm -f $(DESTDIR)$(PREFIX)/share/polkit-1/rules.d/49-cockpit-lincot.rules

# Development: symlink the built tree into the per-user cockpit dir (no root).
devel-install: $(DIST_TEST)
	mkdir -p ~/.local/share/cockpit
	ln -sfn `pwd`/dist ~/.local/share/cockpit/$(PACKAGE_NAME)

devel-uninstall:
	rm -f ~/.local/share/cockpit/$(PACKAGE_NAME)

print-version:
	@echo "$(VERSION)"

#
# Packaging — nfpm builds both .deb and .rpm from the prebuilt dist/ tree.
#
deb: $(DIST_TEST)
	mkdir -p out
	VERSION=$(VERSION) nfpm package -f nfpm.yaml -p deb -t out/

rpm: $(DIST_TEST)
	mkdir -p out
	VERSION=$(VERSION) nfpm package -f nfpm.yaml -p rpm -t out/

package: deb rpm

$(NODE_MODULES_STAMP): package.json $(PACKAGE_LOCK)
	# unset NODE_ENV, skips devDependencies otherwise
	env -u NODE_ENV npm ci --ignore-scripts
	@touch $(NODE_MODULES_STAMP)

# Fast checks for CI: unit tests, linters, bundle
.PHONY: ci
ci: $(NODE_MODULES_STAMP) $(COCKPIT_REPO_STAMP) $(DIST_TEST)
	npm run test
	npm run eslint
	npm run stylelint

clean:
	rm -rf dist/ out/
	rm -f po/LINGUAS

.PHONY: all watch install uninstall devel-install devel-uninstall print-version deb rpm package clean
