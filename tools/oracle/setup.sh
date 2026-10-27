#!/bin/bash
# Prepares the reference oracle: copies the core sources of Portfolio Performance next to the
# oracle sources and compiles everything with Maven.
#
# usage: tools/oracle/setup.sh [pp-commit]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
COMMIT="${1:-2a0ef52a93882c0845596b2c6b834e54f592b7ec}"
WORK="$HERE/.pp"

if [ ! -d "$WORK" ]; then
  git clone --filter=blob:none --no-checkout https://github.com/portfolio-performance/portfolio.git "$WORK"
  git -C "$WORK" sparse-checkout set name.abuchen.portfolio/src
fi
git -C "$WORK" checkout -q "$COMMIT"

SRC="$WORK/name.abuchen.portfolio/src"
# java sources of the core plugin
(cd "$SRC" && find . -name '*.java' -print0 | cpio -0pdm --quiet "$HERE/src/main/java")
# resources (messages, currencies, ...)
(cd "$SRC" && find . -type f ! -name '*.java' -print0 | cpio -0pdm --quiet "$HERE/src/main/resources")

cd "$HERE"
mvn -q -DskipTests compile
mvn -q dependency:build-classpath -Dmdep.outputFile=cp.txt
echo "oracle ready"
