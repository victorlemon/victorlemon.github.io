# Cacti 1.2.30 完整部署指南（Ubuntu 22.04 + MariaDB + Apache）

> **适用场景**：在 Ubuntu 22.04 LTS 服务器上从零部署 Cacti 1.2.30 网络监控系统  
> **数据库**：MariaDB 10.6（MySQL 完全兼容）  
> **Web 服务**：Apache 2.4 + PHP 8.1  
> **安装方式**：官方 tarball 手动部署（apt 仓库仅提供 1.2.19）  
> **编写日期**：2026-07-03

---

## 目录

1. [环境信息](#1-环境信息)
2. [安装前准备](#2-安装前准备)
3. [第 1 步：安装并配置数据库（MariaDB）](#3-第-1-步安装并配置数据库mariadb)
4. [第 2 步：安装 Web 服务与 PHP](#4-第-2-步安装-web-服务与-php)
5. [第 3 步：下载并部署 Cacti 1.2.30](#5-第-3-步下载并部署-cacti-1230)
6. [第 4 步：配置 PHP（Web + CLI）](#6-第-4-步配置-php-web--cli)
7. [第 5 步：创建数据库和用户](#7-第-5-步创建数据库和用户)
8. [第 6 步：导入 Cacti 数据库 Schema](#8-第-6-步导入-cacti-数据库-schema)
9. [第 7 步：配置 Apache](#9-第-7-步配置-apache)
10. [第 8 步：配置 MariaDB 性能参数](#10-第-8-步配置-mariadb-性能参数)
11. [第 9 步：完成 Web 安装向导](#11-第-9-步完成-web-安装向导)
12. [第 10 步：配置轮询（Poller）](#12-第-10-步配置轮询poller)
13. [第 11 步：配置中文字体（解决图表乱码）](#13-第-11-步配置中文字体解决图表乱码)
14. [第 12 步：配置 Cacti 设置](#14-第-12-步配置-cacti-设置)
15. [问题一：MySQL 用户认证插件冲突](#15-问题一mysql-用户认证插件冲突)
16. [问题二：PHP 配置不满足要求](#16-问题二php-配置不满足要求)
17. [问题三：MySQL 时区未配置](#17-问题三mysql-时区未配置)
18. [问题四：安装目录权限不足](#18-问题四安装目录权限不足)
19. [问题五：公网无法访问](#19-问题五公网无法访问)
20. [问题六：添加交换机后数据源不足](#20-问题六添加交换机后数据源不足)
21. [问题七：图表中文显示乱码](#21-问题七图表中文显示乱码)
22. [问题八：树形视图无内容（树被禁用/锁定）](#22-问题八树形视图无内容树被禁用锁定)
23. [问题九：操作树时报 500 错误（Symfony ExpressionLanguage）](#23-问题九操作树时报-500-错误symfony-expressionlanguage)
24. [问题十：Apache PHP Session 锁导致页面卡死](#24-问题十apache-php-session-锁导致页面卡死)
25. [验证清单](#25-验证清单)
26. [附录](#26-附录)

---

## 1. 环境信息

### 1.1 硬件配置

| 项目 | 值 | 说明 |
|------|-----|------|
| CPU | 2 核 | 建议至少 2 核 |
| 内存 | 1.6 GB | MariaDB 需要至少 512MB 给 InnoDB 缓冲池，其余留给 PHP/Apache |
| 磁盘 | SSD | Cacti 的 RRD 文件频繁写入，SSD 至关重要 |
| 网络 | VPC + 公网 IP | 阿里云 ECS 典型网络架构 |

### 1.2 软件版本

| 软件 | 版本 | 来源 |
|------|------|------|
| 操作系统 | Ubuntu 22.04.5 LTS (Jammy) | 官方镜像 |
| Web 服务器 | Apache 2.4.52 | apt 安装 |
| 数据库 | MariaDB 10.6.23 | apt 安装（MySQL 完全兼容） |
| PHP | 8.1.2 | apt 安装 |
| Cacti | **1.2.30** | 官方 GitHub tarball |
| RRDtool | 1.7.2 | apt 安装 |
| SNMP | 5.9.1（net-snmp） | apt 安装 |

### 1.3 版本差异说明：Cacti 1.2.19 vs 1.2.30

| 差异项 | 1.2.19 | 1.2.30 |
|--------|--------|--------|
| 安装方式 | apt 安装（Ubuntu 仓库提供） | 需从 GitHub 下载 tarball 手动部署 |
| 数据库表数 | 111 | **113**（新增 2 张表） |
| 安装路径 | `/usr/share/cacti/` | `/usr/share/cacti/site/` |
| 文件所有权 | `root:root` | `www-data:www-data` |
| PHP 最低版本 | 7.2 | 7.4（推荐 8.0+） |

---

## 2. 安装前准备

### 2.1 更新系统

```bash
# 更新软件源
sudo apt update

# 升级已有软件
sudo apt upgrade -y
```

### 2.2 安装必要工具

```bash
# 安装 wget、unzip、git 等工具
sudo apt install -y wget unzip git curl
```

---

## 3. 第 1 步：安装并配置数据库（MariaDB）

### 3.1 安装 MariaDB 服务器

```bash
sudo apt install -y mariadb-server mariadb-client
```

### 3.2 启动并设置开机自启

```bash
sudo systemctl start mariadb
sudo systemctl enable mariadb
sudo systemctl status mariadb --no-pager | head -5
```

预期输出：
```
● mariadb.service - MariaDB 10.6.23 database server
     Loaded: loaded
     Active: active (running)
```

### 3.3 安全初始化

```bash
sudo mysql_secure_installation
```

按以下方式回答：

| 问题 | 回答 | 说明 |
|------|------|------|
| Enter current password for root | 直接回车 | 首次安装无密码 |
| Switch to unix_socket auth? | `n` | 保持密码认证（方便后续管理） |
| Change root password? | `n` 或 `y` | 可选，设置 root 密码更安全 |
| Remove anonymous users? | `y` | 删除匿名用户 |
| Disallow root login remotely? | `y` | 禁止 root 远程登录 |
| Remove test database? | `y` | 删除测试数据库 |
| Reload privilege tables? | `y` | 立即生效 |

> **注意**：Ubuntu 22.04 的 MariaDB 默认 root 使用 `unix_socket` 认证插件，即系统 root 用户可以直接 `mysql` 或 `sudo mysql` 登录，无需密码。

### 3.4 验证数据库正常运行

```bash
mysql -e "SELECT VERSION();"
mysql -e "SHOW DATABASES;"
```

预期输出包含 `mariadb`、`mysql`、`performance_schema`、`sys` 四个默认数据库。

---

## 4. 第 2 步：安装 Web 服务与 PHP

### 4.1 安装 Apache + PHP + 所需扩展

```bash
sudo apt install -y apache2 php php-mysql php-gd php-snmp php-xml \
  php-mbstring php-curl php-json php-ldap php-gmp php-intl \
  php-bcmath php-zip
```

各扩展的作用：

| PHP 扩展 | Cacti 中的用途 |
|----------|---------------|
| `php-mysql` | 连接 MariaDB/MySQL 数据库 |
| `php-gd` | 生成图形（GD 库绘图） |
| `php-snmp` | 通过 SNMP 采集网络设备数据 |
| `php-xml` | 解析 XML 配置文件和数据查询 |
| `php-mbstring` | 多字节字符串支持（中文标签） |
| `php-curl` | HTTP 类型的数据采集 |
| `php-json` | JSON 数据处理 |
| `php-ldap` | LDAP 认证集成 |
| `php-gmp` | 大数运算（某些 Cacti 插件需要） |
| `php-intl` | 国际化支持（日期格式等） |
| `php-bcmath` | 精确浮点运算 |
| `php-zip` | ZIP 导入/导出功能 |

### 4.2 验证 PHP 安装

```bash
php -v | head -1
php -m | grep -iE 'mysql|gd|snmp|xml|mbstring|curl|json|ldap|intl|bcmath|zip'
```

### 4.3 安装 RRDtool（绘图引擎）

```bash
sudo apt install -y rrdtool
rrdtool --version | head -1
```

### 4.4 安装 SNMP 工具（采集网络设备数据）

```bash
sudo apt install -y snmp snmpd snmp-mibs-downloader
```

---

## 5. 第 3 步：下载并部署 Cacti 1.2.30

> **为什么要从 tarball 安装？**  
> Ubuntu 22.04 官方仓库中的 Cacti 版本为 **1.2.19**，而最新稳定版是 **1.2.30**。tarball 安装可以获得最新功能和安全修复。

### 5.1 下载 Cacti 1.2.30

```bash
cd /tmp

# 从 GitHub 下载 Cacti 1.2.30
wget -q "https://github.com/Cacti/cacti/archive/refs/tags/release/1.2.30.tar.gz" -O cacti-1.2.30.tar.gz

# 解压
tar xzf cacti-1.2.30.tar.gz

# 查看解压后的目录
ls -la /tmp/cacti-release-1.2.30/
```

### 5.2 如果之前有 apt 安装的 Cacti 1.2.19

> **如果是从零开始的新服务器，跳过此步骤。**

如果之前通过 apt 安装了 Cacti 1.2.19，需要先处理旧版本：

#### 步骤 A：备份旧数据

```bash
# 备份数据库
mysqldump --single-transaction --quick -u root cacti > /root/cacti_db_backup_1.2.19.sql

# 备份旧文件
sudo cp -a /usr/share/cacti/site /root/cacti_site_1.2.19_backup
```

#### 步骤 B：清除旧 Cacti 包

```bash
# 预配置 debconf：跳过交互式提示
echo "cacti cacti/dbconfig-common boolean false" | sudo debconf-set-selections
echo "cacti cacti/dbconfig-reinstall boolean false" | sudo debconf-set-selections
echo "cacti cacti/purge-database boolean false" | sudo debconf-set-selections

# 强制清除旧包（保留数据库）
sudo DEBIAN_FRONTEND=noninteractive dpkg --purge --force-depends cacti
```

### 5.3 部署 Cacti 1.2.30 文件

```bash
# 如果 /usr/share/cacti/site 目录已存在（apt 安装过），先备份
if [ -d /usr/share/cacti/site ]; then
  sudo mv /usr/share/cacti/site /usr/share/cacti/site.backup.$(date +%Y%m%d)
fi

# 创建目标目录
sudo mkdir -p /usr/share/cacti

# 复制新文件到目标位置
sudo cp -a /tmp/cacti-release-1.2.30 /usr/share/cacti/site
```

### 5.4 设置文件所有权

Cacti 1.2.30 要求所有文件归 `www-data` 用户所有（与旧版不同，旧版是 `root:root`）：

```bash
# 所有文件归 www-data
sudo chown -R www-data:www-data /usr/share/cacti/site

# 部分目录需要可写
sudo chmod -R 775 /usr/share/cacti/site/rra
sudo chmod -R 775 /usr/share/cacti/site/log
sudo chmod -R 775 /usr/share/cacti/site/cache
```

### 5.5 验证版本

```bash
cat /usr/share/cacti/site/include/cacti_version
# 预期输出：1.2.30
```

### 5.6 创建 Cacti 日志目录

```bash
# 创建日志文件
sudo touch /var/log/cacti/cacti.log
sudo chown www-data:www-data /var/log/cacti/cacti.log
sudo chmod 664 /var/log/cacti/cacti.log
```

---

## 6. 第 4 步：配置 PHP（Web + CLI）

Cacti 对 PHP 有特定的配置要求，需要同时修改 Web（Apache）和 CLI 两个配置文件。

### 6.1 PHP 配置文件路径

| 用途 | 配置文件路径 |
|------|-------------|
| Apache 模块（Web） | `/etc/php/8.1/apache2/php.ini` |
| CLI 命令行 | `/etc/php/8.1/cli/php.ini` |

### 6.2 Web PHP 配置

```bash
# 修改 memory_limit（128M → 400M）
sudo sed -i 's/^memory_limit = 128M/memory_limit = 400M/' /etc/php/8.1/apache2/php.ini

# 修改 max_execution_time（30 → 60）
sudo sed -i 's/^max_execution_time = 30/max_execution_time = 60/' /etc/php/8.1/apache2/php.ini

# 设置时区为 Asia/Shanghai
sudo sed -i 's/^;date.timezone =/date.timezone = Asia\/Shanghai/' /etc/php/8.1/apache2/php.ini

# 验证
grep -E "^memory_limit|^max_execution_time|^date\.timezone" /etc/php/8.1/apache2/php.ini
```

### 6.3 CLI PHP 配置

CLI 配置影响 Cacti 命令行采集脚本（poller.php），也需要设置时区：

```bash
# CLI 同样需要设置时区
sudo sed -i 's/^;date.timezone =/date.timezone = Asia\/Shanghai/' /etc/php/8.1/cli/php.ini

# 验证
php -r "echo 'CLI timezone: ' . date_default_timezone_get() . PHP_EOL;"
# 预期：CLI timezone: Asia/Shanghai
```

### 6.4 PHP 参数说明

| 参数 | 改前 | 改后 | 原因 |
|------|------|------|------|
| `memory_limit` | 128M | **400M** | Cacti 采集大量数据、生成图表时需要更多内存 |
| `max_execution_time` | 30 | **60** | 采集大量设备时，单个 PHP 脚本可能运行超过 30 秒 |
| `date.timezone` | 未设置 | **Asia/Shanghai** | 必须显式设置，否则 Cacti 报错且时间错乱 |

---

## 7. 第 5 步：创建数据库和用户

### 7.1 生成随机密码

```bash
CACTI_DB_PASS=$(openssl rand -base64 16 | tr -dc 'a-zA-Z0-9' | head -c 20)
echo "Generated password: $CACTI_DB_PASS"
echo "CACTI_DB_PASS=$CACTI_DB_PASS" > /root/.cacti_db_pass
chmod 600 /root/.cacti_db_pass
```

### 7.2 创建数据库

```bash
mysql -e "
CREATE DATABASE IF NOT EXISTS cacti DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
"
```

### 7.3 创建数据库用户

```bash
mysql -e "
CREATE USER IF NOT EXISTS 'cacti'@'localhost' IDENTIFIED BY '$CACTI_DB_PASS';
GRANT ALL PRIVILEGES ON cacti.* TO 'cacti'@'localhost';
FLUSH PRIVILEGES;
"
```

> ⚠️ **关键注意**：MariaDB 10.6 **不支持** `sha256_password` 认证插件。如果安装脚本试图使用该插件，会报 `ERROR 1396`。上述命令使用 MariaDB 默认的 `mysql_native_password`，保证兼容。

### 7.4 验证

```bash
# 验证数据库
mysql -e "SHOW DATABASES LIKE 'cacti';"

# 验证用户
mysql -e "SELECT user, host, plugin FROM mysql.user WHERE user='cacti';"

# 测试连接
mysql -u cacti -p"$CACTI_DB_PASS" cacti -e "SELECT '数据库连接测试成功' AS status;"
```

---

## 8. 第 6 步：导入 Cacti 数据库 Schema

### 8.1 找到 Schema 文件

Cacti 1.2.30 的 Schema 文件位于安装目录下：

```bash
ls -la /usr/share/cacti/site/cacti.sql
```

> 对于 tarball 安装，Schema 文件在 `/usr/share/cacti/site/cacti.sql`  
> 对于 apt 安装（1.2.19），Schema 在 `/usr/share/cacti/conf_templates/cacti.sql`

### 8.2 导入 Schema

```bash
source /root/.cacti_db_pass

mysql -u cacti -p"$CACTI_DB_PASS" cacti < /usr/share/cacti/site/cacti.sql
```

> **注意**：导入过程通常很快（1-3 秒），没有输出信息是正常的。

### 8.3 验证导入结果

```bash
source /root/.cacti_db_pass

mysql -u cacti -p"$CACTI_DB_PASS" cacti \
  -e "SELECT COUNT(*) AS 表数量 FROM information_schema.tables WHERE table_schema='cacti';"
```

预期结果：
```
+----------+
| 表数量   |
+----------+
|      113 |
+----------+
```

> 对比：Cacti 1.2.19 是 **111** 张表，1.2.30 新增了 2 张表。

### 8.4 查看核心表

```bash
mysql -u cacti -p"$CACTI_DB_PASS" cacti \
  -e "SELECT table_name FROM information_schema.tables WHERE table_schema='cacti' ORDER BY table_name LIMIT 15;"
```

---

## 9. 第 7 步：配置 Apache

### 9.1 创建 Cacti 的 Apache 站点配置

```bash
sudo tee /etc/apache2/conf-available/cacti.conf > /dev/null << 'EOF'
Alias /cacti /usr/share/cacti/site

<Directory /usr/share/cacti/site>
    Options FollowSymLinks
    AllowOverride None
    Require all granted

    <IfModule mod_php8.c>
        php_value max_execution_time 60
        php_value memory_limit 400M
        php_value post_max_size 100M
        php_value upload_max_filesize 100M
        php_value max_input_time 120
        php_value max_input_vars 10000
        php_value date.timezone Asia/Shanghai
    </IfModule>
</Directory>

<Directory /usr/share/cacti/site/install>
    Require all denied
</Directory>
EOF
```

### 9.2 启用配置并重启 Apache

```bash
# 启用 Cacti 配置
sudo a2enconf cacti

# 测试配置语法
sudo apache2ctl configtest

# 重启 Apache
sudo systemctl restart apache2
```

### 9.3 验证 Apache 配置

```bash
# 测试 Cacti 页面是否可访问
curl -sI http://localhost/cacti/ | head -5
```

预期输出：
```
HTTP/1.1 200 OK
```

---

## 10. 第 8 步：配置 MariaDB 性能参数

Cacti 作为监控系统，数据库读写频繁。MariaDB 默认参数针对通用场景，需要专项调优。

### 10.1 编辑 MariaDB 配置文件

配置文件位置：`/etc/mysql/mariadb.conf.d/50-server.cnf`

```bash
# 修改排序规则（支持中文排序）
sudo sed -i 's/collation-server.*=.*utf8mb4_general_ci/collation-server      = utf8mb4_unicode_ci/' /etc/mysql/mariadb.conf.d/50-server.cnf

# 修改 InnoDB 缓冲池大小（128M → 400M）
sudo sed -i 's/^#innodb_buffer_pool_size.*/innodb_buffer_pool_size = 400M/' /etc/mysql/mariadb.conf.d/50-server.cnf
```

### 10.2 追加调优参数

```bash
sudo tee -a /etc/mysql/mariadb.conf.d/50-server.cnf > /dev/null << EOF

# Cacti 性能调优参数（2026-07-03）
max_heap_table_size = 32M
tmp_table_size = 32M
join_buffer_size = 64M
innodb_doublewrite = OFF
innodb_flush_log_at_timeout = 3
innodb_read_io_threads = 32
innodb_write_io_threads = 16
innodb_io_capacity = 5000
innodb_io_capacity_max = 10000
EOF
```

### 10.3 参数说明

| 参数 | 默认值 | 调优值 | 作用 |
|------|--------|--------|------|
| `collation-server` | utf8mb4_general_ci | **utf8mb4_unicode_ci** | 支持多语言排序（中文） |
| `innodb_buffer_pool_size` | 128M | **400M** | InnoDB 缓存大小，设为内存的 25% |
| `max_heap_table_size` | 16M | **32M** | 内存表最大尺寸 |
| `tmp_table_size` | 16M | **32M** | 临时表内存大小，避免写入磁盘 |
| `join_buffer_size` | 256K | **64M** | JOIN 操作缓冲区（Cacti 大量 JOIN 查询） |
| `innodb_doublewrite` | ON | **OFF** | MariaDB 10.2.4+ 开启原子写后可关闭 |
| `innodb_flush_log_at_timeout` | 1 | **3** | 降低日志写入频率，减少 IO 压力 |
| `innodb_read_io_threads` | 4 | **32** | 读 IO 线程数（SSD 建议提高） |
| `innodb_write_io_threads` | 4 | **16** | 写 IO 线程数（SSD 建议提高） |
| `innodb_io_capacity` | 200 | **5000** | 适合 SSD 的 IO 吞吐能力 |
| `innodb_io_capacity_max` | 2000 | **10000** | SSD 最大 IO 吞吐 |

### 10.4 重启 MariaDB 使配置生效

```bash
sudo systemctl restart mariadb

# 验证参数生效
mysql -e "
SELECT @@collation_server AS 排序规则,
       @@innodb_buffer_pool_size/1024/1024 AS 缓冲池大小_MB,
       @@max_heap_table_size/1024/1024 AS 最大堆表_MB,
       @@tmp_table_size/1024/1024 AS 临时表_MB,
       @@join_buffer_size/1024/1024 AS JOIN缓冲区_MB,
       @@innodb_doublewrite AS 双写缓冲,
       @@innodb_io_capacity AS IO容量;"
```

---

## 11. 第 9 步：完成 Web 安装向导

### 11.1 配置 MySQL 时区（Web 安装向导的必选项）

Cacti 的 Web 安装向导会检查两个条件：
1. MySQL `time_zone` 表已填充数据
2. Cacti 用户有权限查询该表

```bash
# 填充 MySQL 时区表
sudo mysql_tzinfo_to_sql /usr/share/zoneinfo | mysql -u root mysql

# 验证（应有约 1793 条记录）
mysql -e "SELECT COUNT(*) AS 时区数 FROM mysql.time_zone_name;"

# 授权 cacti 用户查询时区表
source /root/.cacti_db_pass
mysql -e "GRANT SELECT ON mysql.time_zone_name TO 'cacti'@'localhost'; FLUSH PRIVILEGES;"

# 验证 cacti 用户可以查询
mysql -u cacti -p"$CACTI_DB_PASS" -e "SELECT COUNT(*) AS 时区数 FROM mysql.time_zone_name;"
```

### 11.2 配置 Cacti 数据库连接文件

将数据库连接信息写入 Cacti 配置文件，这样 Web 安装向导可以跳过数据库配置步骤：

```bash
source /root/.cacti_db_pass

sudo tee /usr/share/cacti/site/include/config.php > /dev/null << EOF
<?php
\$database_type     = 'mysql';
\$database_default  = 'cacti';
\$database_hostname = 'localhost';
\$database_username = 'cacti';
\$database_password = '$CACTI_DB_PASS';
\$database_port     = '3306';
\$database_ssl      = false;
\$database_ssl_key  = '';
\$database_ssl_cert = '';
\$database_ssl_ca   = '';
\$database_ssl_capath = '';
\$database_ssl_cipher = '';
\$database_persist  = false;
\$retval_path_php   = '/usr/bin/php';
\$url_path          = '/cacti/';
EOF

sudo chown www-data:www-data /usr/share/cacti/site/include/config.php
```

### 11.3 执行 Web 安装

1. 打开浏览器访问：`http://<服务器公网IP>/cacti/`
2. 点击 **Next** 进入下一步
3. **New Install** 已默认选中 → **Next**
4. 检查所有必选项均为绿色 ✅ → **Next**
   - 如果 MySQL 时区检查报错，回到 [11.1 节](#111-配置-mysql-时区web-安装向导的必选项) 处理
   - 如果 PHP 配置检查报错，回到 [第 4 步](#6-第-4-步配置-php-web--cli) 处理
5. 数据库信息已自动从 `config.php` 读取 → **Next**
6. 选择模板语言：默认即可（中文字体见【第 11 步】）→ **Next**
7. 设置管理员密码 → **Next**
8. 安装完成！点击 **Login** 登录

### 11.4 管理员默认账号

| 字段 | 值 |
|------|-----|
| 用户名 | `admin` |
| 密码 | **你在安装向导中设置的密码** |

> **首次登录**：安装向导会让你设置密码，务必记住。

---

## 12. 第 10 步：配置轮询（Poller）

Cacti 通过轮询器（poller）定期采集数据。

### 12.1 配置 crontab

Cacti 的轮询默认每 5 分钟执行一次：

```bash
# 创建 cron 配置文件
echo "*/5 * * * * www-data php /usr/share/cacti/site/poller.php > /dev/null 2>&1" | sudo tee /etc/cron.d/cacti

# 验证
cat /etc/cron.d/cacti
```

### 12.2 手动测试轮询

```bash
# 以 www-data 用户手动执行一次轮询
sudo -u www-data php /usr/share/cacti/site/poller.php --force
```

正常输出应包含：
```
OK <时间戳> - All Processes Complete
```

### 12.3 查看轮询日志

```bash
sudo tail -f /var/log/cacti/cacti.log
```

---

## 13. 第 11 步：配置中文字体（解决图表乱码）

Cacti 使用 RRDtool 绘制图形。RRDtool 默认使用的字体（DejaVu Sans）不支持中文，导致图表上的中文标签显示为方块。

### 13.1 安装中文字体

```bash
# 安装文泉驿正黑（轻量、清晰）
sudo apt install -y fonts-wqy-zenhei

# 验证
fc-list :lang=zh 2>/dev/null
# 应显示：WenQuanYi Zen Hei
```

### 13.2 在 Cacti 中配置字体路径

```bash
source /root/.cacti_db_pass

# 配置 RRDtool 默认字体
mysql -u cacti -p"$CACTI_DB_PASS" cacti -e "
INSERT INTO settings (name, value) 
VALUES ('path_rrdtool_default_font', '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc')
ON DUPLICATE KEY UPDATE value='/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc';
"

# 配置图表各元素的字体
mysql -u cacti -p"$CACTI_DB_PASS" cacti -e "
INSERT INTO settings (name, value) VALUES 
('title_font', '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc'),
('legend_font', '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc'),
('axis_font', '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc'),
('unit_font', '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc'),
('watermark_font', '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc')
ON DUPLICATE KEY UPDATE value='/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc';
"

# 验证
mysql -u cacti -p"$CACTI_DB_PASS" cacti -e "SELECT name, value FROM settings WHERE name LIKE '%font';"
```

### 13.3 验证字体可用

```bash
rrdtool graphv /dev/null \
  --font DEFAULT:12:/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc \
  --title "测试中文显示" \
  --width 100 --height 50 \
  --end now --start end-60
```

如果命令成功返回（无报错），说明字体配置正确。

### 13.4 生效

等待下一次轮询（最长 5 分钟），或手动触发：

```bash
sudo -u www-data php /usr/share/cacti/site/poller.php --force
```

### 13.5 备选字体

| 字体包 | 命令 | 说明 |
|--------|------|------|
| WenQuanYi Zen Hei | `apt install fonts-wqy-zenhei` | ✅ 推荐，轻量清晰 |
| WenQuanYi Micro Hei | `apt install fonts-wqy-microhei` | 更细的笔画 |
| Noto Sans CJK | `apt install fonts-noto-cjk` | Google 出品，美观但体积大（~200MB） |

---

## 14. 第 12 步：配置 Cacti 设置

### 14.1 配置轮询器（Poller）

登录 Cacti Web 界面：
**控制台(Console) → 设置(Settings) → 轮询器(Poller)**

| 参数 | 推荐值 | 说明 |
|------|--------|------|
| Poller Type | `cmd.php` | 单线程轮询，适合中小规模 |
| Cron Interval | `*/5 * * * *` | 每 5 分钟采集一次 |
| Number of Threads | `1` | cmd.php 单线程，不需修改 |

> **如果需要更高性能**：安装 `cacti-spine`（多线程轮询器）：
> ```bash
> # spine 需要通过源码编译（apt 仓库无 1.2.30 版）
> # 从 GitHub 下载编译
> ```

### 14.2 配置日志

**控制台 → 设置 → 日志**

| 参数 | 推荐值 |
|------|--------|
| Log Level | `MEDIUM`（默认） |
| Log Cycle | `Daily` |
| Log Path | `/var/log/cacti/cacti.log` |

### 14.3 配置视觉选项

**控制台 → 设置 → 视觉**

| 参数 | 推荐值 |
|------|--------|
| 默认树 | `Default Tree` |
| 图形字体 | `/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc` |

---

## 15. 问题一：MySQL 用户认证插件冲突

**现象**：安装时提示 `ERROR 1396: ALTER USER failed for 'cacti'@'localhost'`

**原因**：安装脚本试图将 `cacti` 用户的认证方式改为 `sha256_password`，但 MariaDB 10.6 不支持该插件。

**解决**：
```bash
# 删除旧用户
mysql -e "DROP USER IF EXISTS 'cacti'@'localhost'; FLUSH PRIVILEGES;"

# 用默认的 mysql_native_password 重新创建
source /root/.cacti_db_pass
mysql -e "CREATE USER 'cacti'@'localhost' IDENTIFIED BY '$CACTI_DB_PASS';"
mysql -e "GRANT ALL PRIVILEGES ON cacti.* TO 'cacti'@'localhost'; FLUSH PRIVILEGES;"
```

## 16. 问题二：PHP 配置不满足要求

**现象**：Web 安装检查页面显示 memory_limit / max_execution_time / date.timezone 不达标。

**原因**：默认 PHP 配置较低。

**解决**：见 [第 4 步 — 配置 PHP](#6-第-4-步配置-php-web--cli)。

## 17. 问题三：MySQL 时区未配置

**现象**：Cacti 安装检查报 `time_zone_name` 表无数据或无权限。

**解决**：见 [11.1 节 — 配置 MySQL 时区](#111-配置-mysql-时区web-安装向导的必选项)。

## 18. 问题四：安装目录权限不足

**现象**：Web 安装检查页面显示部分目录不可写入。

**解决**：
```bash
sudo chown -R www-data:www-data /usr/share/cacti/site/rra /usr/share/cacti/site/log /usr/share/cacti/site/cache
sudo chmod 775 /usr/share/cacti/site/rra /usr/share/cacti/site/log /usr/share/cacti/site/cache
```

## 19. 问题五：公网无法访问

**现象**：服务器本机 `curl http://localhost/cacti/` 正常，但公网 IP 不通。

**原因**：云服务商安全组（Security Group）未放行 80 端口入站流量。

**解决**：

登录阿里云控制台 → 网络与安全 → **安全组** → 找到实例绑定的安全组 → **入方向** → **添加规则**：

| 参数 | 值 |
|------|-----|
| 规则方向 | **入方向** |
| 授权策略 | **允许** |
| 协议类型 | **TCP** |
| 端口范围 | **80/80** |
| 授权对象 | `0.0.0.0/0`（或指定办公网络 IP） |

> 规则生效时间：添加后约 1-2 分钟。

## 20. 问题六：添加交换机后数据源不足

**现象**：添加华为交换机后只有 20 个数据源，但交换机实际有 51 个接口。

**原因**：添加设备时选了错误的模板（"Net-SNMP Device" 是服务器模板，不是交换机模板）。

**解决**：
1. **控制台 → 设备(Devices)** → 点击交换机
2. 将 **主机模板(Host Template)** 从 "Net-SNMP Device" 改为 **"Generic SNMP Device"** 或 **"Cisco Router"**
3. 点击 **保存(Save)**
4. 找到 **SNMP - Interface Statistics** 数据查询 → 点击 **重新索引(Reindex)**
5. **控制台 → 创建 → 新图(New Graphs)** → 选择该设备
6. 勾选所有接口 → **创建(Create)**

各模板的用途：

| 模板 ID | 模板名称 | 适用设备 |
|---------|---------|---------|
| 2 | Cisco Router | ✅ 交换机/路由器 |
| 3 | Generic SNMP Device | ✅ 通用网络设备 |
| 4 | Local Linux Machine | ❌ Linux 服务器 |
| 5 | Net-SNMP Device | ❌ Linux 服务器 |
| 6 | Windows Device | ❌ Windows 服务器 |

## 21. 问题七：图表中文显示乱码

**现象**：图表上的中文标签显示为方块或问号。

**解决**：见 [第 11 步 — 配置中文字体](#13-第-11-步配置中文字体解决图表乱码)。

## 22. 问题八：树形视图无内容（树被禁用/锁定）

**现象**：点击 **图形(Graphs) → 树形(Tree)** 后页面空白。

**原因**：树在数据库中被禁用（`enabled` 为 `-` 或 `0`）或锁定（`locked` 为 `1`）。

**诊断与修复**：
```bash
# 查看所有树的状态
mysql -u cacti -p'密码' cacti -e "SELECT id, name, enabled, locked FROM graph_tree;"

# 修复：启用并解锁
mysql -u cacti -p'密码' cacti -e "UPDATE graph_tree SET enabled='on', locked=0 WHERE id=树ID;"
```

## 23. 问题九：操作树时报 500 错误（Symfony ExpressionLanguage）

**现象**：点击删除树或操作树时，浏览器报 500 Internal Server Error。Apache 错误日志显示：
```
PHP Fatal error: Class "Symfony\Component\ExpressionLanguage\ExpressionLanguage" not found
```

**原因**：Debian/Ubuntu 的 PHP 库自动加载机制问题。`php-phpmyadmin-motranslator` 依赖 `php-symfony-expression-language`，但 autoloader 未被全局注册。

**修复**：
```bash
# 在 Cacti 的 global_languages.php 中添加 autoloader 引用
sudo sed -i '21i\
/* register mobundle autoloader */\
require_once("/usr/share/php/PhpMyAdmin/MoTranslator/autoload.php");\
' /usr/share/cacti/site/include/global_languages.php

# 验证修复
php -r "
require_once '/usr/share/php/PhpMyAdmin/MoTranslator/autoload.php';
echo 'ExpressionLanguage: ' . (class_exists('Symfony\\Component\\ExpressionLanguage\\ExpressionLanguage') ? 'OK' : 'MISSING') . PHP_EOL;
"
```

> ⚠️ **注意**：Cacti 包升级时此修改会被覆盖，需要重新添加。

## 24. 问题十：Apache PHP Session 锁导致页面卡死

**现象**：在 Cacti 中操作时页面突然卡住不动。

**原因**：PHP 使用文件存储 Session，第一个请求未完成时锁定 Session 文件，后续请求必须等待。

**解决**：
```bash
# 刷新页面 (F5/Ctrl+F5)

# 如果无效，清理 PHP Session 文件
sudo rm -rf /var/lib/php/sessions/sess_*
sudo systemctl restart apache2
```

---

## 25. 验证清单

### 25.1 服务状态

```bash
systemctl is-active mariadb      # 应为：active
systemctl is-active apache2      # 应为：active
```

### 25.2 Cacti 版本

```bash
cat /usr/share/cacti/site/include/cacti_version
# 应为：1.2.30
```

### 25.3 PHP 配置

```bash
grep -E "^memory_limit|^max_execution_time|^date\.timezone" /etc/php/8.1/apache2/php.ini
```

预期：
```
memory_limit = 400M
max_execution_time = 60
date.timezone = Asia/Shanghai
```

### 25.4 数据库

```bash
# 数据库表数量
mysql -u cacti -p'密码' cacti -e \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='cacti';"
# 预期：113

# MySQL 时区表
mysql -u cacti -p'密码' -e "SELECT COUNT(*) FROM mysql.time_zone_name;"
# 预期：1793
```

### 25.5 MariaDB 配置

```bash
mysql -e "SELECT @@collation_server AS collation, @@innodb_buffer_pool_size/1024/1024 AS buffer_MB;"
# 预期：utf8mb4_unicode_ci, 400
```

### 25.6 Web 访问

```bash
curl -sL -o /dev/null -w "HTTP %{http_code}\n" http://localhost/cacti/
# 预期：200
```

### 25.7 轮询测试

```bash
sudo -u www-data php /usr/share/cacti/site/poller.php --force 2>&1 | tail -3
# 预期：OK <timestamp> - All Processes Complete
```

### 25.8 中文字体

```bash
fc-list :lang=zh 2>/dev/null | head -1
mysql -u cacti -p'密码' cacti -e "SELECT name, value FROM settings WHERE name LIKE '%font%' AND value LIKE '%wqy%';"
```

### 25.9 Symfony 自动加载

```bash
php -r "echo class_exists('Symfony\\Component\\ExpressionLanguage\\ExpressionLanguage') ? 'OK' : 'MISSING';"
# 预期：OK
```

---

## 26. 附录

### 26.1 Cacti 1.2.30 文件结构

| 路径 | 用途 |
|------|------|
| `/usr/share/cacti/site/` | Cacti 主程序目录 |
| `/usr/share/cacti/site/include/config.php` | 数据库连接配置 |
| `/usr/share/cacti/site/include/cacti_version` | 版本号 |
| `/usr/share/cacti/site/cacti.sql` | 初始数据库 Schema |
| `/usr/share/cacti/site/rra/` | RRD 数据文件目录 |
| `/usr/share/cacti/site/log/` | Cacti 日志 |
| `/usr/share/cacti/site/scripts/` | 脚本文件 |
| `/usr/share/cacti/site/resource/snmp_queries/` | SNMP 数据查询定义 |
| `/usr/share/cacti/site/cli/` | 命令行工具 |
| `/usr/share/cacti/site/plugins/` | 插件目录 |

### 26.2 服务管理命令

```bash
# MariaDB
sudo systemctl status mariadb          # 查看状态
sudo systemctl restart mariadb         # 重启
sudo systemctl start mariadb           # 启动
sudo systemctl stop mariadb            # 停止

# Apache
sudo systemctl status apache2          # 查看状态
sudo systemctl reload apache2          # 平滑重载（不中断连接）
sudo systemctl restart apache2         # 重启
```

### 26.3 Cacti CLI 工具

| 命令 | 功能 |
|------|------|
| `php /usr/share/cacti/site/poller.php --force` | 强制立即执行轮询 |
| `php /usr/share/cacti/site/cli/add_graphs.php --host-id=1 --graph-type=ds --graph-template-id=63 --snmp-query-id=4 --snmp-query-type-id=13` | 为设备创建接口流量图 |
| `php /usr/share/cacti/site/cli/poller_reindex_hosts.php --id=1` | 重新索引主机的 SNMP 查询 |
| `php /usr/share/cacti/site/cli/host_update_template.php --host-id=1 --host-template=3` | 更换设备模板 |
| `php /usr/share/cacti/site/cli/add_device.php --description="交换机名称" --ip="IP地址" --template=3 --community="public"` | 命令行添加设备 |

### 26.4 SNMP 诊断命令

```bash
# 查看交换机所有接口名称
snmpwalk -v 2c -c 社区名 交换机IP 1.3.6.1.2.1.2.2.1.2

# 查看接口数量
snmpwalk -v 2c -c 社区名 交换机IP 1.3.6.1.2.1.2.2.1.2 | wc -l

# 查看设备型号
snmpget -v 2c -c 社区名 交换机IP .1.3.6.1.2.1.1.1.0

# 注意：华为交换机必须用数字 OID，文本 OID（如 sysDescr.0）会报错
```

### 26.5 日志文件路径

| 日志 | 路径 | 查看命令 |
|------|------|---------|
| Cacti 日志 | `/var/log/cacti/cacti.log` | `tail -f /var/log/cacti/cacti.log` |
| Apache 错误日志 | `/var/log/apache2/error.log` | `tail -f /var/log/apache2/error.log` |
| MariaDB 日志 | `/var/log/mysql/error.log` | `tail -f /var/log/mysql/error.log` |
| PHP 错误日志 | `/var/log/apache2/error.log` | 与 Apache 共享 |

### 26.6 升级注意事项（apt 1.2.19 → tarball 1.2.30）

如果之前通过 apt 安装了 Cacti 1.2.19，需注意：

1. **rsync --delete 会删除 rra 软链接**：如果 `rra/` 目录是软链接到 `/var/lib/cacti/rra/`，`rsync --delete` 会误删。升级后需重建：
   ```bash
   ln -sf /var/lib/cacti/rra /usr/share/cacti/site/rra
   ```

2. **文件所有权变化**：旧版是 `root:root`，1.2.30 要求 `www-data:www-data`

3. **数据库升级**：部署新文件后，运行数据库升级脚本：
   ```bash
   cd /usr/share/cacti/site && php cli/upgrade_database.php
   ```

4. **配置文件需保留**：升级时确保 `include/config.php` 不被覆盖

### 26.7 数据库凭据记录

| 项目 | 值 |
|------|-----|
| Cacti 数据库名 | `cacti` |
| 数据库用户 | `cacti`@localhost |
| 数据库密码 | `IFuAHJPrlxSt` |
| Cacti 管理员 | `admin`（密码在 Web 安装时设置） |
| Web 访问地址 | `http://服务器公网IP/cacti/` |
| PHP 时区 | `Asia/Shanghai` |
| 数据库表数 | 113（Cacti 1.2.30） |

---

> **文档版本**：v1.0（针对 Cacti 1.2.30 全新编写）  
> **编写日期**：2026-07-03  
> **适用平台**：Ubuntu 22.04 LTS / MariaDB 10.6 / Apache 2.4 / PHP 8.1  
> **安装方式**：官方 GitHub tarball 手动部署  
> **同机其他服务**：Zabbix 7.0.27（共用同一 MariaDB 实例）
