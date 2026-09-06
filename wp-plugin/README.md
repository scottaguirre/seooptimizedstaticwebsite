# wp-plugin/

The WordPress side of Blog Automation, kept in this repository on purpose.

## Why the plugin lives here

The plugin and the server are two halves of one protocol. They agree on
endpoint names, on the shape of every request body, and on how a request is
signed. A change to either half that the other does not know about breaks the
feature — and 0.1.0 and 0.2.0 talk to endpoints that no longer exist, so an
old build against a new server gets nothing but 404s.

Keeping the source here means the two halves move in one commit, and the ZIP a
customer downloads is built from this folder at the moment they ask for it. The
version they get is the version in this repository. There is no second copy to
forget to update.

## Building the ZIP

Nothing to run. `utils/pluginPackage.js` zips this folder on the first request
to `/plugin/download` and caches the result under `builds/plugin/`. The cache
is keyed on the version in the plugin header and rebuilt whenever any source
file here is newer than the cached archive, so editing a file during
development is enough — there is no build step to remember.

## Releasing a change

Bump `Version:` in `interlink-engine/interlink-engine.php` and the `IE_VERSION`
constant beneath it. Both, together — they are read by different things. The
header is what WordPress shows in the plugin list and what the download route
names the file; the constant is what travels outbound as `X-IE-Version` on
every API call, which is how the server can tell a site is running an old
build instead of guessing at a mystery.

Then add a `WHAT x.y.z CHANGED` block to the comment at the top of that file.
That comment is the changelog, and it is the only place anyone can find out
what a version actually did.

## What must never go in this folder

Anything that is not meant for a customer's server. The packager excludes
dotfiles, `node_modules`, `*.zip` and `*.log`, but the rule to hold in your
head is simpler: every file here is shipped to strangers' WordPress installs.
No keys, no notes, no test fixtures.
