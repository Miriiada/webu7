# Ubuntu + существующий Nginx: https://u7-hub.kz/web/

**Для проверенного сервера kalki-server:** основной сайт `u7-hub` и бот `u7-school-bot` работают в PM2 под `admin`; доступ sudo подтверждён. Рекомендуется инструкция ниже: отдельный пользователь `u7-web` и systemd для изоляции нового веба. Существующие приложения остаются в PM2. [Вариант PM2](PM2.md) сохранён как альтернатива; не запускайте оба варианта одновременно.

Node.js 24.14.1, npm 11.11.0 и Nginx 1.24 подходят. Нужны Git, curl, tar и flock (пакет util-linux). Все исходники, версии, конфигурация приложения и база находятся в `/srv/web-u7-school`. Два системных файла устанавливаются в стандартные каталоги Nginx и systemd.

## 1. Поместить веб-проект в отдельный приватный Git-репозиторий

Создайте пустой **приватный** репозиторий, например `web-u7-school`. Это репозиторий данного веб-проекта, а не исходного Telegram-бота. В PowerShell из `C:\JS\webu7`:

```powershell
git init -b main
git add .
git status --short
git diff --cached --name-only
```

Перед коммитом убедитесь, что в списке нет `.env`, `private/`, баз SQLite, архивов и пользовательских данных. Их исключает `.gitignore`, но если секреты были добавлены раньше, ignore не удаляет их из Git. Не коммитьте их. Затем (замените OWNER и REPO своими значениями):

```powershell
git commit -m "Prepare U7 web deployment"
git remote add origin git@github.com:OWNER/REPO.git
git push -u origin main
```

Если Git уже настроен, повторять `init` и `remote add` не нужно. Для сервера создайте отдельный SSH-ключ и добавьте его как **read-only Deploy key** в этот приватный репозиторий. Не копируйте личный приватный ключ с компьютера. При первом SSH-подключении проверьте отпечаток ключа Git-хостинга по его официальной документации.

На сервере под `admin`:

```bash
mkdir -p /srv/web-u7-school/deploy-keys
chmod 700 /srv/web-u7-school/deploy-keys
ssh-keygen -t ed25519 -f /srv/web-u7-school/deploy-keys/github -C u7-web-server -N ''
cat /srv/web-u7-school/deploy-keys/github.pub
```

Не перезаписывайте существующий ключ с этим именем. Содержимое **.pub** добавьте в GitHub → нужный приватный репозиторий → Settings → Deploy keys → Add deploy key. **Allow write access не включать**. Приватный файл без `.pub` остаётся только на сервере. Каталог `/srv/web-u7-school` уже существует и принадлежит admin; ключи остаются внутри него, вне Git и вне доступа процесса веба. Существующие ключи и конфигурация `~/.ssh/` не меняются.

```bash
ssh -i /srv/web-u7-school/deploy-keys/github -o IdentitiesOnly=yes -o UserKnownHostsFile=/srv/web-u7-school/deploy-keys/known_hosts -T git@github.com
```

Успех — сообщение об успешной аутентификации и отсутствии shell-доступа; код выхода 1 для этого теста GitHub нормален. Права deploy key описаны в [документации GitHub](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/managing-deploy-keys).

## 2. Подготовить каталоги на сервере

Команды ниже выполняются по SSH под `admin`, предполагается, что это имя владельца развёртывания. Если имя другое, замените его. Не запускайте приложение под root.

```bash
sudo apt-get update
sudo apt-get install -y git curl ca-certificates util-linux
sudo useradd --system --user-group --home-dir /srv/web-u7-school --no-create-home --shell /usr/sbin/nologin u7-web
sudo install -d -o admin -g admin -m 755 /srv/web-u7-school
sudo install -d -o admin -g admin -m 755 /srv/web-u7-school/releases
sudo install -d -o root -g u7-web -m 750 /srv/web-u7-school/shared
sudo install -d -o u7-web -g u7-web -m 700 /srv/web-u7-school/shared/private
git -c 'core.sshCommand=ssh -i /srv/web-u7-school/deploy-keys/github -o IdentitiesOnly=yes -o UserKnownHostsFile=/srv/web-u7-school/deploy-keys/known_hosts' clone --branch main git@github.com:OWNER/REPO.git /srv/web-u7-school/repo
git -C /srv/web-u7-school/repo config core.sshCommand 'ssh -i /srv/web-u7-school/deploy-keys/github -o IdentitiesOnly=yes -o UserKnownHostsFile=/srv/web-u7-school/deploy-keys/known_hosts'
```

