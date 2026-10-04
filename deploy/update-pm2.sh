#!/usr/bin/env bash
# Uses the existing admin PM2 daemon. Never targets other applications.
set -Eeuo pipefail
umask 077
root=/srv/web-u7-school
repo="$root/repo"
branch="${1:-main}"
case "$branch" in -*) echo 'Invalid branch.' >&2; exit 1;; esac
git check-ref-format --branch "$branch" >/dev/null
[[ -d "$repo/.git" && -d "$root/releases" && -r "$root/shared/.env" ]] || { echo 'Follow deploy/PM2.md first.' >&2; exit 1; }
for tool in git npm pm2 curl tar flock; do command -v "$tool" >/dev/null; done
/usr/bin/node -e 'if(Number(process.versions.node.split(".")[0])<24)process.exit(1)'
exec 9>"$root/.update.lock"
flock -n 9 || { echo 'Another deployment is running.' >&2; exit 1; }
git -C "$repo" fetch --no-tags origin "refs/heads/$branch"
revision=$(git -C "$repo" rev-parse FETCH_HEAD)
release="$root/releases/$(date -u +%Y%m%dT%H%M%SZ)-${revision:0:12}"
mkdir "$release"
git -C "$repo" archive "$revision" | tar -x -C "$release"
cd "$release"
npm ci --include=dev --ignore-scripts
APP_BASE_PATH=/web/ npm run build
npm test
npm prune --omit=dev --ignore-scripts

# Read configuration without copying secrets into PM2's ecosystem or dump.
DOTENV_CONFIG_PATH="$root/shared/.env" /usr/bin/node --input-type=module -e '
  const {loadConfig}=await import("./build-server/server/config.js");
  const c=loadConfig();
  if(!c.production || c.origin!=="https://u7-hub.kz" || c.basePath!=="/web/" || c.host!=="127.0.0.1" || c.port!==4173 || c.dbPath!=="/srv/web-u7-school/shared/private/astra.sqlite") {
    throw new Error("Configuration must match deploy/env.production.example");
  }
'
previous=$(readlink -f "$root/current" 2>/dev/null || true)
# Fail on a port conflict BEFORE altering current or adding a PM2 process.
if [[ -z "$previous" ]]; then
    /usr/bin/node --input-type=module -e '
      import net from "node:net";
      const s=net.createServer(); s.once("error",()=>{ console.error("Port 4173 is occupied; activation aborted."); process.exit(1); });
      s.listen(4173,"127.0.0.1",()=>s.close());
    '
    if pm2 describe u7-web >/dev/null 2>&1; then
        echo 'A PM2 process named u7-web already exists. Inspect it before deploying.' >&2; exit 1
    fi
fi
/usr/bin/node --input-type=module -e '
  import {existsSync,mkdirSync} from "node:fs";
  import {DatabaseSync,backup} from "node:sqlite";
  const dir="/srv/web-u7-school/shared/private", file=dir+"/astra.sqlite";
  if(existsSync(file)) {
    mkdirSync(dir+"/backups",{recursive:true,mode:0o700});
    const db=new DatabaseSync(file,{readOnly:true});
    await backup(db,dir+"/backups/astra-"+Date.now()+".sqlite"); db.close();
  }
'
switch_release() {
    ln -sfn "$1" "$root/current.next"
    mv -Tf "$root/current.next" "$root/current"
}
activate() {
    pm2 startOrRestart "$1/deploy/ecosystem.config.json" --only u7-web --update-env
}
rollback() {
    trap - ERR
    if [[ -n "$previous" && -d "$previous" ]]; then
        switch_release "$previous"
        activate "$previous" || true
        echo 'Activation failed; previous code restored. Database was not rolled back.' >&2
    else
        pm2 delete u7-web >/dev/null 2>&1 || true
        if [[ -L "$root/current" ]]; then unlink "$root/current"; fi
        echo 'First activation failed; only u7-web was removed. Check shared/logs/.' >&2
    fi
    exit 1
}
trap rollback ERR
switch_release "$release"
activate "$release"
ready=false
for attempt in {1..20}; do
    if curl --fail --silent --max-time 2 -H 'Host: u7-hub.kz' http://127.0.0.1:4173/web/api/health | /usr/bin/node --input-type=module -e '
      let s=""; for await(const chunk of process.stdin)s+=chunk;
      try {if(JSON.parse(s).ok!==true)process.exit(1);} catch {process.exit(1);}
    '; then ready=true; break; fi
    sleep 1
done
[[ "$ready" == true ]]
trap - ERR
echo "Activated u7-web revision $revision on 127.0.0.1:4173/web/"
echo 'Public access requires the Nginx snippet. Other PM2 apps were not restarted.'
