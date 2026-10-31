#!/bin/sh
set -e
node tests/engine_rules.mjs
node tests/turn_test.mjs
node tests/server_v6.mjs
node tests/layout_check.mjs
node tests/final_check.mjs