Создание пользователя выполняется один раз; если он уже существует, пропустите `useradd`. Проверьте, что порт 4173 свободен (`sudo ss -ltnp 'sport = :4173'`). Он будет слушать только 127.0.0.1; открывать его в firewall не требуется.

## 3. Заполнить конфигурацию приложения

```bash
sudo test -e /srv/web-u7-school/shared/.env || sudo install -o root -g u7-web -m 640 /srv/web-u7-school/repo/deploy/env.production.example /srv/web-u7-school/shared/.env
sudoedit /srv/web-u7-school/shared/.env
```

Заполните `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `MASTER_KEY`, при наличии — `TELEGRAM_BOT_ID`. `APP_ORIGIN=https://u7-hub.kz` содержит только origin; путь задан отдельно: `APP_BASE_PATH=/web/`. Не изменяйте остальные значения примера без необходимости. Формат файла — `KEY=value`, без `export`.

Для **новой пустой базы** сгенерируйте MASTER_KEY один раз:

```bash
/usr/bin/node -e 'console.log(require("node:crypto").randomBytes(32).toString("base64"))'
```

Вставьте результат в конфигурацию на сервере. Не присылайте его в чат и не добавляйте в Git.

Если переносите существующие кабинеты и Telegram-сессии, необходимы **существующая база и тот же MASTER_KEY**. Остановите локальное приложение и переносите SQLite вместе с оставшимися `-wal`/`-shm`, если они есть, через SCP/SFTP в защищённый временный каталог; затем установите файлы в `shared/private/` с владельцем `u7-web:u7-web`, правами 600 и удалите временные копии. Не копируйте работающую SQLite обычным копированием. Ключ берётся из локальной `.env` и вводится через `sudoedit`. Для существующей базы новый ключ не генерируйте. Домен изменится, поэтому войти на сайте потребуется заново; Telegram-связь хранится в базе.

**Не используйте перенесённую Telegram-сессию одновременно локально и на сервере.** Telegram может аннулировать её с ошибкой `AUTH_KEY_DUPLICATED`. После переноса оставьте её только в рабочем экземпляре. Для параллельной локальной разработки создайте отдельную Telegram-сессию через новое подключение в локальном кабинете. Если ошибка уже появилась, отключите Telegram в кабинете и подключите заново отдельно на каждой установке. API ID и API HASH могут быть одинаковыми; сама Telegram-сессия должна быть отдельной. Не переносите локальную базу поверх серверной при обновлении кода.

## 4. Установить службу и опубликовать первую версию

```bash
sudo install -m 644 /srv/web-u7-school/repo/deploy/u7-web.service /etc/systemd/system/u7-web.service
sudo systemctl daemon-reload
sudo systemctl enable u7-web
bash /srv/web-u7-school/repo/deploy/update.sh main
sudo systemctl status u7-web --no-pager
```

Скрипт скачивает коммит из Git, собирает отдельный каталог версии, выполняет тесты, делает согласованную резервную копию существующей SQLite, переключает `current` и перезапускает службу. Проверяет `/web/api/health`. При неудачной активации возвращает предыдущий код; **изменения схемы базы автоматически не откатываются**. Исходники действующей версии и зависимости доступны службе для чтения; запись разрешена только в `shared/private` и служебный временный каталог. Доступ процесса к `/srv/u7-hub`, `/srv/u7-school`, `/srv/web-legal`, checkout `repo` и `deploy-keys` закрыт через InaccessiblePaths; домашние каталоги закрыты через ProtectHome. Ограничения применяются только к новой службе, не меняют права файлов старых проектов. Логи идут в journal.

## 5. Подключить отдельный файл Nginx

```bash
sudo install -m 644 /srv/web-u7-school/repo/deploy/nginx-u7-web.conf /etc/nginx/snippets/u7-web.conf
```

На проверенном сервере конфигурация — обычный файл `/etc/nginx/sites-enabled/u7-hub.kz`. Сначала сделайте резервную копию вне sites-enabled:

```bash
sudo cp -a /etc/nginx/sites-enabled/u7-hub.kz /etc/nginx/u7-hub.kz.before-web.backup
sudoedit /etc/nginx/sites-enabled/u7-hub.kz
```

