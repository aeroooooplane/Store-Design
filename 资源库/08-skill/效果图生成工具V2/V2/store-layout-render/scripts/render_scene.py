"""Run with Blender 4.5: --background --python this.py -- --job job.json."""
import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from render_core import cache_key, cache_hit, sha256_file, validate_view, validate_scale

from render_queue import select_views, build_passes, prepare_output, atomic_json, output_lock

PROFILES = {'draft': (600, 400, 8, 8), 'final': (1800, 1200, 64, 16)}


def main():
    import bpy
    from mathutils import Vector
    parser = argparse.ArgumentParser()
    parser.add_argument('--job', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--profile', choices=PROFILES, default='draft')
    parser.add_argument('--views', default='all')
    parser.add_argument('--mode', choices=['both', 'material', 'white'], default='both')
    parser.add_argument('--order', choices=['grouped', 'interleaved'], default='grouped')
    parser.add_argument('--recover-incomplete', action='store_true')
    parser.add_argument('--check-only', action='store_true')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    started = time.perf_counter()
    started_wall = time.time()
    job_path = Path(args.job).resolve()
    job = json.loads(job_path.read_text(encoding='utf-8-sig'))
    scene_path = (job_path.parent / job['scene']).resolve()
    output = Path(args.out).resolve()
    views = select_views(job, args.views)
    passes = build_passes(views, args.mode, args.order)
    bpy.ops.wm.open_mainfile(filepath=str(scene_path), load_ui=False, use_scripts=False)
    scene = bpy.context.scene
    # Immutable packed input: changing anything in this file invalidates all its renders.
    # Adding/changing an external view only invalidates that view.
    for image in bpy.data.images:
        if image.source == 'FILE' and not image.packed_file:
            raise ValueError('Pack external texture before rendering: ' + image.name)
    if any(lib for lib in bpy.data.libraries):
        raise ValueError('Make linked libraries local before portable rendering')
    for obj in bpy.data.objects:
        if not obj.get('plan_fixture'):
            continue
        asset = Path(obj['source_asset'].replace('\\', '/')).stem
        basis = obj.matrix_world.to_3x3()
        lengths = [basis.col[i].length for i in range(3)]
        if basis.determinant() <= 0 or max(lengths) - min(lengths) > 1e-5:
            raise ValueError('Mirrored or nonuniformly scaled fixture: ' + obj.name)
        if any(abs(basis.col[i].dot(basis.col[j])) > 1e-5 for i, j in [(0, 1), (0, 2), (1, 2)]):
            raise ValueError('Sheared fixture: ' + obj.name)
        validate_scale(asset, round(lengths[0], 6))
    for view in views:
        if view.get('camera') and (view['camera'] not in bpy.data.objects or bpy.data.objects[view['camera']].type != 'CAMERA'):
            raise ValueError('Missing camera: ' + view['camera'])
    if args.check_only:
        print('CHECK_OK', json.dumps({'views': len(views), 'passes': len(passes), 'packed_scene': True}), flush=True)
        return
    clay = next((m for m in bpy.data.materials if m.name.startswith('白模材质')), None)
    if clay is None:
        clay = bpy.data.materials.new('White model override')
        clay.use_nodes = True
        shader = clay.node_tree.nodes.get('Principled BSDF')
        shader.inputs['Base Color'].default_value = (.67, .68, .68, 1)
        shader.inputs['Roughness'].default_value = .7
    width, height, mat_samples, white_samples = PROFILES[args.profile]
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.use_denoising = True
    scene.render.use_persistent_data = True
    scene.render.resolution_x, scene.render.resolution_y = width, height
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    base_visibility = {o.name: o.hide_render for o in bpy.data.objects}
    base_cameras = {o.name: (o.matrix_world.copy(), o.data.lens, o.data.type, o.data.ortho_scale)
                    for o in bpy.data.objects if o.type == 'CAMERA'}
    scene_hash = sha256_file(scene_path)
    # Script changes must not reuse images produced by old rendering behavior.
    implementation_hash = sha256_file(__file__) + sha256_file(Path(__file__).with_name('render_core.py')) + sha256_file(Path(__file__).with_name('render_queue.py'))
    output.mkdir(parents=True, exist_ok=True)
    manifest_path = output / 'render-manifest.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8')) if manifest_path.exists() else {'renders': {}}
    summary = {'profile': args.profile, 'rendered': 0, 'skipped': 0, 'passes': []}
    summary['started_at'] = started_wall
    summary['total'] = len(passes)
    summary['order'] = args.order
    summary['material_switches'] = 0
    prior_mode = None
    def progress(state, current=None):
        record = {**summary, 'state': state, 'current': current, 'updated_at': time.time(),
                  'elapsed_seconds': round(time.perf_counter() - started, 3)}
        atomic_json(output / 'progress.json', record)
    progress('running')
    for view, mode in passes:
        for obj in bpy.data.objects:
            obj.hide_render = base_visibility.get(obj.name, False)
            if any(obj.name.startswith(p) for p in view.get('hide_prefixes', [])):
                obj.hide_render = True
        if view.get('camera'):
            camera = bpy.data.objects.get(view['camera'])
            if camera is None or camera.type != 'CAMERA':
                raise ValueError('Missing camera: ' + view['camera'])
            matrix, lens, camera_type, ortho_scale = base_cameras[camera.name]
            camera.matrix_world = matrix.copy()
            camera.data.lens, camera.data.type, camera.data.ortho_scale = lens, camera_type, ortho_scale
        else:
            camera = bpy.data.objects.get('__external_view')
            if camera is None:
                camera = bpy.data.objects.new('__external_view', bpy.data.cameras.new('__external_view'))
                scene.collection.objects.link(camera)
            camera.data.type = 'PERSP'
            camera.data.lens = 35
        if 'position' in view:
            if view.get('coordinate_system') not in ('pdf_y_down', 'world'):
                raise ValueError('Explicit camera positions require coordinate_system')
            convert = lambda p: (p[0], -p[1], p[2]) if view['coordinate_system'] == 'pdf_y_down' else p
            camera.location = convert(view['position'])
            direction = Vector(convert(view['target'])) - camera.location
            if direction.length < 1e-6:
                raise ValueError('Camera position and target cannot coincide')
            camera.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
        if 'lens' in view:
            camera.data.lens = view['lens']
        scene.camera = camera
        bpy.context.view_layer.update()
        camera_record = {'matrix': [list(row) for row in camera.matrix_world], 'lens': camera.data.lens,
                         'type': camera.data.type, 'ortho_scale': camera.data.ortho_scale}
        scene.cycles.samples = mat_samples if mode == 'material' else white_samples
        if prior_mode != mode:
            for layer in scene.view_layers:
                layer.material_override = clay if mode == 'white' else None
            summary['material_switches'] += int(prior_mode is not None)
            prior_mode = mode
        settings = {'resolution': [width, height], 'samples': scene.cycles.samples,
                    'device': 'CPU', 'denoise': True, 'implementation': implementation_hash,
                    'camera': camera_record}
        key = cache_key(scene_hash, view, mode, settings, bpy.app.version_string)
        relative = mode + '/' + view['id'] + '.png'
        path = output / relative
        entry = manifest['renders'].get(relative)
        intent_path = path.with_name(path.stem + '.intent.json')
        intent = json.loads(intent_path.read_text(encoding='utf-8')) if intent_path.exists() else None
        if cache_hit(entry, key, path):
            summary['skipped'] += 1
            summary['passes'].append({'file': relative, 'status': 'cached'})
            print('CACHE_HIT', relative, flush=True)
            progress('running')
            continue
        backup = prepare_output(path, entry or intent, key, args.recover_incomplete)
        if backup:
            summary.setdefault('recovered', []).append(backup)
        path.parent.mkdir(parents=True, exist_ok=True)
        partial = path.with_name(path.stem + '.partial.png')
        if partial.exists():
            backup = prepare_output(partial, intent, key, args.recover_incomplete)
            summary.setdefault('recovered', []).append(backup)
        atomic_json(intent_path, {'key': key, 'scene_sha256': scene_hash})
        scene.render.filepath = str(partial)
        progress('running', {'file': relative, 'started_at': time.time()})
        tick = time.perf_counter()
        bpy.ops.render.render(write_still=True)
        if not partial.is_file() or partial.stat().st_size < 100:
            raise RuntimeError('Render output missing or incomplete: ' + str(partial))
        partial.replace(path)
        elapsed = round(time.perf_counter() - tick, 3)
        manifest['renders'][relative] = {'key': key, 'sha256': sha256_file(path), 'seconds': elapsed,
                                         'camera': camera_record, 'scene_sha256': scene_hash,
                                         'hidden': sorted(o.name for o in bpy.data.objects if o.hide_render)}
        atomic_json(manifest_path, manifest)
        summary['rendered'] += 1
        summary['passes'].append({'file': relative, 'status': 'rendered', 'seconds': elapsed})
        progress('running')
    summary['elapsed_seconds'] = round(time.perf_counter() - started, 3)
    progress('complete')
    (output / 'last-run.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')
    print('RUN_SUMMARY', json.dumps(summary, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    raw = sys.argv[sys.argv.index('--') + 1:]
    if '--out' not in raw:
        main()
    else:
        destination = Path(raw[raw.index('--out') + 1]).resolve()
        with output_lock(destination):
            atomic_json(destination / 'progress.json', {'state': 'initializing', 'started_at': time.time(), 'updated_at': time.time()})
            try:
                main()
            except BaseException as error:
                record_path = destination / 'progress.json'
                record = json.loads(record_path.read_text(encoding='utf-8')) if record_path.exists() else {}
                atomic_json(record_path, {**record, 'state': 'failed', 'error': str(error), 'updated_at': time.time()})
                raise
