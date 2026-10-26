#!/usr/bin/env bash
# One-time (idempotent) GitHub setup for the maintainer. Requires: gh (logged in), jq optional.
# Usage: scripts/setup-github.sh
set -euo pipefail

REPO="joennespreuwers/toledo-plus"
DESC="Toledo+ — een rustigere, duidelijkere KU Leuven Toledo (onofficiële Chrome/Edge-extensie voor studenten)."
HOMEPAGE="https://github.com/${REPO}#readme"
TOPICS=(chrome-extension ku-leuven toledo blackboard students luca-school-of-arts)
cd "$(dirname "$0")/.."

command -v gh >/dev/null || { echo "gh CLI not found: https://cli.github.com" >&2; exit 1; }
gh auth status >/dev/null || { echo "Run 'gh auth login' first." >&2; exit 1; }

if gh repo view "$REPO" >/dev/null 2>&1; then
  echo "• Repo $REPO exists"
else
  echo "• Creating $REPO"
  [ -d .git ] || { git init -q && git add -A && git commit -qm "Initial commit"; }
  gh repo create "$REPO" --public --source . --push --description "$DESC" --homepage "$HOMEPAGE"
fi

echo "• Settings: issues, discussions, description, homepage"
gh repo edit "$REPO" --enable-issues --enable-discussions --enable-wiki=false \
  --description "$DESC" --homepage "$HOMEPAGE" --delete-branch-on-merge >/dev/null

echo "• Topics"
for t in "${TOPICS[@]}"; do gh repo edit "$REPO" --add-topic "$t" >/dev/null; done

echo "• Labels from .github/labels.json"
node -e '
const labels = require("./.github/labels.json");
for (const l of labels) console.log([l.name, l.color.replace(/^#/, ""), l.description].join("\t"));
' | while IFS=$'\t' read -r name color description; do
  gh label create "$name" --repo "$REPO" --color "$color" --description "$description" --force >/dev/null
  echo "  - $name"
done

echo "Done. Next: tag a release (git tag v1.0.0 && git push --tags) to publish the zip via .github/workflows/release.yml"
