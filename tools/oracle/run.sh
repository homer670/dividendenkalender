#!/bin/bash
# usage: tools/oracle/run.sh <model|calc> <file> <out.json> [password] [rates.csv]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
RATES="${5:-$HERE/../../tests/fixtures/rates-1.csv}"
cd "$HERE"
java -Duser.language=de -Duser.country=DE -Doracle.rates="$RATES" -cp "target/classes:$(cat cp.txt)" oracle.Oracle "$1" "$2" "$3" "${4:-geheim}"
