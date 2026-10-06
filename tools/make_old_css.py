#!/usr/bin/env python3
"""Génère old.css à partir de style.css pour les vieux navigateurs (télé Samsung Tizen 4 = Chrome 56).

Ces navigateurs ignorent « gap » en flexbox et la grille CSS. On traduit :
  - gap en flexbox      -> marges entre enfants (sel > * + *)
  - display: grid       -> blocs en ligne avec largeurs calculées
Relancer après chaque modification de style.css :  python3 tools/make_old_css.py
"""
import re, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
css = open(os.path.join(ROOT, 'style.css'), encoding='utf-8').read()
css = re.sub(r'/\*.*?\*/', '', css, flags=re.S)

# ---- découpage en règles (un niveau de @media) ----
rules = []  # (media, selector, {prop: value})
def parse(block, media):
    i = 0
    while True:
        m = re.search(r'([^{}]+)\{', block[i:])
        if not m:
            break
        head = m.group(1).strip()
        start = i + m.end()
        if head.startswith('@media'):
            depth, j = 1, start
            while depth:
                if block[j] == '{': depth += 1
                elif block[j] == '}': depth -= 1
                j += 1
            parse(block[start:j - 1], head[len('@media'):].strip())
            i = j
            continue
        end = block.index('}', start)
        body = block[start:end]
        decls = {}
        for d in body.split(';'):
            if ':' in d:
                k, v = d.split(':', 1)
                decls[k.strip()] = v.strip()
        if not head.startswith('@'):
            rules.append((media, head, decls))
        i = end + 1
parse(css, None)

# direction / wrap / display définis n'importe où pour un même sélecteur
by_sel = {}
for media, sel, d in rules:
    by_sel.setdefault(sel, {}).update(d)

def kids(sel, suffix):
    return ', '.join(s.strip() + ' > ' + suffix for s in sel.split(','))

out = []
def emit(media, sel, body):
    out.append((media, sel + ' { ' + body + ' }'))

for media, sel, d in rules:
    if 'gap' not in d and d.get('display') != 'grid':
        continue
    allp = dict(by_sel.get(sel, d))
    # « .tvw .memo.tv { gap } » : la grille vient de la règle « .memo »
    if 'display' not in allp:
        last = re.split(r'[\s>+~]+', sel.split(',')[0].strip())[-1]
        mine = set(re.findall(r'\.([\w-]+)', last))
        for full, decls in by_sel.items():
            lc = re.split(r'[\s>+~]+', full.split(',')[0].strip())[-1]
            cls = set(re.findall(r'\.([\w-]+)', lc))
            if cls and cls <= mine and decls.get('display') == 'grid':
                for k in ('display', 'grid-template-columns', 'grid-auto-flow', 'align-items'):
                    if k in decls and k not in allp: allp[k] = decls[k]
    g = d.get('gap') or allp.get('gap') or '0px'
    parts = g.split()
    row, col = parts[0], parts[1] if len(parts) > 1 else parts[0]
    disp = allp.get('display', '')
    if disp == 'grid':
        tpl = allp.get('grid-template-columns')
        if not tpl and 'column' in allp.get('grid-auto-flow', ''):
            emit(media, sel, 'display: flex;')
            emit(media, kids(sel, '*'), 'flex: 1 1 0%; min-width: 0;')
            emit(media, kids(sel, '* + *'), 'margin-left: %s;' % col)
            continue
        rep = re.match(r'repeat\(\s*(\d+)', tpl or '')
        toks = re.sub(r'minmax\([^)]*\)', 'X', tpl or 'X').split()
        n = int(rep.group(1)) if rep else len(toks)
        fixed = None if rep else (toks[0] if toks[0].endswith('px') else None)
        va = 'middle' if allp.get('align-items') == 'center' else 'top'
        emit(media, sel, 'display: block; font-size: inherit;')
        emit(media, kids(sel, '*'), 'display: inline-flex !important; vertical-align: %s; box-sizing: border-box; margin-left: %s;' % (va, col))
        emit(media, kids(sel, 'input') + ', ' + kids(sel, 'select'), 'display: inline-block !important;')
        if fixed and n == 2:
            emit(media, kids(sel, '*:nth-child(2n+1)'), 'width: %s !important;' % fixed)
            emit(media, kids(sel, '*:nth-child(2n)'), 'width: calc(100%% - %s - %s - 1px) !important;' % (fixed, col))
        else:
            emit(media, kids(sel, '*'), 'width: calc((100%% - %d * %s) / %d - 1px) !important;' % (n - 1, col, n))
        emit(media, kids(sel, '*:nth-child(%dn+1)' % n), 'margin-left: 0;')
        emit(media, kids(sel, '*:nth-child(n+%d)' % (n + 1)), 'margin-top: %s;' % row)
        continue
    direction = allp.get('flex-direction', 'row')
    wrap = 'wrap' in allp.get('flex-wrap', '')
    if direction.startswith('column'):
        emit(media, kids(sel, '* + *'), 'margin-top: %s; margin-left: 0;' % row)
    elif wrap:
        emit(media, kids(sel, '*'), 'margin-right: %s; margin-bottom: %s;' % (col, row))
    else:
        emit(media, kids(sel, '* + *'), 'margin-left: %s;' % col)

# ---- espacements écrits directement dans les écrans (style="...gap:...") ----
app = open(os.path.join(ROOT, 'app.js'), encoding='utf-8').read()
done = set()
for attrs in re.findall(r'<[a-z0-9]+ ([^>]*style="[^"]*gap:[^"]*"[^>]*)>', app):
    style = re.search(r'style="([^"]*)"', attrs).group(1)
    cls = re.search(r'class="([^"]*)"', attrs)
    classes = cls.group(1).split() if cls else []
    sel = ''.join('.' + c for c in classes) + '[style="' + style + '"]'
    if sel in done:
        continue
    done.add(sel)
    d = {}
    for c in classes:
        for full, decls in by_sel.items():
            for one in full.split(','):
                if re.split(r'[\s>+~]+', one.strip())[-1] == '.' + c:
                    d.update(decls)
    for part in style.split(';'):
        if ':' in part:
            k, v = part.split(':', 1)
            d[k.strip()] = v.strip()
    g = d['gap'].split()
    row, col = g[0], g[1] if len(g) > 1 else g[0]
    if d.get('flex-direction', 'row').startswith('column'):
        emit(None, sel + ' > * + *', 'margin-top: %s; margin-left: 0;' % row)
    elif 'wrap' in d.get('flex-wrap', ''):
        emit(None, sel + ' > *', 'margin-right: %s; margin-bottom: %s;' % (col, row))
    else:
        emit(None, sel + ' > * + *', 'margin-left: %s;' % col)

lines = ['/* Généré par tools/make_old_css.py à partir de style.css — ne pas modifier à la main.',
         '   Chargé uniquement par les vieux navigateurs (sans gap en flexbox ni grille CSS). */']
cur = None
for media, rule in out:
    if media != cur:
        if cur is not None: lines.append('}')
        if media is not None: lines.append('@media ' + media + ' {')
        cur = media
    lines.append(('  ' if media else '') + rule)
if cur is not None: lines.append('}')
open(os.path.join(ROOT, 'old.css'), 'w', encoding='utf-8').write('\n'.join(lines) + '\n')
print('old.css :', len(out), 'règles')
