#!/usr/bin/env node
// Requires Node.js and Python 3.9+ standard libraries only. Never rebuilds or changes inputs.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const [collection, output, receiptArgument] = process.argv.slice(2);
if (!collection || !output) throw new Error('Use package-core-source.mjs SOURCE_COLLECTION OUTPUT_ZIP [RECEIPT_JSON]; outputs must not already exist.');
const extension = fileURLToPath(new URL('..', import.meta.url));
const receipt = resolve(receiptArgument ?? resolve(extension, 'release/codec-core-source-bundle.json'));

// Streaming ZIP creation/readback avoids retaining the complete source collection in RAM.
const python = String.raw`
import datetime, hashlib, json, os, pathlib, posixpath, re, shutil, stat, sys, tarfile, zipfile

collection, output, receipt_path, recipe_root, notices_root = map(pathlib.Path, sys.argv[1:])
collection = collection.absolute()
recipe_root = recipe_root.absolute()
notices_root = notices_root.absolute()
ROOT = 'ai-director-studio-core-sources/'

def require(condition, message):
    if not condition: raise ValueError(message)

def safe_relative(value):
    require(isinstance(value, str) and value and '\\' not in value and '\x00' not in value, 'Invalid relative path')
    require(not value.startswith('/') and not re.match(r'^[A-Za-z]:', value), 'Absolute archive path')
    require(all(part not in ('', '.', '..') for part in value.split('/')), 'Archive path escapes or aliases')
    return value

def ordinary(root, name):
    name = safe_relative(name)
    path = root / name
    require(root.is_dir() and not root.is_symlink(), 'Input root is not an ordinary directory')
    current = root
    for part in name.split('/'):
        current = current / part
        require(not current.is_symlink(), 'Unexpected input symlink: ' + name)
    require(path.is_file(), 'Missing ordinary input: ' + name)
    return path

def measure(path):
    h, length = hashlib.sha256(), 0
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            length += len(chunk); h.update(chunk)
    return {'bytes': length, 'sha256': h.hexdigest()}

def verify(path, row):
    actual = measure(path)
    require(actual['bytes'] == row['bytes'] and actual['sha256'] == row['sha256'], 'Locked input differs: ' + path.name)
    return actual

def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode()

def byte_hash(value): return hashlib.sha256(value).hexdigest()

require(not output.exists() and not output.is_symlink(), 'Refusing to replace an existing ZIP')
require(not receipt_path.exists() and not receipt_path.is_symlink(), 'Refusing to replace an existing receipt')
lock_path = ordinary(recipe_root, 'source-lock.json')
lock = json.loads(lock_path.read_bytes())
core = lock['completedBuilds']['core']
require(core['outputAcceptance']['status'] == 'passed', 'Accepted own Core build required')
build = collection / safe_relative(core['externalDirectory'])
context = collection / safe_relative(core['executedContext']['externalDirectory'])
handoff_path = ordinary(build, 'adoption-handoff.json')
handoff = json.loads(handoff_path.read_bytes())
require(handoff['schemaVersion'] == 1 and len(handoff['sourceFiles']) == 76, 'Expected frozen 76-file handoff')
verify(lock_path, handoff['canonicalSourceLock'])
run_path = ordinary(build, 'run-receipt.json')
run = json.loads(run_path.read_bytes())
require(run['status'] == 'compiled' and run['exitCode'] == 0, 'Successful actual compile receipt required')
require(run['compilerImage'] == core['compilerImage'] == lock['toolchains']['core']['immutableImage'], 'Compiler image mismatch')
# Receipts retain their original observed absolute paths. A copied collection
# must keep the locked relative context layout, not that developer's home path.
recorded_context = pathlib.PurePosixPath(run['context'])
relative_context = pathlib.PurePosixPath(core['executedContext']['externalDirectory'])
require(recorded_context.parts[-len(relative_context.parts):] == relative_context.parts, 'Receipt selects another executed context')
require('--network=none' in run['argv'], 'Offline compiler RUN steps required')
require(run['sourceLockSha256'] == core['executedContext']['sourceLockSha256'], 'Executed lock differs from canonical record')
require(run['dockerfileSha256'] == core['executedContext']['dockerfileSha256'], 'Executed Dockerfile differs from canonical record')

entries, measurements, counts, source_rows = {}, {}, {}, []
def add(name, path=None, data=None, group=None, expected=None, directory=False, mode=None):
    name = ROOT + safe_relative(name) + ('/' if directory else '')
    require(name not in entries, 'Duplicate ZIP member: ' + name)
    require((path is None) != (data is None), 'Exactly one payload is required')
    info = measure(path) if path is not None else {'bytes': len(data), 'sha256': byte_hash(data)}
    if expected: require(info['bytes'] == expected['bytes'] and info['sha256'] == expected['sha256'], 'Selected input mismatch: ' + name)
    entries[name] = {'path': path, 'data': data, 'directory': directory, 'mode': mode if mode is not None else (stat.S_IMODE(path.stat().st_mode) if path else 0o644)}
    measurements[name] = {**info, 'group': group, 'kind': 'directory' if directory else 'file'}
    item = counts.setdefault(group, {'files': 0, 'bytes': 0}); item['files'] += 1; item['bytes'] += info['bytes']

print('Verifying archive hashes and complete frozen-context correspondence', file=sys.stderr, flush=True)
expected_context, expected_links, expected_directories = {}, {}, set()
sources = core['sources']
require(len(sources) == 19, 'Expected exactly 19 selected Core source archives')
for component, row in sources.items():
    archive_path = ordinary(collection, row['archive'])
    verify(archive_path, row)
    add('source-archives/' + row['archive'], path=archive_path, group='sourceArchives', expected=row)
    source_rows.append({'component': component, **row})
    prefix = '' if component == 'ffmpegwasm-recipe' else ('locked-sources/zimg/test/extra/googletest/' if component == 'zimg-googletest' else 'locked-sources/' + component + '/')
    with tarfile.open(archive_path, 'r:gz') as archive:
        archive_root = None
        for member in archive:
            parts = member.name.rstrip('/').split('/')
            safe_relative('/'.join(parts))
            if archive_root is None: archive_root = parts[0]
            require(parts[0] == archive_root, 'Source archive has multiple roots')
            if len(parts) == 1: continue
            name = prefix + '/'.join(parts[1:])
            if member.isdir():
                expected_directories.add(name)
                continue
            if member.issym():
                target = member.linkname
                require(not target.startswith('/') and '\\' not in target, 'Unsafe upstream symlink')
                resolved = posixpath.normpath(posixpath.join(posixpath.dirname(member.name), target))
                require(resolved == archive_root or resolved.startswith(archive_root + '/'), 'Upstream symlink escapes archive root')
                expected_links[name] = target
                continue
            require(member.isfile(), 'Unsupported source archive member type')
            stream = archive.extractfile(member)
            h, size = hashlib.sha256(), 0
            # The preparation transform applies even to the two unused build scripts.
            if component == 'ffmpegwasm-recipe' and name.startswith('build/') and name.endswith('.sh'):
                original = stream.read()
                transformed = re.sub(rb'(?<![\w-])-j(?![\w=])', b'-j2', original)
                expected_context[name] = {'bytes': len(transformed), 'sha256': byte_hash(transformed)}
            else:
                for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                    size += len(chunk); h.update(chunk)
                expected_context[name] = {'bytes': size, 'sha256': h.hexdigest()}

executed = core['executedContext']
expected_context['Dockerfile'] = {'bytes': (context / 'Dockerfile').stat().st_size, 'sha256': executed['dockerfileSha256']}
expected_context['SOURCE-LOCK.json'] = {'bytes': (context / 'SOURCE-LOCK.json').stat().st_size, 'sha256': executed['sourceLockSha256']}
for row in executed['buildScripts']: expected_context[safe_relative(row['filename'])] = row
for row in lock['apt']['downloadedDebs']: expected_context['locked-debs/' + safe_relative(row['filename'])] = row

actual_files, actual_links, empty_directories = {}, {}, []
def scan(directory):
    children = sorted(os.scandir(directory), key=lambda item: item.name)
    if not children and directory != context: empty_directories.append(pathlib.Path(directory).relative_to(context).as_posix())
    for node in children:
        path = pathlib.Path(node.path)
        name = path.relative_to(context).as_posix()
        safe_relative(name)
        # Upstream's archive-bound Svelte fixture has a public .npmrc; arbitrary
        # local additions still fail the exact expected-context map below.
        require(not any(part in ('.git', 'node_modules', '.env', 'id_rsa', 'id_ed25519') for part in name.split('/')), 'Forbidden local/credential input name')
        if node.is_symlink(): actual_links[name] = os.readlink(path)
        elif node.is_dir(follow_symlinks=False): scan(path)
        else:
            require(node.is_file(follow_symlinks=False), 'Special context input')
            require(not name.endswith(('.wasm', '.a')) and 'dist' not in name.split('/'), 'Compiled/runtime seed in source context')
            actual_files[name] = path
scan(context)
require(set(actual_files) == set(expected_context), 'Frozen context regular-file scope differs from source archives/locked generated inputs')
require(actual_links == expected_links, 'Frozen context symlinks differ from original archives')
for name, path in actual_files.items():
    add('executed-context/' + name, path=path, group='context', expected=expected_context[name])
for name in sorted(empty_directories):
    require(name in expected_directories, 'Unexplained empty context directory')
    add('executed-context/' + name, data=b'', group='emptyContextDirectories', directory=True, mode=stat.S_IMODE((context / name).stat().st_mode))

link_records = []
for name, target in sorted(actual_links.items()):
    resolved = (context / name).resolve(strict=True)
    require(resolved.is_relative_to(context.resolve()), 'Context link resolves outside selected inputs')
    record = {'path': name, 'target': target, 'resolvedPath': resolved.relative_to(context).as_posix(), 'kind': 'directory' if resolved.is_dir() else 'file'}
    link_records.append(record)
    if resolved.is_file():
        require(record['resolvedPath'] in actual_files, 'Link target is not an archive-bound ordinary file')
        add('executed-context/' + name, path=resolved, group='context', expected=expected_context[record['resolvedPath']])
    else:
        require(resolved.is_dir(), 'Unsupported symlink target')
        for child_name, child_path in sorted(actual_files.items()):
            if child_path.is_relative_to(resolved):
                alias = name + '/' + child_path.relative_to(resolved).as_posix()
                add('executed-context/' + alias, path=child_path, group='context', expected=expected_context[child_name])

original_context = {'regularFiles': len(actual_files), 'regularBytes': sum(expected_context[name]['bytes'] for name in actual_files), 'symlinks': len(actual_links), 'emptyDirectories': len(empty_directories)}
source_proof = json.loads(ordinary(build, 'source-chain-proof.json').read_bytes())
source_audit = json.loads(ordinary(build, 'independent-source-audit.json').read_bytes())
require(len(actual_files) + sum(row['kind'] == 'file' for row in link_records) == source_proof['sourceContextFileCount'], 'Frozen context count differs from measured build proof')
require(len(actual_files) + len(actual_links) == source_audit['frozenContext']['sourceContextEntryCount'], 'Frozen context entry count differs from source audit')
require(counts['context'] == {'files': 18348, 'bytes': 354650783}, 'Materialized accepted context size/count changed')

recipe_names = set()
for row in handoff['sourceFiles']:
    original_path = pathlib.Path(row['path'])
    require(original_path.is_relative_to(pathlib.Path(handoff['recipeDirectory'])), 'Handoff recipe file escapes its root')
    name = safe_relative(original_path.relative_to(handoff['recipeDirectory']).as_posix())
    require(name not in recipe_names, 'Duplicate handoff recipe file')
    recipe_names.add(name)
    add('frozen-recipe/' + name, path=ordinary(recipe_root, name), group='frozenRecipe', expected=row)
require(len(recipe_names) == 76, 'Frozen recipe scope differs from handoff')
for row in core['rawBuildEvidence']:
    name = safe_relative(row['filename'])
    add('build-evidence/' + name, path=ordinary(build, name), group='rawBuildEvidence', expected=row)
add('build-evidence/adoption-handoff.json', path=handoff_path, group='handoff')

notice_rows = json.loads(ordinary(recipe_root.parent / 'codec-sources', 'notices.json').read_bytes())
selected_notices = [row for row in notice_rows if row['component'] in sources or row['component'] in ('emsdk', 'emscripten')]
for row in selected_notices:
    name = safe_relative(row['noticeFile'])
    path = ordinary(notices_root, name)
    require(measure(path)['sha256'] == row['sha256'], 'Original license notice changed')
    add('licenses/' + name, path=path, group='licenses')
for component, prefix, names in [
    ('ffmpeg', 'locked-sources/ffmpeg/', ['COPYING.GPLv2', 'COPYING.GPLv3', 'COPYING.LGPLv2.1', 'COPYING.LGPLv3', 'LICENSE.md']),
    ('ffmpegwasm-recipe', '', ['LICENSE']),
    ('zimg-googletest', 'locked-sources/zimg/test/extra/googletest/', ['googletest/LICENSE', 'googlemock/LICENSE'])
]:
    for name in names:
        key = prefix + name
        require(key in expected_context, 'Selected source license missing')
        add('licenses/' + component + '/' + name, path=actual_files[key], group='licenses', expected=expected_context[key])
add('licenses/NOTICE-MAP.json', data=json_bytes(selected_notices), group='metadata')

readme = '''AI Director Studio - selected own Core sources and measured build evidence

This bundle supplies the exact selected filesystem inputs for the observed full
Core UMD/ESM build, the unchanged executed context and original license notices.
All payload file sizes and SHA256 values are in BUNDLE-MANIFEST.json. Source
archives remain their original locked bytes. Frozen recipe files are the
76-file accepted adoption handoff; raw evidence is checked against source-lock.
No product runtime JS/WASM, installed dependency tree, credentials, private
media, standalone encoder replacement or new compilation is included.

The compiler container and BuildKit image remain external digest-pinned
dependencies; their hashes and the actual offline build argv are in the locks
and receipts. The bundle does not attest the original publisher's historical
environment, a second cold rebuild, all compiler sources, or legal compliance.
Standalone Mediabunny AAC/MP3/FLAC product encoders remain the npm baseline.

There are no ZIP symlink entries. Ten original archive-bound internal links
were materialized as ordinary files/directories. Their original path/target
and resolved mapping are recorded in BUNDLE-MANIFEST.json. To reconstruct the
exact context layout before rebuilding, remove each materialized alias and
restore the recorded relative symlink within executed-context. Do not replace
the frozen Dockerfile/SOURCE-LOCK with the historical prepare-recipe output.

Technical receipt delivery is not publication, native-host acceptance, storage
migration, a reviewer submission, or a legal completeness attestation.
'''
add('README.txt', data=readme.encode(), group='metadata')
payload_digest = byte_hash(json_bytes({name: measurements[name] for name in sorted(measurements)}))
manifest = {'schemaVersion': 1, 'scope': 'selected-own-core-build-inputs-and-evidence', 'sourceLock': measure(lock_path), 'handoff': measure(handoff_path), 'compilerImage': core['compilerImage'], 'buildkitImage': core['buildkitImage'], 'originalContext': original_context, 'materializedContext': counts['context'], 'materializedSymlinks': link_records, 'groups': counts, 'payloadInventorySha256': payload_digest, 'files': [{'path': name, **measurements[name]} for name in sorted(measurements)], 'legalComplianceAttested': False, 'standaloneEncodersAdopted': False}
manifest_data = json_bytes(manifest)
add('BUNDLE-MANIFEST.json', data=manifest_data, group='manifest')

print('Writing checked source ZIP (' + str(len(entries)) + ' safe entries; no symlinks)', file=sys.stderr, flush=True)
output.parent.mkdir(parents=True, exist_ok=True)
receipt_path.parent.mkdir(parents=True, exist_ok=True)
created = False
try:
    with zipfile.ZipFile(output, 'x', allowZip64=True) as archive:
        created = True
        for name in sorted(entries):
            selected = entries[name]
            info = zipfile.ZipInfo(name, (2026, 10, 2, 0, 0, 0))
            info.create_system = 3
            info.external_attr = ((stat.S_IFDIR if selected['directory'] else stat.S_IFREG) | selected['mode']) << 16
            if selected['directory']: info.external_attr |= 0x10
            info.compress_type = zipfile.ZIP_STORED if name.endswith(('.gz', '.deb', '.png', '.jpg', '.jpeg', '.zip')) else zipfile.ZIP_DEFLATED
            info._compresslevel = 6
            h, size = hashlib.sha256(), 0
            with archive.open(info, 'w', force_zip64=True) as destination:
                if selected['path'] is not None:
                    with selected['path'].open('rb') as stream:
                        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                            destination.write(chunk); h.update(chunk); size += len(chunk)
                else:
                    destination.write(selected['data']); h.update(selected['data']); size = len(selected['data'])
            require(size == measurements[name]['bytes'] and h.hexdigest() == measurements[name]['sha256'], 'Input changed during ZIP creation')
    print('Reading every ZIP entry back and checking scope, CRC, bytes and SHA256', file=sys.stderr, flush=True)
    with zipfile.ZipFile(output, 'r') as archive:
        require(len(archive.infolist()) == len(entries) and set(archive.namelist()) == set(entries), 'ZIP readback scope mismatch')
        for info in archive.infolist():
            safe_relative(info.filename.rstrip('/'))
            require(info.is_dir() == entries[info.filename]['directory'], 'ZIP member type changed')
            require(stat.S_ISDIR(info.external_attr >> 16) if info.is_dir() else stat.S_ISREG(info.external_attr >> 16), 'Nonordinary ZIP member')
            h, size = hashlib.sha256(), 0
            with archive.open(info) as stream:
                for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                    h.update(chunk); size += len(chunk)
            require(size == measurements[info.filename]['bytes'] and h.hexdigest() == measurements[info.filename]['sha256'], 'ZIP payload readback mismatch')
    zip_measurement = measure(output)
    report = {'schemaVersion': 1, 'status': 'passed', 'createdAtUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'scope': 'selected-own-core-build-inputs-and-evidence', 'archive': {'filename': output.name, **zip_measurement}, 'zipEntries': len(entries), 'uncompressedBytes': sum(row['bytes'] for row in measurements.values()), 'selectedInputs': {'sourceArchives': source_rows, 'sourceLock': measure(lock_path), 'handoff': measure(handoff_path), 'originalContext': original_context, 'materializedContext': counts['context'], 'frozenRecipe': counts['frozenRecipe'], 'rawBuildEvidence': counts['rawBuildEvidence'], 'licenses': counts['licenses']}, 'checks': {'allSelectedArchiveHashes': True, 'completeContextArchiveAndGeneratedInputCorrespondence': True, 'frozenRecipeHandoffHashes': True, 'rawBuildEvidenceHashes': True, 'originalNoticeHashes': True, 'safeOrdinaryZipPaths': True, 'fullZipCountBytesCrcSha256Readback': True}, 'payloadInventorySha256': payload_digest, 'bundleManifestSha256': byte_hash(manifest_data), 'materializedSymlinks': link_records, 'compilerImage': core['compilerImage'], 'buildkitImage': core['buildkitImage'], 'runtimeBinariesIncluded': False, 'standaloneEncodersAdopted': False, 'legalComplianceAttested': False, 'compilerBaseImageIsExternal': True}
    with receipt_path.open('xb') as stream: stream.write(json_bytes(report))
    print(json.dumps({'status': 'passed', 'archive': report['archive'], 'zipEntries': report['zipEntries'], 'groups': counts, 'receipt': str(receipt_path)}))
except BaseException:
    if created: output.unlink(missing_ok=True)
    raise
`;
const args = ['-c', python, resolve(collection), resolve(output), receipt, resolve(extension, 'release/codec-rebuild'), resolve(extension, 'public/licenses')];
const child = spawn('python3', args, { stdio: 'inherit' });
const code = await new Promise((done, reject) => { child.on('error', reject); child.on('exit', done); });
if (code !== 0) process.exitCode = typeof code === 'number' ? code : 1;
