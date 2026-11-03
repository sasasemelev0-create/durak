#!/bin/sh
set -e
node tests/engine_rules.mjs
node tests/turn_test.mjs
node tests/cheat_v9.mjs
node tests/server_v6.mjs
node tests/layout_v8.mjs
node tests/style_v8.mjs
node tests/ui_v9.mjs
node tests/turn_light.mjs
node tests/height_test.mjs
node tests/insets_test.mjs
