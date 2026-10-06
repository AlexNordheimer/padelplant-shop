#!/usr/bin/env bash
# Pushes the latest Casa Hirostar shop changes to GitHub. Netlify republishes about a minute later.
# Usage (in Git Bash):  cd ~/Documents/padelplant-shop && ./ship.sh "optional note"
set -e
cd "$(dirname "$0")"
git pull --rebase --autostash -q
git add -A
if git diff --cached --quiet; then
  echo "Nothing new to ship. The site is already up to date."
  exit 0
fi
git commit -q -m "${1:-Shop update $(date '+%b %d, %I:%M %p')}"
git push -q
echo "Shipped. The live site updates in about a minute: https://padelplant-shop.netlify.app"
