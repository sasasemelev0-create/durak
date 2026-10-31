#!/bin/sh
set -e
node tests/engine_rules.mjs
node tests/turn_test.mjs
node tests/server_v6.mjs
node tests/layout_v8.mjs
node tests/style_v8.mjs
