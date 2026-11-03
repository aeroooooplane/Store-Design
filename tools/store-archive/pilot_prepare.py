"""Read-only source selection and first-six input preparation; outputs must be outside worktrees."""
from __future__ import annotations
import argparse, csv, hashlib, json, math, re, subprocess, unicodedata
from datetime import datetime, timezone
from pathlib import Path

def load(p):
    return json.loads(Path(p).read_text(encoding="utf-8-sig"))
def sha(p):
    h = hashlib.sha256()
    with Path(p).open("rb") as f:
        for b in iter(lambda: f.read(1024 * 1024), b""):
            h.update(b)
    return h.hexdigest()
def canonical(v):
    return hashlib.sha256(json.dumps(v, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
def norm(s):
    s = unicodedata.normalize("NFKC", s).lower()
    return "".join(c for c in s if not (c.isspace() or unicodedata.category(c)[0] in "PZ"))
def write(p, d):
    p = Path(p); p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(d, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

def coordinates(value):
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    if hasattr(value, 'x') and hasattr(value, 'y'):
        return [float(value.x), float(value.y)]
    return [coordinates(part) for part in value]
def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")
def guarded(root, rel):
    p = (root / rel).resolve()
    if not p.is_relative_to(root.resolve()):
        raise ValueError("Path escapes input root: " + str(rel))
    return p
def new_out(out, repo, resources):
    out = out.resolve()
    worktrees = subprocess.check_output(["git", "-C", str(repo), "worktree", "list", "--porcelain"], text=True, encoding="utf-8")
    roots = [resources.resolve()] + [Path(x[9:]).resolve() for x in worktrees.splitlines() if x.startswith("worktree ")]
    if any(out.is_relative_to(r) for r in roots) or out.exists() or not out.parent.is_dir():
        raise ValueError("Output must be new, outside every worktree/resource root, with existing parent")
    return out

def pool(args):
    archive = args.resources / "09_门店档案"
    source_doc = load(archive / "来源清单.json")
    source_by_id = {s["source_id"]: s for s in source_doc["sources"]}
    source_groups = {s["archive_source_id"]: s for s in source_doc["archives"]}
    stores = {}
    for d in archive.iterdir():
        if d.is_dir() and (d / "store.json").is_file():
            value = load(d / "store.json")
            stores[value["store_id"]] = (value, d)
    def identity(sid):
        s, folder = stores[sid]
        raw = s.get("aliases", {})
        names = [s["name"]] + (raw.get("filenames") or []) + [raw.get("feishu_1009"), raw.get("feishu_0923")]
        aliases = sorted({re.sub(r"\.pdf$", "", v, flags=re.I).strip() for v in names if isinstance(v, str) and v.strip()})
        # Drawing title names may name another store; preserve them in store.json as evidence,
        # never use generic/wrong title-block text to assert store identity.
        source_ids = s["source"].get("source_ids", [sid])
        hashes = sorted({source_by_id[x]["sha256"] for x in source_ids if x in source_by_id} | {s["source"]["sha256"]})
        simplified = [re.sub(r"授权体验店|专卖店|体验店|边厅店|中岛店|专区|旗舰店", "", n) for n in aliases]
        return {"store_id": sid, "name": s["name"], "aliases": aliases,
                "sameStoreKeys": sorted({"id-" + x for x in source_ids} | {"name-" + norm(x) for x in simplified if norm(x)}), "sourceSha256s": hashes}
    gold_path = archive / "金标准名单.json"
    gold_ids = [s["store_id"] for s in load(gold_path)]
    dev_doc = load(args.development)
    dev_ids = [s.get("id", s.get("store_id")) for s in dev_doc["samples"]]
    acceptance = {"schemaVersion": 1, "kind": "acceptance", "revision": "existing-45-identity-only", "sourceManifestSha256": sha(gold_path), "stores": [identity(s) for s in gold_ids]}
    development = {"schemaVersion": 1, "kind": "development", "revision": dev_doc.get("id", "fixed-48-20261030"), "sourceManifestSha256": sha(args.development), "stores": [identity(s) for s in dev_ids]}
    def tokens(s):
        return {"id-" + s["store_id"]} | {"name-" + norm(x) for x in [s["name"]] + s["aliases"]} | {"key-" + norm(x) for x in s["sameStoreKeys"]} | {"pdf-" + x for x in s["sourceSha256s"]}
    excluded = set().union(*(tokens(s) for s in acceptance["stores"] + development["stores"]))
    features = {}
    with args.features.open(encoding="utf-8") as f:
        for line in f:
            row = json.loads(line)
            features[row["store_id"]] = {p["page"]: p for p in row["pages"]}
    candidates = []
    for sid, (s, folder) in stores.items():
        ident = identity(sid)
        if tokens(ident) & excluded:
            continue
        page = s.get("pages", {}).get("main_plan_page")
        src = source_by_id.get(sid)
        if not page or not src or src.get("open_error") or not src.get("page_count"):
            continue
        feat = features.get(sid, {}).get(page, {})
        ptype = "raster" if feat.get("cover", 0) > .6 and feat.get("chars", 0) < 200 else "vector-text" if feat.get("chars", 0) >= 100 else "vector-outline"
        si = s.get("si", {}).get("value")
        shop = {"边厅店": "边厅", "中岛店": "中岛", "专区": "专区", "专区店": "专区"}.get(s.get("shop_type", {}).get("value"), "unknown")
        area = s.get("area_m2", {}).get("candidates", [])
        candidates.append({**ident, "si": si if si in ("SI1.0", "SI2.0") else "unknown", "shopType": shop, "pageType": ptype, "geometry": "unknown", "mallGroupKey": "unresolved-" + sid, "nearDuplicateGroupKeys": ["pdf-" + h for h in ident["sourceSha256s"]], "missing": ["商场及近重复关系待独立复核；未准入训练", "边界形态待原图查看，初筛不作已审核结论"], "source": {"path": src["path"].removeprefix("资源库/"), "sha256": src["sha256"], "page": page, "pageCount": src["page_count"]}, "rank": hashlib.sha256(("pilot24-20261103-source-v1/" + sid).encode()).hexdigest(), "areaCandidates": area})
    candidates.sort(key=lambda s: s["rank"])
    return acceptance, development, candidates, stores, tokens

def select(candidates, tokens):
    selected, seen = [], set()
    def take(rows):
        for s in rows:
            if s["store_id"] in {x["store_id"] for x in selected} or tokens(s) & seen:
                continue
            selected.append(s.copy()); seen.update(tokens(s)); return True
        return False
    # First five/six cover available SI/shop strata. Choice is based only on existing
    # source metadata, deterministic seed, and area for a bounded manual first batch.
    strata = [(si, shop) for si in ("SI1.0", "SI2.0") for shop in ("边厅", "中岛", "专区")]
    available = [key for key in strata if any((s["si"], s["shopType"]) == key for s in candidates)]
    for key in available:
        rows = [s for s in candidates if (s["si"], s["shopType"]) == key]
        bounded = [s for s in rows if any(0 < x.get("value", 0) <= 120 for x in s["areaCandidates"])]
        take(bounded or rows)
    while len(selected) < 6:
        if not take([s for s in candidates if s["pageType"] != "vector-text"]):
            if not take(candidates): raise ValueError("Insufficient first batch")
    for ptype in ("raster", "vector-outline"):
        for _ in range(max(0, 2 - sum(s["pageType"] == ptype for s in selected))):
            take([s for s in candidates if s["pageType"] == ptype])
    while len(selected) < 24:
        progressed = False
        for key in available:
            if len(selected) >= 24: break
            progressed |= take([s for s in candidates if (s["si"], s["shopType"]) == key])
        if not progressed: raise ValueError("Insufficient independent candidates")
    for i, s in enumerate(selected):
        s["batch"] = 1 if i < 6 else 2
        s["selectionReason"] = "按原资料SI/铺型分层及固定source-v1哈希排序；首批优先有不超过120平方米面积依据的来源，未运行或查看识别成败；补充图纸类型覆盖"
        s.pop("rank"); s.pop("areaCandidates")
    return selected, available

def bundle(a):
    import pymupdf
    m = load(a.manifest)
    out = new_out(a.out, a.repo, a.resources)
    if len(m['samples']) != 24 or sum(s['batch'] == 1 for s in m['samples']) != 6:
        raise ValueError('Not a frozen 24/6 manifest')
    archive = a.resources / '09_门店档案'
    folders = {}
    for folder in archive.iterdir():
        if folder.is_dir() and (folder / 'store.json').is_file():
            raw = load(folder / 'store.json'); folders[raw['store_id']] = folder
    revision = subprocess.check_output(['git','-C',str(a.repo),'rev-parse','HEAD'], text=True).strip()
    out.mkdir()
    reports = []
    for sample in (s for s in m['samples'] if s['batch'] == 1):
        sid = sample['store_id']; folder = folders[sid]
        store = load(folder / 'store.json')
        source = guarded(a.resources, sample['source']['path'])
        if sha(source) != sample['source']['sha256']: raise ValueError('Changed PDF: ' + sid)
        dest = out / sid; (dest / 'source').mkdir(parents=True); (dest / 'evidence').mkdir()
        (dest / 'store.json').write_bytes((folder / 'store.json').read_bytes())
        with pymupdf.open(source) as pdf:
            page = pdf[sample['source']['page'] - 1]
            single = pymupdf.open(); single.insert_pdf(pdf, from_page=page.number, to_page=page.number)
            single.save(dest / 'source/plan.pdf'); single.close()
            scale = 2600 / page.rect.width
            pix = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), alpha=False)
            pix.save(dest / 'source/preview.png')
            crop = page.cropbox; media = page.mediabox; rot = page.rotation_matrix
            transform = [rot.a*scale, rot.b*scale, rot.c*scale, rot.d*scale,
                         (rot.e-rot.a*crop.x0-rot.c*crop.y0)*scale,
                         (rot.f-rot.b*crop.x0-rot.d*crop.y0)*scale]
            # All original text/line evidence remains raw PDF coordinates, not inferred labels.
            write(dest / 'evidence/page-text.json', {'store_id':sid,'sourcePage':sample['source']['page'],'words':page.get_text('words'),'text':page.get_text('text')})
            drawings = []
            for drawing in page.get_drawings():
                items = []
                for item in drawing['items']:
                    items.append([item[0]] + [coordinates(value) for value in item[1:]])
                drawings.append({'items':items,'rect':list(drawing['rect']),'color':drawing.get('color'),'fill':drawing.get('fill'),'width':drawing.get('width'),'closePath':drawing.get('closePath')})
            write(dest / 'evidence/page-vectors.json', {'store_id':sid,'coordinates':'PyMuPDF unrotated page top-left points','drawings':drawings})
            bom_source = folder / 'bom.json'
            if bom_source.is_file():
                (dest / 'evidence/source-bom.json').write_bytes(bom_source.read_bytes())
                bom = {'status':'present','path':'evidence/source-bom.json'}
            else:
                bom_pages = store.get('pages',{}).get('bom_pages',[])
                for n in bom_pages:
                    bp = pdf[n-1]; bp.get_pixmap(matrix=pymupdf.Matrix(1,1),alpha=False).save(dest / f'evidence/bom-page-{n}.png')
                bom = {'status':'unreadable' if bom_pages else 'missing','reason':'原档案无已结构化BOM；保留原PDF物料页证据，C阶段逐件对图计数，不能当作零件数为0'}
            render = {'pageSizePt':[media.width,media.height],'cropBoxPt':[crop.x0,crop.y0,crop.width,crop.height], 'rotationCW':page.rotation,'widthPx':pix.width,'heightPx':pix.height,'pageToPreview':transform,'renderer':'PyMuPDF','rendererVersion':pymupdf.VersionBind}
        observations = [
            {'id':'source-page','kind':'source','path':'source/plan.pdf','note':f'原PDF第{sample["source"]["page"]}页，不重绘不改内容'},
            {'id':'source-text','kind':'text','path':'evidence/page-text.json','note':'原文字层，不是OCR或人工核准'},
            {'id':'source-vectors','kind':'geometry','path':'evidence/page-vectors.json','note':'原矢量证据，不是已确认空间边界'},
            {'id':'identity','kind':'identity','path':'store.json','note':'原档案完整副本，保留未确认字段'}]
        if bom['status'] == 'present': observations.append({'id':'source-bom','kind':'bom','path':'evidence/source-bom.json','note':'原BOM完整副本，后续按原单位复核'})
        write(dest / 'evidence/index.json',{'store_id':sid,'observations':observations})
        files = [{'path':p.relative_to(dest).as_posix(),'sha256':sha(p)} for p in sorted(dest.rglob('*')) if p.is_file()]
        handoff = {'schemaVersion':1,'contract':'store-pilot/1','store_id':sid,'manifestSha256':canonical(m),
                   'producer':{'name':'Codex/source-preparation','tool':'tools/store-archive/pilot_prepare.py --bundle','codeRevision':revision,'createdAt':now()},
                   'sourceSha256':sample['source']['sha256'],'sourcePage':sample['source']['page'],'render':render,
                   'dimensions':[],'bom':bom,'files':files,'status':'blocked','missing':['原页已提取，量尺端点与独立尺寸尚待逐店视觉核对，不准入C成品']}
        write(dest / 'handoff.json',handoff)
        reports.append({'store_id':sid,'status':'source-extracted-dimensions-pending','preview':str(dest/'source/preview.png'),'bom':bom})
    write(out / 'extraction-report.json',{'count':6,'sourcePagesExtracted':6,'completeSamples':0,'rows':reports})
    print(json.dumps({'sourcePagesExtracted':6,'completeSamples':0,'bundle':str(out)},ensure_ascii=False))

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--repo", type=Path, required=True); p.add_argument("--resources", type=Path, required=True)
    p.add_argument("--development", type=Path, required=True); p.add_argument("--features", type=Path, required=True)
    p.add_argument("--out", type=Path); p.add_argument("--profile", action="store_true")
    p.add_argument("--bundle", action="store_true"); p.add_argument("--manifest", type=Path)
    a = p.parse_args(); a.repo = a.repo.resolve(); a.resources = a.resources.resolve()
    if a.bundle:
        if not a.manifest or not a.out: raise ValueError('--bundle requires --manifest/--out')
        bundle(a); return
    acceptance, development, candidates, stores, tokens = pool(a)
    samples, available = select(candidates, tokens)
    if a.profile:
        print(json.dumps({"pool": len(candidates), "strata": available, "first6": [{k:s[k] for k in ("store_id", "name", "si", "shopType", "pageType", "source")} for s in samples[:6]], "all24": [s["store_id"] for s in samples]}, ensure_ascii=False, indent=2)); return
    if not a.out: raise ValueError("--out required")
    out = new_out(a.out, a.repo, a.resources)
    lock = load(a.repo / "resources.lock.json")
    for s in samples:
        src = guarded(a.resources, s["source"]["path"])
        if sha(src) != s["source"]["sha256"]: raise ValueError("Source changed: " + s["store_id"])
    import pymupdf
    for s in samples:
        with pymupdf.open(guarded(a.resources, s["source"]["path"])) as pdf:
            if pdf.page_count != s["source"]["pageCount"] or not 1 <= s["source"]["page"] <= pdf.page_count:
                raise ValueError("Invalid source page: " + s["store_id"])
    version = subprocess.check_output(["git", "-C", str(a.repo), "rev-parse", "HEAD"], text=True).strip()
    gaps = ["形态初筛暂记unknown，选中后逐页对图；不按识别结果更换样本", "商场与近重复组为待复核键，本批不宣称可训练"]
    if not any(shop == '专区' for _,shop in available): gaps.append("11家专区中：5家在45验收、3家在48开发，另3家未选主平面；当前独立且有主平面来源没有专区层，不挪用既有集合，缺层如实保留")
    manifest = {"schemaVersion":1, "contract":"store-pilot/1", "pilotId":"pilot24-20261103", "status":"frozen", "frozenAt":now(), "selectedBy":"Codex/source-preparation", "selectionBasis":"source-stratified-before-recognition", "coverageGaps":gaps, "resourceLockSha256":canonical(lock), "modelsVersion":lock["releaseVersions"]["models"], "exclusions":{"acceptanceSha256":canonical(acceptance),"developmentSha256":canonical(development)}, "samples":samples}
    out.mkdir()
    write(out / "pilot-manifest.json", manifest); write(out / "acceptance-index.json", acceptance); write(out / "development-index.json", development)
    write(out / "selection-evidence.json", {"producerRevision":version, "featuresSha256":sha(a.features), "developmentSourceSha256":sha(a.development), "sourceManifestSha256":sha(a.resources / "09_门店档案/来源清单.json"), "poolCount":len(candidates), "noRecognitionUsed":True, "noAcceptancePlansRead":True, "bodyFootprintSha256":sha(a.resources / "04_模型库/body-footprint.json")})
    print(json.dumps({"frozen":24,"firstBatch":6,"out":str(out),"manifestSha256":canonical(manifest)},ensure_ascii=False))

if __name__ == "__main__": main()
