/**
 * 站点静态配置
 * 静态且与语言无关的链接/路径放这里;需要本地化的 nav 标签由组件内 useTranslation 处理
 */
export const siteConfig = {
  name: "EndProtocol",
  description:
    "A cross-platform desktop client for Skland account management.",
  links: {
    github: "https://github.com/mon3tr-dev/endprotocol",
    docs: "https://heroui.com",
    sponsor: "https://patreon.com/jrgarciadev",
  },
} as const;

export type SiteConfig = typeof siteConfig;
