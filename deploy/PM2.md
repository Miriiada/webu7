# kalki-server: третий проект в существующем PM2

Проверено по выводу сервера: `/srv/u7-hub` — основной сайт, `/srv/u7-school` — бот; оба работают под `admin` в PM2 с именами `u7-hub` и `u7-school-bot`. `/srv/web-u7-school` пуст, порт 4173 свободен на момент проверки. В `/etc/nginx/sites-enabled/u7-hub.kz` первый HTTPS server обслуживает `u7-hub.kz`, `/api/` идёт на 3101, `/tg-webhook` — на 8443. `/web/` ещё нет.

Веб запускается отдельно как **u7-web**, только `127.0.0.1:4173`. Скрипт `update-pm2.sh` управляет только этим именем. Не выполняйте `pm2 restart all`, `pm2 delete all`, `pm2 kill`, `pm2 update` и не перезагружайте сервер ради установки веба.

Доступ sudo теперь подтверждён. Рекомендуется [основная инструкция с отдельным пользователем и systemd](README.md), чтобы изолировать веб от двух процессов под admin. Эта инструкция PM2 оставлена как альтернатива; запуск и обычные обновления через PM2 возможны без sudo. Не запускайте оба варианта одновременно.

## 1. Подготовить приватный репозиторий на компьютере

Следуйте разделу 1 [общей инструкции](README.md) до отправки исходников в Git. Репозиторий должен содержать именно этот веб-проект; `.env`, базы и SSH-ключи в него не добавляются. Ниже OWNER/REPO заменяются реальными значениями.

## 2. Подготовить папки и отдельный ключ на сервере

Все команды запускайте под `admin`:

```bash
command -v git npm pm2 curl tar flock
chmod 700 /srv/web-u7-school
mkdir -p /srv/web-u7-school/releases /srv/web-u7-school/shared/private /srv/web-u7-school/shared/logs /srv/web-u7-school/deploy-keys
chmod 700 /srv/web-u7-school/shared /srv/web-u7-school/shared/private /srv/web-u7-school/shared/logs /srv/web-u7-school/deploy-keys
ssh-keygen -t ed25519 -f /srv/web-u7-school/deploy-keys/github -C u7-web-server -N ''
cat /srv/web-u7-school/deploy-keys/github.pub
```

Ожидаются пути для всех шести программ; если какой-либо программы нет, остановитесь и попросите владельца установить её. `chmod` относится только к новому каталогу веба. Если файл ключа уже существует, не перезаписывайте его.

Текст **github.pub** добавьте в GitHub → приватный репозиторий веба → Settings → Deploy keys. Не включайте **Allow write access**. Приватный `github` не покидает сервер. Существующие `~/.ssh/id_ed25519`, `~/.ssh/config` и `authorized_keys` не меняются.

```bash
git -c 'core.sshCommand=ssh -i /srv/web-u7-school/deploy-keys/github -o IdentitiesOnly=yes -o UserKnownHostsFile=/srv/web-u7-school/deploy-keys/known_hosts' clone --branch main git@github.com:OWNER/REPO.git /srv/web-u7-school/repo
git -C /srv/web-u7-school/repo config core.sshCommand 'ssh -i /srv/web-u7-school/deploy-keys/github -o IdentitiesOnly=yes -o UserKnownHostsFile=/srv/web-u7-school/deploy-keys/known_hosts'
```

При первом подключении сверяйте показанный отпечаток SSH-сервера с [официальными отпечатками GitHub](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints). Не отключайте проверку ключа хоста. Ключи, known_hosts и настройка git относятся только к вебу.

## 3. Конфигурация и существующие кабинеты

```bash
test -e /srv/web-u7-school/shared/.env || install -m 600 /srv/web-u7-school/repo/deploy/env.production.example /srv/web-u7-school/shared/.env
nano /srv/web-u7-school/shared/.env
```

