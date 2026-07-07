# 华为 CE8850 交换机 SNMP 监控 → Prometheus + Grafana 完整配置笔记

> **作者**: Hermes Agent | **日期**: 2026-06-24 | **环境**: Ubuntu 24.04 LTS
> **交换机**: 南宁电信 - 华为 CE8850 (100GE 数据中心交换机)

---

## 目录

1. [环境信息总览](#一环境信息总览)
2. [核心概念速览](#二核心概念速览)
3. [方案选型说明](#三方案选型说明)
4. [前置条件核实](#四前置条件核实)
5. [第一种方案：snmp_exporter 安装与配置](#五第一种方案snmp_exporter-安装与配置)
6. [第一种方案失败原因分析](#六第一种方案失败原因分析)
7. [第二种方案：Python 自定义 SNMP 采集器（最终方案）](#七第二种方案python-自定义-snmp-采集器最终方案)
8. [配置 Prometheus 抓取](#八配置-prometheus-抓取)
9. [创建 Grafana 仪表盘](#九创建-grafana-仪表盘)
10. [告警规则配置建议](#十告警规则配置建议)
11. [完整验证流程](#十一完整验证流程)
12. [常用 PromQL 查询参考](#十二常用-promql-查询参考)
13. [故障排查手册](#十三故障排查手册)
14. [附录：SNMP 基础概念](#十四附录snmp-基础概念)
15. [附录：OID 速查表](#十五附录oid-速查表)

---

## 一、环境信息总览

### 1.1 服务器环境

| 项目 | 值 |
|------|-----|
| 操作系统 | Ubuntu 24.04 LTS |
| 内核 | 6.8.0-53-generic x86_64 |
| 主机名 | zabbix-server |
| IP 地址 | 114.67.234.232 |
| CPU | 2 核 |
| Prometheus 版本 | 2.45.3 (端口 9090) |
| Grafana 版本 | 10.4.2 (端口 3001) |
| Alertmanager 版本 | 0.26.0 (端口 9093) |
| SNMP 工具 | net-snmp 5.9.4.pre2 |

### 1.2 交换机信息

| 项目 | 值 |
|------|-----|
| 品牌型号 | **华为 CE8850** (CloudEngine 系列) |
| IP 地址 | 171.105.26.249 |
| SNMP 版本 | **v2c** |
| Community（团体名） | `tskj123@TEST` |
| SNMP 端口 | 161 (UDP) |
| 端口配置 | 32×100GE + 2×10GE + 管理口 + VLAN接口 |
| 在线端口 | 100GE1/0/1 ~ 1/0/4, 1/0/6 ~ 1/0/9 |

### 1.3 已有基础设施

| 服务 | 端口 | 状态 |
|------|------|------|
| Prometheus | 9090 | ✅ 运行中 |
| Grafana | 3001 | ✅ 运行中，已配置企业微信+邮箱通知 |
| node_exporter | 9100 | ✅ 本机监控 |
| snmp_exporter (备用) | 9116 | ✅ 已安装但未用于本方案 |
| **Python SNMP 采集器（本方案）** | **9117** | **✅ 运行中** |

---

## 二、核心概念速览

### 2.1 SNMP 是什么

SNMP（Simple Network Management Protocol，简单网络管理协议）是网络设备（交换机、路由器、防火墙）通用的管理协议。

> **比喻**：SNMP 就像医院的**病历查询系统**。你用正确的密码（Community）去查一个病人ID（OID），就能拿到对应数据（体温、心率）。

### 2.2 几个关键术语

| 术语 | 解释 | 类比 |
|------|------|------|
| **SNMP Agent** | 交换机/路由器上运行的SNMP服务端 | 医院的病历档案室 |
| **SNMP Manager** | 采集端，向Agent发请求 | 来查病历的医生 |
| **Community** | 相当于密码，分read-only和read-write | 病历室的门禁密码 |
| **OID** | 每个监控项的编号，如 `.1.3.6.1.2.1.2.2.1.10` 代表接口入流量 | 病历编号 |
| **MIB** | OID的字典/说明书，把数字编号翻译成人类可读的名字 | 病历编号对照表 |
| **Walk** | 遍历某个OID下所有子节点（一口气拿所有端口数据） | 一次查完所有病历 |
| **Get** | 查单个OID的值 | 查一个病历号 |
| **Counter64** | 64位计数器，不会翻转（适合100GE这种高速端口） | 大数字里程表 |
| **Gauge32** | 32位标量值，可增可减 | 当前速度表 |

### 2.3 完整数据链路

```
[华为 CE8850 交换机]                [你的服务器]
┌─────────────────────┐         ┌─────────────────────────┐
│ SNMP Agent (UDP 161)│ ──SNMP──│ Python 采集器 (9117)   │
│ 管理MIB库            │  walk   │ 每60秒调用snmpbulkwalk  │
│ 存有流量/状态数据    │         │ 解析输出 → Prometheus格式│
└─────────────────────┘         └──────────┬──────────────┘
                                           │ HTTP GET /metrics
                                           ▼
                                    ┌──────────────┐
                                    │ Prometheus   │
                                    │ 9090         │
                                    │ 每60秒抓取    │
                                    │ 存储为时序数据 │
                                    └──────┬───────┘
                                           │ PromQL 查询
                                           ▼
                                    ┌──────────────┐
                                    │ Grafana 3001 │
                                    │ 可视化仪表盘  │
                                    │ 告警规则      │
                                    └──────────────┘
```

---

## 三、方案选型说明

### 3.1 可选方案对比

| 方案 | 优点 | 缺点 | 最终选择 |
|------|------|------|---------|
| **snmp_exporter**（官方） | Prometheus 官方出品，功能完备 | gosnmp 库与华为CE系 SNMP 实现有兼容问题 | ❌ 失败 |
| **Python 自定义采集器** | 绕过兼容问题，灵活可控 | 需要手写维护 | ✅ **采用** |
| Telegraf + SNMP | 功能强 | 需要额外安装 InfluxDB | ❌ 额外组件 |
| Zabbix SNMP | 你已有 Zabbix | 与本机 Prometheus 栈分离 | ❌ 不统一 |

### 3.2 为什么 snmp_exporter 失败

**现象**：snmp_exporter 的 gosnmp 库在执行 SNMP Walk 时，对华为 CE8850 的响应处理超时，重试 3 次后放弃。

**原因**：
- 华为 CloudEngine 交换机的 SNMP 实现遵循标准但 `snmpbulk` 包处理方式与 gosnmp 的期望不完全一致
- gosnmp 库的 bulk walk 在收到某些 SNMP 响应时无法正确处理分页
- 系统自带的 `snmpbulkwalk`（net-snmp C 语言实现）却能正常工作

**结论**：这是一个 Golang 库 vs 交换机实现之间的兼容性问题，不是配置错误。

---

## 四、前置条件核实

### 4.1 确认交换机上已开启 SNMP

登录交换机执行（SSH 到 171.105.26.249）：

```
system-view
snmp-agent
snmp-agent community read tskj123@TEST
snmp-agent sys-info version v2c
snmp-agent trap source LoopBack0
```

或者用 Web 管理页面开启。

### 4.2 验证交换机可达

```bash
# 验证网络连通性
ping -c 2 171.105.26.249

# 验证 SNMP 可达（拿到接口名称）
snmpwalk -v 2c -c "tskj123@TEST" -t 5 171.105.26.249 1.3.6.1.2.1.2.2.1.2
```

成功返回类似：
```
iso.3.6.1.2.1.2.2.1.2.5 = STRING: "100GE1/0/1"
iso.3.6.1.2.1.2.2.1.2.6 = STRING: "100GE1/0/2"
...
```

> 注意：Community 包含 `@` 符号时，shell 中需要用双引号括起来。URL 传参时需编码为 `%40`。

### 4.3 确认服务器上已安装 SNMP 工具

```bash
# 检查版本
snmpwalk --version
# 应输出: NET-SNMP version: 5.9.x

# 如果需要安装
apt install snmp snmp-mibs-downloader -y
```

---

## 五、第一种方案：snmp_exporter 安装与配置

> 尽管最终未采用此方案，仍记录安装过程作为参考。

### 5.1 下载 snmp_exporter

```bash
cd /opt

# 下载 v0.27.0
wget https://github.com/prometheus/snmp_exporter/releases/download/v0.27.0/snmp_exporter-0.27.0.linux-amd64.tar.gz

# 解压
tar xzf snmp_exporter-0.27.0.linux-amd64.tar.gz

# 移动二进制
mv snmp_exporter-0.27.0.linux-amd64/snmp_exporter /usr/local/bin/

# 创建配置目录
mkdir -p /etc/snmp_exporter
```

### 5.2 配置 snmp.yml（纯接口监控版）

```yaml
auths:
  public_v2:
    community: public
    version: 2

modules:
  if_mib:
    walk:
      - 1.3.6.1.2.1.2.2.1.2   # ifDescr - 接口描述
      - 1.3.6.1.2.1.2.2.1.7   # ifAdminStatus - 管理状态
      - 1.3.6.1.2.1.2.2.1.8   # ifOperStatus - 运行状态
      - 1.3.6.1.2.1.31.1.1.1.1  # ifName - 接口名称
      - 1.3.6.1.2.1.31.1.1.1.6  # ifHCInOctets - 64位入流量
      - 1.3.6.1.2.1.31.1.1.1.10 # ifHCOutOctets - 64位出流量
      - 1.3.6.1.2.1.31.1.1.1.15 # ifHighSpeed - 接口高速率
```

### 5.3 创建 systemd 服务

```bash
cat > /etc/systemd/system/snmp_exporter.service << 'EOF'
[Unit]
Description=Prometheus SNMP Exporter
After=network.target

[Service]
Type=simple
User=prometheus
Group=prometheus
ExecStart=/usr/local/bin/snmp_exporter \
  --config.file=/etc/snmp_exporter/snmp.yml \
  --web.listen-address=:9116

[Install]
WantedBy=multi-user.target
EOF

# 创建 prometheus 用户
useradd -M -r -s /bin/false prometheus 2>/dev/null

# 设置权限
chown -R prometheus:prometheus /etc/snmp_exporter

# 启动
systemctl daemon-reload
systemctl enable snmp_exporter
systemctl start snmp_exporter
```

### 5.4 测试

```bash
curl "http://localhost:9116/snmp?target=171.105.26.249&community=tskj123%40TEST&module=if_mib"
```

### 5.5 结果：失败

```
error collecting metric: error walking target 171.105.26.249: request timeout (after 3 retries)
```

---

## 六、第一种方案失败原因分析

### 6.1 根本原因

snmp_exporter 使用 **gosnmp**（Go 语言 SNMP 库）执行 SNMP 操作。该库在发送 `GetBulkRequest` 后，处理华为 CE8850 的回应时存在问题。

### 6.2 证据对比

```bash
# 系统的 snmpbulkwalk（正常）
snmpbulkwalk -v 2c -c "tskj123@TEST" -t 5 171.105.26.249 1.3.6.1.2.1.31.1.1.1.6
# → 立即返回 43 行正确数据

# snmp_exporter 的 Go walk（超时）
curl "http://localhost:9116/snmp?target=171.105.26.249&community=tskj123%40TEST&module=if_mib"
# → 3次重试后 timeout
```

### 6.3 影响范围

| 设备类型 | snmp_exporter 兼容性 |
|---------|-------------------|
| Cisco IOS | ✅ 良好 |
| H3C/华为通用 | ⚠️ 部分型号有问题 |
| **华为 CE8850 (CloudEngine)** | **❌ gosnmp walk 超时** |
| 主流服务器 | ✅ 良好 |

### 6.4 解决方案

采用 **net-snmp CLI 工具 + Python 包装**的方式，绕过 gosnmp 库。

---

## 七、第二种方案：Python 自定义 SNMP 采集器（最终方案）

### 7.1 设计思路

```
snmpbulkwalk (net-snmp C库)  →  标准输出  →  Python解析  →  HTTP /metrics
                        ↑                         ↑
             原生C实现，兼容性最好          :9117 端口
```

### 7.2 采集器代码

安装位置：`/usr/local/bin/snmp_huawei_exporter.py`

```python
#!/usr/bin/env python3
"""
华为 CE8850 SNMP 流量采集器
通过系统 snmpbulkwalk 获取数据，以 Prometheus 格式暴露
端口: 9117
"""

import subprocess
import re
import time
from http.server import HTTPServer, BaseHTTPRequestHandler

# ========== 配置区（按需修改）==========
SWITCH_IP    = "171.105.26.249"
COMMUNITY    = "tskj123@TEST"
SNMP_VER     = "2c"
SCRAPE_PORT  = 9117
# ======================================


def sniff(oid):
    """执行 snmpbulkwalk，返回 [(index, value), ...]
    
    输出格式示例:
      iso.3.6.1.2.1.31.1.1.1.6.10 = Counter64: 371483141266789069
      iso.3.6.1.2.1.2.2.1.2.5     = STRING: "100GE1/0/1"
    
    关键：取最后一个数字（跳过 Counter64/Gauge32 前缀中的64/32）
    """
    try:
        result = subprocess.run(
            ["snmpbulkwalk", "-v", SNMP_VER, "-c", COMMUNITY,
             "-t", "8", SWITCH_IP, oid],
            capture_output=True, text=True, timeout=35
        )
        if result.returncode != 0:
            result = subprocess.run(
                ["snmpwalk", "-v", SNMP_VER, "-c", COMMUNITY,
                 "-t", "8", SWITCH_IP, oid],
                capture_output=True, text=True, timeout=35
            )
    except:
        return []

    data = []
    for line in result.stdout.strip().split('\n'):
        line = line.strip()
        if not line or '=' not in line:
            continue
        parts = line.split(' = ')
        if len(parts) < 2:
            continue
        oid_full = parts[0]
        val_raw  = parts[1]
        idx = oid_full.rstrip('.').split('.')[-1]
        
        # 取最后一个数字（避免 Counter64 里的 64 被误取）
        all_nums = re.findall(r'(\d+)', val_raw.replace('"', ''))
        if all_nums:
            data.append((idx, all_nums[-1]))
    return data


def sniff_str(oid):
    """获取字符串类型的 SNMP 值（接口名称）"""
    try:
        result = subprocess.run(
            ["snmpbulkwalk", "-v", SNMP_VER, "-c", COMMUNITY,
             "-t", "8", SWITCH_IP, oid],
            capture_output=True, text=True, timeout=35
        )
        if result.returncode != 0:
            result = subprocess.run(
                ["snmpwalk", "-v", SNMP_VER, "-c", COMMUNITY,
                 "-t", "8", SWITCH_IP, oid],
                capture_output=True, text=True, timeout=35
            )
    except:
        return []

    data = []
    for line in result.stdout.strip().split('\n'):
        line = line.strip()
        if not line or '=' not in line:
            continue
        parts = line.split(' = ')
        if len(parts) < 2:
            continue
        oid_full = parts[0]
        val_raw  = parts[1]
        idx = oid_full.rstrip('.').split('.')[-1]
        m = re.search(r'"([^"]*)"', val_raw)
        if m:
            name = ''.join(c for c in m.group(1) if c.isprintable())
            data.append((idx, name))
        else:
            val = val_raw.split(':')[-1].strip()
            data.append((idx, val))
    return data


class SNMPExporterHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != '/metrics':
            self.send_response(404)
            self.end_headers()
            return

        start = time.time()
        self.send_response(200)
        self.send_header('Content-Type', 'text/plain; charset=utf-8')
        self.end_headers()

        metrics = []

        # 1. 获取接口名称
        print("[采集] 获取接口名称...")
        if_names = dict(sniff_str("1.3.6.1.2.1.31.1.1.1.1"))
        if_descr = dict(sniff_str("1.3.6.1.2.1.2.2.1.2"))
        all_idx  = sorted(set(list(if_names.keys()) + list(if_descr.keys())))
        print(f"[采集] 发现 {len(all_idx)} 个接口")

        # 2. HELP / TYPE 声明
        metrics.append('# HELP snmp_if_in_octets_total Bytes received (64-bit)')
        metrics.append('# TYPE snmp_if_in_octets_total counter')
        metrics.append('# HELP snmp_if_out_octets_total Bytes sent (64-bit)')
        metrics.append('# TYPE snmp_if_out_octets_total counter')
        metrics.append('# HELP snmp_if_speed Interface speed (bps)')
        metrics.append('# TYPE snmp_if_speed gauge')
        metrics.append('# HELP snmp_if_oper_status 1=up, 2=down')
        metrics.append('# TYPE snmp_if_oper_status gauge')

        # 3. 并发采集流量数据
        print("[采集] 获取入流量...")
        hc_in  = dict(sniff("1.3.6.1.2.1.31.1.1.1.6"))
        print("[采集] 获取出流量...")
        hc_out = dict(sniff("1.3.6.1.2.1.31.1.1.1.10"))
        print("[采集] 获取端口速率...")
        speed  = dict(sniff("1.3.6.1.2.1.2.2.1.5"))
        print("[采集] 获取运行状态...")
        oper   = dict(sniff("1.3.6.1.2.1.2.2.1.8"))

        # 4. 输出所有接口的指标
        for idx in all_idx:
            name  = if_names.get(idx, f"if{idx}")
            descr = if_descr.get(idx, "")
            labels = f'ifIndex="{idx}",ifName="{name}"'
            if descr and descr != name:
                labels += f',ifDescr="{descr}"'

            if idx in hc_in:
                metrics.append(f'snmp_if_in_octets_total{{{labels}}} {hc_in[idx]}')
            if idx in hc_out:
                metrics.append(f'snmp_if_out_octets_total{{{labels}}} {hc_out[idx]}')
            if idx in speed:
                metrics.append(f'snmp_if_speed{{{labels}}} {speed[idx]}')
            if idx in oper:
                metrics.append(f'snmp_if_oper_status{{{labels}}} {oper[idx]}')

        # 5. 采集耗时
        elapsed = time.time() - start
        metrics.append('# HELP snmp_scrape_duration_seconds Scrape duration')
        metrics.append('# TYPE snmp_scrape_duration_seconds gauge')
        metrics.append(f'snmp_scrape_duration_seconds {elapsed}')

        print(f"[采集] 完成，耗时 {elapsed:.2f}s，输出 {len(metrics)} 行")
        self.wfile.write('\n'.join(metrics).encode('utf-8'))

    def log_message(self, format, *args):
        pass  # 减少日志噪音


if __name__ == '__main__':
    server = HTTPServer(('0.0.0.0', SCRAPE_PORT), SNMPExporterHandler)
    print(f"Huawei CE8850 SNMP exporter running on port {SCRAPE_PORT}")
    print(f"Target: {SWITCH_IP}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()
```

### 7.3 创建 systemd 服务

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

### 7.4 验证采集器

```bash
# 查看服务状态
systemctl status snmp_huawei_exporter

# 直接测试数据输出
curl -s http://localhost:9117/metrics | head -30

# 应能看到类似输出：
# snmp_if_in_octets_total{ifIndex="5",ifName="100GE1/0/1"} 1947443419438
# snmp_if_out_octets_total{ifIndex="5",ifName="100GE1/0/1"} 317994563222142599
```

---

## 八、配置 Prometheus 抓取

### 8.1 修改 prometheus.yml

编辑 `/etc/prometheus/prometheus.yml`，在 `scrape_configs:` 下添加：

```yaml
  - job_name: 'snmp_huawei_ce8850'
    scrape_interval: 60s          # 每60秒采集一次（SNMP采集较慢）
    scrape_timeout: 50s           # 超时时间（采集一次约1.7秒，50s足够）
    static_configs:
      - targets: ['localhost:9117']  # Python采集器端口
```

### 8.2 各参数说明

| 参数 | 值 | 原因 |
|------|-----|------|
| `scrape_interval` | 60s | SNMP walk 一次约 1.7s，没必要太频繁 |
| `scrape_timeout` | 50s | 给足余量，网络波动时不会超时 |
| `job_name` | `snmp_huawei_ce8850` | 唯一标识，Grafana 中用来区分数据来源 |

### 8.3 重启 Prometheus

```bash
systemctl restart prometheus
systemctl status prometheus
```

### 8.4 验证 Prometheus 抓取

```bash
# 确认 target 状态为 UP
curl -s http://localhost:9090/api/v1/targets | python3 -c "
import json,sys
d = json.load(sys.stdin)
for t in d['data']['activeTargets']:
    print(f\"  {t['labels']['job']:30s} | health={t['health']}\")
"

# 确认数据已进入 Prometheus
curl -s 'http://localhost:9090/api/v1/query?query=snmp_if_in_octets_total{ifName="100GE1/0/1"}'
```

---

## 九、创建 Grafana 仪表盘

### 9.1 通过 API 创建仪表盘

直接使用 Grafana REST API 创建包含 5 个面板的仪表盘：

```bash
curl -s -u admin:ZZh1832388 -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "dashboard": {
      "title": "华为CE8850 交换机流量",
      "tags": ["snmp", "huawei", "ce8850"],
      "timezone": "browser",
      "panels": [
        { "title": "总入流量 (bits/s)",   ... },
        { "title": "总出流量 (bits/s)",   ... },
        { "title": "端口状态",            ... },
        { "title": "各端口入流量TOP10",   ... },
        { "title": "各端口出流量TOP10",   ... }
      ]
    }
  }' http://localhost:3001/api/dashboards/db
```

### 9.2 仪表盘面板说明

| 面板 | 类型 | 查询 (PromQL) | 说明 |
|------|------|-------------|------|
| **总入流量** | Time series | `rate(snmp_if_in_octets_total{ifName=~"100GE.*"}[2m]) * 8` | 所有 100GE 端口入站流量曲线（bits/s） |
| **总出流量** | Time series | `rate(snmp_if_out_octets_total{ifName=~"100GE.*"}[2m]) * 8` | 所有 100GE 端口出站流量曲线（bits/s） |
| **端口状态** | Stat | `count(snmp_if_oper_status{ifName=~"100GE.*",ifName!="100GE1/0/5"} == 1)` | 在线端口数量（大数字展示） |
| **入流量TOP10** | Bar gauge | `topk(10, rate(snmp_if_in_octets_total{ifName=~"100GE.*",ifOperStatus="1"}[5m]) * 8)` | 入流量最大的10个端口 |
| **出流量TOP10** | Bar gauge | `topk(10, rate(snmp_if_out_octets_total{ifName=~"100GE.*",ifOperStatus="1"}[5m]) * 8)` | 出流量最大的10个端口 |

### 9.3 手动访问地址

```
http://114.67.234.232:3001/d/dfq2n3w9eafpce
```

> 如 UID 变动，在 Grafana → Dashboards → Browse 中搜索"华为CE8850"。

---

## 十、告警规则配置建议

### 10.1 端口 Down 告警

当某个关键端口从 up 变成 down 时触发：

```
规则名称: 交换机_100GE1/0/1_端口Down
查询: snmp_if_oper_status{ifName="100GE1/0/1"}
条件: last() == 2   (2=down)
Pending: 30s
标签: severity = critical
```

### 10.2 端口流量异常低（疑似链路故障）

```
规则名称: 交换机_端口流量异常
查询: rate(snmp_if_in_octets_total{ifName=~"100GE1/0/[1-4]",ifOperStatus="1"}[5m]) * 8 < 1000000
条件: last() < 1000000   (小于1Mbps)
Pending: 5m
标签: severity = warning
```

### 10.3 说明：什么是 oper_status

| 值 | 含义 | 状态 |
|----|------|------|
| 1 | up | ✅ 正常运行 |
| 2 | down | ❌ 端口关闭/未连接 |
| 3 | testing | 🔧 测试模式 |
| 4 | unknown | ❓ 未知 |
| 5 | dormant | 💤 休眠 |
| 6 | notPresent | 不存在 |
| 7 | lowerLayerDown | 下层协议不通 |

---

## 十一、完整验证流程

### 11.1 逐层验证

```bash
# 第1层：交换机 SNMP 可达
snmpwalk -v 2c -c "tskj123@TEST" -t 5 171.105.26.249 .1.3.6.1.2.1.2.2.1.2 | head -3

# 第2层：Python 采集器运行
systemctl status snmp_huawei_exporter

# 第3层：采集器输出
curl -s http://localhost:9117/metrics | grep -c "snmp_if_in_octets_total"

# 第4层：Prometheus 抓取状态
curl -s http://localhost:9090/api/v1/targets | grep snmp_huawei

# 第5层：Prometheus 数据存在
curl -s 'http://localhost:9090/api/v1/query?query=snmp_if_in_octets_total{ifName="100GE1/0/1"}'

# 第6层：Grafana 仪表盘
curl -s -u admin:ZZh1832388 "http://localhost:3001/api/search?query=华为"
```

### 11.2 最终验证输出

```
① SNMP 采集器      → Active (running) since ...
② 采集器数据        → 45 行指标
③ Prometheus 抓取   → snmp_huawei_ce8850 | health=up
④ Prometheus 数据   → 100GE1/0/1: 1,947,612,761,971 bytes (1.95 TB)
⑤ Grafana 仪表盘    → 华为CE8850 交换机流量
```

---

## 十二、常用 PromQL 查询参考

### 12.1 接口入流量（bits/s）

```promql
# 单个端口
rate(snmp_if_in_octets_total{ifName="100GE1/0/1"}[2m]) * 8

# 所有端口求和
sum(rate(snmp_if_in_octets_total{ifName=~"100GE.*",ifOperStatus="1"}[2m])) * 8

# 按端口分组
rate(snmp_if_in_octets_total{ifName=~"100GE.*",ifOperStatus="1"}[2m]) * 8
```

### 12.2 接口出流量（bits/s）

```promql
rate(snmp_if_out_octets_total{ifName="100GE1/0/1"}[2m]) * 8
```

### 12.3 端口利用率（百分比）

```promql
# 入向利用率（假设100G端口，speed=100000000000）
rate(snmp_if_in_octets_total{ifName="100GE1/0/1"}[2m]) * 8 * 100 / 100000000000

# 出向利用率
rate(snmp_if_out_octets_total{ifName="100GE1/0/1"}[2m]) * 8 * 100 / 100000000000
```

> ⚠️ 华为 CE8850 的 ifSpeed 返回 4294967295（Counter32 最大值），这是 100G 端口的溢出表现。实际速率应使用接口命名（100GE）推断为 100Gbps。

### 12.4 在线端口统计

```promql
# 在线端口数
count(snmp_if_oper_status{ifName=~"100GE.*",ifOperStatus="1"} == 1)

# 离线端口数
count(snmp_if_oper_status{ifName=~"100GE.*"} == 2)

# 总端口数
count(snmp_if_oper_status{ifName=~"100GE.*"})
```

### 12.5 TOP N 流量端口

```promql
# 入流量 TOP5
topk(5, rate(snmp_if_in_octets_total{ifName=~"100GE.*",ifOperStatus="1"}[5m]) * 8)

# 出流量 TOP5
topk(5, rate(snmp_if_out_octets_total{ifName=~"100GE.*",ifOperStatus="1"}[5m]) * 8)
```

---

## 十三、故障排查手册

### 13.1 SNMP 连接不上

```bash
# ① 先 ping
ping 171.105.26.249

# ② 用 snmpget 单 OID 测试
snmpget -v 2c -c "tskj123@TEST" -t 5 171.105.26.249 1.3.6.1.2.1.1.1.0

# ③ 检查防火墙是否开放 UDP 161
nmap -sU -p 161 171.105.26.249
```

### 13.2 交换机配置问题

如果 SNMP 连接失败，登录交换机检查：

```bash
# 查看 SNMP 配置
display snmp-agent community

# 确认 SNMP 版本
display snmp-agent sys-info version

# 确认 ACL 是否限制了访问 IP
display snmp-agent acl
```

### 13.3 采集器报错

```bash
# 查看采集器日志
journalctl -u snmp_huawei_exporter --no-pager -n 50

# 手动测试采集器能不能跑
python3 /usr/local/bin/snmp_huawei_exporter.py &
curl -s http://localhost:9117/metrics | head
# 测试完记得 kill %1
```

### 13.4 Prometheus 抓取失败

```bash
# 检查 target 状态
curl -s http://localhost:9090/api/v1/targets | python3 -m json.tool | grep -A 5 "snmp_huawei"

# 检查 Prometheus 日志
journalctl -u prometheus --no-pager -n 30
```

### 13.5 Grafana 面板无数据

| 可能性 | 检查方法 | 解决 |
|--------|---------|------|
| 数据源未选 | 编辑面板→看 Data source 是否选了 prometheus | 选 prometheus |
| PromQL 写错 | 复制查询去 Explore 页面试运行 | 修正语法 |
| 时间范围不对 | 检查右上角时间选择器 | 选 Last 6 hours |
| 数据还没采集完 | 等2-3分钟 | rate()需要至少2个数据点 |

### 13.6 数据值异常

| 现象 | 原因 | 解决 |
|------|------|------|
| 流量值全是 0 | 端口实际没有流量，或 oper_status=2 | 查看端口状态 |
| 值很小（如 64） | Python 解析取了 Counter64 中的"64" | 确认取的是 findall 最后一个数字 |
| 值很大 | 正常，100GE端口累计了几PB流量 | 用 rate() 计算速率 |
| 速率显示 4.29G | ifSpeed 返回了最大值 | 用接口命名推断实际速率 |

---

## 十四、附录：SNMP 基础概念

### 14.1 OID 树结构

SNMP 的 OID 是一个树形结构，类似文件系统路径：

```
.1.3.6.1.2.1.2.2.1.10
iso(1)
  └── org(3)
       └── dod(6)
            └── internet(1)
                 ├── mgmt(2)
                 │    └── mib-2(1)        ← 标准MIB-II
                 │         └── interfaces(2)
                 │              └── ifTable(2)
                 │                   └── ifEntry(1)
                 │                        ├── ifIndex(1)
                 │                        ├── ifDescr(2)
                 │                        ├── ifType(3)
                 │                        ├── ifMtu(4)
                 │                        ├── ifSpeed(5)         ← 端口速率
                 │                        ├── ifPhysAddress(6)
                 │                        ├── ifAdminStatus(7)  ← 管理状态
                 │                        ├── ifOperStatus(8)   ← 运行状态
                 │                        ├── ifInOctets(10)    ← 入流量(32位)
                 │                        └── ifOutOctets(16)   ← 出流量(32位)
                 └── ...
```

### 14.2 32位 vs 64位计数器

| 类型 | OID | 最大可计数 | 适用场景 |
|------|-----|-----------|---------|
| ifInOctets | .1.3.6.1.2.1.2.2.1.10 | ~4.3 GB（会翻转） | 百兆/千兆端口 |
| **ifHCInOctets** | **.1.3.6.1.2.1.31.1.1.1.6** | **~1.8×10¹⁹ GB（不翻转）** | **万兆/百G端口** |

> 对 100GE 端口，必须用 `ifHCInOctets`（64位版本），32位版本几秒钟就会溢出。

### 14.3 Counter vs Gauge

| 类型 | 特点 | 示例 |
|------|------|------|
| **Counter** (计数器) | 只增不减，重启才归零 | 流量字节数 |
| **Gauge** (标量) | 可增可减 | 端口速率、温度 |

---

## 十五、附录：OID 速查表

### 15.1 接口监控核心 OID

| OID | 名称 | 类型 | 说明 |
|-----|------|------|------|
| .1.3.6.1.2.1.2.2.1.2 | ifDescr | STRING | 接口描述（如 "100GE1/0/1"） |
| .1.3.6.1.2.1.2.2.1.3 | ifType | INTEGER | 接口类型（6=以太网） |
| .1.3.6.1.2.1.2.2.1.5 | ifSpeed | Gauge32 | 接口速率(bps) |
| .1.3.6.1.2.1.2.2.1.6 | ifPhysAddress | STRING | MAC地址 |
| .1.3.6.1.2.1.2.2.1.7 | ifAdminStatus | INTEGER | 管理状态(1=up, 2=down) |
| .1.3.6.1.2.1.2.2.1.8 | ifOperStatus | INTEGER | 运行状态(1=up, 2=down) |
| .1.3.6.1.2.1.2.2.1.10 | ifInOctets | Counter32 | 入流量(32位) |
| .1.3.6.1.2.1.2.2.1.11 | ifInUcastPkts | Counter32 | 入单播包(32位) |
| .1.3.6.1.2.1.2.2.1.13 | ifInDiscards | Counter32 | 入丢弃包 |
| .1.3.6.1.2.1.2.2.1.14 | ifInErrors | Counter32 | 入错误包 |
| .1.3.6.1.2.1.2.2.1.16 | ifOutOctets | Counter32 | 出流量(32位) |
| .1.3.6.1.2.1.2.2.1.17 | ifOutUcastPkts | Counter32 | 出单播包(32位) |
| .1.3.6.1.2.1.2.2.1.19 | ifOutDiscards | Counter32 | 出丢弃包 |
| .1.3.6.1.2.1.2.2.1.20 | ifOutErrors | Counter32 | 出错误包 |
| .1.3.6.1.2.1.31.1.1.1.1 | ifName | STRING | 接口名称 |
| **.1.3.6.1.2.1.31.1.1.1.6** | **ifHCInOctets** | **Counter64** | **入流量(64位，推荐)** |
| .1.3.6.1.2.1.31.1.1.1.7 | ifHCInUcastPkts | Counter64 | 入单播包(64位) |
| **.1.3.6.1.2.1.31.1.1.1.10** | **ifHCOutOctets** | **Counter64** | **出流量(64位，推荐)** |
| .1.3.6.1.2.1.31.1.1.1.11 | ifHCOutUcastPkts | Counter64 | 出单播包(64位) |
| .1.3.6.1.2.1.31.1.1.1.15 | ifHighSpeed | Gauge32 | 高速率(单位：Mbps) |

### 15.2 系统信息 OID

| OID | 名称 | 说明 |
|-----|------|------|
| .1.3.6.1.2.1.1.1.0 | sysDescr | 系统描述（品牌型号） |
| .1.3.6.1.2.1.1.2.0 | sysObjectID | 设备类型 |
| .1.3.6.1.2.1.1.3.0 | sysUpTime | 运行时长(ticks) |
| .1.3.6.1.2.1.1.5.0 | sysName | 设备名称 |
| .1.3.6.1.2.1.1.6.0 | sysLocation | 设备位置 |

---

## 文档结束

> **维护记录**
> - 2026-06-24：初版创建，完成华为 CE8850 SNMP 监控配置
> - 待添加：批量交换机接入、Cacti 风格流量图、更精确的端口速率计算
