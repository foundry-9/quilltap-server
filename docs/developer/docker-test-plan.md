# Docker Test Plan

A repeatable test of the production Docker image against a real instance, aimed at
everything that behaves differently when Quilltap runs in a container on a macOS
host: bind mounts (virtiofs, iCloud), the instance lock across PID namespaces,
localhost rewriting, missing binaries, the non-root user, timezone, logs and
shutdown.

Run it against **V4test** (`~/iCloud/Quilltap/V4test`), never Friday. Several
steps change data (stores, uploads, a full restore, container recreation).

## Setup

Build the image from the tree under test, with the same command
`scripts/build-push-docker.ts` uses, so the build itself is tested:

```bash
docker build --target production -t foundry9/quilltap:dev .
```

The container under test is started the way `npm run start:docker` starts it
(`npx tsx scripts/start-quilltap-docker.ts --data-dir "$HOME/iCloud/Quilltap/V4test" --tag dev --recreate`), which
amounts to:

```bash
docker run -d --name quilltap --restart unless-stopped -p 3000:3000 \
  -v "$HOME/iCloud/Quilltap/V4test:/app/quilltap" \
  -e QUILLTAP_HOST_DATA_DIR="$HOME/iCloud/Quilltap/V4test" \
  -e QUILLTAP_TIMEZONE=America/Chicago \
  foundry9/quilltap:dev
```

Shorthands used below:

```bash
V4=$HOME/iCloud/Quilltap/V4test
Q="node packages/quilltap/bin/quilltap.js db --data-dir $V4"   # host-side CLI
API=http://localhost:3000
```

The image runs with `LOG_OUTPUT=console` by default, so **the server's logs are in
`docker logs quilltap`, not `$V4/logs/combined.log`** (see section 10).

## 1. Container baseline

| # | Check | How | Expect |
|---|---|---|---|
| 1.1 | Health | `curl $API/api/health` | 200, all services healthy |
| 1.2 | Runs as non-root | `docker exec quilltap id` | `uid=1001(nextjs)` |
| 1.3 | Bind mount type and ownership | `docker exec quilltap sh -c 'mount \| grep quilltap; ls -la /app/quilltap/data'` | virtiofs, files owned by nextjs; host side shows them as your user |
| 1.4 | Write through the bind | `docker exec quilltap touch /app/quilltap/files/.w && ls -ln $V4/files/.w` | file appears on host |
| 1.5 | Process tree | `docker exec quilltap sh -c 'for p in /proc/[0-9]*; do tr "\0" " " <$p/cmdline; echo; done'` | `node server.js` as PID 1, `child-entry.js` job child |
| 1.6 | Binaries present/absent | `docker exec quilltap sh -c 'which bash zip unzip git curl npx perl'` | only bash, zip, unzip |
| 1.7 | Home directory | `docker exec quilltap ls -ld /home/nextjs` | **does not exist** (image uses `--no-create-home`); see findings |

## 2. Native modules

| # | Check | How | Expect |
|---|---|---|---|
| 2.1 | SQLite driver, sharp, node-pty load | `docker exec -w /app quilltap node -e 'for (const m of ["better-sqlite3","sharp","node-pty"]) require(m); console.log("ok")'` | `ok` |
| 2.2 | Job child forks and runs jobs | `docker logs quilltap \| grep "Running job in child"` | scheduler ticks every minute |
| 2.3 | sharp in a real path | upload a PNG: `curl -X POST "$API/api/v1/files?action=upload" -F file=@probe.png` then `GET /api/v1/files/<id>` | stored as `image/webp`, GET returns 200 |
| 2.4 | PDF conversion (pdfjs, external in the child bundle) | drop a PDF into a bound filesystem store and scan | converted, chunks created |

## 3. Instance lock across the container boundary

| # | Check | How | Expect |
|---|---|---|---|
| 3.1 | Host CLI sees the container's lock | `$Q --lock-status` | ACTIVE (docker), hostname = container id, port 3000 |
| 3.2 | Host CLI refuses writes | `$Q --write "select 1"` | "held by docker instance" refusal |
| 3.3 | Graceful restart | `docker restart quilltap` | logs show SIGTERM, WAL checkpoints, "Instance lock released"; healthy again in a few seconds |
| 3.4 | Hard kill + start of the same container | `docker kill quilltap; docker start quilltap` | re-entrant acquire (same hostname, PID 1), integrity checks pass |
| 3.5 | **Recreate** (what `--recreate` does) | `docker rm -f quilltap` then the `docker run` above; watch `docker inspect quilltap --format '{{.RestartCount}}'` | new hostname; should start. **Currently crash-loops for ~4.5 min** — see findings |
| 3.6 | Host server vs container | with the container up, start a host server on the same instance (`QUILLTAP_DATA_DIR=$V4 npm run dev -- -p 3005`) | host refuses with the "Docker container" lock message; the container is untouched |
| 3.7 | Port mapping | run with `-p 3001:3000` and `$Q --lock-status` | lock records port 3000 (container side); note whether CLI commands that talk to the server (`characters archive --write`) find it |

