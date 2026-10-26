#!/usr/bin/env python3
"""Render a reviewed nginx candidate; the operator backs up and validates it."""
import pathlib
import sys
config = pathlib.Path(sys.argv[1]).read_text()
snippet = pathlib.Path(sys.argv[2]).read_text()
marker = '    client_max_body_size 50m;'
if config.count(marker) != 1 or 'location ^~ /static/' in config:
    raise SystemExit('Unexpected nginx configuration; inspect before applying')
pathlib.Path(sys.argv[3]).write_text(config.replace(marker, snippet + '\n' + marker))
