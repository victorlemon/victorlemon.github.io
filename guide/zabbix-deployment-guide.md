# Zabbix 7.0.27 部署完整记录

> **部署环境**：Ubuntu 22.04 LTS / MariaDB 10.6 (MySQL 兼容) / Apache 2.4 / PHP 8.1  
> **同机已有服务**：Cacti 1.2.19（共用同一数据库实例）  
> **编写日期**：2026-07-03

---

## 目录

1. [环境准备与检查](#1-环境准备与检查)
2. [添加 Zabbix 官方仓库](#2-添加-zabbix-官方仓库)
3. [安装 MySQL (MariaDB) 数据库服务器](#3-安装-mysql-mariadb-数据库服务器)
4. [安装 Zabbix 相关包](#4-安装-zabbix-相关包)
5. [创建 Zabbix 数据库和用户](#5-创建-zabbix-数据库和用户)
6. [导入 Zabbix 初始 Schema](#6-导入-zabbix-初始-schema)
7. [配置 Zabbix Server](#7-配置-zabbix-server)
8. [配置 Zabbix 前端 (Web)](#8-配置-zabbix-前端-web)
9. [配置 Apache](#9-配置-apache)
10. [启动服务并验证](#10-启动服务并验证)
11. [最终验证清单](#11-最终验证清单)
12. [附录：关键文件与路径](#12-附录关键文件与路径)

---

## 1. 环境准备与检查

在开始部署之前，先检查当前系统的状态，确认是否已有已安装的组件。

### 1.1 检查系统版本

```bash
# 确认 Ubuntu 版本
cat /etc/os-release | head -5

# 查看内核版本
uname -a

# 查看主机名和 IP
hostname -I
```

### 1.2 检查是否已安装其他监控系统

```bash
# 检查 Cacti 是否已安装
dpkg -l | grep cacti

# 检查其他监控工具
dpkg -l | grep -iE 'nagios|prometheus|grafana'
```

### 1.3 检查已安装的数据库和 Zabbix 相关包

```bash
# 检查 MariaDB/MySQL 安装情况
dpkg -l | grep -iE 'mysql|mariadb'

# 检查 Zabbix 安装情况
dpkg -l | grep -i zabbix

# 检查 MySQL/MariaDB 二进制文件是否存在
which mysql mysqld
```

### 1.4 检查现有数据库状态

```bash
# 查看 MySQL/MariaDB 服务状态
systemctl status mariadb 2>/dev/null || systemctl status mysql 2>/dev/null

# 如果数据库已运行，查看已有数据库
mysql -e "SHOW DATABASES;" 2>/dev/null

# 查看已有的 MySQL 用户
mysql -e "SELECT user, host, plugin FROM mysql.user;" 2>/dev/null
```

### 1.5 检查 Apache 和 PHP

```bash
# Apache 版本和状态
apache2ctl -v 2>/dev/null
systemctl status apache2 2>/dev/null | head -5

# PHP 版本
php -v | head -1

# PHP MySQL 扩展
php -m | grep -i mysql
```

---

## 2. 添加 Zabbix 官方仓库

Zabbix 7.0 的包需要通过 Zabbix 官方仓库获取，Ubuntu 默认源不包含 Zabbix 7.0。

### 2.1 下载并安装 Zabbix 仓库配置包

```bash
# 下载 Zabbix 7.0 官方仓库配置包（Ubuntu 22.04 Jammy）
wget https://repo.zabbix.com/zabbix/7.0/ubuntu/pool/main/z/zabbix-release/zabbix-release_latest_7.0+ubuntu22.04_all.deb

# 安装仓库配置包（添加 apt 源和 GPG 密钥）
dpkg -i zabbix-release_latest_7.0+ubuntu22.04_all.deb
```

### 2.2 更新包列表

```bash
# 更新 apt 缓存，使新添加的 Zabbix 仓库生效
apt update
```

> **说明**：`apt update` 会从 Zabbix 仓库拉取包列表，输出中应该能看到类似以下内容的行：
> ```
> Get:5 https://repo.zabbix.com/zabbix/7.0/ubuntu jammy InRelease [xx.x kB]
> Get:6 https://repo.zabbix.com/zabbix/7.0/ubuntu jammy/main amd64 Packages [xx.x kB]
> ```

### 2.3 验证仓库是否添加成功

```bash
# 查看 Zabbix 仓库源文件
cat /etc/apt/sources.list.d/zabbix.list

# 搜索 Zabbix 7.0 包
apt-cache search zabbix-server-mysql | grep "^zabbix"
```

预期输出：
```
zabbix-server-mysql - Zabbix network monitoring solution - server (MySQL)
```

---

## 3. 安装 MySQL (MariaDB) 数据库服务器

Zabbix 需要一个 MySQL 兼容的数据库来存储监控数据。在 Ubuntu 22.04 上，我们使用 **MariaDB**（MySQL 的完全兼容分支，API、协议、命令行完全一致）。

### 3.1 安装 MariaDB 服务器

```bash
# 安装 MariaDB 服务器和客户端
apt install -y mariadb-server mariadb-client
```

### 3.2 启动 MariaDB 服务并设置开机自启

```bash
# 启动 MariaDB
systemctl start mariadb

# 设置开机自启
systemctl enable mariadb

# 验证服务状态
systemctl status mariadb --no-pager | head -10
```

预期输出包含：
```
● mariadb.service - MariaDB 10.6.23 database server
     Loaded: loaded
     Active: active (running)
```

### 3.3 安全初始化（可选但推荐）

MariaDB 安装完成后，建议运行安全初始化脚本：

```bash
mysql_secure_installation
```

该脚本会依次询问：
1. **Enter current password for root** — 首次安装直接回车（无密码）
2. **Switch to unix_socket authentication?** — 输入 `n`（保持密码认证）
3. **Change the root password?** — 输入 `n`（或 `y` 来设置密码）
4. **Remove anonymous users?** — 输入 `y`
5. **Disallow root login remotely?** — 输入 `y`
6. **Remove test database and access to it?** — 输入 `y`
7. **Reload privilege tables now?** — 输入 `y`

> **注意**：Ubuntu 22.04 的 MariaDB 默认使用 `unix_socket` 认证插件，即 root 用户只能通过系统 root 身份或 `sudo` 登录 MySQL，无需密码。
>
> ```bash
> # root 用户连接数据库的方法：
> mysql                          # 以当前系统用户身份连接（如果 root 系统用户）
> sudo mysql                     # 以 sudo 提权连接
> mysql -u root -p               # 如果设置了密码，使用密码连接
> ```

### 3.4 验证数据库已正常运行

```bash
# 确认数据库服务运行中
systemctl is-active mariadb

# 确认可以连接数据库
mysql -e "SELECT VERSION();"

# 查看现有数据库列表
mysql -e "SHOW DATABASES;"
```

预期输出：
```
active
+-------------------------+
| VERSION()               |
+-------------------------+
| 10.6.23-MariaDB-0ubuntu0.22.04.1 |
+-------------------------+
Database
information_schema
mysql
performance_schema
sys
```

---

## 4. 安装 Zabbix 相关包

### 4.1 安装 Zabbix Server、前端、Agent 等组件

```bash
# 安装 Zabbix 全部所需组件（一行命令安装所有包）
apt install -y zabbix-server-mysql zabbix-frontend-php zabbix-apache-conf zabbix-sql-scripts zabbix-agent
```

各包功能说明：

| 包名 | 用途 |
|------|------|
| `zabbix-server-mysql` | Zabbix Server 主程序（MySQL 后端版本） |
| `zabbix-frontend-php` | Zabbix Web 前端界面（PHP 编写） |
| `zabbix-apache-conf` | Apache 的 Zabbix 站点配置 |
| `zabbix-sql-scripts` | 初始数据库结构 SQL 脚本 |
| `zabbix-agent` | Zabbix Agent（用来监控本机） |

### 4.2 验证安装版本

```bash
# 查看各包版本
dpkg -l | grep zabbix

# 查看 Zabbix Server 版本号
zabbix_server --version 2>&1 | head -1
```

### 4.3 安装 PHP MySQL 扩展（如果未自动安装）

```bash
# 确认 PHP MySQL 扩展已安装
php -m | grep -i mysql

# 如果未显示 mysqli 或 mysqlnd，手动安装
apt install -y php-mysql
```

---

## 5. 创建 Zabbix 数据库和用户

Zabbix 需要独立的数据库和专用数据库用户。

### 5.1 生成 Zabbix 数据库密码

```bash
# 生成 20 位随机密码（仅包含字母和数字，便于复制）
ZABBIX_DB_PASS=$(openssl rand -base64 16 | tr -dc 'a-zA-Z0-9' | head -c 20)
echo "Generated password: $ZABBIX_DB_PASS"

# 保存密码到文件，后续步骤中可通过 source 命令引用
echo "ZABBIX_DB_PASS=$ZABBIX_DB_PASS" > /root/.zabbix_db_pass

# 设置安全权限（只有 root 可读）
chmod 600 /root/.zabbix_db_pass
```

### 5.2 创建数据库和用户

```bash
# 创建 zabbix 数据库（使用 utf8mb4 字符集，支持中文和 emoji）
mysql -e "
CREATE DATABASE IF NOT EXISTS zabbix CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
"

# 创建 zabbix 用户并授权（仅允许本地 localhost 连接）
mysql -e "
CREATE USER IF NOT EXISTS 'zabbix'@'localhost' IDENTIFIED BY '$ZABBIX_DB_PASS';
GRANT ALL PRIVILEGES ON zabbix.* TO 'zabbix'@'localhost';
FLUSH PRIVILEGES;
"
```

> **数据库配置说明**：
> - `utf8mb4` 字符集：支持完整的 Unicode，包括中文、日文、特殊符号
> - `utf8mb4_bin` 排序规则：二进制比较，严格区分大小写
> - `zabbix@localhost`：只允许从本机连接，安全性更高
> - `GRANT ALL PRIVILEGES ON zabbix.*`：仅对 zabbix 数据库有全部权限

### 5.3 验证数据库和用户创建成功

```bash
# 验证数据库已创建
mysql -e "SHOW DATABASES LIKE 'zabbix';"

# 验证用户已创建
mysql -e "SELECT user, host, authentication_string FROM mysql.user WHERE user='zabbix';"

# 测试用户是否能正常连接数据库
mysql -u zabbix -p"$ZABBIX_DB_PASS" zabbix -e "SELECT 'Zabbix 数据库连接测试成功' AS status;"
```

---

## 6. 导入 Zabbix 初始 Schema

Zabbix 的初始数据库结构（表定义、索引、初始数据）存储在压缩的 SQL 文件中，需要导入到 zabbix 数据库中。

### 6.1 查看 SQL 脚本文件

```bash
# SQL 脚本文件路径
ls -la /usr/share/zabbix-sql-scripts/mysql/server.sql.gz

# 查看文件大小（用于估算导入时间）
du -h /usr/share/zabbix-sql-scripts/mysql/server.sql.gz
```

### 6.2 执行 Schema 导入

```bash
source /root/.zabbix_db_pass

# 将压缩的 SQL 文件解压并通过管道导入数据库
# zcat 解压 .gz 文件，| 管道传输到 mysql 命令
zcat /usr/share/zabbix-sql-scripts/mysql/server.sql.gz | \
  mysql -u zabbix -p"$ZABBIX_DB_PASS" zabbix
```

> **重要说明**：
> - 该文件约 10-15 MB（压缩后），解压后约 100+ MB
> - 导入过程可能需要 **1-3 分钟**，具体取决于服务器性能
> - 导入过程中没有输出信息是正常的，耐心等待即可
> - 如果导入中途中断（如网络断连、终端关闭），会导致数据库不完整，需要重建后重导

### 6.3 验证导入结果

```bash
source /root/.zabbix_db_pass

# 检查总表数（Zabbix 7.0.27 完整应为 203 张表）
mysql -u zabbix -p"$ZABBIX_DB_PASS" zabbix \
  -e "SELECT COUNT(*) AS table_count FROM information_schema.tables WHERE table_schema='zabbix';"

# 查看前 10 张表的名称
mysql -u zabbix -p"$ZABBIX_DB_PASS" zabbix \
  -e "SELECT table_name FROM information_schema.tables WHERE table_schema='zabbix' ORDER BY table_name LIMIT 10;"
```

预期结果：
```
+-------------+
| table_count |
+-------------+
|         203 |
+-------------+

+-----------------------+
| table_name            |
+-----------------------+
| acknowledges          |
| actions               |
| alerts                |
| auditlog              |
| autoreg_host          |
| changelog             |
| conditions            |
| config                |
| config_autoreg_tls    |
| connector             |
+-----------------------+
```

### 6.4 如果导入中断：重建并重导

如果导入过程中断（Ctrl+C、网络问题等），数据库只有部分表，需要重建后重试：

```bash
source /root/.zabbix_db_pass

# 第一步：检查当前表数（如果远低于 203，说明导入不完整）
mysql -u zabbix -p"$ZABBIX_DB_PASS" zabbix \
  -e "SELECT COUNT(*) AS table_count FROM information_schema.tables WHERE table_schema='zabbix';"

# 第二步：删除不完整的数据库并重建
mysql -e "DROP DATABASE IF EXISTS zabbix; CREATE DATABASE zabbix CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;"

# 第三步：重新授权
mysql -e "GRANT ALL PRIVILEGES ON zabbix.* TO 'zabbix'@'localhost'; FLUSH PRIVILEGES;"

# 第四步：重新导入（耐心等待完成）
zcat /usr/share/zabbix-sql-scripts/mysql/server.sql.gz | \
  mysql -u zabbix -p"$ZABBIX_DB_PASS" zabbix

# 第五步：验证表数
mysql -u zabbix -p"$ZABBIX_DB_PASS" zabbix \
  -e "SELECT COUNT(*) AS table_count FROM information_schema.tables WHERE table_schema='zabbix';"
```

---

## 7. 配置 Zabbix Server

### 7.1 检查默认配置

```bash
# 查看配置文件中的数据库相关设置
grep -n '^DB' /etc/zabbix/zabbix_server.conf
```

默认内容：
```
105:DBName=zabbix
121:DBUser=zabbix
```

可以看到：`DBName` 和 `DBUser` 已配置，但 **`DBPassword` 缺失** — 需要手动添加。

### 7.2 添加数据库密码到配置

```bash
source /root/.zabbix_db_pass

# 在 DBUser=zabbix 之后插入 DBPassword 行
sed -i "s/^DBUser=zabbix/DBUser=zabbix\nDBPassword=$ZABBIX_DB_PASS/" /etc/zabbix/zabbix_server.conf

# 验证修改结果
grep '^DB' /etc/zabbix/zabbix_server.conf
```

预期输出：
```
DBName=zabbix
DBUser=zabbix
DBPassword=S2698A3NVgbvmXaVWykI
```

### 7.3 完整 DB 配置段参考

`/etc/zabbix/zabbix_server.conf` 中与数据库相关的配置项完整说明：

```ini
### Option: DBName         # 数据库名称（必需）
DBName=zabbix

### Option: DBUser         # 数据库用户名（必需）
DBUser=zabbix

### Option: DBPassword     # 数据库密码（必需，默认无此配置，需要手动添加）
DBPassword=<你的密码>

### Option: DBSocket       # MySQL socket 文件路径（默认即可）
# DBSocket=/var/run/mysqld/mysqld.sock

### Option: DBPort         # 数据库端口（默认 3306）
# DBPort=3306
```

---

## 8. 配置 Zabbix 前端 (Web)

Zabbix 的 PHP 前端需要独立的数据库配置文件才能连接到数据库。

### 8.1 确认前端配置目录存在

```bash
# 检查目录是否存在
ls -la /etc/zabbix/web/
```

### 8.2 创建前端数据库配置文件

```bash
source /root/.zabbix_db_pass

cat > /etc/zabbix/web/zabbix.conf.php << EOF
<?php
\$DB['TYPE']     = 'MYSQL';
\$DB['SERVER']   = 'localhost';
\$DB['PORT']     = '0';
\$DB['DATABASE'] = 'zabbix';
\$DB['USER']     = 'zabbix';
\$DB['PASSWORD'] = '$ZABBIX_DB_PASS';
\$DB['SCHEMA']   = '';
\$DB['ENCRYPT']  = false;
\$DB['KEY_FILE']  = '';
\$DB['CERT_FILE'] = '';
\$DB['CA_FILE']   = '';
\$DB['CIPHER_LIST'] = '';
\$DB['DOUBLE_IEEE754'] = 0;
\$ZBX_SERVER      = 'localhost';
\$ZBX_SERVER_PORT = '10051';
\$ZBX_SERVER_NAME = '';
\$IMAGE_FORMAT_DEFAULT = IMAGE_FORMAT_PNG;
EOF
```

### 8.3 验证前端配置文件

```bash
# 显示配置文件内容的前 8 行
cat /etc/zabbix/web/zabbix.conf.php | head -8
```

确认包含以下关键配置：
```php
<?php
$DB['TYPE']     = 'MYSQL';
$DB['SERVER']   = 'localhost';
$DB['DATABASE'] = 'zabbix';
$DB['USER']     = 'zabbix';
$DB['PASSWORD'] = 'S2698A3NVgbvmXaVWykI';
```

### 8.4 配置文件参数说明

| 参数 | 值 | 说明 |
|------|-----|------|
| `$DB['TYPE']` | `'MYSQL'` | 数据库类型（MySQL/MariaDB） |
| `$DB['SERVER']` | `'localhost'` | 数据库服务器地址 |
| `$DB['PORT']` | `'0'` | 使用默认端口（3306） |
| `$DB['DATABASE']` | `'zabbix'` | 数据库名称 |
| `$DB['USER']` | `'zabbix'` | 数据库用户名 |
| `$DB['PASSWORD']` | `'<密码>'` | 数据库密码 |
| `$ZBX_SERVER` | `'localhost'` | Zabbix Server 地址 |
| `$ZBX_SERVER_PORT` | `'10051'` | Zabbix Server 端口 |

---

## 9. 配置 Apache

Zabbix 的 Apache 配置由 `zabbix-apache-conf` 包提供，存放在 `/etc/apache2/conf-available/zabbix.conf`。

### 9.1 默认配置存在的问题

Ubuntu 22.04 使用 Apache 2.4，而 `zabbix-apache-conf` 包提供的默认配置使用的是 Apache **2.2 语法**（`Order allow,deny`、`Allow from all`），这会导致 Apache 配置语法检查失败。

**需要做的修改：**
- `Order allow,deny` + `Allow from all` → `Require all granted`
- `Order deny,allow` + `Deny from all` → `Require all denied`
- `mod_php7.c` → `mod_php8.c`（PHP 8.1 对应）

### 9.2 写入正确的 Apache 2.4 配置

```bash
cat > /etc/apache2/conf-available/zabbix.conf << 'EOF'
# Define /zabbix alias, this is the default
<IfModule mod_alias.c>
    Alias /zabbix /usr/share/zabbix
</IfModule>

<Directory "/usr/share/zabbix">
    Options FollowSymLinks
    AllowOverride None
    Require all granted

    <IfModule mod_php8.c>
        php_value max_execution_time 300
        php_value memory_limit 128M
        php_value post_max_size 16M
        php_value upload_max_filesize 2M
        php_value max_input_time 300
        php_value max_input_vars 10000
        php_value always_populate_raw_post_data -1
    </IfModule>
</Directory>

<Directory "/usr/share/zabbix/conf">
    Require all denied
</Directory>
<Directory "/usr/share/zabbix/app">
    Require all denied
</Directory>
<Directory "/usr/share/zabbix/include">
    Require all denied
</Directory>
<Directory "/usr/share/zabbix/local">
    Require all denied
</Directory>
<Directory "/usr/share/zabbix/vendor">
    Require all denied
</Directory>
EOF
```

PHP 参数说明：

| 参数 | 值 | 说明 |
|------|-----|------|
| `max_execution_time` | 300 | PHP 脚本最大执行时间（秒），Zabbix 图表生成可能需要较长时间 |
| `memory_limit` | 128M | PHP 最大内存使用，低于此值可能导致图表空白 |
| `post_max_size` | 16M | POST 数据大小限制 |
| `upload_max_filesize` | 2M | 上传文件大小限制 |
| `max_input_time` | 300 | PHP 解析输入数据的最大时间 |
| `max_input_vars` | 10000 | 最大输入变量数 |

### 9.3 启用 Zabbix 配置并重载 Apache

```bash
# 启用 Zabbix Apache 配置
a2enconf zabbix

# 测试 Apache 配置语法是否正确
apache2ctl configtest

# 重载 Apache（平滑重载，不中断现有连接）
systemctl reload apache2
```

> **注意**：使用 `reload` 而不是 `restart`，可以保持现有 HTTP 连接不中断。

---

## 10. 启动服务并验证

### 10.1 启动 Zabbix Server

```bash
# 启用开机自启
systemctl enable zabbix-server

# 启动服务
systemctl start zabbix-server

# 查看服务状态
systemctl status zabbix-server --no-pager
```

预期输出（关注 Active 行）：
```
● zabbix-server.service - Zabbix Server
     Loaded: loaded (/lib/systemd/system/zabbix-server.service; enabled; ...)
     Active: active (running) since ...
```

### 10.2 验证 Zabbix Server 进程树

```bash
# 查看完整的进程树
ps auxf | grep zabbix | grep -v grep
```

正常的 Zabbix Server 应当有 40+ 个子进程，包含以下关键组件：

```
zabbix_server                          # 主进程（PID 1）
  ├── ha manager                       # 高可用管理器
  ├── service manager                  # 服务管理器
  ├── configuration syncer             # 配置同步（从 DB 加载配置）
  ├── alert manager / alerter #1-3     # 告警管理
  ├── preprocessing manager            # 预处理管理（处理 JMX/SNMP 等）
  ├── lld manager + worker #1-2        # 自动发现（LLD）
  ├── housekeeper                      # 数据清理（自动删除过期数据）
  ├── timer                            # 定时器（触发周期任务）
  ├── http poller / browser poller     # HTTP 探测
  ├── discovery manager                # 网络发现
  ├── history syncer #1-4              # 历史数据写入数据库
  ├── poller #1-5                      # 数据轮询器（采集监控数据）
  ├── trapper #1-5                     # 数据接收器（接收 Agent 主动推送）
  ├── icmp pinger                      # ICMP ping 监测
  ├── snmp poller                      # SNMP 轮询
  ├── agent poller                     # Zabbix Agent 轮询
  ├── proxy poller                     # 代理轮询（如果使用了 proxy）
  ├── internal poller                  # Zabbix 内部监控
  ├── odbc poller                      # ODBC 数据库监控
  └── availability manager             # 可用性管理
```

### 10.3 验证 Web 前端

```bash
# 使用 curl 测试 Zabbix 前端是否可访问
curl -sI http://localhost/zabbix/ | head -10
```

预期输出包含：
```
HTTP/1.1 200 OK
Server: Apache/2.4.52 (Ubuntu)
Set-Cookie: zbx_session=...     ← 说明 PHP 和数据库连接正常
```

### 10.4 确认 Cacti 不受影响（如适用）

```bash
# 如果同机有 Cacti，验证其仍正常
curl -sI http://localhost/cacti/ | head -5

# MariaDB 服务状态
systemctl is-active mariadb
```

### 10.5 查看 Zabbix Server 启动日志

```bash
# 查看最新 30 行日志
journalctl -u zabbix-server --no-pager -n 30
```

检查是否有以下常见错误：
- `Unable to connect to database` — 数据库连接失败
- `Access denied for user 'zabbix'` — 密码错误
- `Table 'zabbix.xxx' doesn't exist` — Schema 导入不完整

### 10.6 登录 Zabbix Web 前端

打开浏览器访问：
```
http://<服务器IP>/zabbix/
```

默认管理员账号：

| 字段 | 值 |
|------|-----|
| 用户名 | `Admin` |
| 密码 | `zabbix` |

> **注意**：
> - 用户名 `Admin` 首字母 **大写**
> - 登录后请立即修改默认密码：**用户头像 → User settings → Change password**
> - 默认语言为英文，可在 **User settings → Language** 中选择 `Chinese (zh_CN)`

---

## 11. 最终验证清单

部署完成后，逐项验证：

| # | 检查项 | 预期结果 | 验证命令 |
|---|--------|---------|----------|
| 1 | MariaDB 运行中 | `active` | `systemctl is-active mariadb` |
| 2 | Zabbix 数据库存在 | 输出 `zabbix` | `mysql -e "SHOW DATABASES LIKE 'zabbix';"` |
| 3 | 数据库表完整 | 表数 `203` | `mysql -u zabbix -p$PASS zabbix -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='zabbix';"` |
| 4 | Zabbix Server 运行中 | `active (running)` | `systemctl is-active zabbix-server` |
| 5 | Zabbix Server 开机自启 | `enabled` | `systemctl is-enabled zabbix-server` |
| 6 | Zabbix Web 可访问 | `HTTP/1.1 200 OK` | `curl -sI http://localhost/zabbix/ \| head -1` |
| 7 | Cacti 正常（如适用） | `HTTP/1.1 200 OK` | `curl -sI http://localhost/cacti/ \| head -1` |
| 8 | 前端 DB 配置存在 | 文件内容正确 | `cat /etc/zabbix/web/zabbix.conf.php \| head -5` |
| 9 | Server DB 密码已配置 | 显示 DBPassword | `grep '^DBPassword' /etc/zabbix/zabbix_server.conf` |
| 10 | Server 日志无报错 | 无 ERROR | `journalctl -u zabbix-server --no-pager -n 20 \| grep -i error` |

---

## 12. 附录：关键文件与路径

### 12.1 Zabbix 相关文件

| 文件/目录 | 用途 |
|-----------|------|
| `/etc/zabbix/zabbix_server.conf` | Zabbix Server 主配置文件 |
| `/etc/zabbix/web/zabbix.conf.php` | Zabbix Web 前端数据库连接配置 |
| `/etc/zabbix/zabbix_agentd.conf` | Zabbix Agent 配置文件 |
| `/usr/share/zabbix/` | Zabbix Web 前端文件目录 |
| `/usr/share/zabbix-sql-scripts/mysql/server.sql.gz` | Zabbix 初始数据库 Schema（压缩包） |
| `/root/.zabbix_db_pass` | 保存的数据库密码文件（`source` 命令引用） |

### 12.2 Apache 相关文件

| 文件/目录 | 用途 |
|-----------|------|
| `/etc/apache2/conf-available/zabbix.conf` | Zabbix Apache 配置 |
| `/etc/apache2/conf-enabled/zabbix.conf` | 已启用的配置（软链接到 conf-available） |

### 12.3 MariaDB 相关文件

| 文件/目录 | 用途 |
|-----------|------|
| `/etc/mysql/mariadb.cnf` | MariaDB 主配置文件 |
| `/etc/mysql/mariadb.conf.d/` | MariaDB 配置片段目录（50-server.cnf 等） |
| `/var/run/mysqld/mysqld.sock` | MySQL 本地 Socket 文件 |
| `/var/lib/mysql/` | 数据库数据文件存储目录 |
| `/var/log/mysql/` | MariaDB 日志目录 |

### 12.4 服务管理命令速查

```bash
# ─── Zabbix Server ───
systemctl status zabbix-server       # 查看状态
systemctl start zabbix-server        # 启动
systemctl stop zabbix-server         # 停止
systemctl restart zabbix-server      # 重启
systemctl enable zabbix-server       # 设置开机自启
systemctl disable zabbix-server      # 取消开机自启
journalctl -u zabbix-server -n 50    # 查看最近 50 行日志
journalctl -u zabbix-server -f       # 实时跟踪日志

# ─── MariaDB ───
systemctl status mariadb             # 查看状态
systemctl start mariadb              # 启动
systemctl stop mariadb               # 停止
systemctl restart mariadb            # 重启
systemctl enable mariadb             # 设置开机自启

# ─── Apache ───
systemctl status apache2             # 查看状态
systemctl reload apache2             # 平滑重载（不中断连接）
systemctl restart apache2            # 重启
apache2ctl configtest                # 测试配置语法
a2enconf <name>                      # 启用某个配置
a2disconf <name>                     # 禁用某个配置
```

### 12.5 Web 访问地址

| 服务 | 访问地址 |
|------|---------|
| Zabbix 前端 | `http://<服务器IP>/zabbix/` |
| Cacti 前端 | `http://<服务器IP>/cacti/`（如适用） |

### 12.6 数据库凭据摘要

| 项目 | 值 |
|------|-----|
| 数据库类型 | MariaDB 10.6 (MySQL 100% 兼容) |
| Zabbix 数据库名 | `zabbix` |
| Zabbix 数据库用户 | `zabbix`@localhost |
| Zabbix 数据库密码 | `S2698A3NVgbvmXaVWykI` |
| Cacti 数据库 | `cacti`（不受本次部署影响） |
| Zabbix 默认管理员 | `Admin` / `zabbix` |

### 12.7 常用故障排查命令

```bash
# 1. 检查 Zabbix Server 是否在监听
ss -tlnp | grep 10051

# 2. 检查数据库连接
mysql -u zabbix -p'<密码>' zabbix -e "SELECT 1;"

# 3. 检查 Apache 错误日志
tail -50 /var/log/apache2/error.log

# 4. 检查 Zabbix 前端错误
tail -50 /var/log/apache2/other_vhosts_access.log

# 5. 检查磁盘空间（数据库需要足够空间）
df -h /var/lib/mysql

# 6. 测试 Zabbix Agent 连接
zabbix_get -s 127.0.0.1 -p 10050 -k system.hostname
```

---

> **文档版本**：v2.0  
> **编写日期**：2026-07-03  
> **部署方式**：从零开始，Ubuntu 22.04 apt 包安装 Zabbix 7.0.27  
> **数据库**：MariaDB 10.6（MySQL 完全兼容，命令、协议、驱动 100% 通用）  
> **同机已有服务**：Cacti 1.2.19（共用同一 MariaDB 实例，互不影响）
