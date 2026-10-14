#!/bin/sh
# Lance tous les tests moteur (Node, sans navigateur). Usage : sh tests/run.sh
cd "$(dirname "$0")" || exit 1
fail=0
for f in *.test.js; do
  if node "$f" >/dev/null 2>&1; then echo "OK   $f"; else echo "ÉCHEC $f"; fail=1; fi
done
exit $fail
