#!/usr/bin/env bash
#
# Mutation test for the trust-badge gates and the shared keptOn() reading.
# Run once, then delete this file.
#
#   bash mutate-badges.sh
#
# BASH 3.2 ONLY. macOS still ships bash 3.2 from 2007, which has no
# associative arrays — `declare -A` is a bash 4 feature and fails here with
# "invalid option". The first version of this script used one and died on line
# 34. Parallel plain arrays do the same job and run anywhere.
#
# Same contract as mutate-pricing.sh: every file is copied to a temp directory
# before anything is touched, an EXIT trap restores them however this ends
# (finished, failed, or Ctrl-C), and checksums prove the restore worked.
#
# The last two mutations are the important ones. keptOn() is read by three
# callers, so a change to it moves the spend gate, the render gate and the
# chokepoint together — which is the point of having one, and also means one
# edit can break all three at once.

set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

ABOUT=utils/buildAboutUsPage.js
BADGE=utils/copyBadgeImages.js
RUN=utils/runGeneration.js
TOGGLE=utils/sectionToggle.js
SUITE=test-business-shape.js

FILES="$ABOUT $BADGE $RUN $TOGGLE"

for f in $FILES $SUITE; do
  [ -f "$f" ] || { echo "Not in the project directory — $f is missing."; exit 1; }
done

BACKUP="$(mktemp -d)"
SUMS=""
for f in $FILES; do
  cp "$f" "$BACKUP/$(basename "$f")"
  SUMS="$SUMS $(md5 -q "$f")"
done

restore() {
  for f in $FILES; do cp "$BACKUP/$(basename "$f")" "$f"; done
}
trap restore EXIT

echo "Backups in $BACKUP"
echo
echo "Breaking each gate on purpose:"
echo

caught=0
missed=0

# $1 description, $2 file, $3 perl substitution
mutate() {
  what="$1"; file="$2"; subst="$3"
  restore
  perl -0pi -e "$subst" "$file"

  if diff -q "$file" "$BACKUP/$(basename "$file")" > /dev/null; then
    echo "  SKIPPED  $what — the pattern did not match, so nothing was changed"
    missed=$((missed + 1))
    return
  fi

  if node "$SUITE" > /dev/null 2>&1; then
    echo "  MISSED   $what"
    missed=$((missed + 1))
  else
    echo "  caught   $what"
    caught=$((caught + 1))
  fi
}

# 1. The render gate forgets the shape rule — a dentist could be given badges.
mutate "render gate drops caps.badges" "$ABOUT" \
  's/\(caps\.badges && keptOn\(globalValues\.showBadges\)\)/(keptOn(globalValues.showBadges))/'

# 2. The render gate forgets the checkbox — unticking does nothing.
mutate "render gate drops the checkbox" "$ABOUT" \
  's/\(caps\.badges && keptOn\(globalValues\.showBadges\)\)/(caps.badges)/'

# 3. The chokepoint stops checking the preference itself.
mutate "copyBadgeImages drops its own guard" "$BADGE" \
  's/if \(!keptOn\(globalValues\.showBadges\)\) \{/if (false) {/'

# 4. The chokepoint stops checking the shape.
mutate "copyBadgeImages drops the shape guard" "$BADGE" \
  's/if \(!wantsBadges\(businessType\)\) \{/if (false) {/'

# 5. runGeneration stops reading the field at all.
mutate "runGeneration hardcodes showBadges on" "$RUN" \
  's/const showBadges = keptOn\(global\?\.showBadges\);/const showBadges = true;/'

# 6. THE SHARED READING: absent starts meaning off. This is the one that would
#    silently strip both sections from every WordPress build.
mutate "keptOn: a missing field reads as off" "$TOGGLE" \
  's/  if \(value == null\) return true;/  if (value == null) return false;/'

# 7. THE SHARED READING: back to the null bug found on 30 September.
mutate "keptOn: null reads as off again" "$TOGGLE" \
  's/  if \(value == null\) return true;/  if (value === undefined) return true;/'

restore
trap - EXIT

echo
now=""
for f in $FILES; do now="$now $(md5 -q "$f")"; done

if [ "$now" = "$SUMS" ]; then
  echo "  All files restored, checksums match."
  rm -rf "$BACKUP"
else
  echo "  NOT RESTORED — originals are in $BACKUP"
  exit 1
fi

echo
echo "  $caught caught, $missed missed"
echo
if [ "$missed" -eq 0 ]; then
  node "$SUITE" | tail -2
  echo "  Every gate is covered. Safe to delete this script."
else
  echo "  A MISSED line means that gate could break with every test still green."
  exit 1
fi
