# Prometheus + Grafana 部署手册（Ubuntu 22.04）

> **适用场景**：在 Ubuntu 22.04 LTS 服务器上部署 Prometheus 监控系统 + Grafana 可视化面板  
> **同机已有**：Cacti 1.2.30（网络设备监控）、Zabbix 7.0.27（服务器监控）  
> **编写日期**：2026-07-03

---

## 目录

1. [环境信息](#1-环境信息)
2. [Vim 编辑器快速上手](#2-vim-编辑器快速上手)
3. [安装 Prometheus](#3-安装-prometheus)
4. [安装 Grafana](#4-安装-grafana)
5. [配置 Grafana 连接 Prometheus](#5-配置-grafana-连接-prometheus)
6. [安装 Node Exporter（本机监控）](#6-安装-node-exporter本机监控)
7. [端口汇总与安全组配置](#7-端口汇总与安全组配置)
8. [常用排错命令](#8-常用排错命令)

---

## 1. 环境信息

### 1.1 软件版本

| 软件 | 版本 | 安装方式 |
|------|------|---------|
| 操作系统 | Ubuntu 22.04.5 LTS | 阿里云 ECS 镜像 |
| Prometheus | 2.53.4 | 二进制 tarball，手动部署 |
| Grafana | 11.3.0 | 官方 deb 包 (`dpkg -i`) |
| Node Exporter | 1.8.2 | 二进制 tarball，手动部署 |

### 1.2 端口规划

| 服务 | 端口 | 用途 |
|------|------|------|
| Prometheus | 9090 | Web UI + API |
| Grafana | 3000 | 可视化仪表盘 |
| Node Exporter | 9100 | 主机指标采集 |

---

## 2. Vim 编辑器快速上手

本手册中的配置文件全部使用 **Vim** 编辑。以下是从零开始的完整使用指南。

### 2.1 打开文件

```bash
vim /path/to/file          # 打开已有文件，或创建新文件
vim /path/to/file +42      # 打开文件并跳转到第 42 行
vim /path/to/file +/search # 打开文件并跳转到第一个匹配 "search" 的位置
```

### 2.2 Vim 的四种模式

```
┌──────────────────────────────────────────────────┐
│                    NORMAL（普通模式）               │
│  启动 vim 时的默认模式，用于移动光标和操作文本        │
│  按 Esc 从其他模式返回此模式                        │
├──────────────────────────────────────────────────┤
│                      ↓ 按 i / a / o / I / A / O  │
├──────────────────────────────────────────────────┤
│                    INSERT（插入模式）               │
│  按 i 进入，此时可以像普通编辑器一样输入文字           │
│  按 Esc 返回 NORMAL 模式                           │
├──────────────────────────────────────────────────┤
│                      ↓ 按 v / V / Ctrl+v          │
├──────────────────────────────────────────────────┤
│                    VISUAL（可视模式）               │
│  选择文本区域，然后按 d（删除）、y（复制）、c（修改）  │
│  v = 字符选择，V = 行选择，Ctrl+v = 块选择          │
├──────────────────────────────────────────────────┤
│                      ↓ 按 :                        │
├──────────────────────────────────────────────────┤
│                    COMMAND（命令模式）              │
│  输入 :w 保存，:q 退出，:wq 保存退出，:q! 强制退出   │
│  :set number 显示行号，:set nonumber 隐藏行号       │
└──────────────────────────────────────────────────┘
```

### 2.3 常用光标移动（NORMAL 模式下）

| 按键 | 功能 |
|------|------|
| `h` / `j` / `k` / `l` | 左 / 下 / 上 / 右（一个字符） |
| `w` | 跳到下一个单词开头 |
| `b` | 跳到上一个单词开头 |
| `0` | 跳到行首 |
| `^` | 跳到行首第一个非空白字符 |
| `$` | 跳到行尾 |
| `gg` | 跳到文件第一行 |
| `G` | 跳到文件最后一行 |
| `42G` 或 `:42` | 跳到第 42 行 |
| `Ctrl+d` | 向下翻半页 |
| `Ctrl+u` | 向上翻半页 |
| `Ctrl+f` | 向下翻一页 |
| `Ctrl+b` | 向上翻一页 |
| `%` | 跳转到匹配的括号 `{ } [ ] ( )` |

### 2.4 编辑操作（NORMAL 模式下）

| 按键 | 功能 |
|------|------|
| `i` | 在光标前插入（最常用） |
| `I` | 在行首插入 |
| `a` | 在光标后插入 |
| `A` | 在行尾插入 |
| `o` | 在下方新建一行并插入 |
| `O` | 在上方新建一行并插入 |
| `x` | 删除光标下的字符 |
| `dd` | 删除整行 |
| `2dd` | 删除 2 行 |
| `dw` | 删除一个单词 |
| `d$` | 删除到行尾 |
| `yy` | 复制整行（yank） |
| `2yy` | 复制 2 行 |
| `p` | 在光标后粘贴 |
| `P` | 在光标前粘贴 |
| `u` | 撤销 |
| `Ctrl+r` | 重做（反撤销） |
| `.` | 重复上一次操作 |

### 2.5 搜索与替换

```vim
# 搜索（NORMAL 模式下）
/关键词     → 向下搜索 "关键词"，按 n 跳到下一个，N 跳到上一个
?关键词     → 向上搜索 "关键词"

# 替换（COMMAND 模式下）
:s/旧/新          → 替换当前行第一个匹配
:s/旧/新/g        → 替换当前行所有匹配
:%s/旧/新/g       → 替换全文所有匹配
:%s/旧/新/gc      → 替换全文，每次确认（c = confirm）
:3,10s/旧/新/g    → 只替换第 3-10 行
```

### 2.6 保存与退出（COMMAND 模式下）

| 命令 | 功能 |
|------|------|
| `:w` | 保存文件 |
| `:w /tmp/backup.txt` | 另存为 |
| `:q` | 退出（如果有未保存修改则拒绝） |
| `:q!` | 强制退出（放弃修改） |
| `:wq` | 保存并退出 |
| `:x` | 保存并退出（等价于 :wq） |
| `ZZ` | 保存并退出（NORMAL 模式下，按大写 Z 两次） |
| `ZQ` | 不保存退出 |
| `:e!` | 重新加载文件，放弃所有修改 |

### 2.7 实用技巧

| 按键 | 功能 |
|------|------|
| `:set number` | 显示行号 |
| `:set nonumber` | 隐藏行号 |
| `:set paste` | 粘贴模式（避免自动缩进干扰） |
| `:set nopaste` | 关闭粘贴模式 |
| `:! command` | 在 vim 中执行 shell 命令（如 `:! pwd`） |
| `:r !command` | 将命令输出插入到当前光标位置 |
| `:r /path/file` | 将另一个文件内容插入到当前光标位置 |

> **快速粘贴外部内容的推荐步骤**：
> 1. 在终端复制文本（Ctrl+Shift+C）
> 2. vim 中输入 `:set paste`（关闭自动缩进）
> 3. 按 `i` 进入插入模式
> 4. 右键粘贴（或 Ctrl+Shift+V）
> 5. 按 `Esc`，输入 `:set nopaste`

---

## 3. 安装 Prometheus

### 3.1 下载 Prometheus 二进制包

```bash
cd /tmp

# 从 GitHub 下载（如果慢，用清华镜像）
wget "https://github.com/prometheus/prometheus/releases/download/v2.53.4/prometheus-2.53.4.linux-amd64.tar.gz"

# 国内镜像备选：
# wget "https://mirrors.tuna.tsinghua.edu.cn/github-release/prometheus/prometheus/LatestRelease/prometheus-2.53.4.linux-amd64.tar.gz"
```

### 3.2 解压并安装到 /opt

```bash
cd /tmp
tar xzf prometheus-2.53.4.linux-amd64.tar.gz
sudo mv prometheus-2.53.4.linux-amd64 /opt/prometheus
```

### 3.3 创建 Prometheus 系统用户

```bash
# 创建无家目录、不可登录的系统用户
sudo useradd --no-create-home --shell /bin/false prometheus

# 设置目录所有权
sudo chown -R prometheus:prometheus /opt/prometheus
```

### 3.4 创建 Prometheus 配置文件

```bash
sudo mkdir -p /etc/prometheus

# 用 vim 创建配置文件
sudo vim /etc/prometheus/prometheus.yml
```

进入 vim 后：
1. 按 `i` 进入插入模式
2. 粘贴以下内容（或逐行输入）：

```yaml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: 'prometheus'
    static_configs:
      - targets: ['localhost:9090']

  - job_name: 'node_exporter'
    static_configs:
      - targets:
        - 'localhost:9100'
```

3. 按 `Esc` 回到普通模式
4. 输入 `:wq` 保存退出

### 3.5 创建 systemd 服务文件

```bash
sudo vim /etc/systemd/system/prometheus.service
```

按 `i` 进入插入模式，输入：

```ini
[Unit]
Description=Prometheus
Documentation=https://prometheus.io/docs/
Wants=network-online.target
After=network-online.target

[Service]
User=prometheus
Group=prometheus
Type=simple
Restart=on-failure
ExecStart=/opt/prometheus/prometheus \
  --config.file=/etc/prometheus/prometheus.yml \
  --storage.tsdb.path=/var/lib/prometheus/ \
  --web.console.templates=/opt/prometheus/consoles \
  --web.console.libraries=/opt/prometheus/console_libraries

[Install]
WantedBy=multi-user.target
```

按 `Esc` → `:wq` 保存退出。

### 3.6 创建数据目录并启动

```bash
sudo mkdir -p /var/lib/prometheus
sudo chown prometheus:prometheus /var/lib/prometheus

# 重新加载 systemd，加载新的服务文件
sudo systemctl daemon-reload

# 启用开机自启
sudo systemctl enable prometheus

# 启动服务
sudo systemctl start prometheus
```

### 3.7 验证

```bash
# 检查服务状态
systemctl status prometheus --no-pager | head -10

# 检查端口监听
ss -tlnp | grep 9090

# 测试 HTTP 访问
curl -sI http://localhost:9090 | head -3
```

浏览器访问 `http://<服务器IP>:9090` 可看到 Prometheus Web UI。

---

## 4. 安装 Grafana

### 4.1 安装方式一：通过 apt 仓库安装（网络好时推荐）

```bash
# 添加 Grafana GPG 密钥
sudo apt-get install -y gnupg2 software-properties-common
sudo wget -q -O /usr/share/keyrings/grafana.key https://apt.grafana.com/gpg.key

# 添加 Grafana apt 源
echo "deb [signed-by=/usr/share/keyrings/grafana.key] https://apt.grafana.com stable main" | sudo tee /etc/apt/sources.list.d/grafana.list

# 更新并安装
sudo apt-get update
sudo apt-get install -y grafana
```

> **apt 安装的 grafana 会自动处理所有依赖，不会出现下面描述的 `iU` 问题**。

### 4.2 安装方式二：手动下载 deb 包安装（仓库慢时推荐）

```bash
cd /tmp

# 从官方下载 deb 包
wget https://dl.grafana.com/oss/release/grafana_11.3.0_amd64.deb

# 使用 dpkg 安装
sudo dpkg -i grafana_11.3.0_amd64.deb
```

### 4.3 ⚠️ 常见问题：`dpkg -i` 后 `systemctl` 找不到服务文件

#### 现象

执行 `systemctl enable grafana-server` 时报错：

```
Failed to enable unit: Unit file grafana-server.service does not exist.
```

执行 `systemctl start grafana-server` 同样报错：

```
Failed to start grafana-server.service: Unit grafana-server.service not found.
```

#### 原因分析

`dpkg -i` 安装时，如果缺少依赖包，dpkg 只会解压文件而**不会执行 post-install 脚本**。systemd 服务文件正是由 post-install 脚本安装的。

**判断方法**——查看包状态：

```bash
dpkg -l | grep grafana
```

输出第二列的状态码：
- `ii` = 正确安装（installed **ok** configured）✅
- `iU` = 解压了但**未配置**（installed **un**packed）❌

**如果看到 `iU`，说明包没装完。**

进一步确认：

```bash
dpkg -s grafana
```

查看 `Status:` 行：
- `Status: install ok installed` → ✅ 正常
- `Status: install ok unpacked` → ❌ 未配置

检查服务文件：

```bash
# 查看 systemd 服务文件是否存在
ls -la /usr/lib/systemd/system/grafana-server.service*

# 如果只有 .dpkg-new 文件，没有 .service 文件，说明 post-install 没执行
# 输出示例：grafana-server.service.dpkg-new  ← 只有这个，没有 .service
```

同理，检查其他配置文件：

```bash
ls -la /etc/default/grafana-server*
ls -la /etc/init.d/grafana-server*
```

#### 根因

Grafana deb 包的依赖关系：

```
grafana
  └── 依赖 musl
        └── 未安装 → dpkg 不执行 post-install → 服务文件没装到位
```

#### 解决方法

**方法一：安装缺失依赖后自动完成配置（推荐）**

```bash
# 1. 安装缺失的依赖
sudo apt install -y musl

# 安装 musl 时会自动触发 grafana 的 post-install 脚本，
# 完成以下工作：
#   - 安装 /usr/lib/systemd/system/grafana-server.service
#   - 安装 /etc/default/grafana-server
#   - 安装 /etc/init.d/grafana-server
#   - 创建 grafana 系统用户
#   - 创建 /var/lib/grafana、/var/log/grafana 等目录
#   - 启动 grafana-server 服务

# 2. 验证包状态
dpkg -l | grep grafana
# 现在应该是 ii（installed ok configured）

# 3. 设置开机自启并启动
sudo systemctl enable grafana-server
sudo systemctl start grafana-server

# 注意：post-install 脚本可能已经启动了服务，
# 但为了确保开机自启，仍需手动执行 enable
```

**方法二：手动安装服务文件（如果 apt install musl 后仍不行）**

```bash
# 1. 将 .dpkg-new 文件改名为正式文件名
mv /usr/lib/systemd/system/grafana-server.service.dpkg-new /usr/lib/systemd/system/grafana-server.service
mv /etc/init.d/grafana-server.dpkg-new /etc/init.d/grafana-server
mv /etc/default/grafana-server.dpkg-new /etc/default/grafana-server

# 2. 重新加载 systemd
systemctl daemon-reload

# 3. 完成 dpkg 配置
dpkg --configure grafana

# 4. 设置开机自启并启动
systemctl enable grafana-server
systemctl start grafana-server
```

**方法三：彻底重装（前两种都不行时）**

```bash
# 1. 先安装依赖
sudo apt install -y musl

# 2. 清除 grafana（保留配置）
sudo dpkg --purge grafana

# 3. 重新安装
sudo dpkg -i /tmp/grafana_11.3.0_amd64.deb

# 4. 验证并启动
dpkg -l | grep grafana    # 应为 ii
systemctl enable grafana-server
systemctl start grafana-server
```

### 4.4 验证 Grafana 安装

```bash
# 检查服务状态
systemctl status grafana-server --no-pager | head -12

# 预期输出包含：
# ● grafana-server.service - Grafana instance
#      Loaded: loaded (/lib/systemd/system/grafana-server.service; enabled; ...)
#      Active: active (running) since ...

# 检查端口监听
ss -tlnp | grep 3000
# 预期输出：
# LISTEN 0 4096  *:3000  *:*  users:(("grafana",pid=...,fd=...))

# 检查 HTTP 响应
curl -sI http://localhost:3000 | head -3
# 预期输出：HTTP/1.1 200 OK
```

### 4.5 登录 Grafana

浏览器访问 `http://<服务器IP>:3000/`：

| 字段 | 默认值 |
|------|--------|
| 用户名 | `admin` |
| 密码 | `admin`（首次登录会强制要求修改密码） |

---

## 5. 配置 Grafana 连接 Prometheus

1. 浏览器打开 `http://<服务器IP>:3000`
2. 登录后，左侧菜单点击 **齿轮图标（Configuration）** → **Data Sources**
3. 点击 **Add data source** 蓝色按钮
4. 选择 **Prometheus**（列表第一个）
5. 在 **URL** 字段填写：`http://localhost:9090`
6. 其他选项保持默认
7. 拉到页面底部，点击 **Save & Test**
8. 看到绿色提示 **"Data source is working"** 即配置成功

---

## 6. 安装 Node Exporter（本机监控）

### 6.1 下载

```bash
cd /tmp
wget https://github.com/prometheus/node_exporter/releases/download/v1.8.2/node_exporter-1.8.2.linux-amd64.tar.gz
tar xzf node_exporter-1.8.2.linux-amd64.tar.gz
sudo mv node_exporter-1.8.2.linux-amd64/node_exporter /opt/prometheus/node_exporter
```

### 6.2 创建 systemd 服务

```bash
sudo vim /etc/systemd/system/node_exporter.service
```

按 `i` 进入插入模式，输入：

```ini
[Unit]
Description=Node Exporter
Documentation=https://prometheus.io/docs/guides/node-exporter/
Wants=network-online.target
After=network-online.target

[Service]
User=prometheus
Group=prometheus
Type=simple
Restart=on-failure
ExecStart=/opt/prometheus/node_exporter

[Install]
WantedBy=multi-user.target
```

按 `Esc` → `:wq` 保存退出。

### 6.3 启动

```bash
sudo systemctl daemon-reload
sudo systemctl enable node_exporter
sudo systemctl start node_exporter
```

### 6.4 验证

```bash
systemctl status node_exporter --no-pager | head -10
ss -tlnp | grep 9100
curl -s http://localhost:9100/metrics | head -20
```

### 6.5 更新 Prometheus 配置加入 node_exporter

```bash
sudo vim /etc/prometheus/prometheus.yml
```

在 `scrape_configs:` 下方（已有 `prometheus` 和 `node_exporter` job），确认 `node_exporter` 的配置存在：

```yaml
  - job_name: 'node_exporter'
    static_configs:
      - targets:
        - 'localhost:9100'
```

如果改动了文件，重启 Prometheus：

```bash
sudo systemctl restart prometheus
```

---

## 7. 端口汇总与安全组配置

### 7.1 端口汇总

| 服务 | 端口 | 监听地址 | 说明 |
|------|------|---------|------|
| Prometheus | 9090 | 默认 0.0.0.0 | Web UI + API，建议仅内网访问 |
| Grafana | 3000 | 默认 0.0.0.0 | 可视化仪表盘 |
| Node Exporter | 9100 | 默认 0.0.0.0 | 主机指标，建议仅内网访问 |

### 7.2 阿里云安全组配置

如果要从公网访问 Grafana，需要在阿里云 ECS 安全组添加入站规则：

| 参数 | 值 |
|------|-----|
| 规则方向 | **入方向** |
| 授权策略 | **允许** |
| 协议类型 | **TCP** |
| 端口范围 | **3000/3000**（只开放 Grafana） |
| 授权对象 | **你的办公网络 IP**（如 `1.2.3.4/32`）或 `0.0.0.0/0` |

> ⚠️ **安全建议**：
> - Grafana 和 Prometheus 不要直接暴露 `0.0.0.0/0`
> - 最好只对特定办公 IP 开放
> - 或使用 SSH 隧道访问

---

## 8. 常用排错命令

### 8.1 服务状态检查

```bash
systemctl status prometheus           # Prometheus 状态
systemctl status grafana-server       # Grafana 状态
systemctl status node_exporter        # Node Exporter 状态

# 查看所有失败的服务
systemctl --failed
```

### 8.2 查看日志

```bash
# Prometheus 日志
journalctl -u prometheus -n 50 --no-pager

# Grafana 日志
journalctl -u grafana-server -n 50 --no-pager

# Node Exporter 日志
journalctl -u node_exporter -n 50 --no-pager

# 实时跟踪日志
journalctl -u grafana-server -f
```

### 8.3 端口检查

```bash
# 查看指定端口是否在监听
ss -tlnp | grep -E '(9090|3000|9100)'

# 查看所有监听端口
ss -tlnp
```

### 8.4 包状态检查

```bash
# 查看 deb 包状态
dpkg -l | grep grafana

# 状态码含义：
# ii = 正常（installed ok configured）
# iU = 解压未配置（installed unpacked）
# iF = 安装失败（half-configured）
# rc = 已删除但残留配置

# 查看详细包信息
dpkg -s grafana
```

### 8.5 文件完整性检查

```bash
# Grafana 关键文件
ls -la /usr/lib/systemd/system/grafana-server.service
ls -la /etc/grafana/
ls -la /var/log/grafana/
ls -la /var/lib/grafana/

# Prometheus 关键文件
ls -la /opt/prometheus/prometheus
ls -la /etc/prometheus/prometheus.yml
ls -la /etc/systemd/system/prometheus.service
```

### 8.6 配置语法检查

```bash
# Prometheus 配置校验
/opt/prometheus/promtool check config /etc/prometheus/prometheus.yml

# Grafana 配置（无内置校验工具，但可通过 API 检查）
curl -s http://localhost:3000/api/health | python3 -m json.tool
```

---

## 附录：dpkg 包状态速查

`dpkg -l <包名>` 输出第一行第二列的状态码：

| 状态码 | 含义 | 说明 |
|--------|------|------|
| `ii` | **installed ok configured** | ✅ 正常安装 |
| `iU` | **installed unpacked** | ⚠️ 解压但未配置（缺依赖） |
| `iF` | **half configured** | ❌ 配置失败 |
| `rc` | **removed but configs remain** | 已删除但有残留配置 |
| `pn` | **purged** | 完全清除 |

---

> **文档版本**：v2.0  
> **编写日期**：2026-07-03  
> **适用平台**：Ubuntu 22.04 LTS  
> **同机已有服务**：Cacti 1.2.30、Zabbix 7.0.27、MariaDB 10.6
