"""阶段 0：生成 旧成果登记.json。

登记历次清洗与整理成果的位置、口径、可信度和去向（复用 / 参考 / 归档 / 保留），
并实测每个路径是否存在、文件数、字节数、Git 跟踪文件数。只读，不移动任何旧文件。
条目内容来自 2026-10-12 的只读盘点，见 docs/store-drawing-archive-plan.md 第 1 节。
"""

from __future__ import annotations

from pathlib import Path

from common import THIS_REPO, base_args, git_tracked, header, write_json

P90 = "资源库/90_处理过程与审核"
CLEAN = f"{P90}/数据清洗-20261009"
HANDOFF = "tools/data-cleaning/light-handoff-20261009-01"

# 去向：复用 = 新档案直接取用其数据；参考 = 只作对照，不直接采用；归档 = 已被取代，不再使用（不删除）；
# 保留 = 必须保留的来源或凭据；已取代 = 口径过时，新档案为准。
LEGACY = [
    {
        "id": "L01",
        "title": "09-23 标签底座：飞书总表快照与 418 份文本粗分类",
        "paths": ["资源库/00_资源索引/历史目录/classification"],
        "date": "2026-09-23",
        "scope": "418 份 PDF；飞书总表 925 条（rev 249），匹配 417 份；页面分为 plan / image / construction",
        "trust": "已核实",
        "disposition": "复用",
        "use": "飞书 recordId 与 09-23 SI / 铺型作为对照（来源清单 legacy_ids）；页面候选只作参考",
        "issues": ["6 份铺型与 PDF 文字冲突当时被忽略", "与 10-09 台账不是同一个飞书 base/table"],
    },
    {
        "id": "L02",
        "title": "门店资源索引（418 口径）",
        "paths": [
            "资源库/00_资源索引/门店资源索引.json",
            "资源库/00_资源索引/资源使用说明.md",
            "资源库/01_各门店原图纸/README.md",
        ],
        "date": "2026-10-08",
        "scope": "418 条，含 source_id、哈希、页数、候选页、SI、铺型；没有城市、面积、版本",
        "trust": "已核实",
        "disposition": "已取代",
        "use": "PDF-001~418 编号沿用；门店信息以 09_门店档案 为准",
        "issues": ["不含 10-09 新增的 95 份", "PDF-418 页数为空（实际 21 页）", "深圳华强北 SI 为空（台账为 si1.0）"],
    },
    {
        "id": "L03",
        "title": "飞书台账 10-09（覆盖全部 513 份）",
        "paths": ["资源库/01_各门店原图纸/各门店图纸_SI类型与铺型.xlsx"],
        "date": "2026-10-09",
        "scope": "已下载门店 518 行（SI1.0 424、SI2.0 92、未填写 2；边厅 357、中岛 146、专区 14、专区 / 边厅 1）；未下载项目 403 行",
        "trust": "已核实",
        "disposition": "复用",
        "use": "阶段 1 的 SI / 铺型初值；2026-10-13 起进 Git",
        "issues": ["用户指出飞书 SI 可能有错（docs/si-source-recovery.md 第 3 行）"],
    },
    {
        "id": "L04",
        "title": "09-25 第一至四轮：拆页、页面分类、效果图初审",
        "paths": [
            "docs/pdf-cleaning.md",
            "docs/data-preparation-next-steps.md",
            f"{P90}/PDF拆分",
            "output/pdf/cleaned-v2",
            "output/图纸上传核对-20261008/GitHub实体可用图纸-358份.txt",
        ],
        "date": "2026-09-25",
        "scope": "声称 358 份、12,303 页、12,266 个单页 PDF、1,264 张唯一底图、1,262 张缩略图初审",
        "trust": "仅声称",
        "disposition": "参考",
        "use": "实体在旧机器 E:\\效果图生成器，本机只剩空的 PDF拆分/pages；358 份口径可用上传核对清单复现",
        "issues": ["引用的 manifest、visual-decisions、master-labels、native-catalog、next-review、si-curation-v2 本机都不存在", "视觉审核数两份文档分别写 460 和 1,262"],
    },
    {
        "id": "L05",
        "title": "09-23 训练候选、样本预览与早期训练实验",
        "paths": [
            "资源库/99_历史归档/训练候选",
            "资源库/99_历史归档/训练实验",
            f"{P90}/页面预览",
            "资源库/00_资源索引/历史目录/sample-set.csv",
            "tools/training",
        ],
        "date": "2026-09-23",
        "scope": "12 家分层候选 + S03；S01–S10 样本（TPY = 上海TPY中心，TAICHUNG = 台湾台中样本）；tiny LoRA 流程试验",
        "trust": "已核实",
        "disposition": "参考",
        "use": "样本号写入来源清单 legacy_ids；面积 areaM2 只作对照",
        "issues": ["sample-set.csv 的铺型列混入渠道类型", "S02 面积 44.4 / 60 ㎡ 冲突"],
    },
    {
        "id": "L06",
        "title": "10-09 上午试点 r8（Git 中的正式成果）",
        "paths": [
            f"{CLEAN}/README.md",
            f"{CLEAN}/06_质检报告.md",
            f"{CLEAN}/06_质检报告补充.md",
            f"{CLEAN}/01_页面分类.jsonl",
            f"{CLEAN}/00_文件清单_最终复核.json",
            f"{P90}/训练标注",
        ],
        "date": "2026-10-09",
        "scope": "20 份、601 页；试点门槛 8/19 = 42.1%；11 个边界、143 件道具、0 件确认",
        "trust": "已核实",
        "disposition": "参考",
        "use": "已被 r13 取代；store-XXXX 编号写入来源清单 legacy_ids",
        "issues": ["00_文件清单.json 中 PDF-175 重号（最终复核已纠正）", "09_新增文件清单.json 实为产物清单", "source.json 仍写旧路径 D:\\各门店图纸"],
    },
    {
        "id": "L07",
        "title": "10-09 试点 r10–r13（交接包 history）",
        "paths": [f"{HANDOFF}/history"],
        "date": "2026-10-09",
        "scope": "r12 门槛 16/20（指标改为主边界 + 主要家具视觉对齐）；19/20 双向比例；r13 210 件道具，确认 0",
        "trust": "已核实",
        "disposition": "参考",
        "use": "阶段 3a 金标准的对照和起点",
        "issues": ["与 r8 的 store-XXXX/v1 同名并存", "8/19 与 16/20 门槛不同，不可直接比较"],
    },
    {
        "id": "L08",
        "title": "10-09 下午全量续跑-02（只在本机）",
        "paths": [f"{CLEAN}/全量续跑-02", f"{CLEAN}/_cache/全量续跑-02"],
        "date": "2026-10-09",
        "scope": "513 份：页面扫描 501 份 / 16,399 页，图签 OCR 338 份，位图恢复 319 份，平面候选 89 份 / 176 页，比例候选 116 页；缺 12 份",
        "trust": "已核实（完成凭据与 checkpoint 一致）",
        "disposition": "复用",
        "use": "阶段 1–2 复用页面扫描和图签 OCR（先抽检）；平面和比例候选只作参考",
        "issues": ["被 Git 忽略", "封面 / 目录类 4,239 页偏高（图签“图纸索引”误判）"],
        "backup": [
            "D:/门店图纸备份/全量续跑-02-20261009：完整副本，与原件同一块 SSD，只防误删（核对结果见 备份核对.json）",
            "GitHub release cleaning-full-run-02-20261009：全量续跑-02 中的 JSON / JSONL / MD / CSV / TXT 打包，异地备份；图片缓存可重建，不上传",
        ],
    },
    {
        "id": "L09",
        "title": "轻量交接包与发布工具",
        "paths": [
            HANDOFF,
            "tools/data-cleaning/full-run-02",
            "tools/data-cleaning/source-release-20261009-01",
            "tools/data-cleaning/light-api-publish-01",
        ],
        "date": "2026-10-09",
        "scope": "8.6 MB 交接包：START_HERE、bootstrap / rebuild_driver v1–v3、validation.json（real_pdf_opened=false）",
        "trust": "已核实（只验证了包本身）",
        "disposition": "参考",
        "use": "NEW-006~101 编号取自 history/00_同步与文件清单.json；另一台电脑的重跑结果未回流（用户确认拿不到）",
        "issues": ["bootstrap / rebuild_driver 的 v1、v2 已被 v3 取代", "scale_candidates_v2 有语法错误"],
    },
    {
        "id": "L10",
        "title": "迁移交接-20261009-1503",
        "paths": [f"{CLEAN}/迁移交接-20261009-1503"],
        "date": "2026-10-09",
        "scope": "早期迁移交接包",
        "trust": "已核实",
        "disposition": "归档",
        "use": "已被轻量交接包取代，不再使用",
        "issues": [],
    },
    {
        "id": "L11",
        "title": "方法对比-01 与 10-09 清洗脚本",
        "paths": [f"{CLEAN}/方法对比-01", "tools/data-cleaning/method-comparison-01", "tools/data-cleaning"],
        "date": "2026-10-09",
        "scope": "geometry3–9 等 7 版几何尝试、pipeline.py、package_pilot.py",
        "trust": "已核实",
        "disposition": "参考",
        "use": "新流程用 tools/store-archive 与工作台识别，旧脚本只作对照",
        "issues": [],
    },
    {
        "id": "L12",
        "title": "data/codex-untracked-backup",
        "paths": ["data/codex-untracked-backup"],
        "date": "2026-10-09",
        "scope": "full-run-02 与 light-handoff 的未跟踪副本",
        "trust": "已核实（与现有两个目录逐文件相同）",
        "disposition": "归档",
        "use": "重复副本，不再使用",
        "issues": [],
    },
    {
        "id": "L13",
        "title": "必须保留的来源凭据",
        "paths": [f"{CLEAN}/_cache/新增图纸GitHub传输-01/source-supplement-manifest.json"],
        "date": "2026-10-09",
        "scope": "release cleaning-source-supplement-20261009（95 份 PDF + 台账）、tag cleaning-source-supplement-20261009、分支 progress/cleaning-light-20261009",
        "trust": "已核实（release 附件大小与本地一致）",
        "disposition": "保留",
        "use": "95 份补充 PDF 最初的远端来源；2026-10-13 起它们已进 Git，release 仍保留",
        "issues": [],
    },
    {
        "id": "L14",
        "title": "02 / 03 每店平面与效果目录",
        "paths": ["资源库/02_各门店平面图", "资源库/03_各门店效果图"],
        "date": "2026-10-08",
        "scope": "只有 README，0 家成品",
        "trust": "已核实",
        "disposition": "已取代",
        "use": "成品改放 资源库/09_门店档案",
        "issues": [],
    },
]