**Внутри первого HTTPS `server {}`**, с `server_name u7-hub.kz www.u7-hub.kz` и `listen 443 ssl`, добавьте:

```nginx
include /etc/nginx/snippets/u7-web.conf;
```

Сохраните существующие `server_name`, сертификаты, location `/` и настройки основного сайта. Не создавайте второй HTTPS server для того же домена. Если уже есть location `/web`, замените его данным include, чтобы не было конфликта. Перед изменением сделайте копию существующего конфигурационного файла.

В нашем файле `proxy_pass` указан без завершающего `/`, чтобы сохранить префикс `/web/` при передаче в Node; это поведение описано в [документации Nginx](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_pass).

```bash
sudo nginx -t
sudo systemctl reload nginx
curl -fsS https://u7-hub.kz/web/api/health
```

Ожидается `{"ok":true}`. Если `nginx -t` завершается ошибкой, исправьте конфигурацию **до** reload. Откройте `/web/`, проверьте вход, переключение темы и подключение Telegram. Проверка health подтверждает HTTP-доступность, но не выполняет команды боту.

`/web` перенаправляется в `/web/`; JS, CSS, картинки и API также используют `/web/`. Cookie кабинета имеет `Path=/web/`, Secure и HttpOnly. Nginx направляет в приложение только этот префикс; само приложение отвергает запросы вне него. Остальные пути домена продолжает обслуживать прежний сайт. Ссылки на учебные ресурсы и Telegram могут вести на внешние сайты.

**Граница безопасности:** `/web/` и основной сайт имеют один origin. Ограничение Path для cookie и маршрутов не изолирует их от JavaScript основного сайта. Если основной сайт может содержать недоверенный JS, для строгой изоляции нужен отдельный поддомен. Приложение при этом защищает свои данные серверной авторизацией, CSRF, шифрованием Telegram-сессий и правами ОС; компрометация сервера вместе с ключом позволяет расшифровать сессии.

## Дальнейшая разработка и обновления

На компьютере правьте файлы, проверьте сборку и тесты, затем:

```powershell
git add .
git diff --cached --name-only
git commit -m "Describe the change"
git push
```

На сервере для публикации последнего коммита main достаточно:

```bash
bash /srv/web-u7-school/repo/deploy/update.sh main
```

Скрипт берёт свежие исходники из Git, не трогая `.env` и личные данные. Сам служебный checkout `repo` не меняется. Если меняете **deploy/update.sh**, предварительно обновите его: `git -C /srv/web-u7-school/repo pull --ff-only`. Изменения файлов Nginx/systemd устанавливаются отдельно командами из пунктов 4–5 и проверяются перед перезапуском. Не редактируйте `current` вручную: изменения потеряются при следующем обновлении.

Для продолжения разработки на другом компьютере — `git clone`, Node 24, `npm ci --ignore-scripts`, `npm run setup`, заполнение собственной `.env`, `npm run build`, `npm start`. Для обновления уже имеющейся локальной копии — `git pull --ff-only`, установка зависимостей и пересборка. Локальный `APP_BASE_PATH=/`, production `/web/`.

Материалы школы обновляются отдельно: локально `npm run sync:content`, проверить изменения `data/`, закоммитить и опубликовать веб обычным способом. Свежий код бота и содержимое уроков не загружаются в веб автоматически через `git pull` веб-проекта.

## Диагностика и резервные копии

```bash
sudo journalctl -u u7-web -n 80 --no-pager
sudo systemctl restart u7-web
curl -fsS -H 'Host: u7-hub.kz' http://127.0.0.1:4173/web/api/health
```

`shared/private/backups/` содержит снимки базы до обновлений. Храните зашифрованную внешнюю резервную копию базы **и MASTER_KEY**, ограничьте доступ к ней. Архив с исходниками без базы и ключа не восстановит Telegram-подключения. Старые версии и снимки не удаляются автоматически; следите за диском. Для восстановления базы остановите службу и восстановите согласованный снимок с соответствующим ключом. Не публикуйте журналы с личными данными.

Сообщение Ubuntu `System restart required` относится к обновлениям системы, а не к версии Node. Перезагрузку планируйте отдельно с учётом остальных сервисов; служба u7-web после enable стартует при загрузке.
