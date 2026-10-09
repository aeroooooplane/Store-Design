import json, hashlib, zipfile, shutil
from pathlib import Path
from datetime import datetime
from urllib.parse import unquote
import xml.etree.ElementTree as ET
import numpy as np
from PIL import Image

# These are trusted local SketchUp exports. verify() checks image structure
# without loading their full pixel buffers, including very large originals.
Image.MAX_IMAGE_PIXELS = None

OUT = Path(__file__).resolve().parent
REPO = OUT.parents[3]
SRC = REPO / '素材库/04_assets/incoming/split-20260925-v2'
IDS = ['asset-' + n for n in '''323015 408124 408125 569180 666964 752992 1788391 2360478 2595882 3356837 6799167 15903179 15903874 16469753 16510684 24312623 24432224 24482600 24488377 24498456 28034994 28192911 33660153 33819654 34276510 34320268 34327615 36857093 36882381 36887885 36890994 36929122 36929204 37747693 37747692 37747691 41053706 41277543'''.split()]
def read(p):
    return json.loads(p.read_text(encoding='utf-8-sig'))
def write(p, data):
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
def sha(p):
    h = hashlib.sha256()
    with p.open('rb') as f:
        for b in iter(lambda: f.read(1024*1024), b''):
            h.update(b)
    return h.hexdigest()
def bounds_and_textures(dae):
    root = ET.parse(dae).getroot()
    for e in root.iter():
        e.tag = e.tag.split('}')[-1]
    byid = {e.get('id'): e for e in root.iter() if e.get('id')}
    textures = []
    for e in root.findall('./library_images/image/init_from'):
        rel = unquote(e.text).replace('\\', '/')
        p = (dae.parent / rel).resolve()
        assert p.is_relative_to(dae.parent.resolve()), ('external texture', rel)
        assert p.is_file() and p.stat().st_size, ('missing texture', rel)
        with Image.open(p) as im:
            im.verify()
        textures.append(p)
    unit = float(root.find('./asset/unit').get('meter'))
    assert root.findtext('./asset/up_axis') == 'Z_UP'
    meshes = {}
    for g in root.findall('./library_geometries/geometry'):
        mesh = g.find('mesh')
        positions = []
        for primitive in mesh:
            if primitive.tag not in ('triangles', 'polylist', 'polygons', 'trifans', 'tristrips'):
                continue
            inputs = primitive.findall('input')
            vertex = next(i for i in inputs if i.get('semantic') == 'VERTEX')
            v = byid[vertex.get('source')[1:]]
            pos = next(i for i in v.findall('input') if i.get('semantic') == 'POSITION')
            source = byid[pos.get('source')[1:]]
            accessor = source.find('./technique_common/accessor')
            arr = np.fromstring(byid[accessor.get('source')[1:]].text, sep=' ')
            stride = int(accessor.get('stride', '1'))
            offset = int(accessor.get('offset', '0'))
            count = int(accessor.get('count'))
            arr = arr[offset:offset+count*stride].reshape(count, stride)[:, :3]
            idxstride = max(int(i.get('offset', '0')) for i in inputs)+1
            idxoffset = int(vertex.get('offset', '0'))
            for p in primitive.findall('p'):
                idx = np.fromstring(p.text, sep=' ', dtype=int).reshape(-1, idxstride)[:, idxoffset]
                positions.append(arr[np.unique(idx)])
        if positions:
            meshes[g.get('id')] = np.vstack(positions)
    lo, hi = np.full(3, np.inf), np.full(3, -np.inf)
    instances = 0
    def walk(node, parent, stack=()):
        nonlocal lo, hi, instances
        assert id(node) not in stack, 'cyclic instance_node'
        stack = stack + (id(node),)
        mat = parent.copy()
        for c in node:
            t = np.eye(4)
            if c.tag == 'matrix':
                t = np.fromstring(c.text, sep=' ').reshape(4,4)
            elif c.tag == 'translate':
                t[:3,3] = np.fromstring(c.text, sep=' ')
            elif c.tag == 'scale':
                t[:3,:3] = np.diag(np.fromstring(c.text, sep=' '))
            elif c.tag in ('rotate', 'lookat', 'skew'):
                raise ValueError('unsupported transform '+c.tag)
            else:
                continue
            mat = mat @ t
        for c in node:
            if c.tag == 'node':
                walk(c, mat, stack)
            elif c.tag == 'instance_node':
                walk(byid[c.get('url')[1:]], mat, stack)
            elif c.tag == 'instance_geometry':
                points = meshes.get(c.get('url')[1:])
                if points is not None:
                    world = points @ mat[:3,:3].T + mat[:3,3]
                    lo = np.minimum(lo, world.min(axis=0))
                    hi = np.maximum(hi, world.max(axis=0))
                    instances += 1
    scene = root.find('./scene/instance_visual_scene')
    walk(byid[scene.get('url')[1:]], np.eye(4))
    assert instances and np.isfinite(lo).all()
    return (hi-lo)*unit*1000, sorted(set(textures)), instances

