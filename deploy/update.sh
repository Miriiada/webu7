#!/usr/bin/env bash
# Run as the deployment account (admin), not root. Requires sudo for the service.
set -Eeuo pipefail
umask 022
root=/srv/web-u7-school
repo="$root/repo"
branch="${1:-main}"
case "$branch" in -*) echo 'Invalid branch.' >&2; exit 1;; esac
git check-ref-format --branch "$branch" >/dev/null
[[ -d "$repo/.git" && -d "$root/releases" ]] || { echo 'Follow deploy/README.md first.' >&2; exit 1; }
exec 9>"$root/.update.lock"
flock -n 9 || { echo 'Another deployment is running.' >&2; exit 1; }
[[ -x /usr/bin/node ]] && /usr/bin/node -e 'if(Number(process.versions.node.split(".")[0])<24)process.exit(1)'
sudo -v
git -C "$repo" fetch --no-tags origin "refs/heads/$branch"
revision=$(git -C "$repo" rev-parse FETCH_HEAD)
release="$root/releases/$(date -u +%Y%m%dT%H%M%SZ)-${revision:0:12}"
mkdir "$release"
git -C "$repo" archive "$revision" | tar -x -C "$release"
cd "$release"
# Install build dependencies even if the caller has NODE_ENV=production.
npm ci --include=dev --ignore-scripts
APP_BASE_PATH=/web/ npm run build
npm test
npm prune --omit=dev --ignore-scripts

previous=$(readlink -f "$root/current" 2>/dev/null || true)
# Consistent SQLite snapshot, including committed WAL data, before schema changes.
sudo -u u7-web /usr/bin/node --input-type=module -e '
  import { existsSync, mkdirSync } from "node:fs";
  import { DatabaseSync, backup } from "node:sqlite";
  process.umask(0o077);
  const dir="/srv/web-u7-school/shared/private", file=dir+"/astra.sqlite";
  if (existsSync(file)) {
    mkdirSync(dir+"/backups", {recursive:true, mode:0o700});
    const db=new DatabaseSync(file, {readOnly:true});
    await backup(db, dir+"/backups/astra-"+Date.now()+".sqlite"); db.close();
  }
'
switch_release() {
    ln -sfn "$1" "$root/current.next"
    mv -Tf "$root/current.next" "$root/current"
}
rollback() {
    trap - ERR
    if [[ -n "$previous" && -d "$previous" ]]; then
        switch_release "$previous"
        sudo systemctl restart u7-web || true
        echo 'Activation failed; previous code restored. Database was not rolled back.' >&2
    else
        sudo systemctl stop u7-web || true
        echo 'First activation failed. Check: sudo journalctl -u u7-web -n 80 --no-pager' >&2
    fi
    exit 1
}
trap rollback ERR
switch_release "$release"
sudo systemctl restart u7-web
ready=false
for attempt in {1..20}; do
    if curl --fail --silent --max-time 2 -H 'Host: u7-hub.kz' http://127.0.0.1:4173/web/api/health | /usr/bin/node --input-type=module -e '
      let s=""; for await (const chunk of process.stdin) s+=chunk;
      try { if(JSON.parse(s).ok!==true)process.exit(1); } catch { process.exit(1); }
    '; then ready=true; break; fi
    sleep 1
done
[[ "$ready" == true ]]
trap - ERR
echo "Published $revision at https://u7-hub.kz/web/"
echo 'Old releases and backups retained. Keep an encrypted off-server backup of the database AND MASTER_KEY.'
