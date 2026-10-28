#!/bin/sh
set -e
node tests/engine_rules.mjs
node tests/server_v6.mjs
node tests/ui_v6.mjs
