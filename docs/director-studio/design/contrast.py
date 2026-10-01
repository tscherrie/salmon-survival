def hx(h):
    h=h.lstrip('#'); return tuple(int(h[i:i+2],16)/255 for i in (0,2,4))
def lin(c): return c/12.92 if c<=0.04045 else ((c+0.055)/1.055)**2.4
def L(rgb): r,g,b=[lin(c) for c in rgb]; return 0.2126*r+0.7152*g+0.0722*b
def mix(fg,a,bg): return tuple(f*a+b*(1-a) for f,b in zip(fg,bg))
def cr(a,b):
    la,lb=L(a),L(b); return (max(la,lb)+0.05)/(min(la,lb)+0.05)
def tohex(rgb): return '#'+''.join(f'{round(c*255):02X}' for c in rgb)
D=dict(well='#09090A',base='#0F0F10',panel='#141415',raised='#1A1A1C',hover='#222224',active='#2A2A2D',sunken='#0B0B0C',
 line='#242426',line2='#2E2E31',line3='#3D3D41',text='#ECE9E4',text2='#AAA69F',text3='#8C8881',text4='#5C5954',
 accent='#F0A458',accenthi='#F5B677',accenttext='#F3B06C',accentline='#F0A458',onaccent='#1A1006',
 ref='#9DBDD8',reftext='#B4CDE2',onref='#0B1620',focus='#F2EFEA',ok='#7EBF8E',warn='#E0C070',danger='#E8705F',
 tv='#A7AEB4',tov='#B9B2A6',tt='#CFC6B8',tvo='#8FB8A0',tmu='#C4AC72',tsx='#C29790', refmedia='#A9CBEA')
Lt=dict(well='#161618',base='#E3E2DE',panel='#F2F1EE',raised='#FFFFFF',hover='#E9E8E4',active='#DEDDD8',sunken='#D9D8D3',
 line='#D3D1CC',line2='#C6C4BE',line3='#ADABA4',text='#1A1A1B',text2='#4B4945',text3='#615E59',text4='#A3A09A',
 accent='#E0923F',accenthi='#E89E4F',accenttext='#874709',accentline='#B05A0A',onaccent='#1A1006',
 ref='#2F6690',reftext='#255680',onref='#FFFFFF',focus='#1A1A1B',ok='#2A7044',warn='#7A5D0C',danger='#A93A2B',
 tv='#5E666D',tov='#6E675C',tt='#6F675B',tvo='#3F7A5A',tmu='#7A631C',tsx='#9A4F45')
def rep(T,name,soft_acc,soft_ref):
    g=lambda k:hx(T[k])
    rows=[]
    for fg in ['text','text2','text3']:
        for bg in ['base','panel','raised','hover']:
            rows.append((f'--{fg} / --{bg}',cr(g(fg),g(bg))))
    rows.append(('--text-3 / --sunken',cr(g('text3'),g('sunken'))))
    for fg in ['accenttext']:
        for bg in ['base','panel','raised']: rows.append((f'--accent-text / --{bg}',cr(g(fg),g(bg))))
    asoft=mix(g('accent'),soft_acc,g('base')); rows.append(('--accent-text / --accent-soft(@base)',cr(g('accenttext'),asoft)))
    rows.append(('--on-accent / --accent',cr(g('onaccent'),g('accent'))))
    rows.append(('--on-accent / --accent-hi',cr(g('onaccent'),g('accenthi'))))
    for bg in ['base','panel','raised']: rows.append((f'--ref-text / --{bg}',cr(g('reftext'),g(bg))))
    rs=mix(g('ref'),soft_ref,g('panel')); rows.append(('--ref-text / --ref-soft(@panel)',cr(g('reftext'),rs)))
    rows.append(('--on-ref / --ref',cr(g('onref'),g('ref'))))
    rows.append(('--ref / --base (UI)',cr(g('ref'),g('base'))))
    rows.append(('--ref / --sunken (marker tag)',cr(g('ref'),g('sunken'))))
    rows.append(('--accent-line / --base (playhead)',cr(g('accentline'),g('base'))))
    rows.append(('--focus / --base',cr(g('focus'),g('base'))))
    rows.append(('--focus / --panel',cr(g('focus'),g('panel'))))
    rows.append(('--focus / --raised',cr(g('focus'),g('raised'))))
    for k in ['ok','warn','danger']:
        rows.append((f'--{k} / --panel',cr(g(k),g('panel'))))
        rows.append((f'--{k} / --raised',cr(g(k),g('raised'))))
    rows.append(('--line-3 / --base (ticks, UI)',cr(g('line3'),g('base'))))
    rows.append(('--line-2 / --panel',cr(g('line2'),g('panel'))))
    for k in ['tv','tov','tt','tvo','tmu','tsx']:
        rows.append((f'track {k} / --base',cr(g(k),g('base'))))
    print('##',name)
    for n,v in rows: print(f'{n:42s} {v:6.2f}')
rep(D,'dark',0.13,0.13)
rep(Lt,'light',0.16,0.10)
# always-dark chrome on well
g=lambda k:hx(D[k])
print('text3/well',round(cr(g('text3'),g('well')),2),'text/well',round(cr(g('text'),g('well')),2),'ref-media/well',round(cr(g('refmedia'),g('well')),2), 'onref/refmedia', round(cr(hx('#0B1620'),g('refmedia')),2), 'refmedia vs white', round(cr(g('refmedia'),hx('#FFFFFF')),2))
# light theme deltas base vs panel
print('light base vs panel', round(cr(hx(Lt['base']),hx(Lt['panel'])),3), 'dark base vs panel', round(cr(hx(D['base']),hx(D['panel'])),3))
print('accent-soft dark composite', tohex(mix(hx(D['accent']),0.13,hx(D['base']))), 'ref-soft dark@panel', tohex(mix(hx(D['ref']),0.13,hx(D['panel']))))
print('accent-soft light composite', tohex(mix(hx(Lt['accent']),0.16,hx(Lt['base']))), 'ref-soft light@panel', tohex(mix(hx(Lt['ref']),0.10,hx(Lt['panel']))))
# Einreihen soft button: text on raised etc