Заполните `MASTER_KEY`, `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, при наличии `TELEGRAM_BOT_ID`. Другие параметры оставьте как в примере. Веб читает этот файл напрямую; ключи не добавляются в ecosystem.config.json и не экспортируются в PM2.

Локальный `.env` веба находится в `C:\JS\webu7\.env`. Его не нужно присылать в чат. Это конфигурация веба, **не секреты существующего бота**. Для переноса имеющихся кабинетов требуется тот же MASTER_KEY и согласованная копия SQLite из локального `private/`: остановите локальный веб перед копированием, передайте базу и оставшиеся WAL/SHM через SFTP/SCP в серверный `shared/private/`, задайте файлам права 600. Для новой пустой базы создайте новый MASTER_KEY один раз командой из общей инструкции.

Содержимое `.env` не коммитится; база и ключ сохраняются при обновлениях. При переносе на новый домен браузерный вход потребуется снова.

## 4. Собрать и запустить только веб

```bash
bash /srv/web-u7-school/repo/deploy/update-pm2.sh main
pm2 list
curl -fsS -H 'Host: u7-hub.kz' http://127.0.0.1:4173/web/api/health
```

Ожидается третье приложение `u7-web` в статусе online и `{"ok":true}`. Перед первой активацией скрипт проверит порт и конфликт имени процесса. Сборка и тесты проходят до переключения. При ошибке активации возвращается предыдущий код, а при неудаче первого запуска удаляется только новый процесс `u7-web`. Схема базы автоматически не откатывается.

После успешного первого запуска проверьте список: оба прежних приложения должны остаться online. Владелец сервера должен подтвердить механизм автозагрузки PM2. Если для текущего пользователя уже настроен startup hook, `pm2 save` сохраняет **весь текущий список** процессов для восстановления после перезагрузки и не перезапускает их. Скрипт не выполняет save автоматически и не меняет startup hook. Само наличие работающего PM2 не доказывает, что автозагрузка настроена.

## 5. Задание владельцу сервера: подключить Nginx один раз

Передайте ему файл `repo/deploy/nginx-u7-web.conf` и следующие инструкции. В существующем `/etc/nginx/sites-enabled/u7-hub.kz` нужно добавить include **только в первый server**, с `server_name u7-hub.kz www.u7-hub.kz` и `listen 443 ssl`. Не менять server редиректов старого домена, HTTP-блок, root, сертификаты, `/api/`, `/tg-webhook`, `/legal/` и `/`.

Команды выполняет человек с root/sudo:

```bash
sudo cp -a /etc/nginx/sites-enabled/u7-hub.kz /etc/nginx/u7-hub.kz.before-web.backup
sudo install -m 644 /srv/web-u7-school/repo/deploy/nginx-u7-web.conf /etc/nginx/snippets/u7-web.conf
sudoedit /etc/nginx/sites-enabled/u7-hub.kz
```

Добавить внутрь первого HTTPS server:

```nginx
include /etc/nginx/snippets/u7-web.conf;
```

Затем проверить; reload выполнять только если тест успешен:

```bash
sudo nginx -t
sudo systemctl reload nginx
curl -fsS https://u7-hub.kz/web/api/health
```

Порт 4173 в firewall не открывается. До подключения Nginx публичный `/web/` не заработает. Пароль sudo не нужно присылать в чат. Обходить права через изменение основного сайта не требуется.

## Обычное обновление

На компьютере: сборка, тесты, коммит, `git push`. На сервере:

```bash
bash /srv/web-u7-school/repo/deploy/update-pm2.sh main
```

При изменении самого скрипта предварительно `git -C /srv/web-u7-school/repo pull --ff-only`. Конфигурация PM2 используется из новой версии автоматически. Изменения Nginx устанавливает владелец сервера отдельно.

Логи только веба:

```bash
pm2 logs u7-web --lines 40 --nostream
```

Не публикуйте журнал целиком без просмотра на личные данные. Старые версии и резервные копии базы в `shared/private/backups/` сохраняются; следите за свободным местом. Храните зашифрованную внешнюю копию базы вместе с MASTER_KEY. Для безопасности не используйте архив всего `/srv/web-u7-school` как архив исходников: там будут ключи и личные данные.

## Что ограничено, а что требует отдельной изоляции

API, файлы и cookie веба находятся под `/web/`; приложение отвергает другие URL-префиксы. Исходники и секреты веба — только в `/srv/web-u7-school`; PM2 при этом продолжает хранить собственные метаданные в своём существующем каталоге `~/.pm2/`.

Все три приложения под одним `admin` имеют одинаковые права ОС. Права 600/700 защищают от других пользователей, но не от компрометации соседнего процесса под admin. Для более строгой защиты Telegram-сессий используйте [отдельного пользователя и systemd](README.md), попросив владельца выполнить настройку. Это также ограничивает запись веба на уровне ОС. Не запускайте оба варианта одновременно.

Аналогично `/web/` имеет общий origin с основным сайтом: Path cookie не изолирует от JavaScript соседнего сайта. Для строгой браузерной изоляции нужен поддомен. Шифрование Telegram-сессий не защищает от злоумышленника, получившего одновременно базу и MASTER_KEY.

Конфигурация и адресное управление приложением основаны на [официальной документации PM2](https://pm2.keymetrics.io/docs/usage/application-declaration/); сохранение списка и startup hook — на [документации автозагрузки](https://pm2.keymetrics.io/docs/usage/startup/).
