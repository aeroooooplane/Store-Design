"""Extract selected pages once. Coordinates remain PDF points, X right/Y down."""
import json
import time
from pathlib import Path
from render_core import sha256_file
from render_queue import atomic_json


def extract(source, cache, pages):
    import pdfplumber
    source, cache = Path(source).resolve(), Path(cache).resolve()
    if not pages or any(not isinstance(p, int) or p < 1 for p in pages):
        raise ValueError('Page numbers must be positive integers (1-based)')
    pages = sorted(set(pages))
    started = time.perf_counter()
    # Content hashing deliberately reads this one input file, not other manuals.
    content_hash = sha256_file(source)
    version = sha256_file(__file__)[:16] + '-' + pdfplumber.__version__
    directory = cache / content_hash / version
    index_path = directory / 'index.json'
    index = json.loads(index_path.read_text(encoding='utf-8')) if index_path.exists() else {'pages': {}}
    result = {'source': str(source), 'source_sha256': content_hash, 'parsed_pages': 0, 'cached_pages': 0, 'pages': []}
    missing = []
    for number in pages:
        path = directory / f'page-{number}.json'
        entry = index['pages'].get(str(number))
        if entry and path.exists() and sha256_file(path) == entry['sha256']:
            result['cached_pages'] += 1
        else:
            missing.append(number)
        result['pages'].append({'page': number, 'path': str(path)})
    if missing:
        with pdfplumber.open(source) as doc:
            if max(pages) > len(doc.pages):
                raise ValueError('Requested page exceeds PDF page count')
            for number in missing:
                page = doc.pages[number - 1]
                text = page.extract_text() or ''
                words = page.extract_words()
                geometries = {}
                for kind in ['lines', 'rects', 'curves']:
                    geometries[kind] = [{'points': item.get('pts', []),
                                         'bbox': [item['x0'], item['top'], item['x1'], item['bottom']],
                                         'linewidth': item.get('linewidth'), 'fill': item.get('fill')}
                                        for item in getattr(page, kind)]
                data = {'page': number, 'width': page.width, 'height': page.height,
                        'units': 'PDF_points', 'coordinate_system': 'x_right_y_down',
                        'rotation': page.rotation, 'text': text, 'words': words, **geometries,
                        'needs_visual_or_ocr_review': not bool(text.strip()),
                        'calibration': None, 'layout_approved': False}
                path = directory / f'page-{number}.json'
                atomic_json(path, data)
                index['pages'][str(number)] = {'sha256': sha256_file(path)}
                result['parsed_pages'] += 1
                page.close()
        atomic_json(index_path, index)
    result['elapsed_seconds'] = round(time.perf_counter() - started, 4)
    # Small summary is enough for the agent; detailed geometry stays on disk.
    return result
