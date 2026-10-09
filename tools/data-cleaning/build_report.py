"""Write honest, immutable pilot coverage reports and audited render observations."""
import concurrent.futures,hashlib,platform,subprocess
from package_pilot import *
from revision2 import classify2
VERSION='1.0.0'
def reportmeta():
    a=meta();a['generator']={'script':'build_report.py','version':VERSION};return a
def save(path,obj):
    if Path(path).exists():raise FileExistsError(path)
    write(path,{**obj,**reportmeta()})
    # write() adds package metadata; provenance below identifies this orchestration script.
def artifact(obj):return {**obj,'orchestration_generator':{'script':'build_report.py','version':VERSION}}
VIEWS={1:{3:'入口正面，带立面尺寸标注',4:'入口正面',5:'侧入口向内',6:'入口向店内',7:'室内俯视'},2:{2:'入口正面，带尺寸标注',3:'入口正面',4:'店内面向后墙',5:'室内斜向'},5:{2:'外立面斜向',3:'入口正面',4:'室内桌区局部',5:'室内斜向'},29:{3:'改造前现场门面照片',5:'入口正面',6:'入口向店内',7:'店内反向',8:'室内俯视',9:'商场走道看门店的合成候选'},43:{2:'中岛第一面',3:'中岛第二面',4:'中央柱另一侧',5:'自行车展示侧'},51:{2:'中岛正面',3:'中岛斜侧面',4:'中岛背面'},88:{4:'入口正面',5:'入口斜向',6:'店内反向',7:'室内俯视'},90:{2:'专区斜向',3:'专区正面'},239:{2:'中岛正面',3:'中岛斜向',4:'中央柱另一侧'},293:{3:'中岛正面，带立面尺寸标注',4:'中岛正面',5:'中岛斜向',6:'中岛另一侧',7:'临水栏杆外侧',8:'中岛俯视'},296:{3:'门架正面，带立面尺寸标注',4:'门架一面',5:'门架另一面',6:'广告背墙侧',7:'广告背墙另一侧',8:'整体俯视'},353:{18:'室内展示区正面',19:'室内展示区斜向',20:'室外门面',21:'橱窗局部'}}
ELEV={(1,3),(2,2),(293,3),(296,3)}
def normalized_name(s):return re.sub(r'(授权体验店|照材专卖店|授权店|专卖店|体验店)$','',s).strip()
def main():
    sentinel=CACHE/'report-receipt.json'
    if sentinel.exists():
        for name,sha in read(sentinel)['files'].items():
            if digest(OUT/name)!=sha:raise RuntimeError('Report resume mismatch')
        print('report already exists, hashes match');return
    inv=inventory();corrected=read(OUT/'00_文件类型复核.json')
    # PPTX ZIP contents are the reliable slide count; generic fitz-open gave unrelated counts.
    for row in corrected['files']:
        if row['format']=='pptx':row['pymupdf_generic_page_count_rejected']=row['page_count'];row['page_count']=row['slide_count'];row['page_count_method']='ppt/slides/slide*.xml'
    write(OUT/'00_文件清单_最终复核.json',artifact({**corrected,'correction_of':['00_文件清单.json','00_文件类型复核.json'],'precedence':'本清单优先；原记录不覆盖，以保留纠错历史。'}))
    queue=read(CACHE/'render-review/queue.json')['items'];visual={}
    for q in queue:
        n=int(q['source_id'][4:]);key=(n,q['page']);typ='elevation' if key in ELEV else 'photo' if key==(29,3) else 'render'
        visual[(q['source_id'],q['page'])]=dict(type=typ,method='vision',confidence=.9 if key==(29,9) else .98,view_description=VIEWS[n][q['page']],rendered_evidence=q['path'],evidence_sha256=q['sha256'],contact_batch=q['contact_batch'])
    reviewrows=[];sources={};inputs={};layouts={};issues=[];mapping=[];pages=[];render_refs=[];versions=[]
    def issue(sid,priority,category,reason,evidence=None):issues.append(dict(source_id=sid,priority=priority,category=category,reason=reason,evidence=evidence))
    for row in inv['files']:
        sid=row['source_id']
        if sid not in [f'PDF-{n:03}' for n in PILOT]:continue
        n=int(sid[4:]);d=ANNOTATIONS/f'store-{n:04}'/'v1'
        source=read(d/'source.json');inp=read(d/'input.json');layout=read(d/'target-layout.json');rev=read(d/'review.json')
        sources[sid]=source;inputs[sid]=inp;layouts[sid]=layout;reviewrows.append(rev)
        supplement=dict(source_id=sid,store_id=source['store_id'],version_id='v1',method='vision',overlay_sha256=digest(d/'overlay.png'),evidence_sha256=digest(d/'evidence.png'),status='inspected_draft_partial' if n!=43 else 'inspected_extraction_failed',alignment='retained_geometry_aligned_with_visible_source' if n!=43 else 'no_geometry_extracted',completeness=False,notes=NOTES[n],training_eligible=False,training_ready_auto=False,reviewer=None,reviewedAt=None)
        if n==239:
            # Higher-resolution crop corrects an initial visual transcription, without overwriting.
            supplement['notes']='图签高分辨率复核为“深航百脑汇店”；用户背景称深圳，文件名沈阳；三项证据冲突，城市仍为null。'
            supplement['corrections']=[dict(file='source.json',json_pointer='/title_block/visual_project_name/text',old='深圳百脑汇店',value='深航百脑汇店',method='vision',evidence=str(CACHE/'PDF-239-title-crop.png')),dict(file='review.json',field='conflicts.store_city.vision_text',value='深航百脑汇店',reason='高分辨率文字复核纠正首次误读，不覆盖原草稿。')]
            source['title_block']['visual_project_name']['text']='深航百脑汇店'
            issue(sid,1,'门店身份冲突','文件名沈阳；实际图签“深航百脑汇店”；用户背景称深圳。城市未裁决。',str(CACHE/'PDF-239-title-crop.png'))
        write(d/'review-supplement.json',artifact(supplement))
        raw=read(CACHE/'classified-r2'/f'{sid}.json');idx=row['index_matches'][0]
        plan_candidates=[];date_evidence=source['title_block'].get('date_evidence',[])
        with fitz.open(row['path']) as doc:
            for p in raw['pages']:
                v=visual.get((sid,p['page']));selected=p['page']==source['physical_page'];signals=copy.deepcopy(p['signals'])
                if v:signals['visual_evidence']=v;signals['requires_vision']=False
                if selected:signals['selected_plan_vision']=True;signals['requires_vision']=False
                typ='plan_layout' if selected else v['type'] if v else p['type']
                rec=dict(**meta(),source_id=sid,page=p['page'],type=typ,confidence=.98 if selected else v['confidence'] if v else p['confidence'],title=p.get('title') or ('平面布置/家具定位图（视觉）' if selected else None),signals=signals,frames=source['frames'] if selected else None,classification_status='vision_checked' if v or selected else 'automatic_candidate',coordinate_space='original_unrotated_pdf_points' if not selected else 'normalized_pdf_points',training_eligible=False)
                pages.append(rec)
                if typ=='plan_layout':plan_candidates.append(p['page'])
                if signals.get('requires_vision'):issue(sid,4,'页面分类待视觉',f'第{p["page"]}页自动类型{typ}，置信度{rec["confidence"]}；未视读确认。',f'_cache/classified-r2/{sid}.json')
                if typ=='render':
                    page=doc[p['page']-1];regions=[]
                    for im in page.get_image_info(hashes=True,xrefs=True):
                        xr=im.get('xref');data=doc.extract_image(xr)['image'] if xr else None
                        regions.append(dict(bbox=list(im['bbox']),pixel_width=im['width'],pixel_height=im['height'],xref=xr,sha256=hashlib.sha256(data).hexdigest() if data else None,hash_basis='encoded_image_bytes_returned_by_extract_image' if data else None,missing_hash_reason=None if data else 'inline image without stable xref',coordinate_space='original_unrotated_pdf_points'))
                    render_refs.append(dict(source_id=sid,store_id=source['store_id'],version_id=None,candidate_version_id='v1',page=p['page'],regions=regions,view_description=v['view_description'] if v else None,method='vision' if v else 'text',same_layout=None,version_assignment_reason='同来源不等于同版本；未完成相机/几何对应核验。'))
        versions.append(dict(store_id=source['store_id'],identity_status='provisional_source_group',name_original=idx['name'],name_normalized=normalized_name(idx['name']),city=None,address=None,unit_number=None,source_ids=[sid],versions=[dict(version_id='v1',version_confirmed=False,date=None,date_evidence=date_evidence,revision_number=None,source_pages=[source['physical_page']],unassigned_plan_candidates=[q for q in plan_candidates if q!=source['physical_page']],ordering_reason=source['version_order_reason'],annotation_path=str(d),auto_status=rev['auto_status'],training_eligible=False)],si_index_label=idx.get('si'),shop_type=idx.get('shop_type'),same_store_cross_source_resolved=False))
        issue(sid,2,'版本未确认','v1为所选页临时编号；未完成同店多来源及多个布局候选版本归并。',str(d/'source.json'))
        issue(sid,2,'结构完整性不足',supplement['notes'],str(d/'review-supplement.json'))
        if inp['scale']['status']=='unverified':issue(sid,2,'两方向比例未核验',inp['scale']['reason'],str(d/'input.json'))
        if inp['boundary'] is None:issue(sid,2,'边界未恢复','边界为null；不使用邻店、玻璃内沿或图框冒充店界。',str(d/'input.json'))
        if rev['props']['rejected_geometry_ids']:issue(sid,2,'道具误配已置空',','.join(rev['props']['rejected_geometry_ids']),str(d/'review.json'))
        for c in rev['conflicts']:
            if n!=239:issue(sid,1,'字段冲突',json.dumps(c,ensure_ascii=False),str(d/'review.json'))
        for item in layout['items']:
            mapping.append(dict(source_id=sid,page=source['physical_page'],object_id=item['id'],label_text=item['label_text'],label_aliases=item.get('label_aliases',[]),function=item['function'],asset_candidates=item['asset_candidates'],nominal_length_m=item['evidence'].get('nominal_length_m'),si_index_label=inp['si_index_label'],si_evidence=inp['si_evidence'],needs_human=True))
    # Persist the classification actually performed; no fabricated records for unscanned pages.
    with (OUT/'01_页面分类.jsonl').open('x',encoding='utf-8') as f:
        for r in pages:f.write(json.dumps(r,ensure_ascii=False)+'\n')
    pending=[dict(source_id=r['source_id'],path=r['path'],format=r['format'],status='not_structured_pilot_gate_not_met',store_id=None,version_id=None,training_eligible=False) for r in corrected['files'] if r['source_id'] not in sources]
    write(OUT/'02_门店与版本.json',artifact(dict(scope='pilot_only',stores=versions,provisional_store_count=len(versions),provisional_version_count=len(versions),confirmed_version_count=0,total_store_count=None,total_version_count=None,pending_sources=pending,note='418份来源不能直接宣称418家独立门店；全量门店合并与版本排序未完成。',training_eligible=False)))
    write(OUT/'04_效果图引用.json',artifact(dict(scope='visually_checked_pilot_subset',items=render_refs,coverage_complete=False,same_layout_true_count=0,note='仅记录原PDF图片区域及哈希；未向03_各门店效果图导出。')))
    write(OUT/'05_道具名称映射.json',artifact(dict(scope='pilot_labels',items=mapping,soft_asset_count=38,nominal_tolerance=.15,asset_id_assigned_count=0,score_is_probability=False,notes=['候选匹配分为启发式排序，不代表核验概率。','只按名称名义尺寸匹配，未用tight_face_bounds_xyz_mm作为家具尺寸。','SI缺少图纸证据时仅用索引弱标签排序。','组合收银/开箱物体的候选可能覆盖不同功能，需人工核对，不作单一型号分配。'])))
    idx=read(ROOT/'资源库/00_资源索引/门店资源索引.json')['sources'];sis=sorted({a.get('si') or '未知' for a in idx});shops=sorted({a.get('shop_type') or '未知' for a in idx})
    write(OUT/'06_候选训练门店.json',artifact(dict(items=[],count=0,by_si={s:0 for s in sis},by_shop_type={s:0 for s in shops},criterion='auto_status=complete且两个方向尺度核验通过；当前没有满足项。',training_eligible=False,training_ready_auto_is_advisory=True)))
    for r in corrected['files']:
        if r['index_status']=='未入索引':issue(r['source_id'],1,'未入索引',f'{r["format"]}文件，仅完成哈希/容器核验，未结构化。',r['path'])
    issue('PDF-175/PDF-176',1,'内容重复','不同文件名含2F差异但SHA256完全相同，必须进入同一数据划分组；不据文件名制造新版本。','00_文件清单_最终复核.json')
    issue('ALL',1,'试点未过门槛','8/19=42.1%，低于80%；全量结构化未启动，不将未处理项算failed。','03_试点提取审核.json')
    issues.sort(key=lambda r:(r['priority'],r['source_id'],r['category']))
    with (OUT/'06_问题清单.csv').open('x',encoding='utf-8-sig',newline='') as f:
        writer=csv.DictWriter(f,fieldnames=['source_id','priority','category','reason','evidence']);writer.writeheader();writer.writerows(issues)
    types=dict(collections.Counter(p['type'] for p in pages));states=dict(collections.Counter(r['auto_status'] for r in reviewrows));states['complete']=states.get('complete',0)
    matched=sum(bool(m['asset_candidates']) for m in mapping);geom=sum(a['x'] is not None for x in layouts.values() for a in x['items']);partial=len([r for r in reviewrows if r['auto_status']=='partial'])
    counts=dict(inventory=corrected['counts'],scanned_sources=len(sources),scanned_pages=len(pages),indexed_pdf_pages_unscanned=corrected['counts']['indexed_pdf_pages']-len(pages),page_types=types,vision_checked_pages=sum(p['classification_status']=='vision_checked' for p in pages),classification_awaiting_vision=sum(p['signals'].get('requires_vision',False) for p in pages),provisional_stores=len(versions),provisional_versions=len(versions),confirmed_versions=0,auto_status=states,scale_methods={'two_axis_vision_and_vector':3,'unverified':17},known_boundaries=sum(a['boundary'] is not None for a in inputs.values()),prop_records=len(mapping),prop_geometry_records=geom,prop_candidate_records=matched,prop_candidate_rate=matched/len(mapping),confirmed_asset_match_count=0,training_candidates=0,render_pages=len(render_refs),remaining_sources=len(pending),pilot_gate_rate=len(PASS)/partial)
    write(OUT/'06_统计依据.json',artifact(dict(counts=counts,coverage_complete=False,source_reports=['00_文件清单_最终复核.json','01_页面分类.jsonl','02_门店与版本.json','03_试点提取审核.json','04_效果图引用.json','05_道具名称映射.json'],by_si=[dict(si=s,pilot_count=sum(v['si_index_label']==s for v in versions),training_usable=0) for s in sis],by_shop_type=[dict(shop_type=s,pilot_count=sum(v['shop_type']==s for v in versions),training_usable=0) for s in shops])))
    lines=['# 数据清洗质检报告（试点未通过，全量未完成）','',f'生成时间：{meta()["generatedAt"]}。所有标注均为自动提取草稿，training_eligible=false。','',f'源目录共423个文件：418份PDF、2份PPTX、3份RAR。418条索引全部有哈希对应，PDF物理页数14251；其中PDF-175/PDF-176内容重复。PPTX实际11+12=23张幻灯片；3个RAR各含一份8页电施PDF，共24页，已只读提取到缓存。','',f'本轮仅扫描20份试点、{len(pages)}页；产出20个临时门店组、20个临时v1样本，未确认版本。其余{len(pending)}个来源未结构化；其中398份PDF还有{counts["indexed_pdf_pages_unscanned"]}页未扫描。','',f'结构化结果：complete=0、partial={partial}、failed=1（PDF-043文字转曲，几何语义提取失败）。最终20张overlay均已逐张打开检查，结果见各review-supplement.json。','',f'试点门槛：8/19={counts["pilot_gate_rate"]:.1%}，低于80%。分母为complete+partial，失败样本另列；即使以全部20份为分母也仅40%。未通过将错误候选置空来抬高通过率。geometry3至geometry9共7版几何尝试；geometry8增加4个有效边界，geometry9未解决剩余边界。','',f'保留{counts["known_boundaries"]}个边界草稿、{geom}个道具位置/共{len(mapping)}条去重后的道具记录。{matched}条有模型候选，对应候选率{matched/len(mapping):.1%}；已确认asset_id为0。候选率不是准确率，缺失家具不计入这一分母。','',f'两方向标定3份：PDF-001、PDF-019、PDF-051；未标定17份仍用PDF点。尺寸数字大量转曲，难点是把读出的数字与正确尺寸线交点关联，并排除延长线和线端过冲。标注面积只做校核，没有用于反推比例。','',f'候选训练门店0。按SI：'+ '、'.join(f'{s}=0' for s in sis)+'；按铺型：'+'、'.join(f'{s}=0' for s in shops)+'。','',f'已视觉分类的栅格候选51页，含46页效果图、4页带立面尺寸标注的合成图、1页现场照片。效果图same_layout全部null，未完成版本配对；仅在04_效果图引用.json记录区域/像素/图片SHA256，未正式导出。','', '## 页面分类数量（仅601页自动候选及已核对子集）','', '|类型|页数|','|---|---:|']
    lines += [f'|{k}|{v}|' for k,v in sorted(types.items())]
    lines += ['',f'{counts["vision_checked_pages"]}页有本轮视觉核对记录；{counts["classification_awaiting_vision"]}页明确待进一步视读。未视读的other不能解释为已确认非平面。多图框切分只在所选20页检查，其他页未穷尽。','','## 主要问题与典型例子','','1. 版本/门店身份未确认：所有20份；PDF-239图签高分辨率复核为“深航百脑汇店”，文件名沈阳，用户背景称深圳。初读深圳已在review-supplement.json纠正。','2. 入口、墙柱、固定设施、椅凳数量缺失：所有20份均未达到完整训练要求。','3. 数字转曲、两方向标定缺失：17份；不能用图签1:50直接换算。','4. 边界语义与闭合失败：9份；PDF-005跨界，PDF-013玻璃内沿被误当店界，均置null。','5. 标签错配及组合家具重复：PDF-239柱体误作柜体，PDF-049产品图案误作储物柜；重复标签已合并，错误几何置null。','','## 人工优先确认前30项','']
    for i,r in enumerate(issues[:30],1):lines.append(f'{i}. {r["source_id"]}｜{r["category"]}｜{r["reason"]}')
    lines += ['','## 未完成范围','', '全量逐页分类、同店多来源归并、每个版本的全量布局、未登记PPTX/RAR中的布局清洗、完整入口/障碍/固定设施、全部不确定页面视读、多图框拆分、效果图与版本配对均未完成。无法在当前提取质量下宣称“一次完成全部清洗”。后续必须继续修复试点并重新证明达到80%后再启动全量。','', '## 不覆盖与复核','', '初始文件清单的RAR损坏判断及PPTX通用页数、同哈希身份歧义通过新建00_文件清单_最终复核.json纠正；原文件保留。每店review-supplement.json为最终视觉补充。缓存生成器字段部分沿用pipeline.py元数据，实际几何版本以_cache/pilot-rN目录、脚本和最终source.extraction_revision为准。','']
    with (OUT/'06_质检报告.md').open('x',encoding='utf-8') as f:f.write('\n'.join(lines))
    # Recheck original bytes after the work, without touching source files.
    def check(r):return dict(path=r['path'],before=r['sha256'],after=digest(r['path']))
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:checks=list(ex.map(check,inv['files']))
    write(OUT/'07_源文件完整性复核.json',artifact(dict(files=checks,checked_count=len(checks),changed_count=sum(a['before']!=a['after'] for a in checks))))
    files={p.name:digest(p) for p in OUT.iterdir() if p.is_file() and p.name!='progress.jsonl'}
    write(sentinel,artifact(dict(files=files,coverage_complete=False)))
    print(json.dumps(counts,ensure_ascii=False),flush=True)
if __name__=='__main__':sys.stdout.reconfigure(encoding='utf-8');main()
