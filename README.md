# 藏匣

个人用工具：批量备份**自己抖音账号**里的收藏（含自建收藏夹）。

- 图集：无水印原图  
- 视频：无水印高清静图 + 无水印原视频（多段都下）  
- 同一作品既有图又有视频：都下进同一文件夹  
- 本机图库：封面墙、标签筛选、内置播放、上下浏览  

目录结构：

```
根/收藏夹名/标题_作品id/图1.jpg … 视频1.mp4 … meta.json
```

## 仓库说明

当前是界面 + Windows 本机层源码。演示用的封面/视频体积较大，**没有放进本仓库**。预览里的演示数据在 `src/lib/demo-data.ts`。

- `src/`：界面（收藏、图库、浏览、设置）  
- `desktop/`：Electron 本机（扫码登录、刷新收藏、下载落盘、验证码通知）  

## 使用注意

只登录**自己的号**，只拉收藏。验证码出现时回电脑过滑块。不要把登录 cookie、PushPlus / WxPusher token 提交进 git。

## 开发

界面（需本机已装依赖）：

```bash
npm install
npm run dev
```

Windows 本机层：

```bash
cd desktop
npm install
npm start
```

打包安装包（在 Windows 上）：

```bash
cd desktop
npm run pack:win
```

## 许可

个人自用。未授权请勿把本工具用于他人账号或公开提供下载服务。
