"""Portable, Blender-independent validation and incremental rendering cache."""
import hashlib
import json
import math
import re
from pathlib import Path


def sha256_file(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def cache_key(scene_hash, view, mode, settings, engine_version):
    payload = [scene_hash, view, mode, settings, engine_version]
    return hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def cache_hit(entry, key, output):
    return bool(entry and entry.get('key') == key and Path(output).is_file()
                and entry.get('sha256') == sha256_file(output))


def validate_view(view):
    if not re.fullmatch(r'[A-Za-z0-9_-]+', view.get('id', '')):
        raise ValueError('View id must contain only letters, numbers, hyphen or underscore')
    if not view.get('camera') and not (view.get('position') and view.get('target')):
        raise ValueError('View needs an existing camera or explicit position and target')


def validate_scale(asset, scale):
    if not isinstance(scale, (int, float)) or not math.isfinite(scale) or scale <= 0:
        raise ValueError('Scale must be finite and positive; mirrored geometry is forbidden')
    if asset not in {'logo_full', 'lightbox_artwork', 'portrait_artwork'} and abs(scale - 1) > 1e-8:
        raise ValueError('Furniture must retain its native dimensions: ' + asset)
