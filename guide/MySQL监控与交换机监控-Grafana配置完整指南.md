# Grafana 10.x 完整配置指南：MySQL 数据库监控 + SNMP 交换机监控

> **环境**: Ubuntu 24.04 / Grafana 10.4.2 / Prometheus 2.45.3
> **作者**: Hermes Agent | **日期**: 2026-06-24
> **适用对象**: 初学者，从零开始

---

## 目录

1. [核心概念：Grafana 如何连接外部数据](#一核心概念grafana-如何连接外部数据)
2. [MySQL 数据库监控完整流程](#二mysql-数据库监控完整流程)
3. [SNMP 交换机监控完整流程](#三snmp-交换机监控完整流程)
4. [两种监控方式对比总结](#四两种监控方式对比总结)

---

## 一、核心概念：Grafana 如何连接外部数据

### 1.1 两种完全不同的监控路径

Grafana 支持两种**完全不同的路径**来获取外部数据：

```
路径A：Grafana 直连数据源（MySQL / PostgreSQL / InfluxDB 等）
         Grafana ──SQL查询──→ MySQL/PostgreSQL/...
         不需要 Prometheus

路径B：Grafana → Prometheus → Exporter → 目标
         Grafana ──PromQL──→ Prometheus ──抓取──→ Exporter ──协议──→ 设备
         需要 Prometheus 做中间层
```

**你的实际使用场景**：

| 监控目标 | 用什么路径 | 为什么 |
|---------|-----------|--------|
| MySQL 数据库 | **路径A** — Grafana 直连 | 查 SQL 就能拿到数据，不需要中间层 |
| 华为交换机 | **路径B** — Prometheus + Exporter | 需要 SNMP 协议采集，Prometheus 做数据中转 |

理解这个区别是**最重要的第一步**。下面分别详解两种路径的 Web 界面操作。

---

## 二、MySQL 数据库监控完整流程

> **当前配置**: MySQL 8.0 @ 宿主机 3307 端口（Docker 容器 animal_db）
> **目标**: 在 Grafana 上创建业务数据大盘（动物数量、领养统计、用户分布）

### 2.1 整体架构

```
Grafana (Web)
    │
    │ SQL 直连查询
    │
    ▼
MySQL 8.0 (Docker 3307)
    │
    ├── animal_rescue 数据库
    │   ├── animals 表       (动物信息)
    │   ├── adoptions 表     (领养申请)
    │   ├── users 表         (用户)
    │   └── ... 其他业务表
    │
    └── exporter 用户 (SELECT 只读权限)
```

### 2.2 第一步：在 MySQL 上创建监控专用用户

**为什么需要这一步？**

用 root 直接连数据库有安全风险。创建只读用户，Grafana 万一被入侵也只能读数据，删不了东西。

**操作** — 登录 MySQL 执行：

```sql
-- 创建只读监控用户
CREATE USER IF NOT EXISTS 'exporter'@'%'
    IDENTIFIED BY 'Monitoring2026!Sec';

-- 授予 SELECT(查)、PROCESS(看连接)、REPLICATION CLIENT(看状态) 权限
GRANT PROCESS, REPLICATION CLIENT, SELECT ON *.* TO 'exporter'@'%';

FLUSH PRIVILEGES;
```

**验证**：

```sql
SELECT user, host FROM mysql.user WHERE user='exporter';
-- 应看到: exporter | %
```

### 2.3 第二步：在 Grafana Web 界面添加 MySQL 数据源

这是你问的核心 — Web 界面上的每一步操作。

#### 步骤 2.3.1：进入数据源配置

```
① 浏览器打开 Grafana: http://114.67.234.232:3001
   登录: admin / ZZh1832388

② 左侧菜单栏 → 齿轮图标(Connections) → Data sources

   你会看到已经有一个 "prometheus" 数据源（黄色的 P 图标）
```

#### 步骤 2.3.2：添加 MySQL 数据源

```
③ 点右上角蓝色按钮: "+ Add new data source"

④ 在搜索框输入 "mysql"
   看到 "MySQL" (海豚图标) → 点它
```

#### 步骤 2.3.3：填写连接信息

你会看到一页配置表单，逐项填写：

```
┌────────────── 表单字段说明 ──────────────────────────┐
│                                                        │
│  【Name】  animal_db                                    │
│  ↑ 随便取名，会在面板选择数据源时显示                    │
│                                                         │
│  【Host URL】  localhost:3307                             │
│  ↑ 格式: IP:端口                                          │
│  ↑ Grafana 运行在宿主机，3307 是 Docker 映射出来的       │
│                                                         │
│  【Database】  animal_rescue                              │
│  ↑ 默认数据库名，可以不填                                  │
│                                                         │
│  【Username】  exporter                                   │
│  ↑ 刚才创建的只读用户                                      │
│                                                         │
│  【Password】  Monitoring2026!Sec                          │
│  ↑ exporter 用户的密码                                    │
│                                                         │
│  【Min time interval】  1m                                 │
│  ↑ 最小查询间隔，防止频繁查数据库                          │
│                                                         │
│  其他字段保持默认即可                                      │
└─────────────────────────────────────────────────────────┘
```

#### 步骤 2.3.4：保存并测试

```
⑤ 页面底部 → 点 "Save & test" 按钮

   如果看到绿色提示 "Database Connection OK"
   → 连接成功 ✅

   如果看到红色错误:
   → 检查: 端口是否正确 (3307不是3306)
   → 检查: Docker 容器是否在运行 (docker ps | grep animal)
   → 检查: 用户密码是不是贴错了
```

#### 步骤 2.3.5：数据源配置好后是什么样

```
左侧菜单 → Connections → Data sources

┌─────────────────────────────────────────┐
│  prometheus (已配置)                     │  黄色 P 图标
│  animal_db  (已配置)                     │  🐬 海豚图标  ← 新加的
└─────────────────────────────────────────┘
```

点击 `animal_db` 可以随时修改配置。

---

### 2.4 第三步：用 SQL 查询创建你的第一个监控面板

#### 步骤 2.4.1：创建仪表盘

```
① 左侧菜单 → 📊 Dashboards

② 点 "New" 右侧的下拉箭头 → "New Dashboard"
   → 看到空白仪表盘页面

③ 点 "Add visualization" (添加可视化)
```

#### 步骤 2.4.2：选择数据源

```
④ 弹出的面板编辑器 → 左上角 "Data source" 下拉框
   → 选择 "animal_db" (你刚创建的 MySQL 数据源)
```

#### 步骤 2.4.3：写 SQL 查询

```
⑤ 你会看到底部有一个 SQL 编辑区域:

┌────────────────────────────────────────────────┐
│  ▶ A  [animal_db]                                │
│  ┌──────────────────────────────────────┐        │
│  │ SELECT 1                               │ ← 改成你的SQL
│  └──────────────────────────────────────┘        │
│  Format as: [Table ▼]                  ← 重要！  │
└────────────────────────────────────────────────┘
```

**不同的 SQL 怎么写，根据你想要的面板类型：**

**🐾 Stat 面板（大数字卡片）**— 查单行单列：

```sql
SELECT COUNT(*) AS value
FROM animals
```

设置: `Format as: Table` → 选 Stat 面板

**📌 饼图 — 分组统计：**

```sql
SELECT species AS metric, COUNT(*) AS value
FROM animals
GROUP BY species
```

设置: `Format as: Table` → 选 Pie Chart 面板

**📈 折线图 — 时间序列：**

```sql
SELECT
  UNIX_TIMESTAMP(created_at)*1000 AS time_sec,
  COUNT(*) AS value
FROM users
GROUP BY FLOOR(UNIX_TIMESTAMP(created_at)/86400)
ORDER BY time_sec
```

设置: `Format as: Time series` → 选 Time Series 面板

#### 步骤 2.4.4：选择面板类型

```
⑥ 右侧面板选择器 → 选你想要的图表类型

┌───────────────────────────────┐
│  Stat         大数字卡片       │  ← 动物总数
│  Gauge        仪表盘          │  ← 百分比进度
│  Pie chart    饼图/环形图      │  ← 种类分布
│  Time series  折线图          │  ← 注册趋势
│  Table        表格            │  ← 救助站列表
│  Bar gauge    横向柱状条       │  ← 如果你数据能匹配上
└───────────────────────────────┘
```

#### 步骤 2.4.5：保存面板

```
⑦ 右上角 → 点 "Apply" (保存面板)
⑧ 仪表盘右上角 → 点 💾 磁盘图标 → 保存仪表盘
   给仪表盘取个名字, 如 "动物救助系统监控"
```

#### 步骤 2.4.6：继续添加更多面板

```
⑨ 仪表盘页面 → 右上角 "Add" → Visualization
   重复步骤④~⑧, 添加更多面板
```

### 2.5 SQL 查询速查表（你的数据库专用）

| 想看什么 | SQL 语句 | 面板类型 |
|---------|---------|---------|
| 动物总数 | `SELECT COUNT(*) FROM animals` | Stat |
| 可领养数 | `SELECT COUNT(*) FROM animals WHERE adoption_status='available'` | Stat |
| 已领养数 | `SELECT COUNT(*) FROM animals WHERE adoption_status='adopted'` | Stat |
| 注册用户 | `SELECT COUNT(*) FROM users` | Stat |
| 种类分布 | `SELECT species AS metric, COUNT(*) AS value FROM animals GROUP BY species` | Pie Chart |
| 健康状况 | `SELECT health_status AS metric, COUNT(*) AS value FROM animals GROUP BY health_status` | Pie Chart |
| 疫苗状态 | `SELECT vaccination_status AS metric, COUNT(*) AS value FROM animals GROUP BY vaccination_status` | Pie Chart |
| 绝育状态 | `SELECT sterilization_status AS metric, COUNT(*) AS value FROM animals GROUP BY sterilization_status` | Pie Chart |
| 体型分布 | `SELECT COALESCE(size,'未填写') AS metric, COUNT(*) AS value FROM animals GROUP BY size` | Pie Chart |
| 救助站统计 | `SELECT rs.name, COUNT(a.id) FROM RescueStations rs LEFT JOIN animals a ON...` | Table |
| 领养完成率 | `SELECT ROUND(已领养数*100.0/总数, 1)` | Gauge |
| 用户注册趋势 | `SELECT UNIX_TIMESTAMP(created_at)*1000, COUNT(*) FROM users GROUP BY FLOOR(...)` | Time Series |

### 2.6 常见问题排查

| 问题 | 原因 | 解决 |
|------|------|------|
| SQL 在命令行能跑，Grafana 显示 No data | Format as 选错了（应选 Table 或 Time series） | 检查面板底下的 Format 下拉框 |
| Save & test 报红 | 数据源连不上 | 检查端口、用户密码、Docker容器状态 |
| Pie Chart 显示空白 | 列名没叫 metric/value | SQL 写 `AS metric` 和 `AS value` |
| Time Series 显示空白 | SQL 用了 `GROUP BY created_at` 但在严格模式下报错 | 改成 `GROUP BY FLOOR(UNIX_TIMESTAMP(created_at)/86400)` |
| 面板有数据但值不对 | WHERE 条件里的单引号被吃了 | SQL 里字符串值用单引号括起来: `'available'` |

---

## 三、SNMP 交换机监控完整流程

> **当前配置**: 华为 CE8850 @ 171.105.26.249, SNMP v2c, Community: tskj123@TEST
> **目标**: 在 Grafana 上看到交换机所有端口的实时流量图表

### 3.1 整体架构

```
[华为 CE8850 交换机]
   IP: 171.105.26.249
   端口: UDP 161 (SNMP)
   协议: SNMP v2c
   Community: tskj123@TEST
         │
         │ SNMP Walk (net-snmp 命令)
         ▼
[Python SNMP 采集器]       ← 运行在你的服务器上
   端口: tcp 9117
   程序: /usr/local/bin/snmp_huawei_exporter.py
   服务: systemctl start snmp_huawei_exporter
         │
         │ HTTP GET /metrics (Prometheus 格式)
         ▼
[Prometheus]
   端口: 9090
   配置: /etc/prometheus/prometheus.yml
   每60秒抓取一次 localhost:9117
         │
         │ PromQL 查询
         ▼
[Grafana]
   端口: 3001
   数据源: prometheus (已配置)
```

### 3.2 关键区别：为什么交换机不能像 MySQL 那样直连？

| | MySQL | 交换机 |
|--|-------|-------|
| 通信协议 | TCP/MySQL 协议（SQL 查询） | UDP/SNMP 协议（OID 查询） |
| Grafana 能直连吗 | ✅ 有内置 MySQL 插件 | ❌ 没有内置 SNMP 插件 |
| 中间层 | **不需要** | **必须有**（Prometheus + Exporter） |
| 查询语言 | SQL | PromQL |

**一句话**：Grafana 不会说 SNMP 这门语言，需要 Prometheus 做翻译。

### 3.3 第一步：确认交换机已开启 SNMP

**登录交换机（SSH 或 Web），执行**：

```
system-view
snmp-agent
snmp-agent community read tskj123@TEST
snmp-agent sys-info version v2c
```

**从你的服务器验证 SNMP 网关可达**：

```bash
# 能查到接口名称 = 通了
snmpwalk -v 2c -c "tskj123@TEST" -t 5 171.105.26.249 .1.3.6.1.2.1.2.2.1.2

# 预期输出:
# iso.3.6.1.2.1.2.2.1.2.5 = STRING: "100GE1/0/1"
# iso.3.6.1.2.1.2.2.1.2.6 = STRING: "100GE1/0/2"
# ...
```

### 3.4 第二步：安装并配置 Python SNMP 采集器

> 为什么用 Python？因为官方 snmp_exporter 的 Go 库在华为 CE 系列上有兼容问题，snmpbulkwalk（系统自带 C 库）反而能正常工作。

#### 步骤 3.4.1：安装 net-snmp 工具

```bash
apt install snmp snmp-mibs-downloader -y
```

#### 步骤 3.4.2：创建 Python 采集器

文件位置: `/usr/local/bin/snmp_huawei_exporter.py`

**工作原理**：
```
1. 启动 HTTP 服务器监听 :9117
2. 有人访问 /metrics → 执行 snmpbulkwalk 去交换机查数据
3. 解析输出 → 转成 Prometheus 格式的文本
4. 返回给请求者（Prometheus）
```

#### 步骤 3.4.3：创建 systemd 服务（开机自启）

```bash
cat > /etc/systemd/system/snmp_huawei_exporter.service << 'EOF'
[Unit]
Description=Huawei CE8850 SNMP Exporter
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/python3 /usr/local/bin/snmp_huawei_exporter.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable snmp_huawei_exporter
systemctl start snmp_huawei_exporter
```

#### 步骤 3.4.4：验证采集器

```bash
# 应该返回 Prometheus 格式数据
curl -s http://localhost:9117/metrics | head -10

# 预期输出类似:
# snmp_if_in_octets_total{ifIndex="5",ifName="100GE1/0/1"} 1947443419438
```

### 3.5 第三步：配置 Prometheus 抓取

#### 步骤 3.5.1：编辑 Prometheus 配置文件

```bash
vim /etc/prometheus/prometheus.yml
```

在 `scrape_configs:` 下面添加：

```yaml
  - job_name: 'snmp_huawei_ce8850'
    scrape_interval: 60s
    scrape_timeout: 50s
    static_configs:
      - targets: ['localhost:9117']
```

**各参数含义**：

| 参数 | 值 | 含义 |
|------|-----|------|
| job_name | snmp_huawei_ce8850 | Prometheus 看板上的名字 |
| scrape_interval | 60s | 每60秒抓一次（SNMP 查询较慢） |
| scrape_timeout | 50s | 一次抓取最多等50秒 |
| targets | localhost:9117 | 采集器的地址 |

#### 步骤 3.5.2：重启 Prometheus

```bash
systemctl restart prometheus
```

### 3.6 第四步：验证数据已进入 Prometheus

#### 步骤 3.6.1：检查 Target 状态

```
浏览器打开: http://114.67.234.232:9090/targets
```

你会看到三个目标：

| 目标 | 状态 | 说明 |
|------|------|------|
| prometheus | UP | Prometheus 自己 |
| node | UP | 本机服务器监控 |
| **snmp_huawei_ce8850** | **UP** ← | **交换机监控** |

看到 `UP` 就代表数据在源源不断地进入 Prometheus。

#### 步骤 3.6.2：验证数据存在

```
浏览器打开: http://114.67.234.232:9090/graph

在 Expression 输入框输入:
  snmp_if_in_octets_total{ifName="100GE1/0/1"}

点 "Execute" 按钮
```

如果看到结果（一个很大的数字），说明数据已进入 Prometheus。

### 3.7 第五步：在 Grafana 上创建交换机流量图

#### 步骤 3.7.1：确认 Prometheus 数据源已存在

```
Grafana → Connections → Data sources
应看到 "prometheus" (黄色 P 图标)
```

#### 步骤 3.7.2：创建仪表盘并添加面板

```
① Dashboards → New → New Dashboard
② Add visualization
③ 数据源选 "prometheus"
④ 输入 PromQL 查询
```

#### 步骤 3.7.3：常用 PromQL 查询

| 想看什么 | PromQL | 面板类型 |
|---------|--------|---------|
| 某端口入流量(bps) | `rate(snmp_if_in_octets_total{ifName="100GE1/0/1"}[2m]) * 8` | Time Series |
| 某端口出流量(bps) | `rate(snmp_if_out_octets_total{ifName="100GE1/0/1"}[2m]) * 8` | Time Series |
| 4口合计入流量 | `sum(rate(snmp_if_in_octets_total{ifName=~"100GE1/0/[6-9]"}[2m])) * 8` | Time Series |
| 95百分位入流量 | `quantile_over_time(0.95, (sum(rate(...)[2m]))*8[$__range:1m])` | Time Series (第二条查询) |
| 在线端口数 | `count(snmp_if_oper_status{ifName=~"100GE.*"} == 1)` | Stat |
| 离线端口数 | `count(snmp_if_oper_status{ifName=~"100GE.*"} == 2)` | Stat |

#### 步骤 3.7.4：添加图例统计

```
编辑面板 → 右侧 "Legend" 选项
  → Display mode: Table (表格模式)
  → Calculations: 勾选 Last (当前值)、Max (最大值)、Mean (平均值)
```

这样图表底部会显示一个表格：这个端口当前多少流量、最大多少、平均多少。

#### 步骤 3.7.5：添加 95百分位红线

```
① 添加第二条查询:
   quantile_over_time(0.95,
     (sum(rate(snmp_if_in_octets_total{ifName=~"100GE1/0/[6-9]"}[2m])) * 8)[24h:30m])

② 给这条查询设置样式:
   编辑面板 → Overrides → 添加覆盖
   → 字段名: 第二条查询返回的字段名
   → Line style: Dashed (虚线)
   → Color: Red (红色)
```

### 3.8 常见问题排查

| 问题 | 排查命令 | 解决 |
|------|---------|------|
| 交换机 SNMP 不通 | `snmpwalk -v 2c -c "密码" -t 5 IP .1.3.6.1.2.1.1.1.0` | 检查交换机 SNMP 配置和防火墙 UDP 161 |
| 采集器端口不通 | `curl http://localhost:9117/metrics` | `systemctl restart snmp_huawei_exporter` |
| Prometheus target 报红 | `curl http://localhost:9090/targets` | 检查 prometheus.yml 语法，`systemctl restart prometheus` |
| Grafana 能看到 Prometheus 但查不到数据 | 去 Explore 测试 PromQL | 确认指标名拼写正确，label 过滤正确 |

---

## 四、两种监控方式对比总结

### 4.1 架构对比

```
┌─────────────────────────────────────────────────────────────────┐
│                      MySQL 监控 (路径A)                          │
│                                                                  │
│   Grafana ──SQL查询──→ MySQL:3307                                │
│      │                      │                                    │
│      │ 不需要 Prometheus      │ 直接返回查询结果                  │
│                                                                  │
│  数据流: Grafana → 发SQL → MySQL → 返回数据 → Grafana画图       │
│  配置量: 2 步 (创建用户 + 添加数据源)                             │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│                     交换机监控 (路径B)                            │
│                                                                   │
│  交换机 ──SNMP walk──→ Python采集器:9117 ──HTTP──→ Prometheus    │
│                                                            │     │
│   Grafana ──PromQL──→ Prometheus ──返回时序数据──→ 画图   │     │
│                                                                   │
│  数据流: 采集器→Prometheus→Grafana                                │
│  配置量: 5+ 步 (交换机SNMP + 采集器 + systemd + Prometheus配置    │
│                + Prometheus重启 + Grafana画图)                    │
└──────────────────────────────────────────────────────────────────┘
```

### 4.2 功能对比

| | MySQL (Grafana直连) | 交换机 (Prometheus+Exporter) |
|--|-------------------|----------------------------|
| 需要额外组件 | ❌ 不需要 | ✅ 需要 Exporter + Prometheus |
| 配置难度 | 简单 | 中等 |
| 查询语言 | SQL | PromQL |
| 数据存储 | 不存 (实时查) | Prometheus 存 15天 |
| 历史数据 | 取决于 MySQL 里的数据 | ✅ 自动存储 |
| 告警 | ❌ Grafana 不做SQL告警 | ✅ 可用 Prometheus 或 Grafana 规则 |
| 适合场景 | 业务数据统计（用户/订单/动物数） | 运维性能监控（流量/CPU/内存） |
| 典型面板 | Stat / Pie / Table | Time Series / Stat / Gauge |

### 4.3 什么时候用哪种方式

```
需要实时流量、CPU、内存等性能指标
→ 用 Prometheus (路径B)

需要业务数据统计、报表（人口、订单、动物数量）
→ 用 Grafana 直连数据库 (路径A)

两者可以共存！本次配置完成了:
  ✅ MySQL 直连 → 动物救助业务大盘
  ✅ Prometheus → 交换机流量监控
  ✅ Prometheus → node_exporter 本机监控
  都在同一个 Grafana 里统一查看
```

### 4.4 你的当前监控全景

```
http://114.67.234.232:3001

├── 🏥 动物救助系统·全面监控  (MySQL直连, 14面板)
│
├── 🔀 华为CE8850交换机流量    (Prometheus, 8面板)
│   └── 端口6-9合计 + 95百分位
│
└── 📡 Node Exporter本机监控  (Prometheus, 已有)
    └── CPU/内存/磁盘/网络
```

---

## 附录：关键配置文件速查

### Prometheus 配置 (`/etc/prometheus/prometheus.yml`)

```yaml
scrape_configs:
  # 本机监控
  - job_name: 'node'
    static_configs:
      - targets: ['localhost:9100']

  # 交换机监控
  - job_name: 'snmp_huawei_ce8850'
    scrape_interval: 60s
    scrape_timeout: 50s
    static_configs:
      - targets: ['localhost:9117']
```

### Python 采集器配置 (文件头)

```python
SWITCH_IP   = "171.105.26.249"
COMMUNITY   = "tskj123@TEST"
SNMP_VER    = "2c"
SCRAPE_PORT = 9117
```

### MySQL 监控用户

```
用户: exporter
密码: Monitoring2026!Sec
权限: SELECT, PROCESS, REPLICATION CLIENT (只读)
主机: % (任意IP可连)
```

---

> **快捷链接**
> - Grafana: http://114.67.234.232:3001 (admin/ZZh1832388)
> - Prometheus: http://114.67.234.232:9090
> - Python SNMP 采集器: systemctl status snmp_huawei_exporter
> - 交换机 MySQL: docker exec animal_db mysql -uroot -p'Anim@l_Rsc#2026!Sec'
