#!/usr/bin/env bash
#
# The only thing sFace's deploy key is allowed to run.
#
# ## Why this exists rather than the workflow sending a script
#
# CI used to pipe a shell script over ssh and let the far end run it, which means
# the deploy key was a root shell on a box that is shared ingress for several
# unrelated products. Anyone who could change a workflow, or who got hold of the
# secret, had the whole machine.
#
# So the key is pinned to this file with a forced command in authorized_keys. The
# client cannot choose what runs; it can only ask for a tag. Whatever it sends
# lands in SSH_ORIGINAL_COMMAND and is treated as hostile until it matches the one
# shape a real deploy has.
#
# ## Install
#
#   sudo install -m 755 sface-deploy.sh /usr/local/sbin/sface-deploy
#   sudo mkdir -p /etc/sface && sudo chmod 700 /etc/sface
#   printf 'DEPLOY_DIR=/srv/sface\n' | sudo tee /etc/sface/deploy.env
#   sudo chmod 600 /etc/sface/deploy.env
#
# Then in the deploy user's authorized_keys, on one line:
#
#   restrict,command="/usr/local/sbin/sface-deploy" ssh-ed25519 AAAA... sface-ci
#
# `restrict` is doing real work: it refuses port forwarding, agent forwarding, X11
# and pty allocation. Without it a forced command still leaves the key usable as a
# tunnel into the private network this box sits on.
#
# ## What it deliberately does not do
#
# No git pull, no build, no compose down. It swaps one service's image and starts
# it. Anything that touches the shared Caddy project, or the network several other
# products are on, is not something a CI key should be able to reach.

set -euo pipefail

log() { printf '[sface-deploy] %s\n' "$*"; }
die() { printf '[sface-deploy] %s\n' "$*" >&2; exit 1; }

# Where the compose file lives. Read from a root-owned file rather than taken from
# the client, because a path from the client is a path an attacker chooses.
CONFIG=/etc/sface/deploy.env
[ -r "$CONFIG" ] || die "missing $CONFIG"
# shellcheck disable=SC1090
. "$CONFIG"
: "${DEPLOY_DIR:?DEPLOY_DIR not set in $CONFIG}"

REQUESTED="${SSH_ORIGINAL_COMMAND:-}"
[ -n "$REQUESTED" ] || die 'no image tag supplied'

# The registry path is fixed here, not accepted from the caller. Otherwise a
# leaked key could point production at any image on any registry, which is a far
# better attack than anything else this key permits.
readonly REGISTRY='ghcr.io'
readonly REPO='iziedking/sface-api'

# One shape only: the pinned repository at a full commit sha. No floating tags, no
# other repository, no registry override, nothing with a slash or a shell
# metacharacter in it.
if [[ ! "$REQUESTED" =~ ^[0-9a-f]{40}$ ]]; then
  die "expected a 40 character commit sha, refusing: $REQUESTED"
fi

IMAGE="$REGISTRY/$REPO:$REQUESTED"

# Credentials arrive on stdin, two lines, never in the command. Arguments are
# visible in `ps` to every other user on the box for as long as the process lives,
# and this box has other tenants.
#
# The username is read rather than hardcoded because GHCR pairs it with the token,
# and a short-lived Actions token belongs to the actor who triggered the run. It is
# not a secret, but it travels the same way to keep one channel instead of two.
read -r REGISTRY_USER || die 'no registry user on stdin'
read -r -s TOKEN || die 'no registry token on stdin'
[ -n "$REGISTRY_USER" ] || die 'empty registry user'
[ -n "$TOKEN" ] || die 'empty registry token'

# It reaches docker as a value, not as part of a command line, so a hostile value
# cannot become an argument. Still worth refusing anything that is not a plausible
# GitHub login.
if [[ ! "$REGISTRY_USER" =~ ^[A-Za-z0-9-]{1,39}$ ]]; then
  die 'registry user is not a plausible GitHub login'
fi

cd "$DEPLOY_DIR" || die "cannot enter $DEPLOY_DIR"

log "pulling $IMAGE"
printf '%s' "$TOKEN" | docker login "$REGISTRY" -u "$REGISTRY_USER" --password-stdin >/dev/null
unset TOKEN

# Logging out matters even on the failure paths: a stored credential in root's
# docker config is a durable secret this script promised not to leave behind.
cleanup() { docker logout "$REGISTRY" >/dev/null 2>&1 || true; }
trap cleanup EXIT

export SFACE_IMAGE="$IMAGE"
docker compose pull api
# This service only. A bare `docker compose down` anywhere on this box deletes
# deploy_default and takes the shared Caddy, and therefore several other products,
# offline with it.
docker compose up -d api

log 'pruning untagged images'
docker image prune -f >/dev/null

log 'running containers:'
docker compose ps api

# Ask the service itself, from inside the network, before reporting success. A
# container that started is not a service that answers, and finding that out here
# is much cheaper than finding it out from a user.
for attempt in 1 2 3 4 5 6; do
  if docker compose exec -T api node -e \
    'fetch("http://127.0.0.1:"+(process.env.PORT||8790)+"/health").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))'
  then
    log "healthy on attempt $attempt"
    exit 0
  fi
  log "attempt $attempt: not healthy yet"
  sleep 5
done

die 'never became healthy; the previous image may need restoring'
