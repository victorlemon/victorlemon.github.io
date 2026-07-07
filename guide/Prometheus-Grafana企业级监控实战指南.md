# 企业级 Prometheus + Grafana 监控实战指南

> **目标读者**: 从入门到企业级，一刀不漏 | **作者**: Hermes Agent | **日期**: 2026-06-24

---

## 目录

1. [核心监控四金信号 (Four Golden Signals)](#一核心监控四金信号-four-golden-signals)
2. [生产环境监控架构总览](#二生产环境监控架构总览)
3. [Node Exporter：服务器/虚拟机层](#三node-exporter服务器虚拟机层)
4. [应用层监控：中间件 + 自研服务](#四应用层监控中间件--自研服务)
5. [网络设备监控 (SNMP + ICMP)](#五网络设备监控-snmp--icmp)
6. [告警体系：从规则到通知到 On-Call](#六告警体系从规则到通知到-on-call)
7. [仪表盘设计规范](#七仪表盘设计规范)
8. [PromQL 实战手册](#八promql-实战手册)
9. [Recording Rules 与预计算](#九recording-rules-与预计算)
10. [高可用与联邦 (HA + Federation)](#十高可用与联邦-ha--federation)
11. [Exporter 生态速查](#十一exporter-生态速查)
12. [自研服务接入 Prometheus (Instrumentation)](#十二自研服务接入-prometheus-instrumentation)
13. [常见运维 Checklist](#十三常见运维-checklist)

---

## 一、核心监控四金信号 (Four Golden Signals)

Google SRE 提出的**四个必监控指标**，任何生产服务都必须有：

```
┌─────────────────────────────────────────────────────────────┐
│  🥇 Latency (延迟)                                           │
│    请求花了多长时间                                          │
│    PromQL: histogram_quantile(0.99, rate(http_req_duration_bucket[5m])) │
│                                                              │
│  🥈 Traffic (流量)                                           │
│    系统承受了多少请求                                          │
│    PromQL: rate(http_requests_total[5m])                     │
│                                                              │
│  🥉 Errors (错误)                                            │
│    失败率是多少                                              │
│    PromQL: rate(http_requests_total{status=~"5.."}[5m])     │
│                                                              │
│  🏅 Saturation (饱和度)                                       │
│    资源有多"满"                                              │
│    PromQL: node_load1 / count(node_cpu_seconds_total{mode="idle"}) │
│           node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes │
│           node_filesystem_avail_bytes / node_filesystem_size_bytes    │
└─────────────────────────────────────────────────────────────┘
```

**这就是企业级监控的最小集合。** 有了这四个，任何一个生产故障你都能快速判断问题在哪个维度。

---

## 二、生产环境监控架构总览

### 2.1 标准三层架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        第三层: 展示 & 告警                         │
│               Grafana (仪表盘) + Alertmanager (告警)             │
│                         ↑            ↑                          │
├──────────────────────────┼────────────┼──────────────────────────┤
│                        第二层: 存储 & 聚合                         │
│                    Prometheus (采集+存储)                         │
│                         ↑            ↑                          │
├──────────────────────────┼────────────┼──────────────────────────┤
│                        第一层: 数据源                             │
│  ┌───────────┐ ┌───────────┐ ┌──────────┐ ┌──────────────┐    │
│  │Node Exporter│ │App Metrics│ │MySQL Exporter│ │SNMP Exporter│   │
│  │(CPU/内存)  │ │(业务埋点) │ │(数据库)   │ │(网络设备) │    │
│  └───────────┘ └───────────┘ └──────────┘ └──────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 典型企业部署规模

| 规模 | 服务器数 | Prometheus 架构 | 典型场景 |
|------|---------|---------------|---------|
| 小型 | 1-20 台 | 单机 Prometheus | 初创公司、测试环境 |
| 中型 | 20-200 台 | Prometheus + 2 副本 | 中型互联网公司 |
| 大型 | 200-1000+ 台 | 联邦架构 (Federation) | 大型互联网、金融 |
| 超大规模 | 1000+ 台 | Thanos / Cortex / VictoriaMetrics | BAT、字节跳动级 |

### 2.3 你当前的架构（小型→中型过渡）

```
Prometheus (单机, 9090)
  ├── node_exporter :9100          (本机性能)
  ├── Python SNMP 采集器 :9117      (华为交换机)
  └── [未来可加] MySQL Exporter     (数据库)

Grafana (单机, 3001)
  ├── Prometheus 数据源
  └── MySQL 直连数据源 (animal_db)

Alertmanager (单机, 9093)
  └── 企业微信 + 邮箱 通知
```

---

## 三、Node Exporter：服务器/虚拟机层

### 3.1 你已部署的（本机监控）

```yaml
# /etc/prometheus/prometheus.yml
- job_name: node
  static_configs:
    - targets: ['localhost:9100']
```

### 3.2 CPU 监控三板斧

```promql
# ① 整体使用率（最常用）
100 - (avg by(instance)(rate(node_cpu_seconds_total{mode="idle"}[2m])) * 100)

# ② 按模式拆分（user/sys/iowait/steal 各占多少）
avg by(mode, instance)(rate(node_cpu_seconds_total[2m])) * 100

# ③ 单核使用率（每个核分别看）
100 - (rate(node_cpu_seconds_total{mode="idle"}[2m]) * 100)
```

### 3.3 内存监控

```promql
# ① 可用内存（推荐用这个，Linux自己有缓存回收机制）
node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes * 100

# ② 内存使用率（传统算法，不太准）
(1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes) * 100

# ③ 即将OOM的警告信号
node_vmstat_oom_kill > 0   # OOM Killer启动次数
rate(node_vmstat_oom_kill[5m]) > 0  # 最近5分钟OOM过
```

### 3.4 磁盘监控

```promql
# ① 磁盘空间剩余（低于20%告警）
(node_filesystem_avail_bytes{mountpoint="/",fstype!="tmpfs"}
  / node_filesystem_size_bytes{mountpoint="/",fstype!="tmpfs"}) * 100

# ② 磁盘IO使用率（await 时间）
rate(node_disk_io_time_seconds_total{device=~"sd.|vd.|nvme.*"}[5m]) * 100

# ③ 磁盘读写吞吐量
rate(node_disk_read_bytes_total{device=~"sd.*"}[5m])  # 读
rate(node_disk_written_bytes_total{device=~"sd.*"}[5m])  # 写
```

### 3.5 网络监控

```promql
# ① 网卡流量(单网卡)
rate(node_network_receive_bytes_total{device="eth0"}[2m]) * 8  # 入
rate(node_network_transmit_bytes_total{device="eth0"}[2m]) * 8  # 出

# ② 网络丢包/错包
rate(node_network_receive_drop_total{device="eth0"}[5m])  # 入丢包
rate(node_network_transmit_drop_total{device="eth0"}[5m])  # 出丢包

# ③ TCP连接数
node_netstat_Tcp_CurrEstab  # 当前连接数
```

### 3.6 系统负载

```promql
# ① 负载与核数比值（>2 负载偏高, >4 严重）
node_load1 / count(node_cpu_seconds_total{mode="idle"})

# ② 直接看负载
node_load1  # 1分钟
node_load5  # 5分钟
node_load15  # 15分钟
```

---

## 四、应用层监控：中间件 + 自研服务

### 4.1 MySQL / MariaDB

| 指标 | 采集方式 | 关键 PromQL |
|------|---------|-----------|
| 连接数 | mysqld_exporter | `mysql_global_status_threads_connected` |
| QPS | mysqld_exporter | `rate(mysql_global_status_questions[5m])` |
| 慢查询 | mysqld_exporter | `rate(mysql_global_status_slow_queries[5m])` |
| 主从延迟 | mysqld_exporter | `mysql_slave_status_seconds_behind_master` |
| 缓冲池命中率 | mysqld_exporter | `mysql_global_status_innodb_buffer_pool_read_requests / (mysql_global_status_innodb_buffer_pool_read_requests + mysql_global_status_innodb_buffer_pool_reads)` |
| **业务数据** | **Grafana 直连 SQL** | `SELECT COUNT(*) FROM orders WHERE DATE(created_at)=CURDATE()` |

### 4.2 Redis

```promql
# 内存使用
redis_memory_used_bytes / redis_memory_max_bytes * 100

# 命中率（<90% 说明缓存策略有问题）
rate(redis_keyspace_hits_total[5m]) 
  / (rate(redis_keyspace_hits_total[5m]) + rate(redis_keyspace_misses_total[5m])) * 100

# 连接数
redis_connected_clients
```

### 4.3 Nginx / Web 服务器

```promql
# QPS
rate(nginx_http_requests_total[5m])

# 状态码分布
sum by(status)(rate(nginx_http_requests_total[5m]))

# 5xx 错误率（金信号之一）
sum(rate(nginx_http_requests_total{status=~"5.."}[5m]))
  / sum(rate(nginx_http_requests_total[5m])) * 100
```

### 4.4 自研 Java/Go/Python 应用接入

**这是企业开发中最核心的一步**：让你自己的代码汇报指标。

```go
// Go 示例：在代码里埋点
import "github.com/prometheus/client_golang/prometheus"

var httpRequests = prometheus.NewCounterVec(
    prometheus.CounterOpts{Name: "myapp_http_requests_total"},
    []string{"method", "endpoint", "status"},
)

func handler(w http.ResponseWriter, r *http.Request) {
    httpRequests.WithLabelValues(r.Method, r.URL.Path, "200").Inc()
}

// 暴露 /metrics 端点给 Prometheus
http.Handle("/metrics", promhttp.Handler())
```

```python
# Python 示例：Flask应用
from prometheus_client import Counter, generate_latest

requests_total = Counter('myapp_requests_total', 'Total requests', ['endpoint'])

@app.route('/api/orders')
def orders():
    requests_total.labels(endpoint='/api/orders').inc()
    return jsonify(...)

@app.route('/metrics')
def metrics():
    return generate_latest()
```

**接入 Prometheus 后，你的四金信号就齐了**：

```
http_request_duration_seconds_bucket  → Latency
http_requests_total                   → Traffic
http_requests_total{status=~"5.."}   → Errors
线程池队列长度 / 连接池使用率          → Saturation
```

---

## 五、网络设备监控 (SNMP + ICMP)

### 5.1 你已经完成的

```
华为 CE8850 → Python SNMP 采集器 → Prometheus → Grafana
```

### 5.2 企业常见的网络监控指标

```promql
# ① 端口流量(bps) — 你最关心的
rate(snmp_if_in_octets_total{ifName=~"100GE.*",ifOperStatus="1"}[2m]) * 8

# ② 端口利用率(%) — 判断是否要扩容
rate(snmp_if_in_octets_total{ifName="100GE1/0/1"}[2m]) * 8 / 100000000000 * 100

# ③ 丢包率 — 判断线路质量
rate(snmp_if_in_errors_total{ifName="100GE1/0/1"}[5m])

# ④ 端口状态变化 — 最紧急的告警
changes(snmp_if_oper_status{ifName=~"100GE.*"}[10m]) > 0
# ↑ 10分钟内状态变化过 = 端口 flapping

# ⑤ 95百分位 — ISP 计费常用
quantile_over_time(0.95, (sum(rate(snmp_if_in_octets_total...))*8)[30d:5m])
```

### 5.3 企业网络监控最佳实践

| 层级 | 监控什么 | 用什么 |
|------|---------|--------|
| 核心交换机/路由器 | 端口流量、丢包、CPU/内存 | SNMP Exporter |
| 防火墙 | 连接数、吞吐量、会话建立率 | SNMP / API |
| 负载均衡 | 后端健康状态、QPS、延迟 | Exporter / API |
| CDN | 缓存命中率、回源率 | 厂商API |

---

## 六、告警体系：从规则到通知到 On-Call

### 6.1 告警分级制度（企业标准做法）

```
P0 (Critical - 紧急)
  ● 服务器宕机 (node_up == 0)
  ● 核心服务端口不通
  ● 数据库主从同步断开
  → 通知渠道: 电话 + 短信 + 企微 + 邮件 (全渠道轰炸)
  → 响应时间: 5分钟内

P1 (Warning - 重要)
  ● CPU > 90% 持续5分钟
  ● 磁盘 < 10%
  ● 内存 > 95%
  → 通知渠道: 企微 + 邮件
  → 响应时间: 30分钟内

P2 (Info - 提醒)
  ● 磁盘 < 30%
  ● 证书30天内过期
  ● 慢查询增多
  → 通知渠道: 邮件 / 企微静默
  → 响应时间: 工作时间处理

P3 (Notice - 通知)
  ● 新版本可用
  ● 定时巡检报告
  ● 自动伸缩事件
  → 通知渠道: 邮件 (每日汇总)
  → 不需要立即处理
```

### 6.2 告警规则设计原则

**① 告警必须有 Action（可操作）**

```
❌ 差: "CPU 使用率高" → 然后呢？
✅ 好: "CPU 使用率 > 90% 持续5分钟, 登录服务器执行 top 查看"
```

**② 一个告警对应一个 runbook**

```yaml
# 好的告警规则示例
groups:
  - name: node_alerts
    rules:
      - alert: NodeHighCPU
        expr: 100 - (avg by(instance)(rate(node_cpu_seconds_total{mode="idle"}[2m]))*100) > 90
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "{{ $labels.instance }} CPU使用率 > 90%"
          description: "持续5分钟, 当前: {{ $value }}%"
          runbook_url: "https://wiki.company.com/runbooks/node-high-cpu"
```

**③ 避免告警风暴**

```
# 用 group_by 把一堆告警归组
route:
  group_by: ['alertname', 'severity']
  group_wait: 30s      # 新告警进来先等30秒, 一次性发送
  group_interval: 5m    # 同一组新告警等5分钟再发
  repeat_interval: 4h   # 同一告警4小时后才重发
```

**④ 抑制低优先级告警**

```yaml
# 服务器已经宕机，就不需要再发"CPU监控无数据"的告警了
inhibit_rules:
  - source_match:
      severity: 'critical'
      alertname: 'InstanceDown'
    target_match:
      alertname: 'NodeExporterDown'
    equal: ['instance']
```

### 6.3 告警通知渠道配置

| 渠道 | 配置方式 | 适用场景 |
|------|---------|---------|
| 企业微信机器人 | Webhook URL | 日常告警 |
| 邮箱 | SMTP | 日报、非紧急告警 |
| 钉钉 | Webhook | 内部 IM |
| Slack | Webhook | 国际团队 |
| PagerDuty | API | On-Call 轮值 |
| OpsGenie | API | On-Call 轮值 |
| 短信 | 阿里云/腾讯云 API | P0 紧急 |
| 电话 | 云厂商语音通知 | P0 紧急 |

---

## 七、仪表盘设计规范

### 7.1 企业级仪表盘分层设计

```
层级1: 🏢 全局概览大屏 (TV Display)
   ├── 所有服务状态概览
   ├── 关键KPI (QPS, 延迟, 错误率)
   ├── 资源使用率 (CPU, 内存, 磁盘)
   └── 适合投在办公室大电视上

层级2: 📊 服务专属仪表盘
   ├── 每个微服务一个
   ├── 四金信号 + 资源监控
   ├── 告警触发情况
   └── 运维日常查看

层级3: 🔍 问题排查仪表盘
   ├── 按主机 / 按 Pod / 按实例
   ├── 日志关联 (Loki)
   ├── 链路追踪 (Tempo)
   └── 故障时深入排查用

层级4: 📈 容量规划仪表盘
   ├── 按月/季的趋势
   ├── 资源增长预测
   └── 架构师/运维经理用
```

### 7.2 仪表盘设计原则

**① 从上到下，从粗到细**

```
┌─────────────────────────────────────────────┐
│  第1行: 大数字卡片 (Stat)                     │
│  在线服务数 | 总QPS | P99延迟 | 错误率         │
├─────────────────────────────────────────────┤
│  第2行: 关键趋势图 (Time Series)              │
│  QPS趋势 | 延迟趋势 | 错误率趋势              │
├─────────────────────────────────────────────┤
│  第3行: 细分分布图 (Pie/Bar)                  │
│  按服务/主机/接口拆分                         │
├─────────────────────────────────────────────┤
│  第4行: 明细表格 (Table)                      │
│  出问题的具体实例列表                         │
└─────────────────────────────────────────────┘
```

**② 颜色约定**

| 颜色 | 含义 |
|------|------|
| 🟢 绿色 | 正常 |
| 🟡 黄色/橙色 | 警告/接近阈值 |
| 🔴 红色 | 告警/超过阈值 |
| 🔵 蓝色 | 中性/信息 |

**③ 一个面板只讲一件事**

```
❌ 差: 一个面板里塞5个完全不相关的指标
✅ 好: 每个面板的标题就是你要看的问题

面板标题 = 你想问的问题
"过去1小时哪些服务器的CPU最高？"
"100GE1/0/1 过去24小时有没有丢包？"
```

---

## 八、PromQL 实战手册

### 8.1 比率类 (Rate)

```promql
# 每秒请求数（通用模式）
rate(http_requests_total[5m])

# 每秒字节数
rate(node_network_receive_bytes_total[5m])

# 每秒错误数
rate(http_requests_total{status=~"5.."}[5m])
```

### 8.2 百分比类

```promql
# 错误率
sum(rate(http_requests_total{status=~"5.."}[5m]))
  / sum(rate(http_requests_total[5m])) * 100

# CPU使用率
100 - (avg by(instance)(rate(node_cpu_seconds_total{mode="idle"}[2m])) * 100)

# 磁盘使用率
(1 - node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"}) * 100
```

### 8.3 分位数类

```promql
# P99 延迟
histogram_quantile(0.99,
  rate(http_request_duration_seconds_bucket[5m]))

# P50 (中位数)
histogram_quantile(0.50,
  rate(http_request_duration_seconds_bucket[5m]))

# 95百分位流量（网络）
quantile_over_time(0.95,
  (sum(rate(snmp_if_in_octets_total[2m])) * 8)[30d:5m])
```

### 8.4 聚合类

```promql
# 按标签聚合求和
sum by(instance)(rate(http_requests_total[5m]))

# TOP 5
topk(5, rate(http_requests_total[5m]))

# BOTTOM 5
bottomk(5, rate(http_requests_total[5m]))

# 计数
count(node_cpu_seconds_total{mode="idle"})  # CPU核数
count(up == 1)  # 在线的target数
```

### 8.5 预测类

```promql
# 预测磁盘什么时候满（按最近6小时趋势）
predict_linear(
  node_filesystem_avail_bytes{mountpoint="/"}[6h],
  3600 * 24 * 7  # 预测7天后
) < 0

# 增长率
deriv(node_filesystem_avail_bytes{mountpoint="/"}[6h])
```

---

## 九、Recording Rules 与预计算

### 9.1 什么时候需要 Recording Rules

```
问题: 每次查这个PromQL都要Prometheus现场算
      100台机器 × 每分钟都查 = 很吃CPU

解决: Recording Rules 把常用查询预先计算并存储
      查的时候直接读预计算结果，秒回
```

### 9.2 配置示例

```yaml
# /etc/prometheus/rules/recording.yml
groups:
  - name: node_precompute
    interval: 30s
    rules:
      # 预计算 CPU 使用率，命名规则: level:metric:operation
      - record: instance:node_cpu_utilization:rate5m
        expr: 100 - (avg by(instance)(
          rate(node_cpu_seconds_total{mode="idle"}[5m]))*100)

      # 预计算 内存使用率
      - record: instance:node_memory_utilization:current
        expr: (1 - node_memory_MemAvailable_bytes 
          / node_memory_MemTotal_bytes) * 100

      # 预计算 总 QPS
      - record: job:http_requests_total:rate5m
        expr: sum by(job)(rate(http_requests_total[5m]))
```

### 9.3 命名规范

```
level:metric:operation

level  = instance / job / global（聚合层级）
metric = cpu_utilization / memory_usage（指标名）
operation = rate5m / avg / sum（做了什么操作）
```

---

## 十、高可用与联邦 (HA + Federation)

### 10.1 Prometheus 高可用方案

```
方案1: 双活 (2个独立 Prometheus)
  ┌──Prometheus A (9090)──┐
  │                        │
  │  各自独立采集            │
  │                        │
  └──Prometheus B (9091)──┘
  Grafana 配两个数据源

方案2: Thanos (存储分离)
  Prometheus → Thanos Sidecar → 对象存储(S3/OSS)
                                     ↑
                                  Thanos Query → Grafana
  优点: 数据保留几年，水平扩展

方案3: VictoriaMetrics (国产替代)
  直接替换 Prometheus 存储，兼容 PromQL
  优点: 压缩率更高，查询更快
```

### 10.2 Federation (联邦) — 多数据中心

```
┌──────────────────────────────────────────────────────────┐
│                   中心 Prometheus (汇总)                   │
│                  scrape_interval: 30s                     │
└──────────────┬──────────────┬──────────────┬─────────────┘
               │              │              │
    ┌──────────▼──┐  ┌───────▼──┐  ┌───────▼──┐
    │ 北京机房      │  │ 上海机房   │  │ 深圳机房   │
    │ Prometheus   │  │ Prometheus │  │ Prometheus │
    │ (采集细节)    │  │ (采集细节)  │  │ (采集细节)  │
    └──────────────┘  └───────────┘  └───────────┘
```

```yaml
# 中心 Prometheus 配置
scrape_configs:
  - job_name: 'federate-beijing'
    scrape_interval: 30s
    honor_labels: true
    metrics_path: '/federate'
    params:
      'match[]':
        - '{__name__=~"job:.*"}'   # 只拉预计算的
    static_configs:
      - targets: ['beijing-prometheus:9090']
```

---

## 十一、Exporter 生态速查

### 11.1 常用官方/社区 Exporter

| Exporter | 监控目标 | 端口 |
|----------|---------|------|
| node_exporter | Linux/服务器性能 | 9100 |
| **mysqld_exporter** | MySQL/MariaDB | 9104 |
| **redis_exporter** | Redis | 9121 |
| **nginx_exporter** | Nginx | 9113 |
| postgres_exporter | PostgreSQL | 9187 |
| blackbox_exporter | HTTP/TCP/ICMP探活 | 9115 |
| **snmp_exporter** | 交换机/路由器 | 9116 |
| elasticsearch_exporter | Elasticsearch | 9114 |
| kafka_exporter | Apache Kafka | 9308 |
| mongodb_exporter | MongoDB | 9216 |
| rabbitmq_exporter | RabbitMQ | 9419 |

### 11.2 Blackbox Exporter (探活 — 最重要的)

```bash
# 安装
wget https://github.com/prometheus/blackbox_exporter/releases/download/v0.25.0/blackbox_exporter-0.25.0.linux-amd64.tar.gz
```

```yaml
# prometheus.yml
- job_name: 'blackbox_http'
  metrics_path: /probe
  params:
    module: [http_2xx]
  static_configs:
    - targets:
      - http://114.67.234.232:3001     # Grafana
      - http://114.67.234.232:9090     # Prometheus
      - http://your-backend-api        # 你的应用
  relabel_configs:
    - source_labels: [__address__]
      target_label: __param_target
    - source_labels: [__param_target]
      target_label: instance
    - target_label: __address__
      replacement: localhost:9115
```

**效果**：你的核心服务不可达时立刻告警。

---

## 十二、自研服务接入 Prometheus (Instrumentation)

### 12.1 四步接入法

```
Step 1: 在代码里引入 client 库
  └── Go:   github.com/prometheus/client_golang
  └── Python: prometheus_client
  └── Java:   io.prometheus:simpleclient

Step 2: 定义指标
  └── Counter (计数器) — QPS、错误数
  └── Gauge (即时值) — 连接数、队列长度
  └── Histogram (分布) — 延迟分布、请求大小
  └── Summary (百分位) — P50/P90/P99

Step 3: 暴露 /metrics 端点
  └── 一般是 :8080/metrics 或 :9090/metrics

Step 4: 在 Prometheus 里配置抓取
  └── 加一段 scrape_configs
```

### 12.2 各语言的推荐 Exporter 路径

| 语言/框架 | 推荐方式 |
|----------|---------|
| Go (标准库) | `promhttp.Handler()` |
| Go (Gin) | `github.com/zsais/go-gin-prometheus` |
| Python (Flask) | `prometheus_flask_exporter` |
| Python (Django) | `django-prometheus` |
| Java (Spring Boot) | `micrometer-registry-prometheus` |
| Node.js (Express) | `prom-client` |

---

## 十三、常见运维 Checklist

### 13.1 日常巡检

- [ ] Grafana 首页大屏：所有服务都是绿色？
- [ ] Alertmanager: 有没有未恢复的告警？
- [ ] Prometheus: `up == 0` 的 target 有没有？
- [ ] 磁盘: Prometheus 数据目录 (`/var/lib/prometheus`) 用了多少？
- [ ] 内存: Prometheus 有没有 OOM？

### 13.2 新服务上线

- [ ] 服务有没有暴露 `/metrics`？
- [ ] Prometheus 有没有添加 scrape 配置？
- [ ] Grafana 有没有对应的仪表盘？
- [ ] 告警规则有没有写？
- [ ] 四金信号齐不齐？

### 13.3 容量规划

```promql
# 每个月的数据增长量
delta(prometheus_tsdb_storage_blocks_bytes[30d])

# 预测30天后会满
predict_linear(
  node_filesystem_avail_bytes{mountpoint="/var/lib/prometheus"}[30d],
  3600 * 24 * 30
) < 0
```

### 13.4 安全建议

- [ ] Prometheus 有没有加 Basic Auth / TLS？
- [ ] Exporter 有没有限制只能 Prometheus 访问？
- [ ] Grafana 默认密码改了没？（你已改 ✅）
- [ ] 敏感指标（如密码查询）有没有过滤掉？

---

> **总结**
>
> 企业用 Prometheus + Grafana，就是把这13章的内容按需组合。
> 你现在已经完成了:
> - ✅ Node Exporter (服务器层)
> - ✅ SNMP Exporter (网络设备层)
> - ✅ MySQL 直连 (业务数据层)
> - ✅ Grafana Alerting (告警层)
>
> 下一步建议: 给后端 API 加入 `blackbox_exporter` 探活 + 接入应用指标埋点。
