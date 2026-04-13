VERSION := $(shell sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' manifest.json)
ZIP := dist/slop-bucket-$(VERSION).zip

ENTRIES := manifest.json background.js README.md icons popup slop-page
DEPS := $(shell find $(ENTRIES) -type f ! -name '.DS_Store' 2>/dev/null)

.PHONY: all clean
all: $(ZIP)

$(ZIP): $(DEPS)
	@mkdir -p $(@D)
	rm -f $@
	zip -r $@ $(ENTRIES) -x "*.DS_Store"

clean:
	rm -rf dist
