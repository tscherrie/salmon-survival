#!/usr/bin/env python3
"""Generate an offline Core build context from verified source/deb archives; does not compile."""
from pathlib import Path
import json,hashlib,tarfile,re,shutil,sys
here=Path(__file__).resolve().parent
lock=json.loads((here/'source-lock.json').read_text())
sources=Path(sys.argv[1]).resolve()
context=Path(sys.argv[2]).resolve()
if context.exists() and any(context.iterdir()):raise ValueError('Choose an empty new build context')
context.mkdir(parents=True,exist_ok=True)
def extract(name,target):
 row=lock['sources'][name];path=sources/row['archive'];data=path.read_bytes()
 if len(data)!=row['bytes'] or hashlib.sha256(data).hexdigest()!=row['sha256']:raise ValueError('Source integrity mismatch: '+name)
 target.mkdir(parents=True,exist_ok=True)
 with tarfile.open(path,'r:gz') as archive:
  members=archive.getmembers();prefix=members[0].name.split('/')[0]
  for member in members:
   parts=Path(member.name).parts
   if member.name.startswith('/') or '..' in parts:raise ValueError('Unsafe archive member')
   member.name='/'.join(parts[1:])
   if member.name:archive.extract(member,target,filter='data')
extract('ffmpegwasm-recipe',context)
names=['ffmpeg','x264','x265','libvpx','lame','ogg','theora','opus','vorbis','zlib','libwebp','freetype2','fribidi','harfbuzz','libass','zimg','sdl2']
for name in names:extract(name,context/'locked-sources'/name)
extract('zimg-googletest',context/'locked-sources/zimg/test/extra/googletest')
# Preserve upstream source archives; only bound concurrency in copied build recipes.
for script in (context/'build').glob('*.sh'):
 text=script.read_text();text=re.sub(r'(?<![\w-])-j(?![\w=])', '-j2', text);script.write_text(text)
# Preserve every configured HarfBuzz library and header. The upstream install
# target also builds unshipped noinst test programs; its Node15 optimizer crashed
# under the observed amd64 emulator. Use the upstream full-library target and
# generated Automake install targets instead, without changing library source.
harfbuzz=context/'build/harfbuzz.sh'
text=harfbuzz.read_text()
if text.count('emmake make install -j2')!=1:raise ValueError('Unexpected HarfBuzz install recipe')
text=text.replace('emmake make install -j2','emmake make -C src libs -j2\nemmake make -C src install-libLTLIBRARIES install-pkgconfigDATA install-pkgincludeHEADERS install-nodist_pkgincludeHEADERS install-cmakeDATA -j2')
harfbuzz.write_text(text)

debs=context/'locked-debs';debs.mkdir()
for row in lock['apt']['downloadedDebs']:
 path=sources/'rebuild/core-toolchain-lock/debs'/row['filename'];data=path.read_bytes()
 if len(data)!=row['bytes'] or hashlib.sha256(data).hexdigest()!=row['sha256']:raise ValueError('Deb integrity mismatch')
 shutil.copyfile(path,debs/row['filename'])
file=context/'Dockerfile';dockerfile=file.read_text()
dockerfile=re.sub(r'^# syntax=.*\n','',dockerfile)
dockerfile=dockerfile.replace('FROM emscripten/emsdk:3.1.40 AS emsdk-base','FROM --platform=linux/amd64 '+lock['toolchains']['core']['immutableImage']+' AS emsdk-base')
dockerfile=re.sub(r'RUN apt-get update && \\\n\s+apt-get install -y pkg-config autoconf automake libtool ragel','COPY locked-debs /locked-debs\nRUN dpkg -i /locked-debs/*.deb',dockerfile,count=1)
repos={'FFmpeg/FFmpeg':'ffmpeg','ffmpegwasm/x264':'x264','ffmpegwasm/x265':'x265','ffmpegwasm/libvpx':'libvpx','ffmpegwasm/lame':'lame','ffmpegwasm/Ogg':'ogg','ffmpegwasm/theora':'theora','ffmpegwasm/opus':'opus','ffmpegwasm/vorbis':'vorbis','ffmpegwasm/zlib':'zlib','ffmpegwasm/libwebp':'libwebp','ffmpegwasm/freetype2':'freetype2','fribidi/fribidi':'fribidi','harfbuzz/harfbuzz':'harfbuzz','libass/libass':'libass'}
for repo,name in repos.items():
 pattern=r'ADD https://github.com/'+re.escape(repo)+r'\.git#\$\w+ /src'
 dockerfile,count=re.subn(pattern,'COPY locked-sources/'+name+' /src',dockerfile)
 if count!=1:raise ValueError('Unexpected recipe source pattern: '+name)
dockerfile=dockerfile.replace('RUN apt-get update && apt-get install -y git\n','')
dockerfile=re.sub(r'RUN git clone --recursive -b \$ZIMG_BRANCH[^\n]+','COPY locked-sources/zimg /src',dockerfile)
dockerfile=dockerfile.replace('RUN embuilder build sdl2 sdl2-mt','COPY locked-sources/sdl2 /locked-sdl2\nENV EMCC_LOCAL_PORTS=sdl2=/locked-sdl2\nRUN embuilder build sdl2')
if 'ADD https://' in dockerfile or 'RUN git clone' in dockerfile or 'apt-get' in dockerfile:raise ValueError('Mutable/network build source remains')
dockerfile=dockerfile.replace('RUN dpkg -i /locked-debs/*.deb', 'RUN dpkg -i /locked-debs/*.deb\nENV MAKEFLAGS=-j2 CMAKE_BUILD_PARALLEL_LEVEL=2 EMCC_CORES=2\nRUN printf \"int main(void) { return 0; }\\n\" > /tmp/codec-cache.c && emcc /tmp/codec-cache.c -O3 -msimd128 -o /tmp/codec-cache.js')
file.write_text(dockerfile)
(context/'SOURCE-LOCK.json').write_bytes((here/'source-lock.json').read_bytes())
print(json.dumps({'prepared':True,'context':str(context),'coreCompiled':False,'sourceTreePins':len(names)+1,'image':lock['toolchains']['core']['immutableImage'],'network':'none','command':['docker','--context','colima','build','--network=none','--platform=linux/amd64','--build-arg','FFMPEG_ST=yes','--build-arg','EXTRA_CFLAGS=-O3 -msimd128','--output','type=local,dest=./owned-core-output',str(context)]},indent=2))
