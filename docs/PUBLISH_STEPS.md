# 作品馆发布

官方指南：https://gallery.developer.huaweicloud.com/gallery/submit-guide

本项目仓库：`https://atomgit.com/lOveZhao/FlowForge.git`。准备发布分支：`main`。

1. 在已注册的 GitCode 账号中新建公开空仓库，名称建议 `flowforge`。保存页面给出的 HTTPS 仓库地址；有默认分支时同时记录实际分支名。
2. 将现有校庆版源码推入该仓库。根目录应含 `package.json`、`README.md` 和 `src/`；本地 `.gitignore` 已排除依赖、构建结果、交付包、临时材料与原始截图。提交前检查暂存清单。
3. 在 AI 开发者空间的 CodeArts 中导入或克隆该仓库，复用现有代码，安装依赖并启动预览。运行 `npm ci`、`npm run dev -- --host 0.0.0.0`，按开发空间的提示打开预览。
4. 在 CodeArts 对话中输入比赛提供的发布指令：

```text
npx skills add https://gitcode.com/Lingxi-HandsOn/gallery.git --skill huawei-cloud-publish-work-to-gallery -y 2>&1
请将当前项目发布至开发者作品展览馆-校园作品-上海理工大学-活动专区。
使用当前已验收的 FlowForge 校庆版项目根目录和实际仓库地址、分支。作品名称：FlowForge｜校园活动空间人流仿真与布局比较。队伍：理行120。请按流程启动并核对体验入口，展示可投稿活动，等我完成账号授权及活动选择后发布，成功后返回真实作品ID和作品链接。
```

5. 作品目录选择源码根目录；按提示完成本人授权，选择实际处于可投稿状态的上海理工大学活动。发布成功后打开返回的链接，检查作者、封面、仓库、活动及体验入口，并在退出登录的浏览器中核对可访问性。

临时访问地址会受开发环境存续影响。先保存代码仓库和真实作品馆链接；发布作品与搜索引擎收录是两个独立过程。

源码推送与作品馆投稿分别核验。取得作品馆成功信息和真实作品链接后，才记为投稿完成。
