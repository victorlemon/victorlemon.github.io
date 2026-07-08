import { defineConfig } from 'vitepress'

export default defineConfig({
  base: '/',
  title: 'My Documentation',
  description: 'A documentation site built with VitePress',
  
  themeConfig: {
    nav: [
      { text: '首页', link: '/' },
      { text: '指南', link: '/guide/getting-started' }
    ],

    sidebar: [
      {
        text: '基础',
        items: [
          { text: 'Getting Started', link: '/guide/getting-started' },
          { text: 'Configuration', link: '/guide/configuration' }
        ]
      },
      {
        text: '其他',
        collapsed: true,
        items: [
          { text: '95bits6aggregate_max2 mbit', link: '/guide/95bits6aggregate_max2 mbit.md' },
          { text: '超详细拆解：M、Mbps、MBs 三者关系，一字一句讲透', link: '/guide/超详细拆解：M、Mbps、MBs 三者关系，一字一句讲透.md' }
        ]
      },
      {
        text: 'Cacti',
        collapsed: true,
        items: [
          { text: 'cacti-deployment-guide', link: '/guide/cacti-deployment-guide.md' }
        ]
      },
      {
        text: 'Grafana & Prometheus',
        collapsed: true,
        items: [
          { text: 'MySQL监控与交换机监控-Grafana配置完整指南', link: '/guide/MySQL监控与交换机监控-Grafana配置完整指南.md' },
          { text: 'prometheus-grafana-install', link: '/guide/prometheus-grafana-install.md' },
          { text: 'Prometheus-Grafana企业级监控实战指南', link: '/guide/Prometheus-Grafana企业级监控实战指南.md' },
          { text: '华为CE8850交换机SNMP监控-Grafana完整配置笔记', link: '/guide/华为CE8850交换机SNMP监控-Grafana完整配置笔记.md' }
        ]
      },
      {
        text: 'Zabbix',
        collapsed: true,
        items: [
          { text: 'zabbix-deployment-guide', link: '/guide/zabbix-deployment-guide.md' },
          { text: 'zabbix-troubleshooting-report', link: '/guide/zabbix-troubleshooting-report.md' }
        ]
      },
      {
        text: '流浪动物救助系统',
        collapsed: true,
        items: [
          { text: '流浪动物救助系统完整部署命令记录', link: '/guide/流浪动物救助系统完整部署命令记录.md' },
          { text: '流浪动物救助系统部署指南', link: '/guide/流浪动物救助系统部署指南.md' },
          { text: '流浪动物救助系统部署详细操作指南', link: '/guide/流浪动物救助系统部署详细操作指南.md' }
        ]
      }
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/victorlemon/victorlemon.github.io' }
    ],

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2024-present'
    }
  }
})
