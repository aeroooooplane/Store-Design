"""Selection, ordering and recoverable output operations, without Blender."""
import json
import os
import uuid
from contextlib import contextmanager
from pathlib import Path
from render_core import validate_view


def atomic_json(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
    temporary.replace(path)


def select_views(job, selection):
    views = job['views']
    for view in views:
        validate_view(view)
    ids = [v['id'] for v in views]
    if len(ids) != len(set(ids)):
        raise ValueError('Duplicate view ids')
    if selection.startswith('@'):
        group = selection[1:]
        if group not in job.get('view_groups', {}):
            raise ValueError('Missing view group: ' + group)
        selected = job['view_groups'][group]
    else:
        selected = ids if selection == 'all' else selection.split(',')
    if not selected or set(selected) - set(ids):
        raise ValueError('Empty or unknown views: ' + str(selected))
    lookup = {v['id']: v for v in views}
    return [lookup[name] for name in dict.fromkeys(selected)]


def build_passes(views, mode='both', order='grouped'):
    passes = []
    for view in views:
        modes = view.get('modes', ['material', 'white'])
        if not modes or len(set(modes)) != len(modes) or set(modes) - {'material', 'white'}:
            raise ValueError('Invalid modes for ' + view['id'])
        passes.extend((view, m) for m in modes if mode == 'both' or mode == m)
    if not passes:
        raise ValueError('No passes selected')
    if order == 'grouped':
        passes.sort(key=lambda p: p[1] == 'white')
    return passes


def prepare_output(path, entry, key, recover):
    path = Path(path)
    if not path.exists():
        return None
    if not entry:
        raise FileExistsError('Unknown output provenance; inspect and move to backup manually: ' + str(path))
    if entry and entry.get('key') != key:
        raise FileExistsError('Settings changed; use a new output directory: ' + str(path))
    if not recover:
        raise FileExistsError('Unverified output; inspect or use --recover-incomplete: ' + str(path))
    directory = path.parent / '_recovered'
    directory.mkdir(exist_ok=True)
    backup = directory / (path.stem + '-' + uuid.uuid4().hex + path.suffix)
    path.rename(backup)
    return str(backup)


@contextmanager
def output_lock(directory):
    """OS-held lock releases on process death; the small lock file can remain."""
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    with (directory / '.render.lock').open('a+b') as stream:
        if stream.tell() == 0:
            stream.write(b'0')
            stream.flush()
        stream.seek(0)
        if os.name == 'nt':
            import msvcrt
            msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            yield
        finally:
            stream.seek(0)
            if os.name == 'nt':
                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(stream.fileno(), fcntl.LOCK_UN)
