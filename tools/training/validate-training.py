import json,hashlib,math
from pathlib import Path
from safetensors import safe_open
ROOT=Path(__file__).resolve().parents[2];base=ROOT/'素材库/04_training'
labels=json.loads((base/'layout-v0/labels.json').read_text(encoding='utf8'));m=json.loads((base/'layout-v0/model.json').read_text(encoding='utf8'));ev=json.loads((base/'layout-v0/evaluation.json').read_text(encoding='utf8'))
ignored=json.loads((ROOT/'素材库/01_catalog/classification/ignored-conflicts.json').read_text(encoding='utf8'));assert not {x['id'] for x in ignored}&{x['id'] for x in labels}
assert m['count']==11 and len(ev['folds'])==11 and m['history'][-1]['loss']<m['history'][0]['loss'];assert m['datasetSha256']==hashlib.sha256((base/'layout-v0/labels.json').read_bytes()).hexdigest()
for f in ev['folds']:assert f['testId'] not in f['trainIds'] and len(f['trainIds'])==10
raw=(base/'style-v0/metadata.jsonl').read_bytes();rows=[json.loads(s) for s in raw.decode('utf8').splitlines()];assert len(rows)==22
assert not {r['store_id'] for r in rows if r['split']=='train'}&{r['store_id'] for r in rows if r['split']=='validation'}
assert not {x['id'] for x in ignored}&{r['store_id'] for r in rows}
for r in rows:assert hashlib.sha256((base/'style-v0'/r['file_name']).read_bytes()).hexdigest()==r['image_sha256']
for style in ['SI1.0','SI2.0']:
    path=base/'style-v0/runs'/('smoke-'+style);r=json.loads((path/'report.json').read_text(encoding='utf8'));assert r['state']=='completed' and r['mode']=='smoke' and r['steps']==80
    assert r['dataset_sha256']==hashlib.sha256(raw).hexdigest();assert r['adapter_absolute_delta']>0 and r['reload_max_pixel_difference']<=1 and not r['usable_for_production']
    assert r['base_revision']=='3ee6c9f225f088ad5d35b624b6514b091e6a4849'
    assert len((path/'loss.jsonl').read_text().splitlines())==80
    with safe_open(str(path/'pytorch_lora_weights.safetensors'),framework='pt') as f:
        assert len(f.keys())>0
        for key in f.keys():assert f.get_tensor(key).isfinite().all()
print('PASS: 11 layout folds; 22 style images; store splits/hashes/exclusions; 2 LoRAs with finite weights, 80 steps and successful reload')
