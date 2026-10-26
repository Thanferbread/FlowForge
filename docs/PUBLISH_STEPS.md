# 作品馆发布

官方指南：https://gallery.developer.huaweicloud.com/gallery/submit-guide

本项目仓库：`https://atomgit.com/Blu3__/FlowForge.git`。源码已公开，发布分支：`main`。正式参赛队伍：上理生日派队。

1. 本仓库已经创建并上传源码，无需重新建仓库。根目录包含 `package.json`、`README.md` 和 `src/`；原始截图、私有提交材料、依赖与临时文件不随公开源码上传。
2. 在 AI 开发者空间的 CodeArts 中导入或克隆现有仓库。云端 Linux 沙箱不能直接读取电脑上的 D 盘路径，例如可运行 `git clone --branch main https://atomgit.com/Blu3__/FlowForge.git /workspace/FlowForge`，然后以 `/workspace/FlowForge` 为项目根目录。已有目录先检查，不覆盖。
3. 复用现有代码，运行 `npm ci`、`npm run build`。开发空间中临时预览可运行 `npm run dev -- --host 0.0.0.0`，按空间提示打开端口；正式静态部署使用构建后的 `dist/`，不将开发服务器作为最终公开服务。若下载源码 ZIP 在电脑上体验，先完整解压，再打开根目录的 `打开FlowForge.html`；源码 `index.html` 由 Vite 编译运行。
4. 在 CodeArts 对话中输入比赛提供的发布指令：

```text
npx skills add https://gitcode.com/Lingxi-HandsOn/gallery.git --skill huawei-cloud-publish-work-to-gallery -y 2>&1
请将当前项目发布至开发者作品展览馆-校园作品-上海理工大学-活动专区。
使用当前已验收的 FlowForge 校庆版项目根目录和实际仓库地址、分支。作品名称：FlowForge｜校园活动空间人流仿真与布局比较。队伍：上理生日派队。请按流程启动并核对体验入口，展示可投稿活动，等我完成账号授权及活动选择后发布，成功后返回真实作品ID和作品链接。
```

5. 作品目录选择源码根目录；按提示完成本人授权，选择实际处于可投稿状态的上海理工大学活动。发布成功后打开返回的链接，检查作者、封面、仓库、活动及体验入口，并在退出登录的浏览器中核对可访问性。

临时访问地址会受开发环境存续影响。先保存代码仓库和真实作品馆链接；发布作品与搜索引擎收录是两个独立过程。

源码推送与作品馆投稿分别核验。取得作品馆成功信息和真实作品链接后，才记为投稿完成。
