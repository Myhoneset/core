# phicomm_dc1_miniapp

这是一个用于控制 phicomm_dc1 的微信小程序示例项目，适配 Home Assistant 接口。

## 已实现能力

- 配置 Home Assistant 地址与 Long-Lived Access Token
- 测试环境内置默认服务器：`https://seo.ynggv.com:8123`、`https://seo.amoyu.top:8123`
- 支持自定义协议、域名和端口
- 自动读取 `switch.phicomm_dc1` 与 `switch.phicomm_dc1_p1/p2/p3` 实体
- 主控与子插孔一键开关
- 展示电压、电流、功率、连接状态
- 通过 WebSocket 实时监听状态变更

## 导入方式

1. 打开微信开发者工具。
2. 选择“导入项目”。
3. 目录选择当前文件夹。
4. AppID 可先使用测试号或开发号。

## 使用说明

1. 先确保 Home Assistant 中已经接入 phicomm_dc1。
2. 在 HA 中创建 Long-Lived Access Token。
3. 打开小程序首页，可直接选择测试服，或自定义填写地址和端口。
4. 测试服默认地址为 `https://seo.ynggv.com:8123` 与 `https://seo.amoyu.top:8123`。
5. 粘贴 Token 并点击“保存并连接”。

## 目录结构

- `app.js`：小程序入口
- `app.json`：页面配置
- `utils/home-assistant.js`：HA 接口与 WebSocket 封装
- `pages/index/`：主控页面

## 后续可扩展

- 增加房间分组与定时任务
- 增加功耗历史曲线
- 增加扫码录入服务器地址