## 4. Network to the host

| # | Check | How | Expect |
|---|---|---|---|
| 4.1 | localhost rewrite for providers | `curl -X POST $API/api/v1/models -H 'content-type: application/json' -d '{"provider":"OLLAMA","baseUrl":"http://localhost:11434"}'` (host Ollama running) | model list returned; log line "using host.docker.internal" |
| 4.2 | Same with `127.0.0.1` | as 4.1 | same |
| 4.3 | Raw container loopback | `docker exec quilltap node -e 'fetch("http://localhost:11434/api/tags").catch(e=>console.log(e.cause.code))'` | ECONNREFUSED (proves 4.1 is the rewrite) |
| 4.4 | Ollama chat + embeddings end to end | create an Ollama connection profile and embedding profile with `http://localhost:11434`, send a Salon message, run an embedding reindex | both work |
| 4.5 | OpenAI-compatible on host (LM Studio etc.) | profile with `http://localhost:1234/v1` | works |
| 4.6 | MCP over HTTP to a host server | MCP server on host `localhost:<port>`; add it in the MCP plugin config | connects; Host header stays `localhost:<port>` |
| 4.7 | curl tool to host | ask a character to curl `http://localhost:…` | blocked as private; `host.docker.internal` is **not** blocked by the hostname filter (allowlist only) — decide if that's intended |
| 4.8 | Cloud providers | send a turn with an OpenAI/DeepSeek/Z.AI profile; generate an image | normal |

## 5. Filesystem document stores and host paths

No host↔container path translation exists; stores work only when the host path is
bind-mounted at the same path (`quilltap docs docker-mounts` plans those binds).

| # | Check | How | Expect |
|---|---|---|---|
| 5.1 | Unbound host path | `POST /api/v1/mount-points` with `basePath: /Users/<you>/Documents`, `mountType: filesystem` | created with the "not visible from inside the container … `--recreate`" warning; watcher skipped |
| 5.2 | Path inside the instance bind | `basePath: /app/quilltap/fs-store-test` | created, scans |
| 5.3 | Host edit → container watcher | write a `.md` into `$V4/fs-store-test` on the host | "Mount watcher processed file change" within ~1 s |
| 5.4 | Container write → host | edit a file in that store from the Scriptorium | change visible on host |
| 5.5 | Convert to database and back | `?action=convert`, then `?action=deconvert` with a bound `targetPath` | round trip preserves files |
| 5.6 | **Deconvert to an unbound path** | `?action=deconvert` with `targetPath: /tmp/x` | **currently succeeds silently into the container's writable layer** — see findings; `docker diff quilltap` shows the files |
| 5.7 | Sync to an unbound path | `?action=sync` with `targetPath: /tmp/y` | same risk as 5.6; check for a warning |
| 5.8 | Bound store via start script | `npm run start:docker -- --recreate` with a filesystem store enabled; `docker inspect` mounts | store path bind-mounted path-identically and scannable |
| 5.9 | Store created with a container path, then run natively | stop the container, run the host server on V4test | store at `/app/quilltap/...` is unreachable on the host (expected; note the message) |
| 5.10 | Directory picker | open the picker in the store dialog (or `GET /api/v1/system/browse-directory`) | **currently 400 "Path does not exist: /home/nextjs"** — see findings |

## 6. Backup and restore

| # | Check | How | Expect |
|---|---|---|---|
| 6.1 | Compact backup | `POST /api/v1/system/backup {"compact":true}`, download `GET /api/v1/system/backup/<id>`, `unzip -t` | valid zip |
| 6.2 | Full backup | same with `{}` | valid zip; time it |
| 6.3 | Staging cleaned up | `docker exec quilltap ls /tmp` after download | no `quilltap-backup-*` left behind |
| 6.4 | Restore (replace) | `?action=upload` (raw body), `?action=preview`, then `POST /api/v1/system/restore {"uploadId","mode":"replace"}` | success summary; health stays green; no error logs |
| 6.5 | Restore with a large backup | repeat 6.4 with a Friday-sized backup | `/tmp` in the container (overlay) has room; check `df -h /tmp` |
| 6.6 | Physical DB backups | `ls $V4/data/backups` after startup | daily physical backup written through the bind |

## 7. Ariel terminals

