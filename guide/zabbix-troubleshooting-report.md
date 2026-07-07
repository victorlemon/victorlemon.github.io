# Zabbix 企业微信报警配置 —— 问题排查与解决总结

> **环境**: 京东试用服务器 114.67.234.232  
> **系统**: Ubuntu 24.04, 2GB 内存  
> **Zabbix**: 7.0.27, PostgreSQL 后端  
> **主机名**: 京东试用服务器-114.67.234.232  
> **模板**: Linux by Zabbix agent active  
> **报警通道**: 企业微信群机器人 Webhook  
> **日期**: 2026-06-10  

---

## 目录

1. [测试目标](#1-测试目标)
2. [问题一：压力测试跑完但没有告警](#2-问题一压力测试跑完但没有告警)
3. [问题二：Zabbix Agent 挂了，停止采集数据](#3-问题二zabbix-agent-挂了停止采集数据)
4. [问题三：触发器条件太严格，始终不触发](#4-问题三触发器条件太严格始终不触发)
5. [问题四：内存阈值太高，2GB 服务器吃不消](#5-问题四内存阈值太高2gb-服务器吃不消)
6. [问题五：触发器终于触发了，但企业微信收不到消息](#6-问题五触发器终于触发了但企业微信收不到消息)
7. [问题六：Webhook 脚本报错 —— padStart 不兼容](#7-问题六webhook-脚本报错--padstart-不兼容)
8. [问题七：Webhook 脚本报错 —— 参数名大小写](#8-问题七webhook-脚本报错--参数名大小写)
9. [最终验证：完整链路跑通](#9-最终验证完整链路跑通)
10. [附录：完整修复清单](#10-附录完整修复清单)

---

## 1. 测试目标

在 Zabbix 中模拟一次内存压力，触发告警并通过企业微信群机器人发送通知。

**测试方法**：用 Python 脚本吃满内存，让 Zabbix 采集到高内存使用率，触发 "High memory utilization" 触发器，通过已配置的企业微信 Webhook 发送报警。

```bash
# 压力测试脚本（/tmp/stress3.py）
python3 << 'EOF'
import time

with open('/proc/meminfo') as f:
    for line in f:
        if line.startswith('MemAvailable:'):
            avail_kb = int(line.split()[1])

target_mb = (avail_kb // 1024) - 60
chunks = []
for i in range(target_mb):
    chunk = bytearray(1024 * 1024)  # 每次 1MB
    chunk[0] = 0x42
    chunk[-1] = 0x42
    chunks.append(chunk)

time.sleep(360)  # 保持 6 分钟
del chunks
EOF
```

---

## 2. 问题一：压力测试跑完但没有告警

### 现象

跑了压力测试，内存确实飙高了，但 Zabbix Web 界面没有任何报警事件，企业微信群也没有消息。

### 分析过程

首先查看当前系统资源状态，确认压力测试是否生效：

```bash
# 查看 CPU 和内存
top -bn1 | head -5
free -h
```

输出：

```
%Cpu(s):  4.2 us,  4.2 sy,  0.0 ni, 87.5 id
MiB Mem :   1963.7 total,   817.2 free,  1000.9 used
```

内存确实用了一半多，但压力测试进程已经结束了（ps 里找不到 python3 压力进程）。

然后查看 Zabbix Server 日志：

```bash
tail -50 /var/log/zabbix/zabbix_server.log | grep -i -E "trigger|alert|action|problem|event"
```

发现日志里有大量 **slow query**（慢查询）：

```
slow query: 123.878823 sec, "select eventid,maintenanceid from event_suppress..."
slow query: 123.244420 sec, "begin;"
slow query: 108.808086 sec, "begin;"
```

查询要 2 分钟才能完成！数据库被内存压力拖慢了。

### 结论

压力测试把系统内存吃满了，PostgreSQL 数据库也跟着变慢，Zabbix 的配置同步和触发器评估全部延迟。

---

## 3. 问题二：Zabbix Agent 挂了，停止采集数据

### 现象

Zabbix 最后一次采集数据停在了 10:40，之后再也没更新。当前时间已经 11:21，中间 41 分钟完全没有数据。

### 分析过程

查看 Zabbix 采集到的最新数据时间：

```bash
sudo -u postgres psql zabbix -c "
SELECT itemid, to_timestamp(clock) as time, value 
FROM history 
WHERE itemid = 50807 
ORDER BY clock DESC 
LIMIT 3;
"
```

输出：

```
 itemid |          time          |   value   
--------+------------------------+-----------
  50807 | 2026-06-10 10:40:22+08 | 46.649944
  50807 | 2026-06-10 10:39:22+08 | 46.400893
```

最新数据是 10:40，现在都 11:21 了，41 分钟没采集！

检查 Zabbix Agent 状态：

```bash
systemctl status zabbix-agent2 --no-pager
```

输出：

```
○ zabbix-agent2.service - Zabbix Agent 2
     Active: inactive (dead) since Wed 2026-06-10 10:58:49 CST; 23min ago
     Duration: 3.013s
```

Agent 在 10:58 就挂了！只跑了 3 秒就被停止了。原因是之前的压力测试把系统内存吃光，Agent 进程被 OOM Killer 杀掉了。

### 解决

重启 Zabbix Agent：

```bash
systemctl start zabbix-agent2
sleep 2
systemctl status zabbix-agent2 --no-pager | head -10
```

确认 Agent 在跑：

```bash
ps aux | grep zabbix_agent | grep -v grep
```

输出：

```
zabbix  121941  0.9  1.1 1697820 22400 ?  Ssl  11:22  0:00 /usr/sbin/zabbix_agent2
```

等约 90 秒让 Zabbix 重新采集一轮数据，确认数据恢复：

```bash
sleep 90
sudo -u postgres psql zabbix -c "
SELECT itemid, to_timestamp(clock) as time, value 
FROM history WHERE itemid = 50807 ORDER BY clock DESC LIMIT 3;
"
```

输出（数据恢复了）：

```
 itemid |          time          |   value   
--------+------------------------+-----------
  50807 | 2026-06-10 11:23:22+08 | 55.926502
  50807 | 2026-06-10 10:40:22+08 | 46.649944
```

### 结论

压力测试把 Agent 进程搞崩了。重启后数据采集恢复。

---

## 4. 问题三：触发器条件太严格，始终不触发

### 现象

Agent 重启后数据恢复采集，内存确实飙到了 95%+，但触发器始终显示 OK 状态。

### 分析过程

查看触发器状态：

```bash
sudo -u postgres psql zabbix -c "
SELECT t.triggerid, t.description, 
       CASE t.value WHEN 0 THEN 'OK' WHEN 1 THEN 'PROBLEM' END as state,
       to_timestamp(t.lastchange) as last_change
FROM triggers t WHERE t.triggerid = 25242;
"
```

输出：

```
 triggerid |          description           | state | last_change 
-----------+--------------------------------+-------+-------------
     25242 | Linux: High memory utilization | OK    | 1970-01-01
```

last_change 是 1970 年，说明这个触发器从来没有触发过！

查看触发器关联的函数：

```bash
sudo -u postgres psql zabbix -c "
SELECT f.functionid, f.name, f.parameter, i.name as item_name, i.key_
FROM functions f
JOIN items i ON f.itemid = i.itemid
WHERE f.triggerid = 25242;
"
```

输出：

```
 functionid | name | parameter |     item_name      |      key_      
------------+------+-----------+--------------------+----------------
      36116 | min  | $,5m      | Memory utilization | vm.memory.util
```

**关键发现**：函数是 `min(5m)` —— 取最近 5 分钟内的 **最小值** 来判断。

再看 Zabbix 采集的数据：

```
11:23  55.93%  ← 压力测试前
11:24  96.13%  ← 压力测试中 📈
11:25  95.46%  ← 压力测试中
11:26  95.64%  ← 压力测试中
11:27  57.52%  ← 压力测试结束 📉
11:28  57.37%
```

压力测试只跑了 3 分钟就结束了。在 5 分钟窗口内始终有一个 55% 的低值，`min` 取到的就是这个低值，永远低于 90% 阈值，所以触发器永远不触发！

### 结论

触发器用 `min(5m)` 函数，需要 5 分钟内**所有**数据都超过阈值才触发。压力测试时间不够长。

---

## 5. 问题四：内存阈值太高，2GB 服务器吃不消

### 现象

默认阈值是 90%，2GB 内存的服务器需要吃掉 1.8GB 才能触发。压力测试很难长时间维持这么高的内存占用（容易被 OOM Killer 杀掉）。

### 分析过程

查看模板的默认宏配置：

```bash
sudo -u postgres psql zabbix -c "
SELECT h.host as template, hm.macro, hm.value
FROM hostmacro hm
JOIN hosts h ON hm.hostid = h.hostid
WHERE hm.macro LIKE '%MEMORY%' OR hm.macro LIKE '%LOAD%'
ORDER BY hm.macro;
"
```

输出：

```
           template           |         macro          | value 
------------------------------+------------------------+-------
 Linux by Zabbix agent active | {$MEMORY.AVAILABLE.MIN} | 20M
 Linux by Zabbix agent active | {$MEMORY.UTIL.MAX}      | 90
 Linux by Zabbix agent active | {$LOAD_AVG_PER_CPU.MAX.WARN} | 1.5
```

`{$MEMORY.UTIL.MAX}` = 90，意味着内存使用率超过 90% 才报警。

### 解决

在主机级别覆盖宏变量，把阈值临时降到 50% 进行测试：

```bash
# 在主机上添加宏覆盖（优先级高于模板宏）
sudo -u postgres psql zabbix -c "
INSERT INTO hostmacro (hostmacroid, hostid, macro, value, type)
VALUES (99999, 10683, '{\$MEMORY.UTIL.MAX}', '50', 0);
"
```

确认配置：

```bash
sudo -u postgres psql zabbix -c "
SELECT macro, value FROM hostmacro WHERE hostid = 10683;
"
```

输出：

```
       macro        | value 
--------------------+-------
 {$MEMORY.UTIL.MAX} | 50
```

测试完成后恢复为 90%：

```bash
sudo -u postgres psql zabbix -c "
UPDATE hostmacro SET value = '90' WHERE hostid = 10683 AND macro = '{\$MEMORY.UTIL.MAX}';
"
```

### 结论

小内存服务器默认 90% 阈值太高，可以通过主机级宏覆盖来调整。测试完成后记得恢复。

---

## 6. 问题五：触发器终于触发了，但企业微信收不到消息

### 现象

降低阈值后，触发器成功触发了（PROBLEM 状态），但企业微信群没有收到任何消息。

查看 Zabbix 事件记录：

```bash
sudo -u postgres psql zabbix -c "
SELECT e.eventid, to_timestamp(e.clock) as time, e.name,
       CASE e.value WHEN 0 THEN 'OK' WHEN 1 THEN 'PROBLEM' END as state
FROM events e WHERE e.source = 0 AND e.object = 0
ORDER BY e.clock DESC LIMIT 5;
"
```

输出：

```
 eventid |         time          |                  name                  |  state  
---------+-----------------------+----------------------------------------+---------
      58 | 2026-06-10 11:36:22   | Linux: High memory utilization (>50%)  | PROBLEM
```

触发器触发了！但查看告警发送记录：

```bash
sudo -u postgres psql zabbix -c "
SELECT to_timestamp(a.clock) as time, a.subject, a.status, a.error
FROM alerts a ORDER BY a.clock DESC LIMIT 5;
"
```

输出：

```
 time       | subject                                              | status | error                    
------------+------------------------------------------------------+--------+--------------------------
 11:36:27   | Problem: Linux: High memory utilization (>50% for 5m)| 2      | No media defined for user.
```

**错误信息：`No media defined for user`** —— 用户没有配置接收媒体！

### 分析过程

检查媒体类型是否存在：

```bash
sudo -u postgres psql zabbix -c "
SELECT mediatypeid, name, type, status,
       CASE status WHEN 0 THEN '启用' WHEN 1 THEN '禁用' END as status_text
FROM media_type WHERE name LIKE '%企业%';
"
```

输出：

```
 mediatypeid |       name        | type | status | status_text 
-------------+-------------------+------+--------+-------------
          72 | 企业机器人监控报警 |    4 |      0 | 启用
```

媒体类型存在且已启用。检查用户是否绑定了这个媒体：

```bash
sudo -u postgres psql zabbix -c "
SELECT m.mediaid, u.username, mt.name as media_type, m.sendto
FROM media m
JOIN users u ON m.userid = u.userid
JOIN media_type mt ON m.mediatypeid = mt.mediatypeid;
"
```

输出为空！media 表一条记录都没有。

### 解决

为 Admin 用户（userid=1）添加媒体类型绑定：

```bash
sudo -u postgres psql zabbix -c "
INSERT INTO media (mediaid, userid, mediatypeid, sendto, active, severity, period)
VALUES (1, 1, 72, 'webhook', 0, 63, '1-7,00:00-24:00');
"
```

参数说明：
- `userid=1`：Admin 用户
- `mediatypeid=72`：企业机器人监控报警
- `sendto='webhook'`：Webhook 类型不需要具体地址（URL 已在媒体类型中配置）
- `active=0`：启用
- `severity=63`：所有严重级别（二进制 111111）
- `period='1-7,00:00-24:00'`：全天候

确认配置：

```bash
sudo -u postgres psql zabbix -c "
SELECT m.mediaid, u.username, mt.name as media_type, m.sendto, 
       CASE m.active WHEN 0 THEN '启用' WHEN 1 THEN '禁用' END as status
FROM media m
JOIN users u ON m.userid = u.userid
JOIN media_type mt ON m.mediatypeid = mt.mediatypeid;
"
```

输出：

```
 mediaid | username |     media_type     | sendto  | status 
---------+----------+--------------------+---------+--------
       1 | Admin    | 企业机器人监控报警 | webhook | 启用
```

### 结论

Zabbix 中配置了媒体类型和动作，但**用户没有绑定媒体**，导致告警无法发送。这是最常见的配置遗漏。

---

## 7. 问题六：Webhook 脚本报错 —— padStart 不兼容

### 现象

用户绑定媒体后，告警发送仍然失败，错误信息：

```
TypeError: undefined not callable (property 'padStart' of '6')
    at [anon] (duktape.c:69012) internal
```

### 分析过程

查看 Webhook 脚本：

```bash
sudo -u postgres psql zabbix -t -c "
SELECT script FROM media_type WHERE mediatypeid = 72;
"
```

发现脚本中使用了 `String.prototype.padStart()`：

```javascript
var timeStr = now.getFullYear() + '-' + 
    String(now.getMonth() + 1).padStart(2, '0') + '-' + 
    String(now.getDate()).padStart(2, '0') + ' ' + 
    String(now.getHours()).padStart(2, '0') + ':' + 
    String(now.getMinutes()).padStart(2, '0') + ':' + 
    String(now.getSeconds()).padStart(2, '0');
```

**问题**：Zabbix 7.0 的 Webhook 使用 **Duktape** JavaScript 引擎，该引擎**不支持** ES2017 的 `padStart()` 方法。

### 解决

用自定义 `pad()` 函数替代 `padStart()`：

```javascript
// 替代方案
function pad(n) { return n < 10 ? '0' + n : '' + n; }

var timeStr = now.getFullYear() + '-' +
    pad(now.getMonth() + 1) + '-' +
    pad(now.getDate()) + ' ' +
    pad(now.getHours() + 8) + ':' +
    pad(now.getMinutes()) + ':' +
    pad(now.getSeconds());
```

完整的修复后脚本（纯英文，避免编码问题）：

```javascript
var params = JSON.parse(value);
var req = new HttpRequest();
req.addHeader('Content-Type: application/json');

function pad(n) { return n < 10 ? '0' + n : '' + n; }

var now = new Date();
var timeStr = now.getFullYear() + '-' +
    pad(now.getMonth() + 1) + '-' +
    pad(now.getDate()) + ' ' +
    pad(now.getHours() + 8) + ':' +
    pad(now.getMinutes()) + ':' +
    pad(now.getSeconds());

var subject = params.Subject || 'No subject';
var message = params.Message || 'No message';

var severity = 'Unknown';
if (subject.indexOf('Disaster') !== -1) {
    severity = 'Disaster';
} else if (subject.indexOf('High') !== -1) {
    severity = 'High';
} else if (subject.indexOf('Average') !== -1) {
    severity = 'Average';
} else if (subject.indexOf('Warning') !== -1) {
    severity = 'Warning';
} else if (subject.indexOf('Information') !== -1) {
    severity = 'Information';
} else {
    severity = 'Notice';
}

var content = '## Zabbix Alert\n';
content += '---\n';
content += 'Host: ' + subject + '\n';
content += 'Severity: ' + severity + '\n';
content += 'Message: ' + message + '\n';
content += 'Time: ' + timeStr + '\n';
content += '---\n';
content += 'Zabbix Monitor Auto-Alert';

var body = {
    "msgtype": "markdown",
    "markdown": {
        "content": content
    }
};

var resp = req.post(params.webhook, JSON.stringify(body));

if (req.getStatus() != 200) {
    throw 'Send failed: ' + resp;
}

return 'OK';
```

更新到数据库：

```bash
python3 << 'PYEOF'
import subprocess

with open('/tmp/webhook_final.js', 'r', encoding='utf-8') as f:
    script = f.read()

script_escaped = script.replace("\\", "\\\\").replace("'", "''")
sql = f"UPDATE media_type SET script = E'{script_escaped}' WHERE mediatypeid = 72;"

with open('/tmp/update.sql', 'w', encoding='utf-8') as f:
    f.write(sql)

result = subprocess.run(
    ['sudo', '-u', 'postgres', 'psql', 'zabbix', '-f', '/tmp/update.sql'],
    capture_output=True, text=True
)
print(result.stdout.strip())
PYEOF
```

### 结论

Zabbix 的 Duktape JS 引擎只支持 ES5 语法，不支持 ES2017+ 的 `padStart()`。写 Webhook 脚本时要注意兼容性。

---

## 8. 问题七：Webhook 脚本报错 —— 参数名大小写

### 现象

修复 `padStart` 后，又报新错：

```
TypeError: cannot read property 'indexOf' of undefined
    at [anon] (duktape.c:60534) internal
```

### 分析过程

查看 Webhook 参数配置：

```bash
sudo -u postgres psql zabbix -c "
SELECT mp.name, mp.value 
FROM media_type_param mp WHERE mp.mediatypeid = 72 ORDER BY mp.sortorder;
"
```

输出：

```
   name    |              value               
-----------+----------------------------------
 HTTPProxy | 
 To        | {ALERT.SENDTO}
 Subject   | {ALERT.SUBJECT}
 Message   | {ALERT.MESSAGE}
 webhook   | https://qyapi.weixin.qq.com/...
```

参数名是大写的 `Subject`、`Message`。

但脚本里写的是小写：

```javascript
// ❌ 错误：小写
if (params.subject.indexOf('Disaster') !== -1)

// ✅ 正确：大写
if (params.Subject.indexOf('Disaster') !== -1)
```

### 解决

脚本中所有参数名改为大写，并加 `||` 兜底：

```javascript
var subject = params.Subject || 'No subject';
var message = params.Message || 'No message';
```

### 结论

Zabbix Webhook 的参数名**区分大小写**，必须与 `media_type_param` 表中的 `name` 字段完全一致。

---

## 9. 最终验证：完整链路跑通

所有问题修复后，重新跑压力测试验证：

```bash
# 启动压力测试
python3 /tmp/stress3.py &

# 等待 7 分钟（内存分配 + 5 分钟采集窗口 + 评估时间）
sleep 420

# 检查结果
sudo -u postgres psql zabbix -c "
SELECT to_timestamp(a.clock) as time, a.subject,
       CASE a.status WHEN 0 THEN '待发送' WHEN 1 THEN '已发送' WHEN 2 THEN '失败' END as status,
       a.error
FROM alerts a ORDER BY a.clock DESC LIMIT 3;
"
```

**最终输出**：

```
         time          |                      subject                       | status | error 
-----------------------+----------------------------------------------------+--------+-------
 2026-06-10 12:17:27   | Resolved: Linux: High memory utilization (>90% for | 已发送 | 
 2026-06-10 12:17:27   | Resolved: Linux: High memory utilization (>90% for | 已发送 | 
 2026-06-10 12:16:27   | Problem: Linux: High memory utilization (>90% for  | 已发送 | 
```

**全部发送成功！** 企业微信群收到了 Problem 报警和 Resolved 恢复通知。

---

## 10. 附录：完整修复清单

| # | 问题 | 诊断命令 | 根因 | 修复方法 |
|---|------|----------|------|----------|
| 1 | Agent 停止采集 | `systemctl status zabbix-agent2` | 内存压力杀死 Agent | `systemctl start zabbix-agent2` |
| 2 | 触发器不触发 | `SELECT * FROM functions WHERE triggerid=25242` | min(5m) 条件太严格 | 压力测试保持 6 分钟以上 |
| 3 | 阈值太高 | `SELECT * FROM hostmacro WHERE hostid=10683` | 默认 90%，小内存服务器难以达到 | 主机宏覆盖 `{$MEMORY.UTIL.MAX}` = 50（测试用） |
| 4 | 用户无媒体绑定 | `SELECT * FROM media` (为空) | media 表无记录 | `INSERT INTO media ...` 为 Admin 绑定媒体 |
| 5 | padStart 不兼容 | `SELECT script FROM media_type WHERE mediatypeid=72` | Duktape 不支持 ES2017 | 改用自定义 `pad()` 函数 |
| 6 | 参数名大小写 | `SELECT * FROM media_type_param WHERE mediatypeid=72` | `params.subject` ≠ `params.Subject` | 改为大写 + 兜底 `|| 'No subject'` |
| 7 | 缺恢复消息模板 | `SELECT * FROM media_type_message WHERE mediatypeid=72` | 只有 Problem 模板 | `INSERT INTO media_type_message ... recovery=1` |

### 常用诊断命令速查

```bash
# 查看 Agent 状态
systemctl status zabbix-agent2

# 查看最新采集数据
sudo -u postgres psql zabbix -c "
SELECT to_timestamp(clock) as time, round(value::numeric, 1) as value
FROM history WHERE itemid = 50807 ORDER BY clock DESC LIMIT 5;
"

# 查看触发器状态
sudo -u postgres psql zabbix -c "
SELECT triggerid, description, 
       CASE value WHEN 0 THEN 'OK' WHEN 1 THEN 'PROBLEM' END as state,
       to_timestamp(lastchange) as last_change
FROM triggers WHERE triggerid = 25242;
"

# 查看告警发送记录
sudo -u postgres psql zabbix -c "
SELECT to_timestamp(clock) as time, subject, 
       CASE status WHEN 0 THEN '待发送' WHEN 1 THEN '已发送' WHEN 2 THEN '失败' END as status,
       error
FROM alerts ORDER BY clock DESC LIMIT 5;
"

# 查看用户媒体绑定
sudo -u postgres psql zabbix -c "
SELECT m.mediaid, u.username, mt.name, m.sendto
FROM media m
JOIN users u ON m.userid = u.userid
JOIN media_type mt ON m.mediatypeid = mt.mediatypeid;
"

# 直接测试企业微信 Webhook
curl -s -X POST "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"msgtype":"text","text":{"content":"测试消息"}}'
```

---

> **文档生成时间**: 2026-06-10  
> **排查耗时**: 约 2 小时  
> **涉及 7 个问题**，从 Agent 崩溃到 Webhook 脚本兼容性，覆盖了 Zabbix 报警链路的每个环节。
