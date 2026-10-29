import { theme as antdTheme, type ThemeConfig } from 'antd'

/**
 * 与转发确认窗共用 macOS 字体、蓝色操作和中性灰阶。
 * 透明材质由 styles.css 管理，令牌为控件和非透明回退提供稳定的颜色。
 */
export const FONT_FAMILY =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Hiragino Sans GB", "Helvetica Neue", "Microsoft YaHei", sans-serif'

export function makeTheme(dark: boolean): ThemeConfig {
  return {
    algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: {
      fontFamily: FONT_FAMILY,
      fontSize: 13,
      colorPrimary: dark ? '#78b6ff' : '#006be6',
      colorLink: dark ? '#78b6ff' : '#0068db',
      colorText: dark ? '#f0f0f2' : '#242426',
      colorTextSecondary: dark ? '#b4b4bc' : '#65656c',
      colorBgLayout: 'transparent',
      colorBgContainer: dark ? '#2c2c2f' : '#ffffff',
      colorBgElevated: dark ? '#303034' : '#ffffff',
      colorBorder: dark ? '#4b4b50' : '#d7d7dd',
      colorBorderSecondary: dark ? '#3c3c40' : '#e6e6e9',
      borderRadius: 7,
      borderRadiusLG: 12,
      controlHeight: 32,
      controlHeightSM: 26,
    },
    components: {
      Layout: { bodyBg: 'transparent', siderBg: 'transparent', headerBg: 'transparent' },
      Menu: { itemBg: 'transparent', itemHeight: 36, itemBorderRadius: 8, itemMarginInline: 10, itemMarginBlock: 4 },
      Card: { headerFontSize: 13, headerFontSizeSM: 13, headerHeight: 44, headerHeightSM: 40 },
      Tag: {
        colorSuccess: dark ? '#91c993' : '#326c36',
        colorSuccessBg: 'rgba(61, 150, 69, 0.1)',
        colorWarning: dark ? '#efc16e' : '#996400',
        colorWarningBg: 'rgba(176, 118, 24, 0.1)',
        colorInfo: dark ? '#78b6ff' : '#0068db',
        colorInfoBg: dark ? 'rgba(90, 160, 255, 0.19)' : 'rgba(0, 104, 219, 0.1)',
      },
      Button: { primaryShadow: 'none', defaultShadow: 'none', fontWeight: 400 },
    },
  }
}