def main(reuse_verified=False):
    named = read(REPO/'资源库/04_软装道具模型/单件模型/manifest.json')
    named_byid = {a['asset_id']:a for a in named['assets']}
    original_manifest = read(SRC/'manifest.json')
    assets = {a['asset_id']:a for a in original_manifest['assets']}
    original_validation = read(SRC/'validation-summary.json')
    valid = {a['asset_id']:a for a in original_validation['results']}
    results, errors, file_plan = [], [], {}
    cached = {}
    if reuse_verified:
        cached = {r['asset_id']:r for r in read(OUT/'verification-20261009.json')['results']}
    for aid in IDS:
        try:
            v, a, n = valid[aid], assets[aid], named_byid[aid]
            assert v['status'] == 'passed', 'prior validation not passed'
            dae = SRC/a['folder']/'prop.dae'
            previous = cached.get(aid)
            if previous and sha(dae) == previous['dae_sha256']:
                dims = np.array(previous['dae_bounds_xyz_mm'])
                textures = [SRC/p for p in previous['textures']]
                instances = previous['geometry_instances']
            else:
                dims, textures, instances = bounds_and_textures(dae)
            expected = np.array(n['tight_face_bounds_xyz_mm'])
            delta = np.abs(dims-expected)
            assert max(delta) <= 1, ('dimension error >1mm', dims.tolist(), expected.tolist())
            assert len(textures) == v['texture_count'], 'texture count differs from prior validation'
            result = {'asset_id':aid, 'status':'passed', 'dae':dae.relative_to(SRC).as_posix(), 'dae_sha256':sha(dae), 'texture_count':len(textures), 'textures':[p.relative_to(SRC).as_posix() for p in textures], 'geometry_instances':instances, 'dae_bounds_xyz_mm':dims.tolist(), 'manifest_tight_face_bounds_xyz_mm':expected.tolist(), 'max_dimension_error_mm':float(max(delta)), 'prior_status':v['status']}
            results.append(result)
            files = [dae]+textures
            for p in (dae.parent/'metadata.json', SRC/aid/'validation.json'):
                if p.is_file(): files.append(p)
            file_plan[aid] = files
            print(aid, 'passed', 'textures='+str(len(textures)), 'max_error_mm='+str(round(max(delta),6)), flush=True)
        except Exception as e:
            errors.append({'asset_id':aid, 'error':str(e)})
            print(aid, 'FAILED', repr(e), flush=True)
    write(OUT/'verification-20261009.json', {'checked_at':datetime.now().astimezone().isoformat(), 'source':str(SRC), 'checked':len(IDS), 'passed':len(results), 'failed':len(errors), 'method':'Parse DAE XML, resolve active scene and all instance transforms; bound referenced face vertices in XYZ millimetres; verify every referenced texture with Pillow. Compare against named manifest tight_face_bounds_xyz_mm.', 'results':results})
    write(OUT/'errors.json', errors)
    if errors:
        raise SystemExit('Packaging stopped: missing or invalid assets require export')
    package = OUT/'split-20260925-v2'
    package.mkdir(exist_ok=False)
    for files in file_plan.values():
        for p in files:
            dest = package/p.relative_to(SRC)
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(p, dest)
            assert sha(p) == sha(dest), 'copy checksum mismatch'
    m = dict(original_manifest)
    m['assets'] = [assets[i] for i in IDS]
    m['completed'] = len(IDS)
    m['delivery_note'] = '38 selected existing exports; SKP files omitted; original DAE and texture relative paths preserved. Historical recommended_skp paths are provenance only, not included files.'
    write(package/'manifest.json', m)
    write(package/'validation-summary.json', {'checked':38,'passed':38,'review_required':[], 'results':[valid[i] for i in IDS], 'note':'Selected historical results from 2026-09-25. Use verification-20261009.json for current file and dimension verification.'})
    write(package/'named-manifest-38.json', {'assets':[named_byid[i] for i in IDS], 'note':'Source named SKP references and expected dimensions; SKP files not included.'})
    for filename in ['verification-20261009.json','errors.json','verify_and_package.py']:
        shutil.copyfile(OUT/filename, package/filename)
    (package/'README.txt').write_text('38 件 SketchUp 2026 现成 DAE 交付包\n来源：split-20260925-v2（2026-09-25 导出）\n每件入口：manifest.json 中 folder 路径下的 prop.dae。请完整解压，保留 prop 贴图子目录与相对路径。\nDAE 使用英寸单位（unit meter=0.0254）及 Z_UP；转换 GLB 时读取场景实例变换并正确处理单位与轴向。\n当前尺寸核对详见 verification-20261009.json，比较对象为单件模型 manifest 的 tight_face_bounds_xyz_mm。\nmetadata.json 和 validation-summary.json 为历史记录，可能含旧电脑绝对路径；旧包围盒字段可能包含非面片实体，尺寸应以 tight face 核对为准。\n保留原 DAE；未修改、保存或打包源 SKP。无须重新导出。\nSHA256SUMS.txt 覆盖包内除其自身外的所有文件。\n', encoding='utf-8')
    files = sorted(p for p in package.rglob('*') if p.is_file())
    (package/'SHA256SUMS.txt').write_text(''.join(sha(p)+'  '+p.relative_to(package).as_posix()+'\n' for p in files), encoding='utf-8')
    archive = OUT/(OUT.name+'.zip')
    with zipfile.ZipFile(archive, 'x', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for p in sorted(package.rglob('*')):
            if p.is_file(): z.write(p, p.relative_to(OUT).as_posix())
    with zipfile.ZipFile(archive) as z:
        assert z.testzip() is None, 'zip CRC failure'
        sums = z.read('split-20260925-v2/SHA256SUMS.txt').decode('utf-8').splitlines()
        for line in sums:
            expected, name = line.split('  ', 1)
            assert hashlib.sha256(z.read('split-20260925-v2/'+name)).hexdigest() == expected, name
        assert sum(n.endswith('/prop.dae') for n in z.namelist()) == 38
    digest = sha(archive)
    (OUT/'SHA256SUMS.txt').write_text(digest+'  '+archive.name+'\n', encoding='utf-8')
    print(json.dumps({'archive':str(archive), 'bytes':archive.stat().st_size, 'sha256':digest, 'passed':38, 'failed':0, 'texture_count':sum(r['texture_count'] for r in results), 'max_error_mm':max(r['max_dimension_error_mm'] for r in results)}, ensure_ascii=False), flush=True)

if __name__ == '__main__':
    import sys
    main(reuse_verified='--resume-verified' in sys.argv)