| # | Check | How | Expect |
|---|---|---|---|
| 7.1 | Spawn | `POST /api/v1/terminals {"chatId":"<chat>"}` | session with `/bin/bash`, cwd `/app/quilltap/files`; Ariel announcement in the chat |
| 7.2 | I/O over WebSocket | connect to `ws://localhost:3000/api/v1/terminals/<id>/stream`, send `{"type":"input","data":"date\r"}` | output streams back; `TZ` is the instance zone |
| 7.3 | CLI inside the terminal | type `quilltap db --lock-status` | ACTIVE (uses `QUILLTAP_DATA_DIR` the PTY sets) |
| 7.4 | Home-dependent commands | `touch ~/.x`, shell history | fail (no home directory) |
| 7.5 | Close | `DELETE /api/v1/terminals/<id>` | `{ok:true}`, shell process gone |
| 7.6 | zsh requested | spawn with `"shell":"/bin/zsh"` | clean error (zsh not installed) |
| 7.7 | Orphans | spawn, run `sleep 1000 &`, close the session, list processes | note whether zombies collect (PID 1 is node, no `--init`) |

## 8. In-container CLI

| # | Check | How | Expect |
|---|---|---|---|
| 8.1 | Default data dir | `docker exec quilltap quilltap db --lock-status` and `quilltap db --tables` | **currently looks in `/home/nextjs/.quilltap`** and says no lock / DB not found — see findings |
| 8.2 | Explicit data dir | `docker exec quilltap quilltap db --data-dir /app/quilltap --lock-status` | ACTIVE |
| 8.3 | Commands that need npm/npx | `quilltap themes create …` (runs `npx create-quilltap-theme`) | fails: npx removed from the image |

## 9. Timezone

