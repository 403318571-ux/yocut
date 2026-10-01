# YoCut悠剪

面向舞蹈训练的轻量浏览器音频编辑器。支持 4/4 拍网格、多音轨片段编辑、智能对拍、节奏 EQ、选区导出 MP3/WAV。

链接转音频支持整段抖音/视频号分享文字或纯链接，默认生成 MP3，按提交顺序加入第一条空音轨。三轨占满后需先用互斥 Solo 分别导出并清空音轨。解析使用 `E:\yocut\tools\yt-dlp.exe`，转码使用 `E:\yocut\tools\ffmpeg\bin\ffmpeg.exe`。若抖音要求登录，可由使用者勾选“使用本机 Chrome 登录状态”；Cookie 只由本机转换程序临时读取，不会保存到项目目录。

## 本地运行

项目位于 `E:\yocut\site`。在此目录运行 `npm run dev`，然后打开 <http://127.0.0.1:4173/>。无需安装依赖。

“提取纯伴奏/找客服”入口会弹出微信客服二维码。原登记、上传与付款流程已停用；旧订单数据未删除。

## GitHub Pages

`E:\yocut\public` 是公开托管用的静态文件目录，`E:\yocut\yocut-github-pages.zip` 是其压缩包。公开仓库为 <https://github.com/403318571-ux/yocut>。GitHub Pages 不能运行 Node、yt-dlp 或 FFmpeg，因此线上链接转换入口需要另接动态后端；音频编辑与 Solo 逻辑可直接在线使用。不要将工具目录、工作目录、旧订单或本地配置上传到公开仓库。

MP3 编码使用 lamejs 1.2.1；授权文件位于 `vendor/`。

