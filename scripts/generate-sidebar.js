import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const guideDir = path.join(__dirname, '..', 'guide')
const configFile = path.join(__dirname, '..', '.vitepress', 'config.ts')

// 定义分类映射
const categoryMap = {
  'grafana': 'Grafana & Prometheus',
  'prometheus': 'Grafana & Prometheus',
  'zabbix': 'Zabbix',
  'cacti': 'Cacti',
  '流浪动物': '流浪动物救助系统',
  '其他': '其他'
}

// 获取所有 markdown 文件
function getMarkdownFiles(dir) {
  const files = []
  const items = fs.readdirSync(dir)
  
  for (const item of items) {
    const fullPath = path.join(dir, item)
    const stat = fs.statSync(fullPath)
    
    if (stat.isDirectory()) {
      files.push(...getMarkdownFiles(fullPath))
    } else if (item.endsWith('.md')) {
      files.push(fullPath)
    }
  }
  
  return files
}

// 根据文件名确定分类
function getCategory(filename) {
  const lowerName = filename.toLowerCase()
  
  for (const [key, category] of Object.entries(categoryMap)) {
    if (lowerName.includes(key)) {
      return category
    }
  }
  
  return '其他'
}

// 生成侧边栏配置
function generateSidebar() {
  const files = getMarkdownFiles(guideDir)
  const categories = {}
  
  // 排除基础文件
  const excludeFiles = ['getting-started.md', 'configuration.md']
  
  for (const file of files) {
    const relativePath = path.relative(guideDir, file)
    const filename = path.basename(file)
    
    if (excludeFiles.includes(filename)) continue
    
    const category = getCategory(filename)
    if (!categories[category]) {
      categories[category] = []
    }
    
    // 生成显示名称（去掉扩展名）
    const displayName = filename.replace('.md', '')
    const link = `/guide/${relativePath.replace(/\\/g, '/')}`
    
    categories[category].push({
      text: displayName,
      link: link
    })
  }
  
  // 构建侧边栏结构
  const sidebarItems = [
    {
      text: '基础',
      items: [
        { text: 'Getting Started', link: '/guide/getting-started' },
        { text: 'Configuration', link: '/guide/configuration' }
      ]
    }
  ]
  
  // 添加分类
  for (const [category, items] of Object.entries(categories)) {
    sidebarItems.push({
      text: category,
      collapsed: true,
      items: items
    })
  }
  
  return sidebarItems
}

// 更新配置文件
function updateConfig() {
  const sidebarItems = generateSidebar()
  
  let configContent = fs.readFileSync(configFile, 'utf-8')
  
  // 替换侧边栏配置
  const sidebarRegex = /sidebar:\s*\[[\s\S]*?\],/
  const newSidebar = `sidebar: ${JSON.stringify(sidebarItems, null, 2).replace(/"/g, "'")},`
  
  configContent = configContent.replace(sidebarRegex, newSidebar)
  
  fs.writeFileSync(configFile, configContent, 'utf-8')
  
  console.log('✅ 侧边栏配置已更新！')
  console.log('📁 发现的文档分类：')
  const categories = {}
  sidebarItems.forEach(item => {
    if (item.text !== '基础') {
      console.log(`   - ${item.text}: ${item.items.length} 个文档`)
    }
  })
}

// 运行
updateConfig()