def measure(repo: Path, rel_path: str, tracked: set[str]) -> dict:
    path = repo / rel_path
    if not path.exists():
        return {"path": rel_path, "exists": False}
    if path.is_file():
        files, size = 1, path.stat().st_size
    else:
        entries = [p for p in path.rglob("*") if p.is_file()]
        files, size = len(entries), sum(p.stat().st_size for p in entries)
    prefix = rel_path.rstrip("/")
    in_git = sum(1 for t in tracked if t == prefix or t.startswith(prefix + "/"))
    return {"path": rel_path, "exists": True, "files": files, "bytes": size, "git_tracked_files": in_git}


def main() -> None:
    args = base_args(__doc__.splitlines()[0]).parse_args()
    tracked = git_tracked(THIS_REPO)  # 跟踪状态取档案所在分支，不随主仓库切分支变化
    entries = []
    for item in LEGACY:
        entries.append(item | {"paths": [measure(args.repo, p, tracked) for p in item["paths"]]})
    data = header("register_legacy.py") | {
        "dispositions": {
            "复用": "新档案直接取用其数据",
            "参考": "只作对照，不直接采用",
            "归档": "已被取代，不再使用（不删除）",
            "保留": "必须保留的来源或凭据",
            "已取代": "口径过时，以 09_门店档案 为准（旧文件不改）",
        },
        "entries": entries,
    }
    out = args.out / "旧成果登记.json"
    write_json(out, data)
    print(f"已写出 {out}")
    for entry in entries:
        states = ", ".join(
            f"{p['path'].split('/')[-1]}={'缺失' if not p['exists'] else str(p['files']) + '个'}" for p in entry["paths"]
        )
        print(f"  {entry['id']} {entry['disposition']}: {states}")


if __name__ == "__main__":
    main()