| # | Check | How | Expect |
|---|---|---|---|
| 9.1 | Server process env | `docker exec quilltap sh -c 'tr "\0" "\n" </proc/1/environ \| grep -E "^(TZ\|QUILLTAP_TIMEZONE)="'` | both `America/Chicago` |
| 9.2 | `docker exec` shells | `docker exec quilltap date` | UTC (exec bypasses the entrypoint — expected, but don't be fooled when debugging) |
| 9.3 | App behaviour | a Salon timestamp, an episodic "yesterday" recall, and an autonomous room scheduled for a local time | all on Chicago time; the cron preview in the browser agrees |

## 10. Logs, shutdown, resources

| # | Check | How | Expect |
|---|---|---|---|
| 10.1 | Where logs go | `grep -c '"environment":"production"' $V4/logs/combined.log` | 0 — container logs only to stdout unless `LOG_OUTPUT=file\|both` |
| 10.2 | Docker log rotation | `docker inspect quilltap --format '{{json .HostConfig.LogConfig}}'` | `json-file` with no `max-size` — grows without bound |
| 10.3 | Graceful stop | `docker stop quilltap` | SIGTERM handled, checkpoints, lock released, child drained |
| 10.4 | Memory | `docker stats --no-stream quilltap` during an embedding reindex | below the VM's limit; `NODE_OPTIONS=--max-old-space-size=4096` applies to both server and child |

## 11. iCloud-backed instance

| # | Check | How | Expect |
|---|---|---|---|
| 11.1 | Dataless files | `find $V4 -flags +dataless` on the host before starting | none. The container **skips** the iCloud prefetch (`materialize-cloud-files.ts` is darwin-only), so evicted files must be downloaded on the host first |
| 11.2 | EDEADLK under load | heavy upload/scan while iCloud syncs | no `EDEADLK`/`-35` errors in `docker logs` |

## Results — 2026-10-28 (image `foundry9/quilltap:dev`, 4.11.0-dev.109)

**Failed:** 1.7, 3.5, 5.6, 5.10, 8.1 (findings 1–4).

**Passed:** 1.1–1.6, 2.1–2.3, 3.1–3.4, 4.1–4.3, 5.1–5.3, 6.1–6.4, 7.1–7.5, 8.2,
9.1–9.2, 10.3. Restart takes about 2 s to healthy. A SIGKILL'd container
restarts with integrity checks passing. A full V4test backup took 8 s (7.7 MB), and a
replace restore took 27 s.

**Not run:** 2.4, 3.6, 3.7, 4.4–4.8, 5.4, 5.5 (bound target), 5.7–5.9, 6.5, 6.6,
7.6, 7.7, 8.3, 9.3, 10.4, 11.2.

### Fix verification (same day, image built from the working tree as `foundry9/quilltap:dockerfix`)

Findings 1–4 are fixed (CHANGELOG, "Docker recreate lockout, deconvert into the
container layer, in-container CLI, folder picker").

- `npm run start:docker -- --recreate` against a running container: healthy in
  5 s, `RestartCount` 0, the lock history shows a clean acquisition.
- 5.6 and 5.7: deconvert and sync dry-run to `/tmp/…` are refused with the
  "inside the container itself" message, and nothing is created. Deconvert to
  `/app/quilltap/deconvert-ok` and a sync dry-run to the path-identical bind
  `/Users/csebold/Documents/qt-sync-probe` are accepted.
- 8.1: `docker exec quilltap quilltap db --lock-status` reports ACTIVE, and
  `db --tables` lists tables, with no flags.
- 5.10: the picker opens at `/app/quilltap`.

**The local image build was also broken, and is fixed.**
`docker build --target production .` (also what `scripts/build-push-docker.ts`
runs) stopped in `next build`'s type check. Colocated tests such as
`components/chat/__tests__/MentionChip.test.tsx` import helpers from the root
`__tests__/`, which `.dockerignore` excludes. `next build` now type-checks with
`tsconfig.build.json`, which leaves tests out. Add a step 0 to any rerun of this
plan: build the image from the tree under test with that exact command.

### Findings

1. **`--recreate` locks the new container out for up to 5 minutes.**
   `docker rm -f` is a SIGKILL, so the old container never releases its lock.
   The new container has a new hostname, so `instance-lock.ts` can only go by the
   heartbeat, which is still fresh. Migrations fail ("another instance holds the
   database lock") and the server does not listen until the heartbeat ages past
   `HEARTBEAT_FRESH_MS`. Measured: the outage ran from 19:46:20 to 19:50:49 (about
   4.5 minutes). The server gave up after 10 connection attempts and exited, and
   `--restart unless-stopped` crash-looped it 11 times (`RestartCount: 11`) until
   the lock went stale. Fix site: `scripts/start-quilltap-docker.ts:472-476`
   should `docker stop` (graceful) before `docker rm`. Optionally, the lock could
   treat a docker-environment lock whose container no longer exists as stale.
2. **Deconvert (and sync) to an unbound path silently writes into the container
   layer.** `?action=deconvert` with `targetPath: /tmp/qt-deconvert-test`
   succeeded and deleted the database copy. The files then existed only in the
   container's writable layer (`docker diff` shows them). After the recreate in
   finding 1, `/tmp/qt-deconvert-test` was gone, and the store's only copy with it. `validateDeconvertTarget` (`lib/mount-index/conversion.ts`) accepts ENOENT
   with no Docker check. Mount-point creation already warns via
   `base-path-availability.ts`; deconvert and sync need a refusal or a warning when
   the target is not under a bind mount.
3. **The in-container CLI defaults to the wrong instance.** `docker exec quilltap
   quilltap db --lock-status` reports "No instance lock found" and `db --tables`
   reports "Database not found: /home/nextjs/.quilltap/…". The CLI doesn't apply
   the server's Docker rule (`/app/quilltap`). The message is wrong and misleading
   while the server holds the lock. The Dockerfile comment advertises exactly this
   usage. It works with `--data-dir /app/quilltap`, and inside an Ariel terminal,
   because the PTY sets `QUILLTAP_DATA_DIR`.
4. **The directory picker opens on a nonexistent home directory.**
   `GET /api/v1/system/browse-directory` with no `path` returns 400 "Path does not
   exist: /home/nextjs". `app/api/v1/system/browse-directory/route.ts` defaults to
   `os.homedir()`. In Docker it should default to `/app/quilltap` (or the image
   should create the home directory, which would also fix 7.4).
5. **Help tells Docker users to set `HOST_REDIRECT_PORTS`, which nothing reads.**
   See `help/connection-profiles.md:208`, `help/embedding-profiles.md:309` and
   `help/startup-wizard.md:258,511`. Rewriting is now automatic (4.1 passed with no
   env var).
6. **`docs/DEPLOYMENT.md:272,472` tell users to `docker exec … sqlite3`.** The image
   has no `sqlite3`, and the DB is encrypted. These should use
   `quilltap db --data-dir /app/quilltap`.
7. **Logs:** the container writes nothing to `$V4/logs/`. That is the documented
   `LOG_OUTPUT=console` default, but it is easy to trip over: the host
   `quilltap logs` and tailing `combined.log` show stale data. Docker's
   `json-file` driver also has no `max-size`, so the start script should pass
   `--log-opt max-size=…` (or set `LOG_OUTPUT=file`).
8. **`isDockerEnvironment()` treats any host with an `/app` directory as Docker**
   (`lib/paths.ts:90-93`, mirrored in `packages/plugin-utils`). On such a host it
   would force `/app/quilltap` and rewrite localhost URLs.
9. **Smaller notes:**
   - The iCloud prefetch is skipped in the container (11.1).
   - `db-encryption-state.ts` doesn't retry `EDEADLK`.
   - The files watcher has no polling option over virtiofs. Inotify worked in 5.3.
   - Ollama/OpenAI-compatible plugins fall back to an unrewritten
     `localhost` default when a profile has a blank base URL. The models API
     refuses a blank URL, so this is reachable only from stored data.
   - `quilltap themes create` needs npx, which the image removes.
