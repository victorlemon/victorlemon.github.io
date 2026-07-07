# Configuration

Learn how to configure your VitePress documentation site.

## Basic Configuration

The main configuration file is located at `.vitepress/config.ts`. Here you can customize:

- **Title and Description**: Set your site's metadata
- **Navigation**: Configure the top navigation bar
- **Sidebar**: Organize your documentation structure
- **Theme**: Customize the appearance and behavior

## Navigation

Add links to the top navigation:

```ts
nav: [
  { text: 'Home', link: '/' },
  { text: 'Guide', link: '/guide/getting-started' }
]
```

## Sidebar

Configure the sidebar navigation:

```ts
sidebar: [
  {
    text: 'Guide',
    items: [
      { text: 'Getting Started', link: '/guide/getting-started' },
      { text: 'Configuration', link: '/guide/configuration' }
    ]
  }
]
```

## Social Links

Add social media links to the footer:

```ts
socialLinks: [
  { icon: 'github', link: 'https://github.com/yourusername/yourrepo' }
]
```

For more configuration options, check the [VitePress documentation](https://vitepress.dev/).
